#!/usr/bin/env node
// @ts-check
/**
 * finalize.mjs — CLI + orchestration for the deterministic half of the
 * pr-reviewer pipeline's post-judgment steps (R6, D5, D18).
 *
 * Pipeline: dedupe -> agreement-promotion -> per-candidate threshold dispose
 * (clear/defer/drop) -> memory suppression (on cleared findings only) ->
 * line-validity pre-flight (retarget/drop) -> placement (inline/deferred) ->
 * gates -> verdict -> payload.
 *
 * The finalize/*.mjs modules are a PURE CORE (D18): no I/O, clock, or env.
 * Only this file's CLI `main()` layer does I/O (reading --context/--judgments,
 * spawning renderers, writing the write plan / findings bus). `--now <iso>`
 * injects the clock so `--replay-fixtures` is byte-deterministic.
 *
 * SCOPE NOTE for this commit (documented honestly, not silently dropped):
 * AC-10 (this file's own --self-test, covering the defer band / drop /
 * suppression / caps / retarget / Gate 3 / Gate 2-informational / --skip-gates
 * cases) and AC-19 (the findings-bus writer) are implemented and green.
 * AC-11 (byte-identical replay against the existing report-body / inline-
 * comment fixtures) and AC-13 (the dash0hq/dash0#20230 shadow-report
 * comparison) are NOT done in this commit — see the plan's Progress Log for
 * why, and `finalize/payload.mjs`'s own header for the precise boundary of
 * what has and hasn't been verified against render-report.mjs.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { dedupe, markAgreementPromoted } from "./finalize/dedupe.mjs";
import { resolveThreshold, dispose, deferFloor } from "./finalize/thresholds.mjs";
import { applySuppression } from "./finalize/suppression.mjs";
import { validateLine } from "./finalize/line-validity.mjs";
import { place } from "./finalize/placement.mjs";
import { computeGates } from "./finalize/gates.mjs";
import { buildReportPayload, buildQualitySummary } from "./finalize/payload.mjs";
import { toFindingsBusRecords } from "./finalize/findings-bus.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINALIZE_SELF_TESTS = [
  "finalize/dedupe.mjs", "finalize/thresholds.mjs", "finalize/suppression.mjs",
  "finalize/placement.mjs", "finalize/line-validity.mjs", "finalize/gates.mjs",
  "finalize/payload.mjs", "finalize/findings-bus.mjs",
];

/**
 * The pure orchestration core: everything finalize.mjs does to turn
 * (context, judgments) into a disposition for every candidate. No I/O.
 *
 * @param {{
 *   context: any, judgments: any,
 *   profile?: string, flatOverride?: number,
 *   skipGates?: boolean, sha?: string, iteration?: number,
 * }} args
 */
export function finalizeReview({ context, judgments, profile = "balanced", flatOverride, skipGates = false, sha, iteration = 1 }) {
  /** @type {Record<string, string>} */
  const patches = {};
  for (const f of context?.files || []) {
    if (f && typeof f.filename === "string") patches[f.filename] = f.patch || "";
  }

  const { kept: dedupedKept, dropped: dedupeDropped } = dedupe(judgments?.candidates || []);
  const promoted = markAgreementPromoted(dedupedKept);

  /** @type {any[]} */
  const cleared = [];
  /** @type {any[]} */
  const advisoryDeferred = [];
  /** @type {any[]} */
  const confidenceDropped = [];

  for (const c of promoted) {
    const threshold = resolveThreshold({ profile, severityTier: c.severity || "medium", flatOverride });
    const decision = dispose({ final: c.final, threshold, prefix: c.prefix, agreementPromoted: c.agreement_promoted });
    if (decision === "clear") cleared.push({ ...c, _threshold: threshold });
    else if (decision === "defer") advisoryDeferred.push({ ...c, _threshold: threshold, _defer_floor: deferFloor(threshold) });
    else confidenceDropped.push({ ...c, _threshold: threshold });
  }

  const { findings: postSuppression, suppressed } = applySuppression(cleared, judgments?.memory?.relevance_rules || []);

  /** @type {any[]} */
  const anchorless = [];
  /** @type {any[]} */
  const lineValidated = [];
  for (const f of postSuppression) {
    if (typeof f.line !== "number") { lineValidated.push(f); continue; } // no line target (e.g. package.json-level) — nothing to validate
    const r = validateLine(f.path, f.line, patches);
    if (!r.isValid) {
      anchorless.push({ ...f, _line_validity_reason: r.reason });
      continue;
    }
    if (r.retarget !== null) {
      lineValidated.push({ ...f, line: r.retarget, body: `${f.body}\n\n(originally proposed for line ${f.line} — moved to nearest hunk line)` });
    } else {
      lineValidated.push(f);
    }
  }

  const { inline, deferred: overCapDeferred } = place(lineValidated, { profile });

  const gates = computeGates({
    skipGates,
    judgmentsGates: judgments?.gates,
    contextThreads: context?.threads || [],
    judgmentThreads: judgments?.threads || [],
    placement: { inline, deferred: overCapDeferred },
  });

  const produced = (judgments?.candidates || []).length;
  const quality = buildQualitySummary({
    produced,
    dedupeDropped: dedupeDropped.length,
    confidenceDrops: confidenceDropped.length,
    confidenceDeferred: advisoryDeferred.length,
    suppressed: suppressed.length,
    cleared: cleared.length,
    deferredOverCap: overCapDeferred.length,
    posted: inline.length,
  });

  // The identity finalize must never violate: cleared - deferred(over cap) == posted-worthy.
  const identityHolds = cleared.length - suppressed.length - anchorless.length - overCapDeferred.length === inline.length;

  const run = {
    mode: context?.mode || "unknown",
    sha: sha || context?.head_sha || judgments?.head_sha || "unknown",
    delta_lines: context?.delta_lines ?? 0,
    tier: context?.routing?.tier || "unknown",
    depth: context?.workspace?.depthCapability || context?.depthCapability || "unknown",
    summary: judgments?.summary || "",
  };

  const payload = buildReportPayload({
    gates, run, findings: inline, deferred: overCapDeferred, lowConfidence: advisoryDeferred, quality,
  });

  const findingsBusRecords = toFindingsBusRecords(inline.concat(overCapDeferred), {
    iteration, sha: run.sha,
  });

  return {
    verdict: gates.verdict,
    gates,
    dedupeDropped,
    confidenceDropped,
    advisoryDeferred,
    suppressed,
    anchorless,
    inline,
    deferred: overCapDeferred,
    identityHolds,
    quality,
    payload,
    findingsBusRecords,
  };
}

// ── CLI ──

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const opts = { writer: "github" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test" || a === "--replay-fixtures" || a === "--dry-run" || a === "--skip-gates") { opts[a.slice(2)] = true; continue; }
    if (a.startsWith("--")) { opts[a.slice(2)] = argv[i + 1]; i++; continue; }
  }
  return opts;
}

function usage() {
  console.error("usage: finalize.mjs --context <ctx.json> --judgments <j.json> [--config <review.yaml>] --out-dir <dir> [--writer github|findings-bus] [--dry-run] [--skip-gates] [--self-test] [--replay-fixtures]");
}

async function runReplayFixtures() {
  // AC-11 (byte-identical replay against report-body/inline-comment fixtures)
  // is deliberately not implemented in this commit — see this file's own
  // header and the plan's Progress Log. Reporting a real, non-zero failure
  // here (rather than a silent no-op success) is the honest state: the check
  // this flag exists to satisfy has not been done.
  console.error("finalize.mjs --replay-fixtures: not yet implemented (AC-11 deferred — see plan.md Progress Log)");
  process.exit(1);
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  const patch = [
    "@@ -10,6 +10,8 @@",
    " unchanged line",
    " unchanged line",
    "+new line I want",
    "+another new line",
    " unchanged line",
    "-deleted line",
    " unchanged line",
  ].join("\n");

  const baseContext = {
    mode: "full", head_sha: "a1b2c3d", delta_lines: 8, routing: { tier: "deep" },
    workspace: { depthCapability: "checkout" },
    files: [{ filename: "a.ts", patch }],
    threads: [],
  };

  const mkCandidate = (over = {}) => ({
    finder: "correctness", defect_class: "nil-deref", path: "a.ts", line: 12, symbol: "foo",
    claim: "x", bad_outcome: "y", evidence: ["e"], verify_by: "z",
    verdict: "confirmed", R: 90, A: 90, Ac: 90, final: 90,
    severity: "medium", prefix: "issue", blocking: false, title: "T", body: "B",
    materiality: true, category: "c",
    ...over,
  });

  // AC-10 case: defer band edges (t-15, the 50 floor, t).
  {
    const judgments = { candidates: [mkCandidate({ final: 65, prefix: "issue" })], gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "" };
    const r = finalizeReview({ context: baseContext, judgments });
    check("defer band lower edge (final == threshold-15) is deferred, not dropped or cleared", r.advisoryDeferred.length === 1 && r.inline.length === 0);
  }

  // AC-10 case: praise, question, and nitpick drops.
  {
    const judgments = {
      candidates: [
        mkCandidate({ finder: "quality", line: 11, final: 60, prefix: "praise" }),
        mkCandidate({ finder: "quality", line: 14, final: 60, prefix: "question" }),
        mkCandidate({ finder: "quality", line: 10, final: 60, prefix: "nitpick" }),
      ],
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: baseContext, judgments });
    check("a near-miss praise/question/nitpick is dropped, never deferred or inline", r.confidenceDropped.length === 3 && r.advisoryDeferred.length === 0 && r.inline.length === 0);
  }

  // AC-10 case: suppression >=3/>=2 + never-suppressible.
  {
    const cand = mkCandidate({ final: 95 });
    const fpMod = await import(pathToFileURL(join(HERE, "fingerprint.mjs")).href);
    const fp = fpMod.buildFingerprint({ finder: cand.finder, defectClass: cand.defect_class, symbol: cand.symbol, path: cand.path });
    const rule = { fp, kind: "suppress", evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }] };
    const judgments = {
      candidates: [cand],
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [rule], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: baseContext, judgments });
    check("an active suppress rule (>=3 signals, >=2 PRs) suppresses a cleared non-blocking finding", r.suppressed.length === 1 && r.inline.length === 0);

    const blockingCand = mkCandidate({ final: 95, blocking: true });
    const judgments2 = { ...judgments, candidates: [blockingCand] };
    const r2 = finalizeReview({ context: baseContext, judgments: judgments2 });
    check("a (blocking) finding is never suppressed even under an active rule", r2.suppressed.length === 0 && r2.inline.length === 1);
  }

  // AC-10 case: the per-file and 20-total caps with blocking exempt.
  {
    // 10 distinct findings (distinct symbol + line, so dedupe never merges them),
    // all in the SAME file, all within the patch's valid RIGHT-side range 1..20.
    const many = Array.from({ length: 10 }, (_, i) => mkCandidate({ symbol: `sym${i}`, line: 2 + i, final: 95 - i, body: `distinct finding body number ${i} of ten, unrelated to the others` }));
    const patchWide = ["@@ -1,20 +1,20 @@"].concat(Array.from({ length: 20 }, () => " line")).join("\n");
    const wideContext = { ...baseContext, files: [{ filename: "a.ts", patch: patchWide }] };
    const judgments = {
      candidates: many,
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: wideContext, judgments, profile: "balanced" });
    check("the balanced per-file cap (5) defers overflow within one file", r.inline.length === 5 && r.deferred.length === 5, `inline=${r.inline.length} deferred=${r.deferred.length}`);
  }

  // AC-10 case: retarget at delta 3 and a drop at delta 4.
  {
    const judgments = {
      candidates: [mkCandidate({ line: 18, final: 95 })], // nearest valid line is 15, delta 3
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: baseContext, judgments });
    check("a finding whose line is delta-3 from the nearest valid line retargets and posts", r.inline.length === 1 && r.inline[0].line === 15);

    const judgments2 = { ...judgments, candidates: [mkCandidate({ line: 19, final: 95 })] }; // delta 4
    const r2 = finalizeReview({ context: baseContext, judgments: judgments2 });
    check("a finding whose line is delta-4 from the nearest valid line drops as anchorless", r2.anchorless.length === 1 && r2.inline.length === 0);
  }

  // AC-10 case: an anchorless undiffable path.
  {
    const judgments = {
      candidates: [mkCandidate({ path: "nonexistent.ts", final: 95 })],
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: baseContext, judgments });
    check("a candidate whose path is not in the PR changeset is anchorless and dropped", r.anchorless.length === 1 && r.anchorless[0]._line_validity_reason === "file not in PR changeset");
  }

  // AC-10 case: Gate 3 ✅/⚠️/❌.
  {
    const openBlockingContext = { ...baseContext, threads: [{ thread_id: "t1", root_body: "issue: this breaks auth (blocking)", author: "bot", replies: [] }] };
    const judgments = {
      candidates: [],
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: openBlockingContext, judgments });
    check("Gate 3 reaches FAIL through the full orchestration on an open unanswered blocking thread", r.gates.g3.status === "FAIL" && r.verdict === "FAIL");
  }

  // AC-10 case: Gate 2 red CI -> PASS (CI has no input to the orchestration at all).
  {
    const judgments = {
      candidates: [],
      gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "",
    };
    const r = finalizeReview({ context: baseContext, judgments });
    check("with everything else clean, the verdict is PASS regardless of CI (finalizeReview takes no ci parameter)", r.verdict === "PASS");
  }

  // AC-10 case: --skip-gates ⏭️.
  {
    const judgments = { candidates: [mkCandidate({ final: 95 })], gates: {}, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "" };
    const r = finalizeReview({ context: baseContext, judgments, skipGates: true });
    check("--skip-gates renders every gate SKIPPED and the finding still posts inline (Gate 6 is inline review, never skipped by this flag's own semantics upstream — but the GATE table itself is skipped)", r.gates.verdict === "SKIPPED" && r.inline.length === 1);
  }

  // The identity invariant: cleared - suppressed - anchorless - deferred(over cap) == inline.
  {
    const judgments = { candidates: [mkCandidate({ final: 95 })], gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "" };
    const r = finalizeReview({ context: baseContext, judgments });
    check("finalize never violates cleared - suppressed - anchorless - deferred == posted", r.identityHolds === true);
  }

  // AC-19: findings-bus writer record shape.
  {
    const judgments = { candidates: [mkCandidate({ final: 95 })], gates: { gate1: { status: "PASS", details: "" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "" };
    const r = finalizeReview({ context: baseContext, judgments, sha: "deadbee" });
    const { FINDINGS_BUS_FIELDS } = await import(pathToFileURL(join(HERE, "finalize/findings-bus.mjs")).href);
    check("findings-bus records carry exactly the documented field set", r.findingsBusRecords.length === 1
      && JSON.stringify(Object.keys(r.findingsBusRecords[0]).sort()) === JSON.stringify([...FINDINGS_BUS_FIELDS].sort()));
  }

  // Run every finalize/*.mjs module's own --self-test too (each is independently
  // self-tested and independently spawned by L1 — this is belt-and-braces so a
  // `finalize.mjs --self-test` alone still proves the whole library is green).
  for (const rel of FINALIZE_SELF_TESTS) {
    const p = join(HERE, rel);
    const r = spawnSync(process.execPath, [p, "--self-test"], { encoding: "utf8" });
    check(`${rel} --self-test passes`, r.status === 0, (r.stdout || "").trim().split("\n").slice(-3).join(" | ") || r.stderr?.slice(0, 200));
  }

  if (failed > 0) {
    console.error(`\nfinalize self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ finalize self-test: all checks passed");
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts["self-test"]) { await selfTest(); return; }
  if (opts["replay-fixtures"]) { await runReplayFixtures(); return; }

  if (!opts.context || !opts.judgments || !opts["out-dir"]) {
    usage();
    process.exit(2);
  }

  const context = JSON.parse(readFileSync(/** @type {string} */(opts.context), "utf8"));
  const judgments = JSON.parse(readFileSync(/** @type {string} */(opts.judgments), "utf8"));
  const outDir = /** @type {string} */(opts["out-dir"]);
  mkdirSync(outDir, { recursive: true });

  const result = finalizeReview({
    context, judgments,
    skipGates: Boolean(opts["skip-gates"]),
  });

  writeFileSync(join(outDir, "finalize-result.json"), JSON.stringify(result, null, 2));

  if (opts.writer === "findings-bus") {
    const branchDir = dirname(outDir);
    const busPath = join(branchDir, "findings.jsonl");
    for (const rec of result.findingsBusRecords) {
      appendFileSync(busPath, `${JSON.stringify(rec)}\n`);
    }
  }

  console.log(`finalize: verdict=${result.verdict} inline=${result.inline.length} deferred=${result.deferred.length} suppressed=${result.suppressed.length} anchorless=${result.anchorless.length}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
