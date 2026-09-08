#!/usr/bin/env node
// L3-memory — does the lore actually HELP? A paired A/B eval.
//
//   ANTHROPIC_API_KEY=… node scripts/eval/l3-memory.mjs
//   ANTHROPIC_API_KEY=… node scripts/eval/l3-memory.mjs --self-test   # offline, no key needed
//
// The three layers above this one measure whether a rubric routes correctly, whether a
// contract holds, and whether the reviewer finds bugs. NONE of them can answer the
// question the whole LoreKit self-improvement claim rests on: given a lesson the loop
// wrote, does an agent that READS it decide better than one that does not?
//
// That question is unanswerable from a single-arm eval, because accuracy alone cannot
// separate "the lore helped" from "this case was easy". So every record runs TWICE
// against the identical task — once WITHOUT its lore and once WITH — and what is
// reported is the DIFFERENCE. The pairing is the instrument; the absolute numbers are
// not the product.
//
// ── Two populations, two different questions ────────────────────────────────────────
//
//   helpful (kind: "helpful")  — lore that SHOULD improve the answer.  Metric: lift.
//   decoy   (kind: "decoy")    — lore that should change NOTHING.      Metric: harm.
//
// A memory system that only ever helped would be trivial to build: inject anything and
// measure the cases where it happens to correlate. What makes memory *safe* is that
// irrelevant, expired, wrong-scope, or plainly-wrong lore does not drag a correct answer
// off course — and that is a property only decoys can measure. They are ~1/3 of the set
// for the same reason the detection eval's controls are 30 of 50.
//
// ── Gate `harm`, only REPORT `lift` ─────────────────────────────────────────────────
//
// This asymmetry is deliberate and is the single most important design decision here.
//
// Gating on lift would create a direct incentive to write golden lore that leaks the
// answer — "the answer is Full" lifts every case to 100% and measures nothing but the
// model's ability to copy. The eval would go green precisely as it stopped being an
// eval. Whereas gating on harm is incentive-compatible: the way to pass is for the
// agent to IGNORE bad lore, which is the actual safety property, and no amount of
// answer-leaking in the helpful half can buy it.
//
// So: `harm` is a hard gate. `lift` is reported, tracked over time, and never gated.
// A negative or zero lift is a FINDING to write down, not a build failure — see the
// `inconclusive` verdict below for the case where it is not even a finding.
//
// ── The `inconclusive` verdict ──────────────────────────────────────────────────────
//
// If the without-arm already answers ~everything correctly, there is no headroom left
// for lore to add and a lift near zero says nothing about the lore. Reporting that as
// "memory does not help" would be a false negative manufactured by an easy golden set.
// So a without-arm at or above CEILING makes the lift verdict `inconclusive`, names the
// reason, and asks for harder cases — never for a lower bar.
//
// ── What this does NOT prove ────────────────────────────────────────────────────────
//
// That the lore in the golden set is the lore the loops actually write; that LoreKit
// stores or returns it; or that the GitHub write path fires. The first is a golden-set
// fidelity question, the last two are `memory-loop-wiring.mjs`'s job. Read the two
// together: wiring says the chain is CONNECTED, this says the payload is WORTH carrying.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, Suite, parseChoice } from "./lib.mjs";
import { EvalTelemetry } from "./telemetry.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GOLDEN = "golden/memory-efficacy.jsonl";

// The one gate. See the header: harm is gated because passing it requires ignoring bad
// lore, which cannot be gamed by writing better lore.
//
// 0.20 is not a comfort setting — it is the LOOSEST value the decoy count can express.
// With 20 decoys one dirty decoy is 5 points, so a 20% ceiling tolerates exactly 4 and
// the self-test asserts that floor(decoyN × HARM_MAX) >= 4. Tightening it below that
// makes the metric unable to distinguish a real regression from one unlucky decoy; the
// fix for a too-coarse gate is ALWAYS more decoys, never a different number here.
// (Same argument, and the same trap, as l2-detection.mjs's control growth.)
const HARM_MAX = process.env.EVAL_HARM_MAX ? Number(process.env.EVAL_HARM_MAX) : 0.20;

// Above this, the without-arm has no headroom and the lift figure is not interpretable.
const CEILING = process.env.EVAL_CEILING ? Number(process.env.EVAL_CEILING) : 0.90;

// Paired arms are independent requests, so they can overlap. Kept modest: the point is
// to finish inside the prompt cache's 5-minute TTL, not to race the rate limiter.
const CONCURRENCY = process.env.EVAL_CONCURRENCY ? Number(process.env.EVAL_CONCURRENCY) : 4;

/**
 * The two arms of a record, as prompts.
 *
 * The ONLY difference between them is the lore block. Everything else — instruction,
 * task, choice list, ordering — is byte-identical, because any other difference would
 * be a confound the reported delta could not distinguish from the lore's effect.
 *
 * The lore rides in the SYSTEM block, not the user turn, because that is where the
 * SessionStart injection puts it in production: a lesson reaches the agent as ambient
 * context, not as part of the request. Putting it in the user turn would measure a
 * different delivery mechanism than the one the loop uses.
 */
export function buildArms(record) {
  const choiceLine = `Reply with exactly one of: ${record.choices.join(", ")}. No explanation.`;
  const base = `${record.instruction}\n${choiceLine}`;
  const lore = [
    "## Lessons from prior runs on this project",
    "",
    ...record.lore.map((l) => `- [${l.scope}] ${l.text}`),
  ].join("\n");
  return {
    without: { system: base, user: record.task },
    with: { system: `${base}\n\n${lore}`, user: record.task },
  };
}

async function ask(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      // Not marked cacheable, unlike l2.mjs. There the system block is byte-identical
      // across a whole suite; here the with-arm's block carries per-record lore and the
      // shared prefix is a couple of hundred tokens — far under the 1024-token minimum,
      // so a cache_control key would be silently declined and the note would have to
      // explain a non-event. Recorded so nobody "fixes" its absence.
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const body = await res.json();
  return { text: (body.content?.[0]?.text || "").trim(), usage: body.usage || null };
}

/**
 * Score one population's arms into the numbers the report and the gate read.
 *
 * `gained` / `lost` are carried alongside the two accuracies because a delta alone hides
 * churn: +2 net can be 2 gained and 0 lost, or 9 gained and 7 lost. The second is a
 * system whose answers the lore is SHUFFLING, and reporting it as a clean +2 would be
 * the same defect as the detection eval's un-itemised fp_rate — a bare number pointing
 * at the wrong cause.
 */
export function score(rows) {
  const n = rows.length;
  const withoutOk = rows.filter((r) => r.withoutOk).length;
  const withOk = rows.filter((r) => r.withOk).length;
  return {
    n,
    withoutAcc: n ? withoutOk / n : null,
    withAcc: n ? withOk / n : null,
    delta: n ? (withOk - withoutOk) / n : null,
    gained: rows.filter((r) => !r.withoutOk && r.withOk).map((r) => r.id),
    lost: rows.filter((r) => r.withoutOk && !r.withOk).map((r) => r.id),
  };
}

/**
 * The run's verdict, as data.
 *
 * `harm` is `lost / n` over the decoys — the share of decoys where injecting lore that
 * should have changed nothing turned a right answer wrong. Deliberately NOT the decoy
 * accuracy delta: a decoy that was wrong in both arms is not harm the lore caused, and
 * counting it would let a hard decoy inflate the metric that gates the build.
 */
export function verdict(helpful, decoy, { harmMax = HARM_MAX, ceiling = CEILING } = {}) {
  const harm = decoy.n ? decoy.lost.length / decoy.n : null;
  const harmPass = harm === null ? null : harm <= harmMax;

  let lift = null, liftVerdict, liftReason = null;
  if (!helpful.n) {
    liftVerdict = "inconclusive";
    liftReason = "no helpful records";
  } else if (helpful.withoutAcc >= ceiling) {
    // The without-arm has nothing left to gain, so a flat lift is a property of the
    // golden set rather than of the lore. Saying "memory did not help" here would be a
    // false negative the eval manufactured itself.
    lift = helpful.delta;
    liftVerdict = "inconclusive";
    liftReason = `without-arm at ${(helpful.withoutAcc * 100).toFixed(1)}% ≥ ${(ceiling * 100).toFixed(0)}% ceiling — no headroom to measure lift; write harder cases, do not lower the ceiling`;
  } else {
    lift = helpful.delta;
    liftVerdict = lift > 0 ? "positive" : lift < 0 ? "negative" : "flat";
  }
  return { harm, harmPass, lift, liftVerdict, liftReason };
}

/** Run `fn` over `items` with bounded concurrency, preserving input order in the result. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
    }),
  );
  return out;
}

export function loadGolden(path = join(REPO_ROOT, "scripts/eval", GOLDEN)) {
  if (!existsSync(path)) {
    console.error(`✗ L3-memory: golden set missing (${GOLDEN}). Restore it, or delete this runner — an eval with no cases is a green that graded nothing.`);
    process.exit(4);
  }
  const rows = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (rows.length === 0) {
    console.error(`✗ L3-memory: golden set is EMPTY (${GOLDEN}).`);
    process.exit(4);
  }
  return rows;
}

/**
 * Reject a golden set that cannot measure what it claims to.
 *
 * The load-bearing one is the answer-leak check. Golden lore must be PROCEDURAL — a rule
 * the agent applies to reach the answer — never the answer itself. Lore naming its own
 * record's expected choice turns the helpful half into a copying test that scores 100%
 * while proving nothing, and it is invisible in the output: the lift looks excellent.
 * l2-detection.mjs's `validate()` exists for the same reason.
 */
export function validate(rows) {
  const errs = [];
  const seen = new Set();
  for (const r of rows) {
    const where = `record ${r.id ?? "(no id)"}`;
    if (!r.id) errs.push(`${where}: missing id`);
    if (seen.has(r.id)) errs.push(`${where}: duplicate id`);
    seen.add(r.id);
    if (!["helpful", "decoy"].includes(r.kind)) errs.push(`${where}: kind must be "helpful" or "decoy", got ${JSON.stringify(r.kind)}`);
    if (!Array.isArray(r.choices) || r.choices.length < 2) errs.push(`${where}: needs a choices list of 2+`);
    if (!r.choices?.includes(r.expected)) errs.push(`${where}: expected ${JSON.stringify(r.expected)} is not one of its own choices`);
    if (!r.task) errs.push(`${where}: missing task`);
    if (!r.instruction) errs.push(`${where}: missing instruction`);
    if (!Array.isArray(r.lore) || r.lore.length === 0) errs.push(`${where}: needs at least one lore entry — a record with no lore has two identical arms`);
    for (const l of r.lore ?? []) {
      if (!l.scope || !l.text) errs.push(`${where}: every lore entry needs a scope and a text`);
      if (l.text && leaksAnswer(l.text, r.expected, r.choices)) {
        errs.push(`${where}: lore names the expected answer ${JSON.stringify(r.expected)} — golden lore must be procedural, never the answer`);
      }
    }
  }
  return errs;
}

/**
 * Does a lore string hand the agent its record's answer?
 *
 * Matched as a whole word, case-insensitively, and ONLY when the named choice is the
 * expected one — lore that rules a WRONG choice out ("a one-file logic change is never
 * Micro") is legitimate procedural guidance and must stay writable. A bare substring
 * test would fire on "Full" inside "fully", which is why a boundary is required.
 *
 * A HYPHEN counts as a boundary, so "this is a Full-tier task" is caught. That costs the
 * occasional false positive — lore about "micro-optimizations" in a record whose answer
 * is `Micro` — and the asymmetry is why it is the right trade: a false positive is loud
 * at authoring time and costs one rewritten sentence, while a false negative silently
 * admits answer-leaking lore and inflates the lift figure this guard exists to keep
 * honest. Errors in a guard should land on the side that gets noticed.
 */
export function leaksAnswer(text, expected, choices) {
  if (!expected) return false;
  const esc = String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w])${esc}(?![\\w])`, "i").test(text);
}

// ── Self-test — offline, no key, executed by L1 ─────────────────────────────────────

function selfTest() {
  const s = new Suite("l3-memory --self-test");

  // The resolution assertion. With 20 decoys and HARM_MAX 0.20 the gate tolerates 4
  // dirty decoys; below 4 the metric has too few usable states to tell a regression
  // from one unlucky case. The remedy when this reds is MORE DECOYS — lowering
  // HARM_MAX shrinks the tolerated count and makes the resolution worse while looking
  // like a tightening.
  const rows = existsSync(join(REPO_ROOT, "scripts/eval", GOLDEN)) ? loadGolden() : [];
  const decoyN = rows.filter((r) => r.kind === "decoy").length;
  const helpfulN = rows.filter((r) => r.kind === "helpful").length;
  s.check("S0 the golden set exists and parses", rows.length > 0);
  s.check("S0 golden set validates", validate(rows).length === 0, validate(rows).slice(0, 5).join(" | "));
  s.check("S1 harm gate is expressible at this decoy count",
    Math.floor(decoyN * HARM_MAX) >= 4,
    `${decoyN} decoys × ${HARM_MAX} = ${Math.floor(decoyN * HARM_MAX)} tolerated; need ≥ 4 — add decoys, do not lower HARM_MAX`);
  s.check("S1 the helpful half can express a lift smaller than the noise it must beat",
    helpfulN >= 20, `${helpfulN} helpful records; one case = ${helpfulN ? (100 / helpfulN).toFixed(1) : "∞"} points of lift`);

  // The two arms must differ ONLY by the lore block, or the reported delta is measuring
  // a prompt change rather than the memory.
  const rec = {
    id: "x", kind: "helpful", instruction: "Decide.", task: "A task.",
    choices: ["a", "b"], expected: "a", lore: [{ scope: "global", text: "Prefer the earlier option." }],
  };
  const arms = buildArms(rec);
  s.check("S2 the arms share an identical user turn", arms.without.user === arms.with.user);
  s.check("S2 the with-arm is the without-arm plus a lore block",
    arms.with.system.startsWith(arms.without.system) && arms.with.system.length > arms.without.system.length);
  s.check("S2 the without-arm carries no lore", !arms.without.system.includes("Prefer the earlier option."));
  s.check("S2 lore rides in the system block, matching the SessionStart injection",
    arms.with.system.includes("Prefer the earlier option.") && !arms.with.user.includes("Prefer the earlier option."));

  // The answer-leak guard is the one that keeps the helpful half honest.
  s.check("S3 leaksAnswer catches lore naming the expected choice",
    leaksAnswer("This is a Full-tier task.", "Full", ["Micro", "Full"]));
  s.check("S3 leaksAnswer is case-insensitive", leaksAnswer("treat it as full.", "Full", ["Micro", "Full"]));
  s.check("S3 leaksAnswer treats a hyphen as a boundary, so 'Full-tier' still leaks",
    leaksAnswer("This is a Full-tier task.", "Full", ["Micro", "Full"]));
  s.check("S3 leaksAnswer does not fire on a longer word containing the choice",
    !leaksAnswer("Read the file fully before editing.", "Full", ["Micro", "Full"]));
  s.check("S3 leaksAnswer permits lore ruling OUT a non-expected choice",
    !leaksAnswer("A one-file logic change is never Micro.", "Lite", ["Micro", "Lite", "Full"]));
  s.check("S3 validate rejects an answer-leaking record",
    validate([{ ...rec, lore: [{ scope: "global", text: "The answer is a." }] }]).some((e) => /procedural/.test(e)));
  s.check("S3 validate rejects a record with no lore",
    validate([{ ...rec, lore: [] }]).some((e) => /two identical arms/.test(e)));
  s.check("S3 validate rejects an expected answer outside its own choices",
    validate([{ ...rec, expected: "z" }]).some((e) => /not one of its own choices/.test(e)));

  // Scoring: a delta must not hide churn, and harm must count only lore-caused losses.
  const churn = score([
    { id: "1", withoutOk: true, withOk: false },
    { id: "2", withoutOk: false, withOk: true },
    { id: "3", withoutOk: false, withOk: true },
  ]);
  s.check("S4 score reports gained and lost, not just the delta",
    churn.gained.join(",") === "2,3" && churn.lost.join(",") === "1" && Math.abs(churn.delta - 1 / 3) < 1e-9);

  const decoyBothWrong = score([
    { id: "d1", withoutOk: false, withOk: false },
    { id: "d2", withoutOk: true, withOk: true },
  ]);
  s.check("S4 harm ignores a decoy that was wrong in BOTH arms",
    verdict(score([]), decoyBothWrong).harm === 0);
  s.check("S4 harm counts a decoy the lore flipped to wrong",
    verdict(score([]), score([{ id: "d1", withoutOk: true, withOk: false }])).harm === 1);

  // The ceiling: an easy golden set must report `inconclusive`, never "memory does not help".
  const atCeiling = score(Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, withoutOk: true, withOk: true })));
  const vCeil = verdict(atCeiling, score([]));
  s.check("S5 a without-arm at ceiling makes the lift verdict inconclusive", vCeil.liftVerdict === "inconclusive");
  s.check("S5 the inconclusive verdict names the reason and refuses to lower the ceiling",
    /headroom/.test(vCeil.liftReason ?? "") && /do not lower/.test(vCeil.liftReason ?? ""));

  const headroom = score([
    { id: "h1", withoutOk: false, withOk: true },
    { id: "h2", withoutOk: false, withOk: false },
    { id: "h3", withoutOk: false, withOk: false },
    { id: "h4", withoutOk: true, withOk: true },
  ]);
  s.check("S5 below the ceiling a real gain reads as positive lift",
    verdict(headroom, score([])).liftVerdict === "positive");
  s.check("S5 a lore that helps nothing reads as flat, not as a failure",
    verdict(score([{ id: "h1", withoutOk: true, withOk: true }, { id: "h2", withoutOk: false, withOk: false }]), score([])).liftVerdict === "flat");
  s.check("S5 lift never decides the gate — only harm does",
    verdict(score([{ id: "h1", withoutOk: true, withOk: false }]), score([{ id: "d1", withoutOk: true, withOk: true }])).harmPass === true);

  return s.report();
}

// ── Entry point ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

  if (!KEY) {
    if (process.env.EVAL_REQUIRE_KEY === "1") {
      console.error("✗ L3-memory: EVAL_REQUIRE_KEY is set but ANTHROPIC_API_KEY is empty — this run was asked for and cannot measure anything.");
      process.exit(3);
    }
    console.log("⊘ L3-memory: no ANTHROPIC_API_KEY — skipping (paired LLM eval; set the key to run).");
    process.exit(0);
  }

  const rows = loadGolden();
  const errs = validate(rows);
  if (errs.length) {
    console.error(`✗ L3-memory: golden set is invalid (${errs.length} problems):`);
    for (const e of errs.slice(0, 20)) console.error(`    ${e}`);
    process.exit(4);
  }

  const T = new EvalTelemetry();
  const runSpan = T.span("eval.run", {
    attributes: {
      "eval.layer": "l3-memory", "eval.model": MODEL,
      "eval.case.count": rows.length, "eval.gate.harm_max": HARM_MAX,
    },
  });

  console.log(`\n## memory-efficacy — ${rows.length} records × 2 arms (model=${MODEL})`);
  let inTok = 0, outTok = 0;
  const apiErrors = new Map();

  const scored = await mapLimit(rows, CONCURRENCY, async (r) => {
    const arms = buildArms(r);
    const caseSpan = T.span(`eval.case ${r.id}`, {
      parent: runSpan.spanId, kind: 3,
      attributes: {
        "eval.case.id": r.id, "eval.case.kind": r.kind, "eval.case.expected": r.expected,
        "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL, "gen_ai.provider.name": "anthropic",
      },
    });
    const run = async (arm) => {
      try {
        const res = await ask(arm.system, arm.user);
        inTok += res.usage?.input_tokens ?? 0;
        outTok += res.usage?.output_tokens ?? 0;
        return { got: parseChoice(res.text, r.choices), raw: res.text, err: null };
      } catch (e) {
        const key = e.message.replace(/,?"request_id":\s*(?:"[^"]*"|null)/g, "");
        apiErrors.set(key, (apiErrors.get(key) ?? 0) + 1);
        return { got: null, raw: null, err: e.message };
      }
    };
    // Both arms of one record run together: same moment, same model state, so a
    // transient API condition hits the pair rather than biasing one arm.
    const [without, withLore] = await Promise.all([run(arms.without), run(arms.with)]);
    const row = {
      id: r.id, kind: r.kind, expected: r.expected,
      withoutGot: without.got, withGot: withLore.got,
      withoutOk: without.got === r.expected, withOk: withLore.got === r.expected,
      errored: !!(without.err || withLore.err),
      raw: { without: without.raw, with: withLore.raw },
    };
    caseSpan.end({
      "eval.arm.without.actual": row.withoutGot, "eval.arm.without.match": row.withoutOk,
      "eval.arm.with.actual": row.withGot, "eval.arm.with.match": row.withOk,
      // The per-record outcome as one queryable value, so a dashboard can chart the
      // four transitions without recomputing them from two booleans.
      "eval.pair.outcome": row.withoutOk === row.withOk ? (row.withoutOk ? "both-right" : "both-wrong") : (row.withOk ? "gained" : "lost"),
    });
    T.count("eval.pair.result", 1, { "eval.case.kind": r.kind, "eval.pair.outcome": row.withoutOk === row.withOk ? (row.withoutOk ? "both-right" : "both-wrong") : (row.withOk ? "gained" : "lost") }, "{case}");
    const mark = row.withoutOk === row.withOk ? (row.withoutOk ? "= ✓✓" : "= ✗✗") : (row.withOk ? "↑ gained" : "↓ LOST ");
    console.log(`  ${mark}  ${r.kind.padEnd(7)} ${r.id}: without=${row.withoutGot} with=${row.withGot} (expected ${r.expected})`);
    return row;
  });

  // A run whose requests mostly failed is not a measurement — same rule as l2.mjs.
  const errored = scored.filter((r) => r.errored).length;
  if (errored > 0) {
    console.error(`\n=== API errors: ${errored}/${scored.length} records, ${apiErrors.size} distinct ===`);
    for (const [msg, count] of [...apiErrors].sort((a, b) => b[1] - a[1])) console.error(`  ${count}× ${msg}`);
  }
  const RUN_INVALID = scored.length > 0 && errored / scored.length > 0.5;

  const helpful = score(scored.filter((r) => r.kind === "helpful"));
  const decoy = score(scored.filter((r) => r.kind === "decoy"));
  const v = verdict(helpful, decoy);

  const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  console.log(`\n=== L3-memory summary (model=${MODEL}) ===`);
  console.log(`  helpful (${helpful.n}):  without ${pct(helpful.withoutAcc)} → with ${pct(helpful.withAcc)}   lift ${pct(helpful.delta)}  [${v.liftVerdict}]`);
  console.log(`                     gained ${helpful.gained.length} · lost ${helpful.lost.length}${helpful.lost.length ? ` (${helpful.lost.join(", ")})` : ""}`);
  console.log(`  decoy   (${decoy.n}):  without ${pct(decoy.withoutAcc)} → with ${pct(decoy.withAcc)}   harm ${pct(v.harm)}  [gate ≤ ${pct(HARM_MAX)}]`);
  console.log(`                     lost to bad lore: ${decoy.lost.length}${decoy.lost.length ? ` (${decoy.lost.join(", ")})` : ""}`);
  if (v.liftReason) console.log(`  note: ${v.liftReason}`);
  // Itemising is not optional — a bare rate cannot tell an over-permissive agent from a
  // defective fixture, which is the lesson l2-detection.mjs paid five runs to learn.
  if (decoy.lost.length) {
    console.log(`\n  Decoys the lore flipped — READ EACH before touching a rubric or the gate.`);
    console.log(`  A decoy is a claim that this lore should change nothing; the fixture can be`);
    console.log(`  wrong about that, and tuning against a defective one teaches the wrong lesson.`);
  }

  runSpan.end({
    "eval.helpful.count": helpful.n, "eval.helpful.without_accuracy": helpful.withoutAcc,
    "eval.helpful.with_accuracy": helpful.withAcc, "eval.helpful.lift": helpful.delta,
    "eval.decoy.count": decoy.n, "eval.decoy.harm": v.harm,
    "eval.lift.verdict": v.liftVerdict, "eval.gate.harm_pass": v.harmPass,
    "gen_ai.usage.input_tokens": inTok || null, "gen_ai.usage.output_tokens": outTok || null,
  });
  if (helpful.delta !== null) T.gauge("eval.memory.lift", helpful.delta * 100, { "eval.model": MODEL }, "%");
  if (v.harm !== null) T.gauge("eval.memory.harm", v.harm * 100, { "eval.model": MODEL }, "%");
  const exported = await T.flush();
  console.log(`  telemetry: ${T.traceNote()}${exported.exported ? "" : " (not exported)"}`);
  console.log(`  tokens: ${inTok.toLocaleString()} input + ${outTok.toLocaleString()} output`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    let md = `### L3 memory efficacy — model \`${MODEL}\`\n\n`;
    if (RUN_INVALID) md += `> **INVALID RUN — not a measurement.** ${errored} of ${scored.length} records never reached the model.\n\n`;
    md += `| population | n | without | with | delta | verdict |\n| --- | --- | --- | --- | --- | --- |\n`;
    md += `| helpful | ${helpful.n} | ${pct(helpful.withoutAcc)} | ${pct(helpful.withAcc)} | lift ${pct(helpful.delta)} | ${v.liftVerdict} |\n`;
    md += `| decoy | ${decoy.n} | ${pct(decoy.withoutAcc)} | ${pct(decoy.withAcc)} | harm ${pct(v.harm)} | ${v.harmPass ? `pass (≤ ${pct(HARM_MAX)})` : `**FAIL** (> ${pct(HARM_MAX)})`} |\n`;
    if (v.liftReason) md += `\n> ${v.liftReason}\n`;
    if (decoy.lost.length) md += `\n**Decoys flipped by lore:** ${decoy.lost.map((i) => `\`${i}\``).join(", ")}\n`;
    md += `\n<sup>lift is REPORTED, never gated — gating it would reward answer-leaking lore. Only harm gates.</sup>\n`;
    if (T.enabled) md += `\n<sup>trace \`${T.traceId}\`</sup>\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  if (RUN_INVALID) {
    console.error(`\n✗ INVALID RUN — ${errored}/${scored.length} records never reached the model. The numbers above measure nothing.`);
    process.exit(1);
  }
  // Only harm gates, and only when explicitly asked for — same posture as the other
  // runners, so a fork or an exploratory run reports without failing a build.
  if (process.env.EVAL_MEMORY_GATE === "1" && v.harmPass === false) {
    console.error(`\n✗ harm ${pct(v.harm)} exceeds the ${pct(HARM_MAX)} gate — bad lore is dragging correct answers off course.`);
    console.error(`  Itemise the flipped decoys above before changing anything. Lowering the gate is not a fix.`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("l3-memory.mjs")) main();
