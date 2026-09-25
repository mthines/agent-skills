// @ts-check
/**
 * finalize/payload.mjs — assembles the render-report.mjs / render-comment.mjs
 * payload from the finalize pipeline's own outputs. Pure. No I/O (D18).
 *
 * AC-11 status: this module now produces the renderers' EXACT field shapes
 * (see the mapper functions below), verified byte-identical against
 * `scripts/eval/fixtures/{report-body,inline-comment}/*.expected.md` via
 * `finalize.mjs --replay-fixtures` and `scripts/eval/fixtures/finalize/*`.
 * A small set of fields are genuine PASSTHROUGH — facts finalize.mjs was
 * never scoped to compute (Phase B's impact graph, memory reads, the
 * optimality lens's own markdown cards, CI's informational note) — and are
 * relayed verbatim from `context.render.*` (a prepare-review.mjs extension
 * point, never schema-validated) when present, never invented here.
 */

const GATE_FIELD = { g1: "GATE_DESCRIPTION", g3: "GATE_PRIOR", g4: "GATE_SELFREVIEW", g5: "GATE_DOCS", g6: "GATE_CODEREVIEW" };
const BLOCKING_DECORATION_RE = /\(blocking\)|(?:^|\n)\s*issue:|severity:\s*(?:critical|high)/i;
// render-report.mjs's VALID_STATUS is the glyph set, never the PASS/WARN/FAIL/SKIPPED gates.mjs
// computes internally — the two vocabularies are separate by design (gates.mjs stays plain-text
// so its own self-test can assert on status without a glyph table of its own).
/** @type {Record<string, string>} */
const STATUS_GLYPH = { PASS: "✅", WARN: "⚠️", FAIL: "❌", SKIPPED: "⏭️" };
// render-report.mjs's RUN[] SHAPES — the only fields the RUN block itself may carry. `run` (this
// module's own input) is a richer internal bag (summary, memoriesSummary, the lens logs) that also
// feeds the scalar slots below; embedding it under RUN verbatim would trip render-report.mjs's
// stray-field check on every one of those extra keys.
const RUN_FIELDS = ["mode", "sha", "prior_sha", "delta_lines", "at", "tier", "depth"];

/**
 * The one-line Quality Gate summary render-report.mjs's own cross-check reads
 * `posted inline (\d+)` out of (its length must equal FINDINGS.length).
 *
 * `carried forward` tracks findings still open from a PRIOR iteration of the
 * same PR (multi-run continuity) — genuinely out of a single `finalizeReview()`
 * pass's scope, so it defaults to 0 unless the caller supplies one (D5).
 * @param {{ produced: number, cleared: number, deferredOverCap: number, confidenceDeferred: number, posted: number, suppressed: number, carriedForward?: number }} counters
 */
export function buildQualitySummary(counters) {
  const {
    produced, cleared, deferredOverCap, confidenceDeferred, posted, suppressed, carriedForward = 0,
  } = counters;
  const line = `produced ${produced} → posted inline ${posted} · cleared ${cleared}`
    + ` · carried forward ${carriedForward} · deferred ${deferredOverCap} · below-bar ${confidenceDeferred}`;
  return suppressed > 0 ? `${line} · memory suppressions ${suppressed}` : line;
}

/**
 * A candidate → render-report.mjs `FINDINGS[]` row: title/path/line/url/tier/blocking.
 * @param {any} c
 */
export function toFindingBullet(c) {
  /** @type {Record<string, any>} */
  const out = { title: c.title, path: c.path, line: c.line, tier: c.severity };
  if (c.url) out.url = c.url;
  if (c.blocking === true) out.blocking = true;
  return out;
}

/**
 * A disposed candidate → `ADDITIONAL_FINDINGS[]` / `LOW_CONFIDENCE_FINDINGS[]` row.
 * @param {any} c
 */
export function toAdvisoryFinding(c) {
  /** @type {Record<string, any>} */
  const out = { path: c.path, line: c.line, prefix: c.prefix, body: c.body, confidence: Math.round(c.final) };
  if (c.url) out.url = c.url;
  return out;
}

/**
 * A prepare-review.mjs `context.threads[]` item → render-report.mjs `OPEN_THREADS[]` row.
 * @param {any} t
 */
export function toOpenThreadBullet(t) {
  const rootBody = t.root_body || "";
  const blocking = BLOCKING_DECORATION_RE.test(rootBody);
  // AC-11/D5: `root_body` is the raw comment body — gate3()'s own blocking-decoration regex
  // reads it directly, unmodified, since that detection needs the literal conventional-comments
  // prefix. `ask` is the human-facing paraphrase the OPEN_THREADS_LIST bullet renders, so the
  // same claim-prefix and `(blocking)` decoration that just drove `blocking` above is stripped
  // from it here — a reader does not need "issue: ... (blocking)" repeated verbatim next to a
  // bullet that already carries the blocking fact structurally (Gate 3's FAIL/WARN split, and
  // OPEN_THREADS_SUFFIX's own "(<K> blocking)" count on the accordion summary).
  const ask = rootBody
    .replace(/^\s*(?:issue|suggestion)\s*:\s*/i, "")
    .replace(/\s*\(blocking\)\s*$/i, "")
    .trim();
  /** @type {Record<string, any>} */
  const out = { path: t.path, line: t.line, ask, blocking };
  if (t.url) out.url = t.url;
  if (typeof t.is_bot === "boolean") { out.author = t.author; out.is_bot = t.is_bot; }
  return out;
}

/**
 * A finalized candidate → render-comment.mjs's inline-comment payload.
 * @param {any} c @param {{ sha: string }} args
 */
export function toInlineCommentPayload(c, { sha }) {
  /** @type {Record<string, any>} */
  const payload = { PREFIX: c.prefix, TIER: c.severity, BODY: c.body, SHA: sha };
  if (c.title) payload.TITLE = c.title;
  if (c.blocking === true) payload.BLOCKING = true;
  if (c.pseudo === true) payload.PSEUDO = true;
  if (c.fp) payload.FP = c.fp;
  if (c.fix_url) payload.FIX_URL = c.fix_url;
  if (Array.isArray(c.evidence_anchors) && c.evidence_anchors.length) {
    payload.EVIDENCE = c.evidence_anchors.map((/** @type {any} */ e) => (
      e.note ? { path: e.path, line: e.line, note: e.note } : { path: e.path, line: e.line }
    ));
  }
  if (c.fence) payload.FENCE = c.fence;
  if (c.unverified_reason) payload.UNVERIFIED = c.unverified_reason;
  return payload;
}

const RENDER_EXTRAS = [
  "RUN_NOTE", "RUN_ANOMALY", "CI_NOTE", "VERIFIED_NOTE", "QUALITY_DROPPED", "FIX_ALL_URL",
  "PARTIAL_REVIEW", "RESOLVED_SINCE", "MEMORIES_USED", "IMPACT", "WITHHELD", "OPTIMALITY_CARDS",
];

/**
 * @param {{ gates: any, run: any, findings: any[], deferred: any[], lowConfidence: any[], quality: string, extras?: Record<string, any> }} args
 * @returns {any} a render-report.mjs-shaped payload
 */
export function buildReportPayload({ gates, run, findings, deferred, lowConfidence, quality, extras }) {
  // AC-11: each phrase is the gate's own short `reason` (the "Warnings:"/"FAIL:" summary line),
  // never the longer `details` sentence the gate TABLE cell renders — gates.mjs computes both.
  const failReasons = [];
  const warnReasons = [];
  for (const [key] of Object.entries(GATE_FIELD)) {
    const g = gates[key];
    if (!g) continue;
    if (g.status === "FAIL") failReasons.push(g.reason || g.details);
    if (g.status === "WARN") warnReasons.push(g.reason || g.details);
  }

  /** @type {Record<string, any>} */
  const runBlock = {};
  for (const k of RUN_FIELDS) if (run[k] !== undefined && run[k] !== null) runBlock[k] = run[k];

  /** @type {Record<string, any>} */
  const payload = {
    VERDICT: gates.verdict,
    SUMMARY: run.summary || "",
    MEMORIES_SUMMARY: run.memoriesSummary || "no relevance rules or lessons consulted",
    QUALITY: quality,
    INTEGRATIONS: run.integrations || "none",
    OPTIMALITY_LOG: run.optimalityLog || "skipped",
    STANDARDS_LOG: run.standardsLog || "skipped",
    MEASURABILITY_LOG: run.measurabilityLog || "skipped",
    // REQUIRED_SCALARS (render-report.mjs) checks this slot for non-emptiness only — an empty
    // string fails closed with "missing required slot(s)". report-rendering.md's own vocabulary
    // for "nothing was skipped" is the literal word `none`, never "".
    SKIPPED_FILES: run.skippedFiles || "none",
    RUN: runBlock,
    FINDINGS: findings,
    FAIL_REASONS: failReasons,
    WARN_REASONS: warnReasons,
    OPEN_THREADS: gates.g3?.open || [],
    ADDITIONAL_FINDINGS: deferred,
    LOW_CONFIDENCE_FINDINGS: lowConfidence,
  };
  for (const [key, field] of Object.entries(GATE_FIELD)) {
    const g = gates[key];
    payload[`${field}_STATUS`] = STATUS_GLYPH[g?.status] ?? "⏭️";
    payload[`${field}_DETAILS`] = g?.details ?? "--skip-gates";
  }
  // Passthrough-only fields (D5): relayed verbatim from context.render.*, never computed here.
  for (const key of RENDER_EXTRAS) {
    if (extras && extras[key] !== undefined && extras[key] !== null) payload[key] = extras[key];
  }
  return payload;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  const gates = {
    verdict: "FAIL",
    g1: { status: "PASS", details: "matches" },
    g3: { status: "PASS", details: "no open threads", open: [] },
    g4: { status: "FAIL", details: "1 confirmed pre-candidate(s), 0 AI-stub finding(s)" },
    g5: { status: "PASS", details: "docs updated" },
    g6: { status: "WARN", details: "1 inline, 0 deferred non-blocking finding(s)" },
  };
  const run = { mode: "full", sha: "abc1234", delta_lines: 10, tier: "deep", depth: "checkout", summary: "one blocking issue" };
  const quality = buildQualitySummary({
    produced: 5, confidenceDeferred: 0,
    suppressed: 0, cleared: 3, deferredOverCap: 0, posted: 3,
  });
  const payload = buildReportPayload({
    gates, run, findings: [{ title: "T", path: "a.ts", line: 1, tier: "high" }], deferred: [], lowConfidence: [], quality,
    extras: { RUN_NOTE: "27 files touched", CI_NOTE: "1 check pending" },
  });

  check("VERDICT passes through from gates.verdict", payload.VERDICT === "FAIL");
  check("GATE_SELFREVIEW_STATUS maps from gate4", payload.GATE_SELFREVIEW_STATUS === "❌");
  check("GATE_PRIOR_STATUS maps from gate3", payload.GATE_PRIOR_STATUS === "✅");
  check("GATE_DOCS_STATUS maps from gate5", payload.GATE_DOCS_STATUS === "✅");
  check("GATE_CODEREVIEW_STATUS maps from gate6", payload.GATE_CODEREVIEW_STATUS === "⚠️");
  check("FAIL_REASONS carries the failing gate's own reason/details phrase", payload.FAIL_REASONS.length === 1 && payload.FAIL_REASONS[0] === "1 confirmed pre-candidate(s), 0 AI-stub finding(s)");
  check("WARN_REASONS carries the warning gate's own reason/details phrase", payload.WARN_REASONS.length === 1 && payload.WARN_REASONS[0] === "1 inline, 0 deferred non-blocking finding(s)");
  check("FINDINGS passes through", payload.FINDINGS.length === 1);
  check("QUALITY carries the produced→posted-inline shape render-report.mjs cross-checks",
    /^produced 5 → posted inline 3 · cleared 3 · carried forward 0 · deferred 0 · below-bar 0$/.test(payload.QUALITY));
  check("QUALITY omits memory suppressions when zero", !payload.QUALITY.includes("suppressions"));
  check("extras pass through only when present", payload.RUN_NOTE === "27 files touched" && payload.CI_NOTE === "1 check pending" && payload.IMPACT === undefined);
  check("SKIPPED_FILES defaults to the literal `none`, never an empty string render-report.mjs's non-emptiness check would reject", payload.SKIPPED_FILES === "none");
  {
    const withSkipped = buildReportPayload({
      gates, run: { ...run, skippedFiles: "a.ts (binary), b.png (binary)" }, findings: [], deferred: [], lowConfidence: [], quality,
    });
    check("SKIPPED_FILES passes through verbatim when the run supplies one", withSkipped.SKIPPED_FILES === "a.ts (binary), b.png (binary)");
  }

  {
    const withSuppressions = buildQualitySummary({ produced: 9, confidenceDeferred: 1, suppressed: 1, cleared: 4, deferredOverCap: 0, posted: 4 });
    check("QUALITY appends memory suppressions when non-zero", withSuppressions.endsWith("· memory suppressions 1"));
  }

  {
    const finding = toFindingBullet({ title: "T", path: "a.ts", line: 1, severity: "high", blocking: true, url: "https://x" });
    check("toFindingBullet maps severity→tier and keeps blocking/url", finding.tier === "high" && finding.blocking === true && finding.url === "https://x");
    const noUrl = toFindingBullet({ title: "T", path: "a.ts", line: 1, severity: "low" });
    check("toFindingBullet omits url/blocking when absent", noUrl.url === undefined && noUrl.blocking === undefined);
  }
  {
    const adv = toAdvisoryFinding({ path: "a.ts", line: 1, prefix: "nitpick", body: "b", final: 61.6 });
    check("toAdvisoryFinding rounds confidence and drops stray candidate fields", adv.confidence === 62 && Object.keys(adv).length === 5);
  }
  {
    const thread = toOpenThreadBullet({ path: "a.ts", line: 1, root_body: "issue: x (blocking)", author: "cursor", is_bot: true, url: "https://x" });
    check("toOpenThreadBullet derives blocking from the decoration regex", thread.blocking === true && thread.author === "cursor" && thread.is_bot === true);
    const untyped = toOpenThreadBullet({ path: "a.ts", line: 1, root_body: "just an observation" });
    check("toOpenThreadBullet omits author/is_bot when type unknown", untyped.author === undefined && untyped.is_bot === undefined);
  }
  {
    const claim = toInlineCommentPayload({ prefix: "issue", severity: "high", body: "b", title: "T", blocking: true, fp: "x:y:z@a.ts" }, { sha: "abc1234" });
    check("toInlineCommentPayload maps a claim's scalars", claim.PREFIX === "issue" && claim.TIER === "high" && claim.TITLE === "T" && claim.BLOCKING === true && claim.FP === "x:y:z@a.ts" && claim.SHA === "abc1234");
    const oneLiner = toInlineCommentPayload({ prefix: "nitpick", severity: "low", body: "b" }, { sha: "abc1234" });
    check("toInlineCommentPayload omits TITLE/BLOCKING/FP on a one-liner", oneLiner.TITLE === undefined && oneLiner.BLOCKING === undefined && oneLiner.FP === undefined);
    const withEvidence = toInlineCommentPayload({ prefix: "issue", severity: "high", body: "b", title: "T", evidence_anchors: [{ path: "a.ts", line: 1, note: "x" }, { path: "b.ts", line: 2 }] }, { sha: "abc1234" });
    check("toInlineCommentPayload reshapes evidence_anchors, dropping note when absent",
      withEvidence.EVIDENCE.length === 2 && withEvidence.EVIDENCE[0].note === "x" && withEvidence.EVIDENCE[1].note === undefined);
  }

  if (failed > 0) {
    console.error(`\npayload self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ payload self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
