#!/usr/bin/env node
// @ts-check
// plan-dispatch.mjs — how many sub-agents a review dispatches, and in what grouping (A/B round 2
// item 6, plan feat/pr-reviewer-shrink-fanout-ab).
//
// A/B round 2 measured wall-clock and tokens as dominated by SUB-AGENT COUNT: every dispatch pays
// a ~110-160k-token base before it reads a line of the diff, and round 2's arms ran 22 (t=0.8)
// and 33 (t=1.0) of them. Two groupings produced most of that count and neither changed what a
// review finds:
//
//   1. one verifier dispatch PER CANDIDATE — packed here into batches of at most
//      VERIFY_BATCH_MAX candidates, with no two candidates that share a `path` in one batch
//      (skills/quality/pr-review/SKILL.md Step e's hard rule, unchanged);
//   2. one dispatch per LENS — holistic, optimality and measurability now share one lens-bundle
//      dispatch. standards-conformance stays its own dispatch (SKILL.md Step c: the lens and the
//      standards finder are two separate dispatches, and the bundle is neither).
//
// Two things are deliberately NOT packed: finders (A/B round 1: the arm that ran intent/standards/
// quality in one context missed the best-corroborated bug), and correctness votes (diversify-then-
// vote needs each vote in its own context, or the votes are one opinion counted N times).
//
// resolveBudget() (route-depth.mjs) decides WHICH units exist; this module decides HOW THEY ARE
// GROUPED into dispatches and messages. rules/dispatch-topology.md owns the prose contract,
// rules/depth-routing.md § Expected sub-agents per band carries the table `--table` prints, and
// L1 G84g diffs the two.
//
// Usage:
//   node plan-dispatch.mjs --verifier-batches <candidates.json> [--batch-max <n>]
//       <candidates.json>: a JSON array, or an object with `candidates` or `kept` (deduped.json).
//       Prints { batchMax, maxParallel, batches: [{id, members, paths}], messages: [[id…]] }.
//   node plan-dispatch.mjs --count --thoroughness <t> [--routed-tier <tier>] [--candidates <n>]
//       [--depth-capability <cap>] [--dispatch-unavailable]
//       Prints the dispatch plan for that budget — packed and unpacked counts side by side.
//   node plan-dispatch.mjs --table
//       Prints the depth-routing.md table rows.
//   node plan-dispatch.mjs --self-test

import { readFileSync } from "node:fs";
import { resolveBudget } from "./route-depth.mjs";

/** Sub-agent dispatches per message — the concurrency cap. rules/dispatch-topology.md and
 *  skills/quality/pr-review/SKILL.md state the same number; L1 G84g holds all three equal. */
export const PR_REVIEW_MAX_PARALLEL = 6;

/** Candidates per verifier dispatch. A batch's own verification work stays well under the
 *  dispatch's base cost at 8, while 8 still cuts a 20-candidate run from 20 dispatches to 3. */
export const VERIFY_BATCH_MAX = 8;

/** The lenses that share one dispatch. standards-conformance is excluded on purpose. */
export const LENS_BUNDLE = Object.freeze(["holistic", "optimality", "measurability"]);

/** finders.md's own table order — the order units are listed, so a plan is deterministic. */
const FINDER_ORDER = ["correctness", "consumer-impact", "dependency", "intent", "standards", "quality"];

/**
 * @typedef {{ kind: "finder"|"lens-bundle"|"lens"|"verifier", id: string, finder?: string,
 *   lenses?: string[], members?: number[] }} Unit
 * @typedef {import("./route-depth.mjs").Budget} Budget
 */

/**
 * One unit per active finder; `correctness` expands to one unit per vote.
 * @param {Budget} budget
 * @returns {Unit[]}
 */
export function finderUnits(budget) {
  if (budget.topology !== "parallel") return [];
  /** @type {Unit[]} */
  const units = [];
  for (const f of FINDER_ORDER) {
    if (!budget.finders[/** @type {keyof Budget["finders"]} */ (f)]) continue;
    if (f === "correctness" && budget.correctnessVotes > 1) {
      for (let v = 1; v <= budget.correctnessVotes; v++) {
        units.push({ kind: "finder", id: `correctness#${v}`, finder: f });
      }
    } else {
      units.push({ kind: "finder", id: f, finder: f });
    }
  }
  return units;
}

/**
 * The lens dispatches. `skip` names lenses a run turned off by flag or by its own gate
 * (`--no-holistic`, the incremental-mode 2.4 skip, `TRIVIAL_SKIP`, …).
 * @param {Budget} budget
 * @param {{ skip?: string[], packing?: boolean }} [opts]
 * @returns {Unit[]}
 */
export function lensUnits(budget, opts = {}) {
  if (budget.topology !== "parallel") return [];
  const skip = new Set(opts.skip ?? []);
  const packing = opts.packing ?? true;
  /** @type {string[]} */
  const bundle = [];
  if (budget.holisticBroadPass && !skip.has("holistic")) bundle.push("holistic");
  if (budget.optimalityLens && !skip.has("optimality")) bundle.push("optimality");
  if (budget.measurabilityLens && !skip.has("measurability")) bundle.push("measurability");
  /** @type {Unit[]} */
  const units = [];
  if (packing && bundle.length > 0) {
    units.push({ kind: "lens-bundle", id: "lens-bundle", lenses: bundle });
  } else {
    for (const l of bundle) units.push({ kind: "lens", id: l, lenses: [l] });
  }
  // Tied to the standards FINDER's activation, exactly as pr-reviewer.md Step 2.4d gates it.
  if (budget.finders.standards && !skip.has("standards-conformance")) {
    units.push({ kind: "lens", id: "standards-conformance", lenses: ["standards-conformance"] });
  }
  return units;
}

/**
 * Partition candidates into verifier batches: at most `batchMax` per batch, and no two candidates
 * that share a `path` in one batch. The batch count is the smallest that satisfies both —
 * `max(ceil(n / batchMax), largest same-path group)` — and loads differ by at most one.
 *
 * Groups are placed largest first, each member into a different least-loaded batch. Placing g
 * members into the g least-loaded of B batches keeps every load within one of every other, so the
 * fullest batch holds ceil(n / B) <= batchMax. A candidate with no string `path` (an anchorless
 * finding) is its own group: it shares a file with nothing.
 * @param {Array<{ path?: unknown }>} candidates
 * @param {{ batchMax?: number }} [opts]
 */
export function planVerifierBatches(candidates, opts = {}) {
  const batchMax = opts.batchMax ?? VERIFY_BATCH_MAX;
  if (!Number.isInteger(batchMax) || batchMax < 1) {
    throw new Error(`batchMax must be a positive integer, got ${JSON.stringify(batchMax)}`);
  }
  if (!Array.isArray(candidates)) throw new Error("candidates must be an array");
  /** @param {number} i */
  const keyOf = (i) => {
    const p = candidates[i]?.path;
    return typeof p === "string" && p !== "" ? p : `\u0000anchorless#${i}`;
  };
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  candidates.forEach((_, i) => {
    const k = keyOf(i);
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  });
  const n = candidates.length;
  const largestGroup = Math.max(0, ...[...groups.values()].map((g) => g.length));
  const batchCount = n === 0 ? 0 : Math.max(Math.ceil(n / batchMax), largestGroup);
  /** @type {number[][]} */
  const loads = Array.from({ length: batchCount }, () => []);
  const ordered = [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [, members] of ordered) {
    const leastLoaded = loads.map((_, k) => k)
      .sort((x, y) => loads[x].length - loads[y].length || x - y);
    members.forEach((ci, j) => loads[leastLoaded[j]].push(ci));
  }
  const batches = loads.map((members, k) => {
    members.sort((x, y) => x - y);
    return {
      id: `v${String(k + 1).padStart(2, "0")}`,
      members,
      paths: members.map((i) => {
        const p = candidates[i]?.path;
        return typeof p === "string" ? p : null;
      }),
    };
  });
  return { batchMax, largestGroup, batches };
}

/**
 * Chunk units into messages of at most `maxParallel` dispatches. Messages go out one at a time:
 * the next is sent only after every dispatch in the current one has returned.
 * @template T
 * @param {T[]} units
 * @param {{ maxParallel?: number }} [opts]
 * @returns {T[][]}
 */
export function planMessages(units, opts = {}) {
  const maxParallel = opts.maxParallel ?? PR_REVIEW_MAX_PARALLEL;
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    throw new Error(`maxParallel must be a positive integer, got ${JSON.stringify(maxParallel)}`);
  }
  /** @type {T[][]} */
  const out = [];
  for (let i = 0; i < units.length; i += maxParallel) out.push(units.slice(i, i + maxParallel));
  return out;
}

/**
 * The whole plan for one budget. `candidates` is either the surviving candidates (their paths
 * decide the batches) or a count, read as that many candidates on distinct paths — the lower
 * bound, which is what the depth-routing.md table states.
 * @param {Budget} budget
 * @param {{ candidates?: Array<{ path?: unknown }> | number, skip?: string[], packing?: boolean,
 *   batchMax?: number, maxParallel?: number }} [opts]
 */
export function planDispatch(budget, opts = {}) {
  const packing = opts.packing ?? true;
  const batchMax = packing ? (opts.batchMax ?? VERIFY_BATCH_MAX) : 1;
  const finders = finderUnits(budget);
  const lenses = lensUnits(budget, { skip: opts.skip, packing });
  const raw = opts.candidates ?? 0;
  const candidates = typeof raw === "number"
    ? Array.from({ length: Math.max(0, Math.floor(raw)) }, (_, i) => ({ path: `distinct-${i}` }))
    : raw;
  /** @type {Unit[]} */
  const verifiers = budget.topology === "parallel"
    ? planVerifierBatches(candidates, { batchMax }).batches
      .map((b) => ({ kind: "verifier", id: b.id, members: b.members }))
    : [];
  const phaseD = [...finders, ...lenses];
  const maxParallel = opts.maxParallel ?? PR_REVIEW_MAX_PARALLEL;
  return {
    topology: budget.topology,
    finders: finders.length,
    lenses: lenses.length,
    verifiers: verifiers.length,
    subagents: finders.length + lenses.length + verifiers.length,
    messages: {
      phaseD: planMessages(phaseD, { maxParallel }).length,
      phaseE: planMessages(verifiers, { maxParallel }).length,
    },
    units: { phaseD, phaseE: verifiers },
  };
}

/* ------------------------------ the doc table ------------------------------ */

/** The bands, keyed by a representative `t` at each band's lower edge (0 for the first). */
export const TABLE_BANDS = Object.freeze([
  { label: "`t < 0.4`", t: 0 },
  { label: "`0.4 ≤ t < 0.5`", t: 0.4 },
  { label: "`0.5 ≤ t < 0.7`", t: 0.5 },
  { label: "`0.7 ≤ t < 0.8`", t: 0.7 },
  { label: "`0.8 ≤ t < 0.95`", t: 0.8 },
  { label: "`t ≥ 0.95`", t: 0.95 },
]);

/** The candidate count the table's total columns assume. */
export const TABLE_CANDIDATES = 10;

/** @returns {string[]} the header, separator, and one row per band */
export function tableRows() {
  const rows = [
    `| Band | Finder dispatches | Lens dispatches | Verifier dispatches | Total at ${TABLE_CANDIDATES} candidates | Before packing |`,
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const band of TABLE_BANDS) {
    const budget = resolveBudget({ thoroughness: band.t });
    const packed = planDispatch(budget, { candidates: TABLE_CANDIDATES });
    const unpacked = planDispatch(budget, { candidates: TABLE_CANDIDATES, packing: false });
    const bundle = packed.units.phaseD.find((u) => u.kind === "lens-bundle");
    const lensCell = packed.lenses === 0 ? "0"
      : `${packed.lenses} (${[bundle ? bundle.lenses?.join(" + ") : null,
        packed.units.phaseD.some((u) => u.id === "standards-conformance") ? "standards-conformance" : null]
        .filter(Boolean).join("; ")})`;
    const verifierCell = budget.topology === "parallel" ? `⌈V / ${VERIFY_BATCH_MAX}⌉` : "0 (in-context)";
    rows.push(`| ${band.label} | ${packed.finders} | ${lensCell} | ${verifierCell} | ${packed.subagents} | ${unpacked.subagents} |`);
  }
  return rows;
}

/* --------------------------------- self-test --------------------------------- */

function selfTest() {
  let passed = 0;
  /** @type {string[]} */
  const fails = [];
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const check = (name, ok, detail = "") => {
    if (ok) { passed++; console.log(`  ✓ ${name}`); } else { fails.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };
  /** @param {string[]} paths */
  const cands = (paths) => paths.map((path) => ({ path }));
  /** @param {ReturnType<typeof planVerifierBatches>} plan @param {number} n */
  const isPartition = (plan, n) => {
    const seen = plan.batches.flatMap((b) => b.members).sort((a, b) => a - b);
    return seen.length === n && seen.every((v, i) => v === i);
  };
  /** @param {ReturnType<typeof planVerifierBatches>} plan */
  const pathDistinct = (plan) => plan.batches.every((b) => {
    const ps = b.paths.filter((p) => p !== null);
    return new Set(ps).size === ps.length;
  });

  // ---- planVerifierBatches ----
  check("no candidates → no batches", planVerifierBatches([]).batches.length === 0);

  const distinct20 = planVerifierBatches(cands(Array.from({ length: 20 }, (_, i) => `f${i}.ts`)));
  check("20 candidates on distinct paths → 3 batches (⌈20/8⌉), loads 7/7/6",
    distinct20.batches.length === 3
      && JSON.stringify(distinct20.batches.map((b) => b.members.length).sort()) === JSON.stringify([6, 7, 7]),
    JSON.stringify(distinct20.batches.map((b) => b.members.length)));
  check("every candidate lands in exactly one batch", isPartition(distinct20, 20));

  const mixedPaths = ["a.ts", "a.ts", "a.ts", "b.ts", "b.ts", "c.ts", "d.ts", "e.ts", "e.ts", "f.ts",
    "g.ts", "h.ts", "a.ts", "i.ts", "j.ts", "k.ts", "l.ts", "m.ts"];
  const mixed = planVerifierBatches(cands(mixedPaths));
  check("no batch holds two candidates that share a path", pathDistinct(mixed));
  check("mixed paths: still a partition, and every batch within batchMax",
    isPartition(mixed, mixedPaths.length) && mixed.batches.every((b) => b.members.length <= VERIFY_BATCH_MAX));
  check("mixed paths: batch count is max(⌈18/8⌉, largest group 4) = 4",
    mixed.batches.length === 4 && mixed.largestGroup === 4, String(mixed.batches.length));
  const loadsMixed = mixed.batches.map((b) => b.members.length);
  check("loads differ by at most one", Math.max(...loadsMixed) - Math.min(...loadsMixed) <= 1, JSON.stringify(loadsMixed));

  const onePath = planVerifierBatches(cands(Array.from({ length: 10 }, () => "hot.ts")));
  check("10 candidates on ONE path → 10 single-candidate batches (the path rule wins over batchMax)",
    onePath.batches.length === 10 && onePath.batches.every((b) => b.members.length === 1));

  const anchorless = planVerifierBatches([{ path: undefined }, { path: "" }, {}, { path: "x.ts" }]);
  check("candidates with no path are each their own group (batched together, never refused)",
    anchorless.batches.length === 1 && anchorless.batches[0].members.length === 4);

  const again = planVerifierBatches(cands(mixedPaths));
  check("deterministic: the same input plans the same batches", JSON.stringify(again) === JSON.stringify(mixed));

  let threw = 0;
  for (const bad of [0, -1, 1.5, NaN]) {
    try { planVerifierBatches(cands(["a"]), { batchMax: bad }); } catch { threw++; }
  }
  check("an invalid batchMax (0, -1, 1.5, NaN) throws rather than planning", threw === 4);

  // ---- planMessages ----
  const msgs = planMessages(Array.from({ length: 14 }, (_, i) => i));
  check("14 units at the default cap → messages of 6, 6, 2",
    JSON.stringify(msgs.map((m) => m.length)) === JSON.stringify([6, 6, 2]));
  check("no message exceeds PR_REVIEW_MAX_PARALLEL", msgs.every((m) => m.length <= PR_REVIEW_MAX_PARALLEL));

  // ---- planDispatch at the tier defaults ----
  const quick = planDispatch(resolveBudget({ routedTier: "quick" }), { candidates: 10 });
  check("quick (t=0.2): in-context, zero sub-agents", quick.topology === "in-context" && quick.subagents === 0);

  const standard = planDispatch(resolveBudget({ routedTier: "standard" }), { candidates: 10 });
  check("standard (t=0.5): 6 finders, 2 lens dispatches, 2 verifier batches → 10",
    standard.finders === 6 && standard.lenses === 2 && standard.verifiers === 2 && standard.subagents === 10,
    JSON.stringify({ f: standard.finders, l: standard.lenses, v: standard.verifiers }));

  const deep = planDispatch(resolveBudget({ routedTier: "deep" }), { candidates: 10 });
  const deepBundle = deep.units.phaseD.find((u) => u.kind === "lens-bundle");
  check("deep (t=0.8): 3 correctness votes + 5 finders = 8 finder dispatches", deep.finders === 8);
  check("deep: holistic + optimality + measurability share ONE lens-bundle dispatch",
    JSON.stringify(deepBundle?.lenses) === JSON.stringify(["holistic", "optimality", "measurability"]));
  check("deep: standards-conformance is its own dispatch, never in the bundle",
    deep.units.phaseD.some((u) => u.id === "standards-conformance" && u.kind === "lens")
      && !deepBundle?.lenses?.includes("standards-conformance"));
  check("deep: each correctness vote is its own dispatch",
    deep.units.phaseD.filter((u) => u.finder === "correctness").length === 3);

  const ceiling = planDispatch(resolveBudget({ effortHigh: true, routedTier: "deep" }), { candidates: 10 });
  check("--effort high (t=1): 5 votes + 5 finders = 10 finder dispatches, 14 sub-agents at 10 candidates",
    ceiling.finders === 10 && ceiling.subagents === 14, String(ceiling.subagents));
  check("--effort high: phase D (12 units) takes 2 messages at the cap of 6", ceiling.messages.phaseD === 2);

  const noDispatch = planDispatch(resolveBudget({ routedTier: "deep", dispatchAvailable: false }), { candidates: 10 });
  check("no dispatch capability: zero sub-agents, whatever the thoroughness", noDispatch.subagents === 0);

  const diffOnly = planDispatch(resolveBudget({ routedTier: "deep", depthCapability: "diff-only" }), { candidates: 0 });
  check("diff-only at deep: consumer-impact is not dispatched (7 finders)",
    diffOnly.finders === 7 && !diffOnly.units.phaseD.some((u) => u.finder === "consumer-impact"));

  const skipped = planDispatch(resolveBudget({ routedTier: "deep" }), { skip: ["holistic", "optimality", "measurability"] });
  check("a lens skipped by its own gate leaves the bundle; an empty bundle is not dispatched",
    !skipped.units.phaseD.some((u) => u.kind === "lens-bundle") && skipped.lenses === 1);

  // ---- packing never costs a dispatch ----
  let regressed = "";
  for (const t of [0, 0.2, 0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 0.95, 1]) {
    for (const n of [0, 1, 5, 8, 9, 20, 40]) {
      const b = resolveBudget({ thoroughness: t });
      const p = planDispatch(b, { candidates: n });
      const u = planDispatch(b, { candidates: n, packing: false });
      if (p.subagents > u.subagents || p.finders !== u.finders) regressed ||= `t=${t} n=${n}: packed ${p.subagents} vs unpacked ${u.subagents}`;
    }
  }
  check("packing never dispatches more sub-agents than unpacked, and never merges a finder", regressed === "", regressed);

  // ---- the doc table ----
  const rows = tableRows();
  check("the table has a header, a separator, and one row per band", rows.length === 2 + TABLE_BANDS.length);
  check("the t < 0.4 row is zero sub-agents", /^\| `t < 0\.4` \| 0 \| 0 \| 0 \(in-context\) \| 0 \| 0 \|$/.test(rows[2]), rows[2]);

  console.log(`plan-dispatch self-test: ${passed}/${passed + fails.length}`);
  if (fails.length) {
    console.log(`✗ plan-dispatch self-test: ${fails.length} failed`);
    process.exit(1);
  }
  console.log(`✓ plan-dispatch self-test: all ${passed} cases passed`);
}

/* ------------------------------------ CLI ------------------------------------ */

/** @param {string[]} args @param {string} flag */
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return; }
  if (args.includes("--table")) { console.log(tableRows().join("\n")); return; }
  if (args.includes("--verifier-batches")) {
    const file = argValue(args, "--verifier-batches");
    if (!file) { console.error("usage: plan-dispatch.mjs --verifier-batches <candidates.json> [--batch-max <n>]"); process.exit(2); }
    const data = JSON.parse(readFileSync(file, "utf8"));
    const list = Array.isArray(data) ? data : Array.isArray(data?.candidates) ? data.candidates
      : Array.isArray(data?.kept) ? data.kept : null;
    if (list === null) { console.error("candidates file must be an array, or carry a `candidates` or `kept` array"); process.exit(2); }
    const bm = argValue(args, "--batch-max");
    const plan = planVerifierBatches(list, bm === undefined ? {} : { batchMax: Number(bm) });
    console.log(JSON.stringify({
      batchMax: plan.batchMax,
      maxParallel: PR_REVIEW_MAX_PARALLEL,
      batches: plan.batches,
      messages: planMessages(plan.batches.map((b) => b.id)),
    }, null, 2));
    return;
  }
  if (args.includes("--count")) {
    const t = argValue(args, "--thoroughness");
    const budget = resolveBudget({
      thoroughness: t === undefined ? undefined : Number(t),
      routedTier: /** @type {any} */ (argValue(args, "--routed-tier")),
      depthCapability: argValue(args, "--depth-capability"),
      dispatchAvailable: !args.includes("--dispatch-unavailable"),
    });
    const n = Number(argValue(args, "--candidates") ?? 0);
    const packed = planDispatch(budget, { candidates: n });
    const unpacked = planDispatch(budget, { candidates: n, packing: false });
    console.log(JSON.stringify({
      effectiveThoroughness: budget.effectiveThoroughness,
      topology: packed.topology,
      packed: { finders: packed.finders, lenses: packed.lenses, verifiers: packed.verifiers,
        subagents: packed.subagents, messages: packed.messages },
      unpacked: { finders: unpacked.finders, lenses: unpacked.lenses, verifiers: unpacked.verifiers,
        subagents: unpacked.subagents, messages: unpacked.messages },
      phaseD: packed.units.phaseD.map((u) => u.id + (u.lenses && u.kind === "lens-bundle" ? ` [${u.lenses.join(", ")}]` : "")),
    }, null, 2));
    return;
  }
  console.error("usage: plan-dispatch.mjs --verifier-batches <file> | --count --thoroughness <t> | --table | --self-test");
  process.exit(2);
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("plan-dispatch.mjs");
if (isEntryPoint) main();
