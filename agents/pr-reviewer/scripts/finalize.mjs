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
 * spawning renderers, writing the write plan / findings bus). Every fixture
 * used by `--replay-fixtures` carries its own `render.at` timestamp, so no
 * live-clock injection is needed for byte-determinism.
 *
 * SCOPE NOTE (documented honestly, not silently dropped):
 * AC-10 (this file's own --self-test) and AC-19 (the findings-bus writer) are
 * implemented and green. AC-11 (`--replay-fixtures`, byte-identical replay
 * against the report-body / inline-comment fixtures) is now implemented below
 * and gets 8/9 fixtures byte-identical + validate-report-shape.mjs-conformant
 * — the 9th (deep.expected.md) is a documented, evidenced fixture-internal
 * inconsistency this pipeline cannot honestly reproduce; see
 * `runReplayFixtures()`'s own `KNOWN_FIXTURE_DEFECTS` comment and
 * `.agent/{branch}/checks.yaml`'s AC-11 entry (status: unsatisfiable, with
 * evidence). AC-13 (the dash0hq/dash0#20230 shadow-report comparison) is a
 * separate deliverable — see the plan's Progress Log.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { dedupe, markAgreementPromoted } from "./finalize/dedupe.mjs";
import { resolveThreshold, dispose, deferFloor, CLAIM_PREFIXES } from "./finalize/thresholds.mjs";
import { applySuppression } from "./finalize/suppression.mjs";
import { validateLine } from "./finalize/line-validity.mjs";
import { place } from "./finalize/placement.mjs";
import { computeGates } from "./finalize/gates.mjs";
import {
  buildReportPayload, buildQualitySummary,
  toFindingBullet, toAdvisoryFinding, toOpenThreadBullet, toInlineCommentPayload,
} from "./finalize/payload.mjs";
import { toFindingsBusRecords } from "./finalize/findings-bus.mjs";
import { scratchRoot } from "./prepare-review.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINALIZE_SELF_TESTS = [
  "finalize/dedupe.mjs", "finalize/thresholds.mjs", "finalize/suppression.mjs",
  "finalize/placement.mjs", "finalize/line-validity.mjs", "finalize/gates.mjs",
  "finalize/payload.mjs", "finalize/findings-bus.mjs",
];

// render-report.mjs's SHA7 check requires RUN.sha/RUN.prior_sha to be EXACTLY 7 lowercase hex
// chars. prepare-review.mjs's `headSha` (and a judgment's own `head_sha`, and any caller-supplied
// `--sha`) is real-world length (a full 40-char GitHub SHA, or already-abbreviated) — this is the
// one normalization point every source funnels through, so a live run never has to hand-truncate
// before calling finalize.mjs. A value that is not hex-shaped (e.g. the "unknown" placeholder) is
// left untouched: truncating a non-sha string would silently manufacture a fake-looking sha rather
// than surfacing that no real sha was ever supplied.
/** @param {string} raw @returns {string} */
export function sha7(raw) {
  if (typeof raw !== "string") return raw;
  const lower = raw.toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(lower) ? lower.slice(0, 7) : raw;
}

// render-report.mjs requires RUN.at unconditionally (an ISO-8601 UTC timestamp). prepare-review.mjs
// never sets it — `at` names the moment the REPORT rendered, which finalize.mjs, not prepare, is
// the one to know. The clock read stays at this CLI I/O boundary (`main()` below), never inside
// `finalizeReview()` itself (D18's pure core) — `now` is injectable so the self-test stays
// deterministic without a live-clock dependency, exactly as `--replay-fixtures`'s fixtures already
// avoid it by carrying their own `render.at`.
/** @param {any} context @param {string} [now] @returns {any} */
export function withRenderAt(context, now = new Date().toISOString()) {
  if (context?.render?.at) return context;
  return { ...context, render: { ...(context?.render || {}), at: now } };
}

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

  // AC-11/D5: the REPORT's FINDINGS table (and the Code review gate it feeds) is for
  // claim-prefix findings — the same `issue:`/`suggestion:` split dispose()/thresholds.mjs
  // already use to decide clear vs. defer. A posted `nitpick:`/`question:` DOES still go out as
  // its own inline PR review comment (render-comment.mjs has no such split) — it just does not
  // also earn a FINDINGS[] table row, the same way it earns no claim-threshold defer band. It
  // renders instead in the "verified, too minor to comment on" ADDITIONAL_FINDINGS appendix,
  // alongside genuine per-file/total-cap overflow. `inline`/`overCapDeferred` (undivided) still
  // feed the identity check and the findings-bus writer below — this split is report-rendering
  // only.
  //
  // Ordering: `inline`'s non-blocking slice is sorted by place()'s compareForPlacement
  // (prefix priority, then materiality, then score, then line) — a ranking meant to decide
  // which CLAIMS earn a scarce inline slot. A non-claim item never competes for that slot
  // (its `nitpick:`/`question:` comment posts regardless, cap or no cap), so re-using that
  // ranking for the ADDITIONAL_FINDINGS appendix would apply a claim-scarcity ordering to
  // items that were never scarce. Re-derive inlineNonClaims from `lineValidated` (the
  // pre-place, original-candidate-order array) filtered to the same object identities
  // place() decided were inline — this restores candidate order without re-running or
  // second-guessing place()'s own clear/defer decision.
  const inlineNonClaimsSet = new Set(inline.filter((f) => !CLAIM_PREFIXES.has(f.prefix)));
  const inlineClaims = inline.filter((f) => CLAIM_PREFIXES.has(f.prefix));
  const inlineNonClaims = lineValidated.filter((f) => inlineNonClaimsSet.has(f));

  // AC-11/D5: report-rendering.md's PARTIAL_REVIEW banner ({calls, scanned, total},
  // scanned < total) means the code-review finders never finished a pass — Gate 6 renders
  // ⏭️ "not evaluated this run" instead of claiming a verdict it can't honestly make.
  const pr = context?.render?.PARTIAL_REVIEW;
  const partialReview = !!(pr && typeof pr.scanned === "number" && typeof pr.total === "number" && pr.scanned < pr.total);

  const gates = computeGates({
    skipGates,
    judgmentsGates: judgments?.gates,
    contextThreads: context?.threads || [],
    judgmentThreads: judgments?.threads || [],
    placement: { inline: inlineClaims, deferred: overCapDeferred },
    partialReview,
  });

  const produced = (judgments?.candidates || []).length;
  // D5/AC-11: the rendered QUALITY line's "cleared" reads as the posted count, not the
  // pre-placement dispose-clear pool (`cleared.length`, kept internally for the identity check
  // below) — every report-body fixture shows `cleared N == posted inline N`, and the pool
  // concept (what got suppressed/anchorless/over-cap out of the pool) is already visible via
  // "carried forward"/"deferred"/"below-bar" plus the optional QUALITY_DROPPED breakdown, so
  // showing the pre-placement number a second time under a different label would be redundant,
  // never observed, and unexplained by any fixture.
  const quality = buildQualitySummary({
    produced,
    confidenceDeferred: advisoryDeferred.length,
    suppressed: suppressed.length,
    cleared: inlineClaims.length,
    deferredOverCap: overCapDeferred.length + inlineNonClaims.length,
    posted: inlineClaims.length,
    carriedForward: context?.render?.carriedForward ?? 0,
  });

  // The identity finalize must never violate: cleared - deferred(over cap) == posted-worthy.
  const identityHolds = cleared.length - suppressed.length - anchorless.length - overCapDeferred.length === inline.length;

  // A SIXTH field-bridging gap, found only by running this against a real prepare-review.mjs
  // context (not a hand-crafted fixture): prepare-review.mjs's context carries the head sha as
  // `headSha` (camelCase — see prepare-review.mjs's own context object and its CLI summary line),
  // never `head_sha`. `context.head_sha` stays as a fallback for the AC-11 replay fixtures
  // (scripts/eval/fixtures/finalize/*.context.json), which are hand-crafted in snake_case and
  // AC-12 forbids editing.
  const runSha = sha7(sha || context?.headSha || context?.head_sha || judgments?.head_sha || "unknown");

  // D5: the diff-only-cap carve-out (Phase 1, render-report.mjs's TIER_FOR_MODE) — a
  // capability-capped run auto-names its own anomaly rather than requiring the caller to
  // remember to. An explicit context.render.RUN_ANOMALY always wins (a real anomaly, e.g. a
  // base-branch merge pollution, is never masked by the cap-derived one).
  const capApplied = context?.routing?.capApplied === true;
  const autoRunAnomaly = capApplied
    ? `depth capability (${context?.workspace?.depthCapability || context?.depthCapability || "diff-only"})`
      + " capped this run below the deep tier its mode would otherwise require"
    : undefined;

  const tier = context?.routing?.tier;
  const depth = context?.workspace?.depthCapability || context?.depthCapability;
  const run = {
    mode: context?.mode || "unknown",
    sha: runSha,
    ...(context?.priorSha ? { prior_sha: context.priorSha } : {}),
    // A SEVENTH field-bridging gap, the same class as headSha above and found the same way (a real
    // prepare-review.mjs context, not a hand-crafted fixture): prepare-review.mjs's context carries
    // this as `deltaLines` (camelCase — see prepare-review.mjs's own context object and CLI summary
    // line), never `delta_lines`. `context.delta_lines` stays as the AC-11 fixtures' fallback.
    delta_lines: context?.deltaLines ?? context?.delta_lines ?? 0,
    ...(context?.render?.at ? { at: context.render.at } : {}),
    // RUN.tier/RUN.depth are OPTIONAL to render-report.mjs (only validated when present) — a run
    // with no routed tier (e.g. gates-only / zero-delta) must OMIT them, never fall back to a
    // literal "unknown", which is not a member of VALID_TIERS/VALID_DEPTHS and would fail render.
    ...(tier ? { tier } : {}),
    ...(depth ? { depth } : {}),
    summary: judgments?.summary || "",
    memoriesSummary: judgments?.memory?.summary || context?.render?.MEMORIES_SUMMARY,
    integrations: context?.render?.INTEGRATIONS,
    optimalityLog: judgments?.lenses?.optimality_log,
    standardsLog: judgments?.lenses?.standards_log,
    measurabilityLog: judgments?.lenses?.measurability_log,
    skippedFiles: context?.render?.SKIPPED_FILES,
  };

  const extras = {
    ...(context?.render || {}),
    RUN_ANOMALY: context?.render?.RUN_ANOMALY ?? autoRunAnomaly,
    ...(judgments?.lenses?.optimality_cards?.length
      ? { OPTIMALITY_CARDS: judgments.lenses.optimality_cards.map((/** @type {any} */ c) => c.markdown ?? c) }
      : {}),
  };

  const payload = buildReportPayload({
    gates,
    run,
    findings: inlineClaims.map(toFindingBullet),
    deferred: inlineNonClaims.concat(overCapDeferred).map(toAdvisoryFinding),
    lowConfidence: advisoryDeferred.map(toAdvisoryFinding),
    quality,
    extras,
  });
  payload.OPEN_THREADS = (gates.g3?.open || []).map(toOpenThreadBullet);

  const findingsBusRecords = toFindingsBusRecords(inline.concat(overCapDeferred), {
    iteration, sha: runSha,
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

// AC-11: the 5 report-body fixtures this replay drives — each backed by a
// scripts/eval/fixtures/finalize/{name}.{context,judgments}.json pair, crafted
// to make finalizeReview()'s real dispose/suppress/place/gate pipeline land on
// the exact payload scripts/eval/fixtures/report-body/{name}.json already
// encodes, then diffed byte-for-byte against {name}.expected.md.
const REPORT_BODY_FIXTURES = ["pass", "pass-ci-pending", "warn", "fail", "deep"];
// AC-11: the 4 inline-comment fixtures — each pair's judgments.json carries
// exactly one candidate that clears, and the replay maps finalizeReview()'s
// sole r.inline[0] through toInlineCommentPayload() before rendering.
const INLINE_COMMENT_FIXTURES = ["issue-blocking", "nitpick", "question-unverified", "suggestion-pseudo"];
const INLINE_COMMENT_SHA = "7389036"; // matches every inline-comment/*.expected.md's SHA verbatim

/**
 * A known, evidenced boundary (not a silent gap): scripts/eval/fixtures/report-body/deep.json's
 * own QUALITY string claims "below-bar 1" with a matching LOW_CONFIDENCE_FINDINGS array entirely
 * ABSENT from the same fixture — free text asserting a fact its own structured sibling contradicts.
 * render-report.mjs never cross-checks QUALITY's prose against LOW_CONFIDENCE_FINDINGS (only the
 * `posted inline N == FINDINGS.length` regex is enforced), so this shipped unnoticed; a real
 * finalizeReview() run cannot reproduce it, because THIS pipeline computes both from the SAME
 * advisoryDeferred array by construction (the real invariant every other fixture already proves:
 * pass/pass-ci-pending/warn/fail all replay byte-identical, INCLUDING fail.json's own below-bar
 * case with a populated LOW_CONFIDENCE_FINDINGS section). Reproducing deep.json's exact bytes
 * would mean deliberately breaking that invariant for one candidate — modeling the bug rather than
 * the renderer. AC-12 holds scripts/eval/fixtures/report-body/** byte-unchanged vs origin/main, so
 * this file cannot be corrected here either. Documented per the check-gaming-forbidden /
 * unsatisfiable-abort-affordance rule, not worked around.
 */
/** @type {Record<string, string>} */
const KNOWN_FIXTURE_DEFECTS = {
  deep: "scripts/eval/fixtures/report-body/deep.json QUALITY says \"below-bar 1\" with no "
    + "LOW_CONFIDENCE_FINDINGS entry backing it — a pre-existing fixture-internal inconsistency "
    + "(not a finalize.mjs defect); see finalize.mjs's runReplayFixtures() comment.",
};

const RENDER_REPORT_SCRIPT = join(HERE, "render-report.mjs");
const RENDER_POINTER_SCRIPT = join(HERE, "render-pointer.mjs");
const RENDER_COMMENT_SCRIPT = join(HERE, "render-comment.mjs");

/**
 * Spawns a renderer CLI (render-report.mjs / render-pointer.mjs / render-comment.mjs) against a
 * payload written to `<scratchDir>/<tag>.payload.json`. Shared by `--replay-fixtures` and the live
 * `main()` render step below — one spawn wrapper, one behavior, never two.
 * @param {string} scratchDir @param {string} script @param {any} payload @param {string} tag
 */
function renderVia(scratchDir, script, payload, tag) {
  const payloadPath = join(scratchDir, `${tag}.payload.json`);
  writeFileSync(payloadPath, JSON.stringify(payload, null, 2));
  const r = spawnSync(process.execPath, [script, payloadPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function runReplayFixtures() {
  const repoRoot = join(HERE, "..", "..", "..");
  const finalizeFixturesDir = join(repoRoot, "scripts", "eval", "fixtures", "finalize");
  const reportBodyDir = join(repoRoot, "scripts", "eval", "fixtures", "report-body");
  const inlineCommentDir = join(repoRoot, "scripts", "eval", "fixtures", "inline-comment");
  const validateShapeScript = join(repoRoot, "scripts", "validate-report-shape.mjs");

  const scratchDir = join(scratchRoot(), "finalize-replay");
  mkdirSync(scratchDir, { recursive: true });

  let failed = 0;
  let knownDefects = 0;
  const results = [];

  for (const name of REPORT_BODY_FIXTURES) {
    const context = JSON.parse(readFileSync(join(finalizeFixturesDir, `${name}.context.json`), "utf8"));
    const judgments = JSON.parse(readFileSync(join(finalizeFixturesDir, `${name}.judgments.json`), "utf8"));
    const { payload } = finalizeReview({ context, judgments });
    const rendered = renderVia(scratchDir, RENDER_REPORT_SCRIPT, payload, `report-${name}`);
    const expected = readFileSync(join(reportBodyDir, `${name}.expected.md`), "utf8");
    const byteIdentical = rendered.ok && rendered.stdout === expected;

    let shapeOk = true;
    let shapeNote = "";
    if (rendered.ok) {
      const renderedPath = join(scratchDir, `report-${name}.rendered.md`);
      writeFileSync(renderedPath, rendered.stdout);
      const shape = spawnSync(process.execPath, [validateShapeScript, renderedPath], { encoding: "utf8" });
      shapeOk = shape.status === 0;
      shapeNote = shapeOk ? "" : (shape.stderr || "").trim();
    }

    const known = KNOWN_FIXTURE_DEFECTS[name];
    const ok = byteIdentical && shapeOk;
    if (ok) {
      console.log(`  ✓ report-body/${name}.expected.md — byte-identical, validate-report-shape.mjs conforms`);
    } else if (known) {
      knownDefects++;
      console.error(`  ⏭️ report-body/${name}.expected.md — KNOWN fixture defect, not a finalize.mjs gap: ${known}`);
    } else {
      failed++;
      console.error(`  ✗ report-body/${name}.expected.md — ${!rendered.ok ? `render-report.mjs failed: ${rendered.stderr}` : !byteIdentical ? "byte diff vs .expected.md" : `validate-report-shape.mjs: ${shapeNote}`}`);
    }
    results.push({ name, kind: "report-body", ok, known: Boolean(known) });
  }

  for (const name of INLINE_COMMENT_FIXTURES) {
    const context = JSON.parse(readFileSync(join(finalizeFixturesDir, `inline-${name}.context.json`), "utf8"));
    const judgments = JSON.parse(readFileSync(join(finalizeFixturesDir, `inline-${name}.judgments.json`), "utf8"));
    const { inline } = finalizeReview({ context, judgments, sha: INLINE_COMMENT_SHA });
    if (inline.length !== 1) {
      failed++;
      console.error(`  ✗ inline-comment/${name}.expected.md — expected exactly 1 inline finding, got ${inline.length}`);
      results.push({ name, kind: "inline-comment", ok: false, known: false });
      continue;
    }
    const commentPayload = toInlineCommentPayload(inline[0], { sha: INLINE_COMMENT_SHA });
    const rendered = renderVia(scratchDir, RENDER_COMMENT_SCRIPT, commentPayload, `inline-${name}`);
    const expected = readFileSync(join(inlineCommentDir, `${name}.expected.md`), "utf8");
    const ok = rendered.ok && rendered.stdout === expected;
    if (ok) {
      console.log(`  ✓ inline-comment/${name}.expected.md — byte-identical`);
    } else {
      failed++;
      console.error(`  ✗ inline-comment/${name}.expected.md — ${!rendered.ok ? `render-comment.mjs failed: ${rendered.stderr}` : "byte diff vs .expected.md"}`);
    }
    results.push({ name, kind: "inline-comment", ok, known: false });
  }

  console.log(`\nfinalize.mjs --replay-fixtures: ${results.filter((r) => r.ok).length}/${results.length} byte-identical`
    + (knownDefects > 0 ? `, ${knownDefects} known fixture defect(s) (not finalize.mjs gaps, see comment above)` : ""));

  if (failed > 0) {
    console.error(`\n${failed} unexplained mismatch(es) — this is a real finalize.mjs/renderer gap, not a known fixture defect.`);
    process.exit(1);
  }
  if (knownDefects > 0) {
    // AC-11's own ears text demands byte-identical replay against EVERY fixture with no carve-out —
    // a known, evidenced, non-finalize.mjs defect still means the check is unsatisfiable exactly as
    // specified. Exiting non-zero here is that honesty, not a bug: checks.yaml marks this AC
    // `unsatisfiable` with this same evidence rather than `pass`, per the abort-affordance rule.
    process.exit(1);
  }
  console.log("✓ finalize.mjs --replay-fixtures: all fixtures byte-identical");
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

  // Field-bridging gaps closed at the source. Five were named in ab/DISPATCH-READY.md's manual
  // patches (context.mode, a 7-char sha, render.at, non-empty SKIPPED_FILES, a length-capped
  // GATE_DESCRIPTION_DETAILS); two more (headSha, deltaLines) surfaced only when this file was
  // actually run against a real prepare-review.mjs context, per this task's own "prove it
  // end-to-end" mandate — every AC-11 fixture happens to already use the field names finalize.mjs
  // expected, so the fixture replay alone could never have found them. Each is proven here,
  // independently of the fixture replay above.
  {
    check("sha7 truncates a full 40-char hex sha to 7 lowercase chars",
      sha7("906A74781990f75607f0234de963fdbbc3953f2c") === "906a747");
    check("sha7 is a no-op on an already-7-char sha", sha7("a1b2c3d") === "a1b2c3d");
    check("sha7 leaves a non-hex placeholder untouched rather than truncating it into a fake sha",
      sha7("unknown") === "unknown");
  }
  {
    // context.headSha (prepare-review.mjs's real field) wins over context.head_sha (the
    // AC-11 fixtures' hand-crafted field) when both are present, and head_sha alone still works —
    // the fixture replay above depends on this fallback never regressing.
    const camel = finalizeReview({
      context: { ...baseContext, headSha: "deadbeef00000000000000000000000000000000", head_sha: undefined },
      judgments: { candidates: [], gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "s" },
    });
    check("headSha (real prepare-review.mjs field name) is read when present", camel.payload.RUN.sha === "deadbee");
    const snake = finalizeReview({
      context: baseContext, // baseContext above carries only head_sha, no headSha
      judgments: { candidates: [], gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "s" },
    });
    check("head_sha (AC-11 fixtures' hand-crafted field) still works as the fallback", snake.payload.RUN.sha === "a1b2c3d");
  }
  {
    // Same class of gap, found the same way: context.deltaLines (prepare-review.mjs's real
    // camelCase field) vs context.delta_lines (the AC-11 fixtures' hand-crafted field).
    const camel = finalizeReview({
      context: { ...baseContext, deltaLines: 8810, delta_lines: undefined },
      judgments: { candidates: [], gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "s" },
    });
    check("deltaLines (real prepare-review.mjs field name) is read when present", camel.payload.RUN.delta_lines === 8810);
    const snake = finalizeReview({
      context: { ...baseContext, delta_lines: 8 }, // baseContext carries no deltaLines
      judgments: { candidates: [], gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "s" },
    });
    check("delta_lines (AC-11 fixtures' hand-crafted field) still works as the fallback", snake.payload.RUN.delta_lines === 8);
  }
  {
    const noAt = { render: {} };
    const withAt = withRenderAt(noAt, "2026-09-25T12:00:00Z");
    check("withRenderAt injects the given `now` when render.at is absent", withAt.render.at === "2026-09-25T12:00:00Z");
    const already = { render: { at: "2020-01-01T00:00:00Z" } };
    check("withRenderAt never overwrites an already-set render.at", withRenderAt(already, "2026-09-25T12:00:00Z").render.at === "2020-01-01T00:00:00Z");
  }
  {
    // End-to-end: a context shaped exactly as prepare-review.mjs now emits it — top-level `mode`,
    // camelCase `headSha`/`deltaLines` (the REAL field names; the sixth and seventh field-bridging
    // gaps, found only by running this against a real prepare-review.mjs context in the plan's
    // end-to-end proof, since every hand-crafted AC-11 fixture happens to already use snake_case),
    // no render.at — renders a payload the renderer accepts with zero hand-bridging, proven at the
    // finalizeReview() + render-report.mjs boundary rather than asserted.
    const liveShapedContext = withRenderAt({
      mode: "full",
      headSha: "906a74781990f75607f0234de963fdbbc3953f2c",
      deltaLines: 3, routing: { tier: "deep" }, workspace: { depthCapability: "checkout" },
      files: [{ filename: "a.ts", patch }], threads: [],
    }, "2026-09-25T12:00:00Z");
    const judgments = { candidates: [], gates: { gate1: { status: "PASS", details: "matches the diff" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "docs unaffected" } }, threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "clean pass, no findings" };
    const r = finalizeReview({ context: liveShapedContext, judgments });
    check("RUN.mode passes through from prepare-review.mjs's top-level context.mode", r.payload.RUN.mode === "full");
    check("RUN.sha is exactly 7 lowercase hex chars from prepare-review.mjs's real camelCase headSha", r.payload.RUN.sha === "906a747");
    check("RUN.at is populated even though the live-shaped context never set render.at", r.payload.RUN.at === "2026-09-25T12:00:00Z");
    check("RUN.delta_lines reads prepare-review.mjs's real camelCase deltaLines", r.payload.RUN.delta_lines === 3);
    check("SKIPPED_FILES is never empty when the context supplies none", r.payload.SKIPPED_FILES === "none");
    const renderReportCheck = renderVia(scratchRoot(), RENDER_REPORT_SCRIPT, r.payload, "self-test-live-shaped");
    check("the resulting payload renders through render-report.mjs with zero manual edits",
      renderReportCheck.ok, renderReportCheck.stderr.trim());
  }

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

  const contextRaw = JSON.parse(readFileSync(/** @type {string} */(opts.context), "utf8"));
  const context = withRenderAt(contextRaw);
  const judgments = JSON.parse(readFileSync(/** @type {string} */(opts.judgments), "utf8"));
  const outDir = /** @type {string} */(opts["out-dir"]);
  mkdirSync(outDir, { recursive: true });

  const result = finalizeReview({
    context, judgments,
    skipGates: Boolean(opts["skip-gates"]),
  });

  writeFileSync(join(outDir, "finalize-result.json"), JSON.stringify(result, null, 2));

  // Render the sticky report body with the SAME renderer --replay-fixtures spawns — this is where
  // "finalize.mjs renders with zero manual edits" becomes literally true for a live run: the seven
  // field-bridging gaps a prior dry-run needed hand patches for (context.mode, headSha, deltaLines,
  // a 7-char sha, render.at, non-empty SKIPPED_FILES, a capped GATE_DESCRIPTION_DETAILS) are now
  // all closed at their source, so this call either renders clean or fails with the renderer's own
  // diagnostic — never with a silently wrong artifact.
  let renderFailed = false;
  const rendered = renderVia(outDir, RENDER_REPORT_SCRIPT, result.payload, "report-body");
  if (rendered.ok) {
    writeFileSync(join(outDir, "report-body.md"), rendered.stdout);
    console.log(`finalize: rendered report-body.md (${rendered.stdout.length} bytes)`);
  } else {
    renderFailed = true;
    console.error(`finalize: render-report.mjs failed — ${rendered.stderr.trim()}`);
  }

  if (result.inline.length > 0) {
    mkdirSync(join(outDir, "inline"), { recursive: true });
    const sha = result.payload?.RUN?.sha || "unknown";
    result.inline.forEach((/** @type {any} */ finding, /** @type {number} */ i) => {
      const commentPayload = toInlineCommentPayload(finding, { sha });
      const r = renderVia(outDir, RENDER_COMMENT_SCRIPT, commentPayload, `inline-${i}`);
      if (r.ok) {
        writeFileSync(join(outDir, "inline", `${i}.md`), r.stdout);
      } else {
        renderFailed = true;
        console.error(`finalize: render-comment.mjs failed for inline[${i}] — ${r.stderr.trim()}`);
      }
    });
  }

  if (opts.writer === "findings-bus") {
    const branchDir = dirname(outDir);
    const busPath = join(branchDir, "findings.jsonl");
    for (const rec of result.findingsBusRecords) {
      appendFileSync(busPath, `${JSON.stringify(rec)}\n`);
    }
  }

  console.log(`finalize: verdict=${result.verdict} inline=${result.inline.length} deferred=${result.deferred.length} suppressed=${result.suppressed.length} anchorless=${result.anchorless.length}`);

  if (renderFailed) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
