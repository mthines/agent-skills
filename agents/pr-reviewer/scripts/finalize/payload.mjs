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
 * never scoped to compute (Phase B's impact graph, CI's informational note)
 * — and are relayed verbatim from `context.render.*` (a prepare-review.mjs
 * extension point, never schema-validated) when present, never invented
 * here. Optimality cards and the FP fingerprint are NOT passthrough — both
 * are BUILT here from judgments.json's structured fields (buildOptimalityCard,
 * toInlineCommentPayload's FP), never relayed from a model-supplied string.
 */

import { buildFingerprint } from "../fingerprint.mjs";
import { CLAIM_PREFIXES } from "./thresholds.mjs";

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

const ASK_WORD_LIMIT = 12;

/**
 * `[text](url)` → `text` — render-report.mjs's assertPlain rejects a markdown link outright.
 * @param {string} s
 */
function unwrapMarkdownLinks(s) {
  return s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * The first non-empty line, then its first sentence (`.`/`!`/`?`) if one is found before the
 * line ends — matching pr-reviewer.md's own "take its first sentence (or its suggestion:/issue:
 * line)" prose. Falls back to the whole first line when no sentence-ending punctuation appears.
 * @param {string} s
 */
function firstSentenceOrLine(s) {
  const firstLine = String(s).split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const m = firstLine.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : firstLine).trim();
}

/**
 * Cuts to ~12 words with a trailing `…`, per pr-reviewer.md's own "cut to ~12 words".
 * @param {string} s
 * @param {number} [limit]
 */
function truncateWords(s, limit = ASK_WORD_LIMIT) {
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= limit) return s.trim();
  return `${words.slice(0, limit).join(" ")}…`;
}

/**
 * pr-reviewer.md's own prose for `ask` ("the comment's own lead line, truncated, not
 * paraphrased: take its first sentence … strip noise like (non-blocking), and cut to ~12 words")
 * — mechanized. `root_body` is a real GitHub comment body: it can be multi-paragraph, carry
 * markdown links, or run well past a sentence, and render-report.mjs's `assertPlain` rejects any
 * of those outright (single line, no markdown link). Arm B's first live run (ab/B/20230/1/
 * meta.json) hit exactly this — a multi-line thread root collapsed the whole render — because the
 * old stripping only removed the claim-prefix and the trailing `(blocking)` marker, never
 * collapsed to one line or bounded the length.
 * @param {string} rootBody
 */
export function normalizeAsk(rootBody) {
  const noPrefix = String(rootBody || "").replace(/^\s*(?:issue|suggestion)\s*:\s*/i, "");
  const unlinked = unwrapMarkdownLinks(noPrefix);
  let line = firstSentenceOrLine(unlinked);
  line = line
    .replace(/\s*\((?:non-)?blocking\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A body that is ENTIRELY decoration (e.g. "issue: (blocking)" with no real ask left after
  // stripping) must not reach the renderer as an empty string — anchorBullet() requires a
  // non-empty text field, and an empty ask would fail closed rather than degrade.
  if (!line) return "(no summary available)";
  return truncateWords(line);
}

/**
 * A prepare-review.mjs `context.threads[]` item → render-report.mjs `OPEN_THREADS[]` row.
 * @param {any} t
 */
export function toOpenThreadBullet(t) {
  const rootBody = t.root_body || "";
  // AC-11/D5: `blocking` reads the RAW comment body, unmodified — gate3()'s own blocking-
  // decoration regex needs the literal conventional-comments prefix, and `ask` below is a
  // truncated, single-line PARAPHRASE derived from the same raw body, never the reverse.
  const blocking = BLOCKING_DECORATION_RE.test(rootBody);
  const ask = normalizeAsk(rootBody);
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
  // render-comment.mjs REQUIRES FP on a claim (issue/suggestion) and FORBIDS it otherwise, but
  // judgments.schema.json's candidate shape forbids the model from supplying `fp` at all
  // (additionalProperties: false, no `fp` property) — on purpose (D4: "the model never decides
  // suppression"; a hand-typed fingerprint is exactly what fingerprint.mjs's `FingerprintError`
  // exists to prevent). Arm B's first live run (ab/B/20230/1/meta.json) hit this gap directly:
  // finalize never computed one, so every claim finding failed render-comment.mjs's FP check.
  // Built here, the same way findings-bus.mjs already does for its own `fp` field — one function,
  // never a hand-typed string.
  if (CLAIM_PREFIXES.has(c.prefix)) {
    payload.FP = buildFingerprint({ finder: c.finder, defectClass: c.defect_class, symbol: c.symbol || "", path: c.path });
  }
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
 * `judgments.schema.json`'s `optimality_card` ({path, line?, verdict, analysis_confidence,
 * card_body}) → the markdown string render-report.mjs's `OPTIMALITY_CARDS[]` requires: each
 * entry must be a string carrying a `### Optimality proposal — <path>:<line>` heading. BUILT from
 * the structured fields, never `card.markdown ?? card` — arm B's first live run (ab/B/20230/1/
 * meta.json) hit this directly: the schema permits an ad-hoc `markdown` field
 * (`additionalProperties: true` on `optimality_card`), but nothing REQUIRES the model to supply
 * one, and the bare pass-through rendered `[object Object]` (or worse, silently coerced) when it
 * didn't. `line` is optional in the schema (a whole-file/approach-level proposal may name no
 * single line) but the renderer's heading regex requires an integer — a missing line anchors to
 * `1` rather than failing the render, since "which line" is never the load-bearing part of an
 * optimality proposal's heading. Only the heading is synthesized here — render-report.mjs's own
 * docstring calls a card "a multi-line markdown block by nature (a Now/Better table and prose)…
 * model-authored", so `card_body` is emitted verbatim rather than wrapped in a second,
 * finalize-invented "Verdict: …" line the model never wrote; `verdict`/`analysis_confidence`
 * stay real schema fields used elsewhere (e.g. the inline-pointer gate,
 * `optimality-review.md § Inline pointer`), not rendering inputs.
 * @param {{path:string, line?:number, verdict:string, analysis_confidence:number, card_body:string}} card
 * @returns {string}
 */
export function buildOptimalityCard(card) {
  const anchor = `${card.path}:${Number.isInteger(card.line) ? card.line : 1}`;
  const heading = `### Optimality proposal — ${anchor}`;
  return `${heading}\n\n${card.card_body}`;
}

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
  // normalizeAsk — ab/B/20230/1/meta.json's "render-report rejects multi-line/markdown thread
  // asks" defect: a real GitHub thread root can be multi-paragraph, carry markdown links, or run
  // well past a sentence, and render-report.mjs's assertPlain rejects any of those outright.
  {
    const multiLine = normalizeAsk("issue: this breaks auth (blocking)\n\nSecond paragraph with more detail.\nThird line.");
    check("normalizeAsk collapses a multi-line/multi-paragraph body to a single line",
      !multiLine.includes("\n") && multiLine === "this breaks auth");
    const withLink = normalizeAsk("suggestion: see [the docs](https://example.com/x) for context.");
    check("normalizeAsk unwraps a markdown link rather than leaving one (which assertPlain rejects)",
      !/\[[^\]]*\]\([^)]*\)/.test(withLink) && withLink === "see the docs for context.");
    const long = normalizeAsk("issue: " + Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ") + ".");
    const words = long.replace(/…$/, "").trim().split(/\s+/);
    check("normalizeAsk truncates to ~12 words with a trailing … when longer", words.length === 12 && long.endsWith("…"));
    const nonBlocking = normalizeAsk("suggestion: minor nit (non-blocking)");
    check("normalizeAsk strips (non-blocking) noise, same as (blocking)", nonBlocking === "minor nit");
    const decorationOnly = normalizeAsk("issue: (blocking)");
    check("normalizeAsk never returns an empty string — anchorBullet() requires a non-empty text field",
      decorationOnly.length > 0);
    const withBacktick = normalizeAsk("issue: `retryRequest` now throws instead of returning null.");
    check("normalizeAsk preserves a backtick (allowCode: true at the render boundary) rather than stripping it",
      withBacktick.includes("`retryRequest`"));
  }
  // buildOptimalityCard — ab/B/20230/1/meta.json: finalize must BUILD the markdown from the
  // schema's structured fields (path/line/verdict/analysis_confidence/card_body), never rely on
  // a model-supplied `card.markdown` passthrough.
  {
    const card = buildOptimalityCard({ path: "src/a.ts", line: 42, verdict: "suboptimal", analysis_confidence: 91.4, card_body: "Use a Map instead of a linear scan." });
    check("buildOptimalityCard emits the exact heading render-report.mjs's regex requires",
      /^### Optimality proposal — src\/a\.ts:42/m.test(card));
    check("buildOptimalityCard includes the card body verbatim, unmodified", card.includes("Use a Map instead of a linear scan."));
    check("buildOptimalityCard is exactly heading + blank line + card_body — never inventing its own prose the model didn't write",
      card === "### Optimality proposal — src/a.ts:42\n\nUse a Map instead of a linear scan.");
    const noLine = buildOptimalityCard({ path: "src/b.ts", verdict: "optimal", analysis_confidence: 96, card_body: "Already the simplest approach." });
    check("buildOptimalityCard anchors to line 1 when the schema's optional `line` is absent, rather than failing the heading regex",
      /^### Optimality proposal — src\/b\.ts:1/m.test(noLine));
  }
  {
    const claim = toInlineCommentPayload({ prefix: "issue", severity: "high", body: "b", title: "T", blocking: true, finder: "correctness", defect_class: "logic", symbol: "foo", path: "a.ts" }, { sha: "abc1234" });
    check("toInlineCommentPayload maps a claim's scalars", claim.PREFIX === "issue" && claim.TIER === "high" && claim.TITLE === "T" && claim.BLOCKING === true && claim.SHA === "abc1234");
    check("toInlineCommentPayload BUILDS FP via fingerprint.mjs from finder/defect_class/symbol/path — never a hand-typed/passed-through string",
      claim.FP === "correctness:logic:foo@a.ts");
    const oneLiner = toInlineCommentPayload({ prefix: "nitpick", severity: "low", body: "b" }, { sha: "abc1234" });
    check("toInlineCommentPayload omits TITLE/BLOCKING/FP on a one-liner (never a claim prefix — FP is never built for it)",
      oneLiner.TITLE === undefined && oneLiner.BLOCKING === undefined && oneLiner.FP === undefined);
    const withEvidence = toInlineCommentPayload({ prefix: "issue", severity: "high", body: "b", title: "T", finder: "consumer-impact", defect_class: "contract-break", symbol: "bar", path: "a.ts", evidence_anchors: [{ path: "a.ts", line: 1, note: "x" }, { path: "b.ts", line: 2 }] }, { sha: "abc1234" });
    check("toInlineCommentPayload reshapes evidence_anchors, dropping note when absent",
      withEvidence.EVIDENCE.length === 2 && withEvidence.EVIDENCE[0].note === "x" && withEvidence.EVIDENCE[1].note === undefined);
    const suggestion = toInlineCommentPayload({ prefix: "suggestion", severity: "medium", body: "b", finder: "quality", defect_class: "maintainability", path: "b.ts" }, { sha: "abc1234" });
    check("toInlineCommentPayload builds FP for suggestion: too, not only issue: (both are CLAIM_PREFIXES)",
      suggestion.FP === "quality:maintainability:-@b.ts");
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
