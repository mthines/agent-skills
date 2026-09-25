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

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
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
  buildOptimalityCard,
} from "./finalize/payload.mjs";
import { toFindingsBusRecords } from "./finalize/findings-bus.mjs";
import { buildWritePlan } from "./finalize/write-plan.mjs";
import { scratchRoot } from "./prepare-review.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINALIZE_SELF_TESTS = [
  "finalize/dedupe.mjs", "finalize/thresholds.mjs", "finalize/suppression.mjs",
  "finalize/placement.mjs", "finalize/line-validity.mjs", "finalize/gates.mjs",
  "finalize/payload.mjs", "finalize/findings-bus.mjs", "finalize/write-plan.mjs",
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
 * D5/AC-11 real gap (arm B's first live A/B run, `ab/B/20230/1/meta.json`): prepare-review.mjs
 * deliberately strips `files[].patch` from the context by default (D5's "the context is an
 * INDEX, not an ARCHIVE") — the full per-file patch text lives instead in the `paths.files` /
 * `filesPath` sidecar (pr-files.json, one JSON object per line). finalizeReview()'s line-validity
 * pre-flight reads `f.patch` straight off `context.files` and has no other way to anchor a
 * candidate's line — against a real (non-`--inline-payloads`) context every candidate came back
 * anchorless, which a hand run had to work around by hand-copying the sidecar's patches into a
 * throwaway context copy. This is the I/O boundary (D18: only `main()` reads files) that closes
 * that gap at the source: re-hydrate `context.files[].patch` from the sidecar before
 * `finalizeReview()` (the pure core) ever sees the context, so a live run needs zero manual
 * patching. A context that already carries inline patches (`--inline-payloads`, or a hand-crafted
 * AC-11 fixture) is left untouched, and a missing/unreadable sidecar degrades to the pre-fix
 * behavior (patch-less files, everything anchorless) rather than throwing — finalize.mjs has
 * always been able to run against a partial context.
 * @param {any} context @returns {any}
 */
export function hydrateFilePatches(context) {
  const files = context?.files;
  if (!Array.isArray(files) || files.length === 0) return context;
  if (files.every((f) => typeof f?.patch === "string" && f.patch.length > 0)) return context;
  const sidecarPath = context?.paths?.files || context?.filesPath;
  if (!sidecarPath) return context;
  let raw;
  try {
    raw = readFileSync(sidecarPath, "utf8");
  } catch {
    return context;
  }
  /** @type {Record<string, string>} */
  const patchByFile = {};
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue; // one malformed sidecar line never blocks the rest
    }
    if (row && typeof row.filename === "string" && typeof row.patch === "string") {
      patchByFile[row.filename] = row.patch;
    }
  }
  return {
    ...context,
    files: files.map((f) => (
      f && typeof f.filename === "string" && patchByFile[f.filename] !== undefined
        ? { ...f, patch: patchByFile[f.filename] }
        : f
    )),
  };
}

/**
 * RUN_ANOMALY — render-report.mjs's own docstring: "one line naming something that changed what
 * this run actually reviewed". Pure (D18): the caller resolves `capApplied`/`depthCapability`/
 * `contextAnomalies` from the context; this only formats them, and never begins with a glyph
 * (the renderer prepends its own ⚠️ — a value that did would double it).
 * @param {{ capApplied: boolean, depthCapability?: string, contextAnomalies?: any[] }} args
 * @returns {string|undefined}
 */
export function buildAutoRunAnomaly({ capApplied, depthCapability, contextAnomalies }) {
  const parts = [];
  if (capApplied) {
    parts.push(`depth capability (${depthCapability || "diff-only"}) capped this run below the deep tier its mode would otherwise require`);
  }
  const anomalies = Array.isArray(contextAnomalies) ? contextAnomalies : [];
  if (anomalies.length) {
    const n = anomalies.length;
    const lead = String(anomalies[0]).replace(/\s+/g, " ").trim();
    parts.push(`${n} prepare-time anomal${n === 1 ? "y" : "ies"} (${lead}${n > 1 ? `, +${n - 1} more` : ""})`);
  }
  return parts.length ? parts.join(" — ") : undefined;
}

/**
 * `judgments.memory.{relevance_rules,lessons_used}` → render-report.mjs `MEMORIES_USED[]` rows
 * (D4: "copied verbatim from MCP reads … finalize.mjs decides the lifecycle"). A relevance rule
 * IS a suppression rule, so it is always `kind: "rule"`; a lesson's kind is derived from its
 * LoreKit key prefix (`hotspot::…` / `knowledge::…`), defaulting to `lesson` for anything else
 * (e.g. an `aw-lessons`-namespaced record).
 * @param {string|null|undefined} key @param {string} fallback @returns {string}
 */
function deriveMemoryKind(key, fallback) {
  const k = String(key || "");
  if (k.startsWith("hotspot::")) return "hotspot";
  if (k.startsWith("knowledge::")) return "knowledge";
  return fallback;
}

/** @param {any} record @param {string|null} kindOverride @returns {Record<string, any>} */
function toMemoryUsedItem(record, kindOverride) {
  const kind = kindOverride || deriveMemoryKind(record?.key, "lesson");
  /** @type {Record<string, any>} */
  const out = { key: record?.key, kind };
  const note = record?.used_as || record?.note;
  if (note) out.note = note;
  if (Array.isArray(record?.evidence) && record.evidence.length) out.evidence = record.evidence;
  if (record?.url) out.url = record.url;
  return out;
}

/** @param {any} memory @returns {Record<string, any>[]} */
export function buildMemoriesUsed(memory) {
  return [
    ...(memory?.relevance_rules || []).map((/** @type {any} */ r) => toMemoryUsedItem(r, "rule")),
    ...(memory?.lessons_used || []).map((/** @type {any} */ r) => toMemoryUsedItem(r, null)),
  ];
}

/**
 * render-report.mjs requires MEMORIES_SUMMARY to be exactly `<N> indexed` (with `N >=` the
 * MEMORIES_USED count) whenever MEMORIES_USED is non-empty, and rejects any string carrying the
 * word "used" (that half is derived from MEMORIES_USED.length). Computed from the SAME array
 * MEMORIES_USED renders, so the two can never disagree.
 * @param {Record<string, any>[]} memoryUsed @returns {string}
 */
export function memoriesSummaryFor(memoryUsed) {
  return memoryUsed.length > 0 ? `${memoryUsed.length} indexed` : "no relevance rules or lessons consulted";
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
  // base-branch merge pollution, is never masked by the cap-derived one). Also folds in
  // prepare-review.mjs's own `anomalies[]` — workspace-ladder exhaustion, a failed shape
  // classifier, an incomplete threads read, and the like are exactly the "something changed
  // what this run actually reviewed" class RUN_ANOMALY exists for, and were previously dropped
  // entirely unless a caller hand-authored one into context.render.RUN_ANOMALY (which is how
  // arm B's first live run — ab/B/20230/1/meta.json — got the leading-glyph rule wrong: a
  // hand-typed value defensively prefixed with the same ⚠️ the rest of the report shows,
  // duplicating the renderer's own prefix). Computed here, a live run never hand-authors this
  // and can never reintroduce the glyph.
  const capApplied = context?.routing?.capApplied === true;
  const autoRunAnomaly = buildAutoRunAnomaly({
    capApplied,
    depthCapability: context?.workspace?.depthCapability || context?.depthCapability,
    contextAnomalies: context?.anomalies,
  });

  // MEMORIES_USED / MEMORIES_SUMMARY — computed from judgments.memory's two arrays (D4:
  // "copied verbatim from MCP reads … finalize.mjs decides the lifecycle"; the schema forbids a
  // `summary` field on judgments.memory outright, additionalProperties:false, so the OLD
  // `judgments?.memory?.summary` read here could never be populated by a real run). Built from
  // the SAME array MEMORIES_USED renders, so the two can never disagree — arm B's first live run
  // hand-typed a MEMORIES_SUMMARY that used the wrong vocabulary (render-report.mjs requires the
  // literal `<N> indexed` shape and rejects any string carrying "used", which is derived).
  const memoryUsed = buildMemoriesUsed(judgments?.memory);
  const memoriesSummary = memoriesSummaryFor(memoryUsed);

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
    memoriesSummary: context?.render?.MEMORIES_SUMMARY ?? memoriesSummary,
    integrations: context?.render?.INTEGRATIONS,
    optimalityLog: judgments?.lenses?.optimality_log,
    standardsLog: judgments?.lenses?.standards_log,
    measurabilityLog: judgments?.lenses?.measurability_log,
    skippedFiles: context?.render?.SKIPPED_FILES,
  };

  const extras = {
    ...(context?.render || {}),
    RUN_ANOMALY: context?.render?.RUN_ANOMALY ?? autoRunAnomaly,
    MEMORIES_USED: context?.render?.MEMORIES_USED ?? memoryUsed,
    // BUILT from judgments.lenses.optimality_cards' structured fields (buildOptimalityCard), never
    // `card.markdown ?? card` — see buildOptimalityCard's own docstring for why the pass-through
    // was wrong (arm B's first live run, ab/B/20230/1/meta.json).
    ...(judgments?.lenses?.optimality_cards?.length
      ? { OPTIMALITY_CARDS: judgments.lenses.optimality_cards.map((/** @type {any} */ c) => buildOptimalityCard(c)) }
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

  // buildAutoRunAnomaly — ab/B/20230/1/meta.json: RUN_ANOMALY must never start with a glyph
  // (the renderer prepends its own ⚠️), and prepare-review.mjs's own anomalies[] were previously
  // dropped entirely rather than surfaced.
  {
    check("buildAutoRunAnomaly returns undefined when nothing anomalous happened",
      buildAutoRunAnomaly({ capApplied: false, contextAnomalies: [] }) === undefined);
    const capOnly = buildAutoRunAnomaly({ capApplied: true, depthCapability: "diff-only", contextAnomalies: [] });
    check("buildAutoRunAnomaly names the depth-capability cap, never with a leading glyph",
      typeof capOnly === "string" && !/^\s*[⚠️❌✅⏭️]/.test(capOnly) && capOnly.includes("diff-only"));
    const anomaliesOnly = buildAutoRunAnomaly({ capApplied: false, contextAnomalies: ["workspace ladder exhausted — DEPTH_CAPABILITY=diff-only, tier capped at standard"] });
    check("buildAutoRunAnomaly folds prepare-review.mjs's context.anomalies[] in, never with a leading glyph",
      typeof anomaliesOnly === "string" && !/^\s*[⚠️❌✅⏭️]/.test(anomaliesOnly) && anomaliesOnly.includes("1 prepare-time anomaly"));
    const both = buildAutoRunAnomaly({ capApplied: true, depthCapability: "diff-only", contextAnomalies: ["a", "b", "c"] });
    check("buildAutoRunAnomaly combines the cap note and the anomaly count when both apply",
      typeof both === "string" && both.includes("diff-only") && both.includes("3 prepare-time anomalies"));
  }

  // buildMemoriesUsed / memoriesSummaryFor — ab/B/20230/1/meta.json: MEMORIES_SUMMARY must be
  // the literal `<N> indexed` shape (never a hand-typed "used" string), computed from the SAME
  // array MEMORIES_USED renders so the two can never disagree.
  {
    const memory = {
      relevance_rules: [{ key: "rule::foo@a.ts", evidence: [1, 2] }],
      lessons_used: [
        { key: "hotspot::b.tsx", used_as: "finder pointer (re-verified)" },
        { key: "knowledge::useThing", used_as: "contradiction record respected" },
        { key: "aw-lessons::some-slug", used_as: "advisory context" },
      ],
    };
    const used = buildMemoriesUsed(memory);
    check("buildMemoriesUsed emits one row per relevance_rules + lessons_used entry", used.length === 4);
    check("a relevance_rules entry is always kind: rule", used[0].kind === "rule" && used[0].key === "rule::foo@a.ts");
    check("a lessons_used entry derives kind from its hotspot:: key prefix", used[1].kind === "hotspot");
    check("a lessons_used entry derives kind from its knowledge:: key prefix", used[2].kind === "knowledge");
    check("a lessons_used entry with neither prefix defaults to kind: lesson", used[3].kind === "lesson");
    check("note is populated from used_as", used[1].note === "finder pointer (re-verified)");
    check("evidence is carried through as an array of PR numbers", Array.isArray(used[0].evidence) && used[0].evidence[0] === 1);

    check("memoriesSummaryFor is the literal `<N> indexed` shape, matching MEMORIES_USED.length exactly",
      memoriesSummaryFor(used) === "4 indexed");
    check("memoriesSummaryFor never contains the word 'used' — render-report.mjs derives that half from MEMORIES_USED.length",
      !/\bused\b/.test(memoriesSummaryFor(used)));
    check("memoriesSummaryFor defaults sensibly with no records", memoriesSummaryFor([]) === "no relevance rules or lessons consulted");

    // End-to-end: a live-shaped context whose judgments carry real memory reads — proving the
    // exact run-1 shape (relevance_rules empty, lessons_used populated) renders with zero manual
    // authoring of MEMORIES_SUMMARY/MEMORIES_USED.
    const liveShapedMemory = withRenderAt({
      mode: "full", headSha: "906a74781990f75607f0234de963fdbbc3953f2c",
      deltaLines: 3, routing: { tier: "deep" }, workspace: { depthCapability: "checkout" },
      files: [], threads: [],
    }, "2026-09-25T12:00:00Z");
    const memJudgments = {
      candidates: [],
      gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } },
      threads: [],
      memory: { relevance_rules: [], lessons_used: [{ key: "hotspot::x.tsx", used_as: "finder pointer (re-verified)" }] },
      summary: "s",
    };
    const rMem = finalizeReview({ context: liveShapedMemory, judgments: memJudgments });
    check("RUN.memoriesSummary is computed as `1 indexed`, matching the single lessons_used entry", rMem.payload.MEMORIES_SUMMARY === "1 indexed");
    check("payload.MEMORIES_USED carries the one lesson, tagged kind: hotspot from its key prefix",
      rMem.payload.MEMORIES_USED.length === 1 && rMem.payload.MEMORIES_USED[0].kind === "hotspot");
    const memRenderCheck = renderVia(scratchRoot(), RENDER_REPORT_SCRIPT, rMem.payload, "self-test-memories");
    check("the memories payload renders through render-report.mjs with zero manual edits", memRenderCheck.ok, memRenderCheck.stderr.trim());
  }

  // hydrateFilePatches — the real "context.files has empty patch" gap (ab/B/20230/1/meta.json).
  {
    const scratchDir = join(scratchRoot(), "finalize-hydrate-self-test");
    mkdirSync(scratchDir, { recursive: true });
    const sidecarPath = join(scratchDir, "pr-files.json");
    writeFileSync(sidecarPath, [
      JSON.stringify({ filename: "a.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n+x\n y" }),
      JSON.stringify({ filename: "b.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n+y\n z" }),
    ].join("\n") + "\n", "utf8");

    const stripped = hydrateFilePatches({
      files: [{ filename: "a.ts", additions: 1, deletions: 0 }, { filename: "b.ts", additions: 1, deletions: 0 }],
      paths: { files: sidecarPath },
    });
    check("hydrateFilePatches re-populates patch from the paths.files sidecar",
      stripped.files[0].patch === "@@ -1,1 +1,2 @@\n+x\n y" && stripped.files[1].patch === "@@ -1,1 +1,2 @@\n+y\n z");

    const viaFilesPath = hydrateFilePatches({
      files: [{ filename: "a.ts" }],
      filesPath: sidecarPath, // the older/alternate field name — same sidecar
    });
    check("hydrateFilePatches also accepts the filesPath field name (not just paths.files)",
      viaFilesPath.files[0].patch === "@@ -1,1 +1,2 @@\n+x\n y");

    const alreadyInline = hydrateFilePatches({
      files: [{ filename: "a.ts", patch: "already here" }],
      paths: { files: sidecarPath },
    });
    check("hydrateFilePatches is a no-op when every file already carries a patch (--inline-payloads)",
      alreadyInline.files[0].patch === "already here");

    const noSidecar = hydrateFilePatches({ files: [{ filename: "a.ts" }] });
    check("hydrateFilePatches degrades to the pre-fix behavior (patch-less) when no sidecar path is given, never throws",
      noSidecar.files[0].patch === undefined);

    const missingSidecar = hydrateFilePatches({
      files: [{ filename: "a.ts" }],
      paths: { files: join(scratchDir, "does-not-exist.json") },
    });
    check("hydrateFilePatches degrades gracefully when the sidecar file is unreadable, never throws",
      missingSidecar.files[0].patch === undefined);

    const notInSidecar = hydrateFilePatches({
      files: [{ filename: "c-not-in-sidecar.ts" }],
      paths: { files: sidecarPath },
    });
    check("hydrateFilePatches leaves a file absent from the sidecar untouched rather than inventing a patch",
      notInSidecar.files[0].patch === undefined);

    // End-to-end: the same field-bridging proof as the "live-shaped" block above, but now with
    // patch-less files (as prepare-review.mjs actually emits by default) plus the sidecar main()
    // reads — proving the SAME candidate that was anchorless in arm B's run now line-validates.
    const liveShapedNoPatch = withRenderAt({
      mode: "full", headSha: "906a74781990f75607f0234de963fdbbc3953f2c",
      deltaLines: 3, routing: { tier: "deep" }, workspace: { depthCapability: "checkout" },
      files: [{ filename: "a.ts" }], threads: [],
      paths: { files: sidecarPath },
    }, "2026-09-25T12:00:00Z");
    const hydrated = hydrateFilePatches(liveShapedNoPatch);
    const j = {
      candidates: [mkCandidate({ final: 95, path: "a.ts", line: 1 })],
      gates: { gate1: { status: "PASS", details: "d" }, gate4: { precandidate_dispositions: [], ai_stub_findings: [] }, gate5: { status: "PASS", details: "d" } },
      threads: [], memory: { relevance_rules: [], lessons_used: [] }, summary: "s",
    };
    const rNoHydrate = finalizeReview({ context: liveShapedNoPatch, judgments: j });
    const rHydrated = finalizeReview({ context: hydrated, judgments: j });
    check("without hydration, a candidate on a patch-less context.files entry lands anchorless",
      rNoHydrate.anchorless.length === 1 && rNoHydrate.inline.length === 0);
    check("with hydration, the SAME candidate line-validates and clears to inline",
      rHydrated.anchorless.length === 0 && rHydrated.inline.length === 1);
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

  // End-to-end CLI replay, shaped like ab/B/20230/1's real inputs (multi-line/markdown-link
  // thread asks, a thread this run resolves, a claim needing a built FP, an optimality card) —
  // spawns `finalize.mjs --context … --judgments … --out-dir …` as a REAL subprocess (the only
  // way to exercise main()'s I/O boundary itself: hydrateFilePatches, the report/pointer/inline
  // renders, and write-plan.json), and asserts it renders and writes write-plan.json with zero
  // manual patching — the exact gap the live A/B run's `manual_workarounds` list documents.
  {
    const e2eDir = join(scratchRoot(), "finalize-e2e-replay");
    mkdirSync(e2eDir, { recursive: true });

    const e2eContext = withRenderAt({
      mode: "full",
      headSha: "906a74781990f75607f0234de963fdbbc3953f2c",
      deltaLines: 42,
      routing: { tier: "deep" },
      workspace: { depthCapability: "checkout" },
      target: { repo: "o/r", owner: "o", name: "r", number: 205, url: "https://github.com/o/r/pull/205" },
      priorRun: { stickyCommentId: 555, stickyUrl: "https://github.com/o/r/pull/205#issuecomment-555", stickyKind: "sticky" },
      files: [{
        filename: "src/api/client.ts",
        patch: "@@ -85,3 +85,6 @@\n unchanged\n unchanged\n unchanged\n+added one\n+added two\n+added three",
      }],
      threads: [
        // t1: resolved THIS run (judgments.threads classifies it "fixed") — must NOT appear in
        // the rendered OPEN_THREADS_LIST, and must produce a thread_reply + thread_resolve op.
        {
          thread_id: "t1", path: "supabase/functions/memories/handlers/list.ts", line: 235,
          url: "https://github.com/o/r/pull/205#discussion_r1",
          root_body: "issue: applyScalarFilter still puts the whole dimension into a PostgREST URL "
            + "operand, which means a caller passing an array value for a scalar column produces a "
            + "malformed query string instead of a 400.\n\nSee [the linked doc](https://example.com/doc) "
            + "for the full write-up.\n\n(blocking)",
          author: "cursor", is_bot: true, replies: [],
        },
        // t2: left OPEN (no judgment classifies it) — exercises normalizeAsk's multi-line
        // collapse + markdown-link unwrap + ~12-word truncation on a real report render.
        {
          thread_id: "t2", path: "src/api/client.ts", line: 88,
          url: "https://github.com/o/r/pull/205#discussion_r2",
          root_body: "This early-return path never flushes pending writes before returning, "
            + "silently dropping buffered log entries whenever the fast-exit branch fires\n\n"
            + "See [the retry doc](https://example.com/retry) for more context.",
          author: "human-reviewer", is_bot: false, replies: [],
        },
      ],
    }, "2026-09-25T12:00:00Z");

    const e2eJudgments = {
      v: 1,
      head_sha: "906a747",
      candidates: [{
        finder: "correctness", defect_class: "logic", path: "src/api/client.ts", line: 88, symbol: "earlyReturn",
        claim: "an early return may skip the audit log write",
        bad_outcome: "the audit log silently drops entries",
        evidence: ["src/api/client.ts:88"],
        verify_by: "trace the early-return branch",
        verdict: "confirmed", R: 92, A: 90, Ac: 91, final: 91,
        severity: "high", prefix: "issue", blocking: true,
        title: "Early return may skip the audit log write",
        body: "This early-return may skip the audit log write.",
        materiality: true, category: "correctness",
      }],
      gates: {
        gate1: { status: "PASS", details: "The description matches what the diff does." },
        gate4: { precandidate_dispositions: [], ai_stub_findings: [] },
        gate5: { status: "PASS", details: "The change is documented well enough to follow." },
      },
      threads: [
        { thread_id: "t1", classification: "fixed", reply: "Fixed in 906a747 — applyScalarFilter now rejects array values with a 400." },
      ],
      memory: { relevance_rules: [], lessons_used: [] },
      lenses: {
        optimality_cards: [{
          path: "src/api/client.ts", line: 180, verdict: "suboptimal", analysis_confidence: 88,
          card_body: "> **Reuse `withRetry()` instead of hand-rolling a retry loop**\n\n"
            + "**Why it's better** · _codebase-fit_ — one backoff policy instead of four.",
        }],
        optimality_log: "ran · 1 judged · 0 optimal · 1 proposal(s) · 0 inline pointer(s) · 0 withheld",
        standards_log: "ran · 1 docs · 0 finding(s)",
        measurability_log: "ran · 1 paths classified · 0 missing · 0 unlinked",
        holistic_log: "skipped",
      },
      summary: "Fixes the audit-log early return and hardens applyScalarFilter against array inputs.",
    };

    const contextPath = join(e2eDir, "context.json");
    const judgmentsPath = join(e2eDir, "judgments.json");
    writeFileSync(contextPath, JSON.stringify(e2eContext, null, 2));
    writeFileSync(judgmentsPath, JSON.stringify(e2eJudgments, null, 2));
    const outDir = join(e2eDir, "out");

    const r = spawnSync(process.execPath, [
      join(HERE, "finalize.mjs"),
      "--context", contextPath, "--judgments", judgmentsPath, "--out-dir", outDir,
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    check("finalize.mjs --context/--judgments/--out-dir exits 0 against a real (non-fixture) shaped input, with zero manual patching",
      r.status === 0, (r.stderr || "").trim().slice(0, 500));

    check("report-body.md is written", existsSync(join(outDir, "report-body.md")));
    check("pointer-body.md is written and is the marker-only pointer form",
      existsSync(join(outDir, "pointer-body.md"))
      && readFileSync(join(outDir, "pointer-body.md"), "utf8").trim() === "<!-- PR_REVIEWER_POINTER -->");
    check("write-plan.json is written (defect 8 — previously emitted by no code path at all)",
      existsSync(join(outDir, "write-plan.json")));

    if (existsSync(join(outDir, "write-plan.json"))) {
      const writePlan = JSON.parse(readFileSync(join(outDir, "write-plan.json"), "utf8"));
      check("write-plan.repo/pr_number come from context.target, never hand-typed",
        writePlan.repo === "o/r" && writePlan.pr_number === 205);
      check("t1 (classified 'fixed' this run) produces a thread_reply carrying the judgment's own reply text",
        writePlan.thread_reply.some((/** @type {any} */ t) => t.thread_id === "t1"
          && t.body === "Fixed in 906a747 — applyScalarFilter now rejects array values with a 400."));
      check("t1 also produces a thread_resolve op; t2 (left unclassified/open) produces neither",
        writePlan.thread_resolve.some((/** @type {any} */ t) => t.thread_id === "t1")
        && !writePlan.thread_resolve.some((/** @type {any} */ t) => t.thread_id === "t2")
        && !writePlan.thread_reply.some((/** @type {any} */ t) => t.thread_id === "t2"));
      check("sticky_upsert.comment_id is the real prior sticky id from context.priorRun, targeting an UPDATE not a create",
        writePlan.sticky_upsert.comment_id === 555);
      check("sticky_upsert paths point at the report/pointer bodies this SAME run just wrote to disk",
        writePlan.sticky_upsert.body_path === join(outDir, "report-body.md")
        && writePlan.sticky_upsert.pointer_body_path === join(outDir, "pointer-body.md"));
      check("review_create.commit_id is the FULL 40-char sha, never truncated to RUN.sha's 7 chars",
        writePlan.review_create.commit_id === "906a74781990f75607f0234de963fdbbc3953f2c");
      check("review_create carries exactly one comment, forced to side: RIGHT",
        writePlan.review_create.comments.length === 1 && writePlan.review_create.comments[0].side === "RIGHT");
      check("the inline comment body carries a BUILT (never hand-typed) v2 fingerprint for the claim",
        writePlan.review_create.comments[0].body.includes(
          "<!-- fp:v2:correctness:logic:earlyReturn@src/api/client.ts -->"));
    }

    if (existsSync(join(outDir, "report-body.md"))) {
      const reportBody = readFileSync(join(outDir, "report-body.md"), "utf8");
      check("the optimality card renders with its structural heading, never a raw markdown passthrough",
        reportBody.includes("### Optimality proposal — src/api/client.ts:180"));
      check("t1 (resolved this run) is absent from the rendered open-threads list",
        !reportBody.includes("applyScalarFilter still puts the whole dimension"));
      check("t2's multi-line, markdown-linked ask renders as ONE normalized line (collapsed + link unwrapped + truncated), never raw",
        reportBody.includes("This early-return path never flushes pending writes before returning, "
          + "silently dropping buffered…")
        && !reportBody.includes("[the retry doc](https://example.com/retry)"));
    }
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
  const context = withRenderAt(hydrateFilePatches(contextRaw));
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

  const sha = result.payload?.RUN?.sha || "unknown";
  // Collected alongside the per-finding render below, so the write-plan's review_create.comments
  // carry the SAME rendered bytes inline/*.md holds on disk — never a second, independently
  // re-derived copy (the failure class execute-write-plan.mjs's own payloadIsSafe exists to catch
  // one layer downstream, at the point of posting: mthines/agent-skills#165).
  /** @type {Array<{path: string, line: number|null, body: string}>} */
  const renderedInlineComments = [];
  if (result.inline.length > 0) {
    mkdirSync(join(outDir, "inline"), { recursive: true });
    result.inline.forEach((/** @type {any} */ finding, /** @type {number} */ i) => {
      const commentPayload = toInlineCommentPayload(finding, { sha });
      const r = renderVia(outDir, RENDER_COMMENT_SCRIPT, commentPayload, `inline-${i}`);
      if (r.ok) {
        writeFileSync(join(outDir, "inline", `${i}.md`), r.stdout);
        renderedInlineComments.push({ path: finding.path, line: finding.line ?? null, body: r.stdout });
      } else {
        renderFailed = true;
        console.error(`finalize: render-comment.mjs failed for inline[${i}] — ${r.stderr.trim()}`);
      }
    });
  }

  // ab/B/20230/1/meta.json (defect 8): finalize.mjs never emitted write-plan.json, so a live run
  // had to hand-assemble it to invoke execute-write-plan.mjs at all — rules/pipeline.md's Artifact
  // flow documents this file as finalize.mjs's own output, not a downstream caller's. The review
  // body itself is the marker-only "pointer" FORM (render-pointer.mjs) — GitHub accepts an
  // empty/marker-only COMMENT review with inline comments attached, and the report's content lives
  // only in the sticky.
  const pointerBodyPath = join(outDir, "pointer-body.md");
  const pointerRendered = renderVia(outDir, RENDER_POINTER_SCRIPT, { FORM: "pointer", HEAD_SHA: sha }, "pointer-body");
  if (pointerRendered.ok) {
    writeFileSync(pointerBodyPath, pointerRendered.stdout);
  } else {
    renderFailed = true;
    console.error(`finalize: render-pointer.mjs failed — ${pointerRendered.stderr.trim()}`);
  }

  const writePlan = buildWritePlan({
    repo: context?.target?.repo,
    prNumber: context?.target?.number,
    // The FULL sha, never truncated — review_create.commit_id is what `gh api pulls/{n}/reviews`
    // posts as the review's commit_id, a real GitHub field with no 7-char convention of its own
    // (RUN.sha's 7-char truncation is a render-report.mjs display rule, not a GitHub API one).
    commitSha: context?.headSha || context?.head_sha || judgments?.head_sha,
    threads: judgments?.threads,
    stickyCommentId: context?.priorRun?.stickyCommentId ?? null,
    reportBodyPath: join(outDir, "report-body.md"),
    pointerBodyPath,
    inlineComments: renderedInlineComments,
  });
  writeFileSync(join(outDir, "write-plan.json"), JSON.stringify(writePlan, null, 2));
  console.log(`finalize: wrote write-plan.json (${writePlan.thread_reply.length} replies, `
    + `${writePlan.thread_resolve.length} resolves, ${writePlan.review_create.comments.length} inline comments)`);

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
