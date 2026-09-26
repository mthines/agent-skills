#!/usr/bin/env node
// @ts-check
/**
 * fanout-glue.mjs — offline proof of the `/pr-review --fanout` orchestration's deterministic
 * glue (skills/quality/pr-review/SKILL.md's `--fanout` section, steps c-f; plan D17).
 *
 * The orchestration itself dispatches sub-agents (finders, lenses, verifiers) and cannot be
 * exercised without live model calls. What CAN be exercised offline is everything AROUND those
 * dispatches — the mechanical steps a fan-out run actually depends on to produce a valid,
 * postable review even when every sub-agent dispatch behaves exactly as its rule file specifies:
 *
 *   raw finder-stage candidates (step c's output, hand-built here — never a live call)
 *     -> finalize.mjs --dedupe-candidates                                    (step d)
 *     -> mock verification (step e's output shape, deterministically stubbed)
 *     -> assembled judgments.json                                            (step f)
 *     -> validate-judgments.mjs                                              (step f)
 *     -> finalize.mjs --context --judgments --out-dir                        (step f)
 *
 * Every step after "raw finder-stage candidates" shells out to the REAL production script — this
 * is not a reimplementation or a mock of any of them, only of the two things this orchestration
 * cannot run offline: the finder's own judgment (stubbed as fixed candidate records) and the
 * verifier's own judgment (stubbed as a fixed pass/fail decision per candidate, in
 * mockVerify() below).
 *
 * `--self-test` runs the demo and asserts every step's exit code and output shape.
 * With no flags, it runs the same demo and prints a human-readable trace — useful for reading
 * the glue chain end to end without digging through the self-test's assertions.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPTS_DIR = join(REPO_ROOT, "agents/pr-reviewer/scripts");
const FINALIZE = join(SCRIPTS_DIR, "finalize.mjs");
const VALIDATE_JUDGMENTS = join(SCRIPTS_DIR, "validate-judgments.mjs");

/** @returns {Promise<string>} */
async function scratchDir() {
  const { scratchRoot } = await import(pathToFileURL(join(SCRIPTS_DIR, "prepare-review.mjs")).href);
  const dir = join(scratchRoot(), "fanout-glue-demo");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Two file patches, matching the exact hunk shape agents/pr-reviewer/scripts/finalize.mjs's own
// --self-test uses, so line-validity accepts the target lines below without a retarget.
const PATCH_A_TS = [
  "@@ -10,6 +10,8 @@",
  " unchanged line",
  " unchanged line",
  "+new line I want",
  "+another new line",
  " unchanged line",
  "-deleted line",
  " unchanged line",
].join("\n");

const PATCH_B_TS = [
  "@@ -1,3 +1,5 @@",
  " unchanged1",
  " unchanged2",
  "+added1",
  "+added2",
  " unchanged3",
].join("\n");

/**
 * Step c's output, hand-built: two finders both flag the SAME defect at the same (path, line) —
 * the cross-finder-agreement case dedupe() exists to catch — plus one independent finding from a
 * third finder on a different file.
 * @returns {any[]}
 */
function rawFinderCandidates() {
  return [
    {
      finder: "correctness", defect_class: "nil-deref", path: "a.ts", line: 12, symbol: "foo",
      claim: "foo may be null here and this is a real problem worth an inline finding",
      bad_outcome: "a null dereference crashes the request handler",
      evidence: ["a.ts:12"], severity_hint: "high", verify_by: "trace callers of foo",
    },
    {
      finder: "consumer-impact", defect_class: "nil-deref", path: "a.ts", line: 12, symbol: "foo",
      claim: "foo may be null here and this is a real problem worth an inline finding",
      bad_outcome: "every consumer of foo() inherits the same crash",
      evidence: ["a.ts:12"], severity_hint: "high", verify_by: "check every call site",
    },
    {
      finder: "quality", defect_class: "maintainability", path: "b.ts", line: 5,
      claim: "this function duplicates logic already in the adjacent module",
      bad_outcome: "the two copies will drift the next time either one is edited",
      evidence: ["b.ts:5"], severity_hint: "low", verify_by: "diff against the sibling module",
    },
  ];
}

/**
 * Step e's output, stubbed: what a verifier sub-agent returns after reading `finding-verifier.md`
 * and the candidate record. Deterministic, never a live call — every field a real verifier would
 * add is present, at fixed values, so the assembled judgments.json is realistic rather than a
 * minimal schema-satisfying stub.
 *
 * Two bookkeeping fields step d's dedupe leaves on a merged candidate — `_also_flagged_by` and
 * `agreement_promoted` — are NOT part of judgments.schema.json (additionalProperties: false) and
 * must not reach judgments.json. Cross-finder corroboration is real signal, though, so it is
 * folded into the verifier's own confidence here (a small bump, mirroring finders.md's
 * diversify-then-vote note that "a unanimous candidate is pre-corroborated") rather than smuggled
 * through as an extra schema field — the same place finalize.mjs's OWN internal dedupe would have
 * re-derived agreement_promoted had step d not already merged the duplicate away.
 * @param {any} c
 * @returns {any}
 */
function mockVerify(c) {
  const corroborated = Array.isArray(c._also_flagged_by) && c._also_flagged_by.length > 0;
  const { _also_flagged_by, agreement_promoted, _dedupe_dropped_for, _dedupe_reason, ...clean } = c;
  const high = clean.severity_hint === "high";
  const bump = corroborated ? 4 : 0;
  return {
    ...clean,
    verdict: "confirmed",
    R: Math.min(100, (high ? 88 : 78) + bump), A: Math.min(100, (high ? 86 : 75) + bump), Ac: Math.min(100, (high ? 88 : 72) + bump),
    final: Math.min(100, (high ? 87 : 75) + bump),
    severity: clean.severity_hint,
    prefix: "issue",
    blocking: high,
    title: high ? "`foo` may be null before this call" : "Duplicated logic risks silent drift",
    body: clean.claim,
    materiality: true,
    category: clean.defect_class,
  };
}

/** @param {string} label @param {boolean} ok @param {any} [detail] */
function assert(label, ok, detail) {
  if (ok) { console.log(`  ✓ ${label}`); return true; }
  console.error(`  ✗ ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  return false;
}

/** Runs the full offline glue chain once. Returns {ok, dir, result}. */
async function runGlue({ verbose = false } = {}) {
  let ok = true;
  const dir = await scratchDir();
  const log = (/** @type {string} */ s) => { if (verbose) console.log(s); };

  // step c (stubbed) -> file, exactly the shape the orchestrator would concatenate from
  // candidates/<finder>.json.
  const rawPath = join(dir, "raw-candidates.json");
  writeFileSync(rawPath, JSON.stringify(rawFinderCandidates(), null, 2));
  log(`[step c] wrote ${rawFinderCandidates().length} raw finder candidates -> ${rawPath}`);

  // step d — the real finalize.mjs --dedupe-candidates.
  const dedupedPath = join(dir, "deduped.json");
  const dedupeRun = spawnSync(process.execPath, [
    FINALIZE, "--dedupe-candidates", rawPath, "--out", dedupedPath,
  ], { encoding: "utf8" });
  ok = assert("[step d] finalize.mjs --dedupe-candidates exits 0", dedupeRun.status === 0, dedupeRun.stderr) && ok;
  if (!existsSync(dedupedPath)) return { ok: false, dir, result: null };
  const deduped = JSON.parse(readFileSync(dedupedPath, "utf8"));
  ok = assert("[step d] the two same-defect candidates merge into one kept record",
    deduped.kept.length === 2 && deduped.dropped.length === 1,
    { kept: deduped.kept.length, dropped: deduped.dropped.length }) && ok;
  log(`[step d] deduped 3 raw candidate(s) -> ${deduped.kept.length} kept, ${deduped.dropped.length} dropped`);

  // step d (extra, D5/AC-12) — a semantic-duplicate group (the same defect filed under a
  // DIFFERENT defect_class per finder — the real dash0hq/dash0#20230 failure mode, which the
  // exact/adjacent pass above can never catch by construction) plus a decoy that must survive,
  // through the REAL finalize.mjs --dedupe-candidates end to end (dedupe() -> semanticDedupe()).
  const semanticRawPath = join(dir, "semantic-raw-candidates.json");
  const semanticRaw = [
    {
      finder: "correctness", defect_class: "edge-case", path: "src/pay.ts", line: 10, symbol: "processPayment",
      claim: "processPayment does not handle a zero amount refund correctly",
      bad_outcome: "a zero amount refund silently succeeds without reversing the charge",
      evidence: ["src/pay.ts:10"], severity_hint: "high", verify_by: "trace the refund branch",
    },
    {
      finder: "consumer-impact", defect_class: "contract-break", path: "src/pay.ts", line: 11, symbol: "processPayment",
      claim: "processPayment silently succeeds on a zero amount refund",
      bad_outcome: "callers assume the refund reversed the charge but it does not",
      evidence: ["src/pay.ts:11"], severity_hint: "high", verify_by: "check callers",
    },
    // The decoy: same path, same symbol, a nearby line — but a disjoint topic. Proximity and
    // symbol alone must never be enough to merge.
    {
      finder: "quality", defect_class: "maintainability", path: "src/pay.ts", line: 12, symbol: "processPayment",
      claim: "this function is 140 lines long and mixes three concerns",
      bad_outcome: "hard to test in isolation",
      evidence: ["src/pay.ts:12"], severity_hint: "low", verify_by: "read the function",
    },
  ];
  writeFileSync(semanticRawPath, JSON.stringify(semanticRaw, null, 2));
  const semanticDedupedPath = join(dir, "semantic-deduped.json");
  const semanticDedupeRun = spawnSync(process.execPath, [
    FINALIZE, "--dedupe-candidates", semanticRawPath, "--out", semanticDedupedPath,
  ], { encoding: "utf8" });
  ok = assert("[step d, semantic] finalize.mjs --dedupe-candidates exits 0",
    semanticDedupeRun.status === 0, semanticDedupeRun.stderr) && ok;
  if (existsSync(semanticDedupedPath)) {
    const semanticDeduped = JSON.parse(readFileSync(semanticDedupedPath, "utf8"));
    ok = assert("[step d, semantic] the differently-worded, differently-classed duplicate merges via semanticDedupe",
      semanticDeduped.kept.length === 2 && semanticDeduped.dropped.length === 1
        && semanticDeduped.dropped[0]._dedupe_reason === "semantic",
      { kept: semanticDeduped.kept.length, dropped: semanticDeduped.dropped.length }) && ok;
    ok = assert("[step d, semantic] the maintainability decoy survives — never semantically merged",
      semanticDeduped.kept.some((/** @type {any} */ c) => c.defect_class === "maintainability"),
      semanticDeduped.kept.map((/** @type {any} */ c) => c.defect_class)) && ok;
    log(`[step d, semantic] semantic dedupe: ${semanticRaw.length} raw -> ${semanticDeduped.kept.length} kept, `
      + `${semanticDeduped.dropped.length} dropped (1 semantic decoy correctly kept)`);
  }

  // step e (stubbed) — one verifier pass per surviving candidate.
  const verified = deduped.kept.map(mockVerify);
  log(`[step e] mock-verified ${verified.length} surviving candidate(s)`);

  // step f — assemble judgments.json matching judgments.schema.json exactly.
  const judgments = {
    v: 1,
    head_sha: "a1b2c3d",
    candidates: verified,
    gates: {
      gate1: { status: "PASS", details: "The description matches what the diff does." },
      gate4: { precandidate_dispositions: [], ai_stub_findings: [] },
      gate5: { status: "PASS", details: "Documented well enough to follow." },
    },
    threads: [],
    lenses: {
      optimality_cards: [], optimality_log: "skipped", standards_log: "skipped",
      measurability_log: "skipped", holistic_log: "skipped",
    },
    summary: "Fan-out glue demo: one merged high-severity finding, one independent low-severity finding.",
    memory: { relevance_rules: [], lessons_used: [] },
  };
  const judgmentsPath = join(dir, "judgments.json");
  writeFileSync(judgmentsPath, JSON.stringify(judgments, null, 2));
  log(`[step f] assembled judgments.json (${verified.length} candidates) -> ${judgmentsPath}`);

  // step f — the real validate-judgments.mjs.
  const validateRun = spawnSync(process.execPath, [VALIDATE_JUDGMENTS, judgmentsPath], { encoding: "utf8" });
  ok = assert("[step f] validate-judgments.mjs exits 0 against the assembled judgments.json",
    validateRun.status === 0, (validateRun.stdout || validateRun.stderr || "").trim().slice(0, 300)) && ok;

  // step f — the real finalize.mjs, context.json shaped like prepare-review.mjs's own output.
  const context = {
    mode: "full", head_sha: "a1b2c3d", delta_lines: 8, routing: { tier: "deep" },
    workspace: { depthCapability: "checkout" },
    files: [{ filename: "a.ts", patch: PATCH_A_TS }, { filename: "b.ts", patch: PATCH_B_TS }],
    threads: [],
  };
  const contextPath = join(dir, "context.json");
  writeFileSync(contextPath, JSON.stringify(context, null, 2));
  const outDir = join(dir, "finalize-out");
  const finalizeRun = spawnSync(process.execPath, [
    FINALIZE, "--context", contextPath, "--judgments", judgmentsPath, "--out-dir", outDir,
  ], { encoding: "utf8" });
  ok = assert("[step f] finalize.mjs --context/--judgments/--out-dir exits 0",
    finalizeRun.status === 0, finalizeRun.stderr) && ok;

  // step f (extra, D4/AC-12) — a cap-violating stub verdict (a > 60-char title, the exact shape
  // that failed closed live on arm C: "verifier-authored title/body exceeded comment-shape caps,
  // not in fan-out prompt") caught by the REAL finalize.mjs --check-shape pre-flight.
  const capViolatingPath = join(dir, "cap-violating-judgments.json");
  const capViolatingJudgments = {
    v: 1,
    head_sha: "a1b2c3d",
    candidates: [{
      finder: "correctness", defect_class: "nil-deref", path: "a.ts", line: 12, symbol: "foo",
      claim: "foo may be null here", bad_outcome: "crash", evidence: ["a.ts:12"], verify_by: "trace",
      verdict: "confirmed", R: 90, A: 88, Ac: 88, final: 89, severity: "high", prefix: "issue",
      blocking: true,
      title: "x".repeat(70),
      body: "foo may be null before this call and callers do not guard it.",
      materiality: true, category: "nil-deref",
    }],
    gates: {
      gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] },
      gate5: { status: "PASS", details: "" },
    },
    threads: [],
    lenses: {
      optimality_cards: [], optimality_log: "skipped", standards_log: "skipped",
      measurability_log: "skipped", holistic_log: "skipped",
    },
    summary: "cap-violating stub for --check-shape", memory: { relevance_rules: [], lessons_used: [] },
  };
  writeFileSync(capViolatingPath, JSON.stringify(capViolatingJudgments, null, 2));
  const checkShapeRun = spawnSync(process.execPath, [FINALIZE, "--check-shape", capViolatingPath], { encoding: "utf8" });
  ok = assert("[step f, check-shape] finalize.mjs --check-shape exits non-zero on a cap-violating stub verdict",
    checkShapeRun.status !== 0, checkShapeRun.status) && ok;
  let shapeResult = null;
  try { shapeResult = JSON.parse(checkShapeRun.stdout); } catch { /* reported below */ }
  ok = assert("[step f, check-shape] the violation names index 0 and field TITLE",
    Boolean(shapeResult) && shapeResult.ok === false
      && shapeResult.violations[0]?.index === 0 && shapeResult.violations[0]?.field === "TITLE",
    shapeResult) && ok;
  log("[step f, check-shape] cap-violating stub verdict caught by the real finalize.mjs --check-shape");

  let result = null;
  const resultPath = join(outDir, "finalize-result.json");
  if (existsSync(resultPath)) {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
    // FAIL is the correct verdict here, not a bug in the glue: the merged candidate is a
    // blocking finding, and Gate 6 (code review) fails a run carrying one — the same behavior
    // scripts/eval/fixtures/report-body/fail.json's own fixture asserts. Proving the pipeline
    // ends up at FAIL for a genuinely blocking, corroborated finding is a stronger demonstration
    // of the glue than an artificially all-clean PASS would have been.
    ok = assert("[step f] the run reaches a verdict (FAIL — Gate 6, one blocking finding)",
      result.verdict === "FAIL" && result.gates?.g6?.status === "FAIL", result.verdict) && ok;
    ok = assert("[step f] the merged high-severity candidate posts inline, blocking",
      result.inline.some((/** @type {any} */ f) => f.blocking === true), result.inline) && ok;
    ok = assert("[step f] write-plan.json is written, carrying one review comment",
      existsSync(join(outDir, "write-plan.json"))) && ok;
  }

  // Same assembled judgments.json, routed through the OTHER writer — proves this one offline
  // glue chain feeds both consumers (a real PR via --writer github, above, and branch-reviewer's
  // findings.jsonl via --writer findings-bus, here) with no re-assembly.
  const busOutDir = join(dir, "finalize-bus-out");
  const busRun = spawnSync(process.execPath, [
    FINALIZE, "--context", contextPath, "--judgments", judgmentsPath, "--out-dir", busOutDir,
    "--writer", "findings-bus",
  ], { encoding: "utf8" });
  ok = assert("[step f, findings-bus] the SAME judgments.json also finalizes via --writer findings-bus",
    busRun.status === 0, busRun.stderr) && ok;
  ok = assert("[step f, findings-bus] findings.jsonl is written, never write-plan.json",
    existsSync(join(dir, "findings.jsonl")) && !existsSync(join(busOutDir, "write-plan.json"))) && ok;

  return { ok, dir, result };
}

async function selfTest() {
  console.log("fanout-glue --self-test: proving the --fanout orchestration's deterministic glue, offline\n");
  const { ok } = await runGlue({ verbose: true });
  if (!ok) {
    console.error("\nfanout-glue self-test: one or more checks failed");
    process.exit(1);
  }
  console.log("\n✓ fanout-glue self-test: all checks passed");
}

async function demo() {
  const { ok, dir } = await runGlue({ verbose: true });
  console.log(`\nArtifacts written under ${dir}`);
  process.exit(ok ? 0 : 1);
}

function usage() {
  console.error("usage: fanout-glue.mjs --self-test | --demo");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) { await selfTest(); return; }
  if (argv.includes("--demo")) { await demo(); return; }
  usage();
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
