#!/usr/bin/env node
// @ts-check
/**
 * ab-review.mjs — the A/B quality harness scorer for the pr-reviewer
 * deterministic-pipeline rewrite (AC-13, AC-20, AC-21, D13).
 *
 * Three subcommands, no GitHub mutation verb anywhere in this file (AC-23):
 *
 *   shadow-report <dir>
 *     AC-13. Reads `<dir>/judgments.json` (the model's real candidates for one
 *     PR) and `<dir>/prose-dispositions.json` (the SAME agent's own
 *     prose-computed clear/defer/drop/suppress/verdict call per candidate,
 *     recorded during a single-context dry-run review — Phase 3 step 3's
 *     "ALSO records its prose-computed disposition per fingerprint"). Runs
 *     those same judgments through the real `finalizeReview()` and diffs each
 *     candidate's disposition against the prose call. Exits 0 iff every
 *     disagreement carries a non-empty `explained` field in
 *     `<dir>/explained.json` (a hand-maintained map `{fp: "why"}` — D5-type,
 *     legitimate ambiguities between the prose and the deterministic pipeline,
 *     not silently accepted mismatches).
 *
 *   score --manifest <m> --runs <dir> --labels <dir> [--out <json>] [--lorekit-out <json>]
 *     AC-21. `--runs <dir>` holds one subdirectory per arm (`A`, `B`), each
 *     holding one subdirectory per PR number, each holding one subdirectory
 *     per run (`run-1`, `run-2`, ...). Every run directory is expected to
 *     contain `inline-comments.json` (the array a `--dry-run` review would
 *     have POSTed to `/pulls/{n}/reviews`, per pipeline.md's artifact-flow
 *     table — `[{path, line, body, ...}]`) and MAY contain
 *     `dispatch-meta.json` (`{tokens_used, wall_clock_ms}`, written by
 *     whoever dispatched the sub-agent, since only the dispatcher sees the
 *     Agent-tool result — this script never estimates either figure).
 *     `--labels <dir>` holds one `<pr>.json` per PR — `thread-outcomes.mjs`'s
 *     own output shape (`{repo, pr, labels: [...]}`). Emits per-arm recall,
 *     precision, run-to-run stability (Jaccard over each PR's own repeated
 *     runs), severity agreement (fraction of matched findings whose tier
 *     agrees), and mean tokens/wall-clock, to stdout and optionally `--out`.
 *
 *   --self-test
 *     Runs every pure function below against synthetic fixtures. No network,
 *     no filesystem outside a scratch tmpdir this process owns.
 *
 * Matching (shared by `score`): a candidate finding and a label match when
 * either (a) both carry a fingerprint AND they're equal (fingerprint.mjs's
 * `fp:v2:finder:defectClass:symbol@path`, or a shared `fp:v1` derivation), or
 * (b) they share the SAME path and their lines are within `LINE_TOLERANCE`
 * (3, matching `l2-detection.mjs`'s own constant — reused, not reinvented).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finalizeReview } from "../../agents/pr-reviewer/scripts/finalize.mjs";
import { extractFingerprint } from "../../agents/pr-reviewer/scripts/fingerprint.mjs";

const LINE_TOLERANCE = 3; // mirrors scripts/eval/l2-detection.mjs's own constant

// ── shadow-report ──

/**
 * @param {any} judgments
 * @param {any} proseDispositions - { [fp]: "clear"|"defer"|"drop"|"suppressed"|"verdict:<X>" }
 * @param {any} explained - { [fp]: string } — non-empty rationale per disagreement
 * @param {any} [context] - the REAL review-context.json (real diff patches) for a live shadow
 *   run; the self-test below passes a synthetic one-line-per-candidate stand-in instead of a
 *   captured PR diff, so it does not depend on any fixture beyond judgments.json itself.
 * @returns {{ ok: boolean, mismatches: any[], total: number }}
 */
export function compareShadow(judgments, proseDispositions, explained, context) {
  const ctx = context || {
    mode: "full",
    files: (judgments?.candidates || [])
      .filter((/** @type {any} */ c) => typeof c.line === "number")
      .map((/** @type {any} */ c) => ({ filename: c.path, patch: `@@ -${c.line},1 +${c.line},1 @@\n+x` })),
    threads: [],
  };
  const { payload, inline, deferred, suppressed, anchorless, dedupeDropped, confidenceDropped, verdict } =
    finalizeReview({ context: ctx, judgments, skipGates: false });
  void payload;

  /** @type {Map<string,string>} */
  const finalizeDisposition = new Map();
  for (const c of inline) finalizeDisposition.set(fpOf(c), "clear");
  for (const c of deferred) finalizeDisposition.set(fpOf(c), "defer");
  for (const c of suppressed) finalizeDisposition.set(fpOf(c), "suppressed");
  for (const c of anchorless) finalizeDisposition.set(fpOf(c), "anchorless");
  for (const c of dedupeDropped) finalizeDisposition.set(fpOf(c), "dedupe-dropped");
  for (const c of confidenceDropped) finalizeDisposition.set(fpOf(c), "drop");
  finalizeDisposition.set("__verdict__", verdict);

  /** @type {any[]} */
  const mismatches = [];
  const allKeys = new Set([...finalizeDisposition.keys(), ...Object.keys(proseDispositions || {})]);
  for (const fp of allKeys) {
    const a = finalizeDisposition.get(fp) ?? "(absent)";
    const b = (proseDispositions || {})[fp] ?? "(absent)";
    if (a !== b) {
      const reason = (explained || {})[fp];
      mismatches.push({ fp, finalize: a, prose: b, explained: reason || null });
    }
  }

  const unexplained = mismatches.filter((m) => !m.explained || !String(m.explained).trim());
  return { ok: unexplained.length === 0, mismatches, total: allKeys.size };
}

/** @param {any} c */
function fpOf(c) {
  try {
    // eslint-disable-next-line no-unused-vars
    return `${c.finder}:${c.defect_class}:${c.symbol || "-"}@${c.path}`;
  } catch {
    return `${c.path}:${c.line}`;
  }
}

async function runShadowReport(/** @type {string} */ dir) {
  const judgments = JSON.parse(readFileSync(join(dir, "judgments.json"), "utf8"));
  const proseDispositions = existsSync(join(dir, "prose-dispositions.json"))
    ? JSON.parse(readFileSync(join(dir, "prose-dispositions.json"), "utf8"))
    : {};
  const explained = existsSync(join(dir, "explained.json"))
    ? JSON.parse(readFileSync(join(dir, "explained.json"), "utf8"))
    : {};
  // The real review-context.json (real diff patches) if this shadow dir captured one —
  // never synthesized for a live run; a candidate outside the real diff must validate (or
  // not) against the diff that was actually reviewed.
  const context = existsSync(join(dir, "context.json"))
    ? JSON.parse(readFileSync(join(dir, "context.json"), "utf8"))
    : existsSync(join(dir, "review-context.json"))
      ? JSON.parse(readFileSync(join(dir, "review-context.json"), "utf8"))
      : undefined;

  const { ok, mismatches, total } = compareShadow(judgments, proseDispositions, explained, context);
  console.log(`shadow-report: ${total} fingerprint(s) compared, ${mismatches.length} mismatch(es)`);
  for (const m of mismatches) {
    const tag = m.explained ? "explained" : "UNEXPLAINED";
    console.log(`  [${tag}] ${m.fp}: finalize=${m.finalize} prose=${m.prose}${m.explained ? ` — ${m.explained}` : ""}`);
  }
  process.exit(ok ? 0 : 1);
}

// ── score ──

/**
 * @param {any} finding - { path, line, body }
 * @param {any} label - { path, line, fingerprint }
 */
export function isMatch(finding, label) {
  const findingFp = extractFingerprint(finding.body ?? "");
  if (findingFp?.source === "marker" && label.fingerprint && findingFp.fp === label.fingerprint) {
    return true;
  }
  if (!finding.path || !label.path || finding.path !== label.path) return false;
  const fLine = Number(finding.line ?? 0);
  const lLine = Number(label.line ?? 0);
  return Math.abs(fLine - lLine) <= LINE_TOLERANCE;
}

/**
 * @param {any[]} findings - one arm/run's inline-comments.json array
 * @param {any[]} labels - thread-outcomes.mjs's labels[] for this PR
 * @returns {{ tp: number, fp: number, fn: number, matchedSeverityAgreements: number, matchedTotal: number }}
 */
export function scoreRun(findings, labels) {
  const fixedLabels = labels.filter((l) => l.outcome === "fixed");
  const declinedLabels = labels.filter((l) => l.outcome === "declined");

  let tp = 0, fp = 0;
  let matchedSeverityAgreements = 0, matchedTotal = 0;
  for (const finding of findings) {
    const fixedMatch = fixedLabels.find((l) => isMatch(finding, l));
    const declinedMatch = !fixedMatch && declinedLabels.find((l) => isMatch(finding, l));
    if (fixedMatch) {
      tp++;
      matchedTotal++;
      if (finding.tier && fixedMatch.severity && finding.tier === fixedMatch.severity) matchedSeverityAgreements++;
    } else if (declinedMatch) {
      fp++;
    }
    // A finding matching neither bucket is "needs manual/judge" material — per the
    // plan's own wording — and is counted in neither tp nor fp (never guessed).
  }
  const matchedFixedFps = new Set(
    findings.filter((f) => fixedLabels.some((l) => isMatch(f, l))).map((f) => `${f.path}:${f.line}`),
  );
  const fn = fixedLabels.filter((l) => !findings.some((f) => isMatch(f, l))
    || !matchedFixedFps.has(`${l.path}:${l.line}`)).length;

  return { tp, fp, fn, matchedSeverityAgreements, matchedTotal };
}

/**
 * Jaccard similarity between two runs' finding sets (by path:line-proximity/fingerprint
 * identity), for the run-to-run stability metric.
 * @param {any[]} runA @param {any[]} runB
 */
export function jaccard(runA, runB) {
  if (runA.length === 0 && runB.length === 0) return 1;
  let intersection = 0;
  const usedB = new Set();
  for (const a of runA) {
    const idx = runB.findIndex((b, i) => !usedB.has(i) && isMatch(a, b));
    if (idx >= 0) { intersection++; usedB.add(idx); }
  }
  const union = runA.length + runB.length - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** @param {string} dir */
function readJsonIfExists(dir) {
  return existsSync(dir) ? JSON.parse(readFileSync(dir, "utf8")) : null;
}

/** @param {string} runsDir @param {string} arm */
function listRunDirs(runsDir, arm) {
  const armDir = join(runsDir, arm);
  /** @type {{ pr: string, runId: string, dir: string }[]} */
  const out = [];
  if (!existsSync(armDir)) return out;
  for (const pr of readdirSync(armDir)) {
    const prDir = join(armDir, pr);
    if (!statSync(prDir).isDirectory()) continue;
    for (const runId of readdirSync(prDir)) {
      const runDir = join(prDir, runId);
      if (statSync(runDir).isDirectory()) out.push({ pr, runId, dir: runDir });
    }
  }
  return out;
}

/**
 * @param {{ runsDir: string, labelsDir: string, arm: string }} args
 */
export function scoreArm({ runsDir, labelsDir, arm }) {
  const runs = listRunDirs(runsDir, arm);
  let tp = 0, fp = 0, fn = 0, matchedSeverityAgreements = 0, matchedTotal = 0;
  let tokensSum = 0, tokensCount = 0, wallClockSum = 0, wallClockCount = 0;
  /** @type {Map<string, any[][]>} */
  const byPr = new Map();

  for (const run of runs) {
    const findings = readJsonIfExists(join(run.dir, "inline-comments.json")) || [];
    const labelsFile = readJsonIfExists(join(labelsDir, `${run.pr}.json`));
    const labels = labelsFile?.labels || [];
    const s = scoreRun(findings, labels);
    tp += s.tp; fp += s.fp; fn += s.fn;
    matchedSeverityAgreements += s.matchedSeverityAgreements;
    matchedTotal += s.matchedTotal;

    const meta = readJsonIfExists(join(run.dir, "dispatch-meta.json"));
    if (typeof meta?.tokens_used === "number") { tokensSum += meta.tokens_used; tokensCount++; }
    if (typeof meta?.wall_clock_ms === "number") { wallClockSum += meta.wall_clock_ms; wallClockCount++; }

    if (!byPr.has(run.pr)) byPr.set(run.pr, []);
    /** @type {any[][]} */ (byPr.get(run.pr)).push(findings);
  }

  /** @type {number[]} */
  const stabilities = [];
  for (const [, prRuns] of byPr) {
    if (prRuns.length < 2) continue;
    for (let i = 0; i < prRuns.length; i++) {
      for (let j = i + 1; j < prRuns.length; j++) stabilities.push(jaccard(prRuns[i], prRuns[j]));
    }
  }

  return {
    arm,
    runs: runs.length,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    stability: stabilities.length > 0 ? stabilities.reduce((a, b) => a + b, 0) / stabilities.length : null,
    severity_agreement: matchedTotal > 0 ? matchedSeverityAgreements / matchedTotal : null,
    mean_tokens: tokensCount > 0 ? Math.round(tokensSum / tokensCount) : null,
    mean_wall_clock_ms: wallClockCount > 0 ? Math.round(wallClockSum / wallClockCount) : null,
    tp, fp, fn,
  };
}

async function runScore(/** @type {Record<string,string|boolean>} */ opts) {
  const runsDir = /** @type {string} */ (opts.runs);
  const labelsDir = /** @type {string} */ (opts.labels);
  const manifest = existsSync(/** @type {string} */(opts.manifest)) ? JSON.parse(readFileSync(/** @type {string} */(opts.manifest), "utf8")) : [];
  void manifest;

  const arms = existsSync(runsDir) ? readdirSync(runsDir).filter((a) => statSync(join(runsDir, a)).isDirectory()) : [];
  const results = arms.map((arm) => scoreArm({ runsDir, labelsDir, arm }));

  console.log(JSON.stringify(results, null, 2));
  if (opts.out) writeFileSync(/** @type {string} */(opts.out), JSON.stringify(results, null, 2));

  if (opts["lorekit-out"]) {
    const records = results.map((r) => ({
      kind: "bus",
      host: "pr-reviewer",
      scope: "repo::mthines/agent-skills",
      ttl_days: 90,
      tags: ["loop::reviewer-benchmarks", `arm::${r.arm}`],
      key: `reviewer-benchmarks::ab-${r.arm}-${Date.now()}`,
      value: r,
    }));
    writeFileSync(/** @type {string} */(opts["lorekit-out"]), JSON.stringify(records, null, 2));
    console.log(`\n${records.length} LoreKit record(s) staged at ${opts["lorekit-out"]} — written over MCP by the caller (this script never calls MCP itself).`);
  }
  process.exit(0);
}

// ── CLI ──

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") { opts["self-test"] = true; continue; }
    if (a.startsWith("--")) { opts[a.slice(2)] = argv[i + 1]; i++; continue; }
  }
  return opts;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // isMatch
  {
    const finding = { path: "a.ts", line: 10, body: "<!-- fp:v2:correctness:logic:foo@a.ts -->issue: x" };
    const label = { path: "a.ts", line: 999, fingerprint: "correctness:logic:foo@a.ts" };
    check("isMatch matches on fingerprint identity even with lines far apart", isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x, no marker" };
    const label = { path: "a.ts", line: 12, fingerprint: null };
    check("isMatch falls back to path + LINE_TOLERANCE proximity", isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x" };
    const label = { path: "a.ts", line: 20, fingerprint: null };
    check("isMatch rejects a path match outside LINE_TOLERANCE", !isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x" };
    const label = { path: "b.ts", line: 10, fingerprint: null };
    check("isMatch rejects a different path even at the same line", !isMatch(finding, label));
  }

  // scoreRun
  {
    const findings = [
      { path: "a.ts", line: 10, body: "issue: x", tier: "high" },
      { path: "z.ts", line: 1, body: "issue: noise", tier: "low" },
    ];
    const labels = [
      { path: "a.ts", line: 10, fingerprint: null, outcome: "fixed", severity: "high" },
      { path: "q.ts", line: 5, fingerprint: null, outcome: "fixed", severity: "medium" },
    ];
    const s = scoreRun(findings, labels);
    check("scoreRun counts a matched fixed-outcome finding as a TP", s.tp === 1);
    check("scoreRun counts an unmatched fixed-outcome label as an FN", s.fn === 1);
    check("scoreRun counts a matched severity tier as an agreement", s.matchedSeverityAgreements === 1 && s.matchedTotal === 1);
  }
  {
    const findings = [{ path: "a.ts", line: 10, body: "issue: x" }];
    const labels = [{ path: "a.ts", line: 10, fingerprint: null, outcome: "declined" }];
    const s = scoreRun(findings, labels);
    check("scoreRun counts a matched declined-outcome finding as an FP", s.fp === 1 && s.tp === 0);
  }
  {
    const findings = [{ path: "a.ts", line: 10, body: "issue: x" }];
    const labels = [{ path: "b.ts", line: 99, fingerprint: null, outcome: null }];
    const s = scoreRun(findings, labels);
    check("scoreRun leaves an unmatched finding and a null-outcome label uncounted (needs manual/judge, never guessed)", s.tp === 0 && s.fp === 0 && s.fn === 0);
  }

  // jaccard
  {
    const runA = [{ path: "a.ts", line: 10, body: "x" }];
    const runB = [{ path: "a.ts", line: 10, body: "x" }];
    check("jaccard(identical runs) is 1", jaccard(runA, runB) === 1);
  }
  {
    const runA = [{ path: "a.ts", line: 10, body: "x" }];
    const runB = [{ path: "b.ts", line: 10, body: "x" }];
    check("jaccard(disjoint runs) is 0", jaccard(runA, runB) === 0);
  }
  {
    check("jaccard(both empty) is 1 (perfectly stable — nothing found either time)", jaccard([], []) === 1);
  }

  // compareShadow
  const shadowGates = { gate1: { status: "PASS", details: "d" }, gate5: { status: "PASS", details: "d" } };
  {
    const judgments = {
      candidates: [
        { finder: "correctness", defect_class: "logic", symbol: "foo", path: "a.ts", line: 1, prefix: "issue", severity: "high", final: 95, title: "t", body: "b" },
      ],
      gates: shadowGates,
    };
    const prose = { "correctness:logic:foo@a.ts": "clear", __verdict__: "WARN" };
    const r = compareShadow(judgments, prose, {});
    check("compareShadow finds agreement (no mismatch) when finalize and prose agree", r.ok && r.mismatches.length === 0);
  }
  {
    const judgments = {
      candidates: [
        { finder: "correctness", defect_class: "logic", symbol: "foo", path: "a.ts", line: 1, prefix: "issue", severity: "high", final: 95, title: "t", body: "b" },
      ],
      gates: shadowGates,
    };
    const prose = { "correctness:logic:foo@a.ts": "defer", __verdict__: "WARN" };
    const rNoExplain = compareShadow(judgments, prose, {});
    check("compareShadow flags a real disagreement (clear vs. defer) and fails without an explanation", !rNoExplain.ok && rNoExplain.mismatches.length === 1);
    const rExplained = compareShadow(judgments, prose, { "correctness:logic:foo@a.ts": "D5: prose applies a stricter bar for this defect class" });
    check("compareShadow's ok flips to true once the SAME disagreement carries a non-empty explanation", rExplained.ok);
  }

  // Read-only surface.
  {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const mutationRe = /-X\s+(?:POST|PATCH|PUT|DELETE)|--method[\s=]+(?:POST|PATCH|PUT|DELETE)|\bmutation\s*[({]/i;
    check("this file's own source contains no GitHub mutation verb", !mutationRe.test(src));
  }

  if (failed > 0) {
    console.error(`\nab-review self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ ab-review self-test: all checks passed");
}

function usage() {
  console.error("usage: ab-review.mjs shadow-report <dir> | score --manifest <m> --runs <dir> --labels <dir> [--out <json>] [--lorekit-out <json>] | --self-test");
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts["self-test"]) { await selfTest(); return; }

  const sub = argv[0];
  if (sub === "shadow-report") {
    const dir = argv[1];
    if (!dir) { usage(); process.exit(2); }
    await runShadowReport(dir);
    return;
  }
  if (sub === "score") {
    if (!opts.manifest || !opts.runs || !opts.labels) { usage(); process.exit(2); }
    await runScore(opts);
    return;
  }
  usage();
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
