#!/usr/bin/env node
// Render a pr-reviewer REPORT_BODY from a JSON payload.
//
// Why this exists: the report layout used to live in three ~85%-identical markdown templates
// inside a 2752-line agent definition, 280 lines below the step that posts them. Runs did not
// copy them — they averaged them into a remembered shape and dropped the marker, the accordion,
// or both (five observed cases across mthines/lorekit#482, #492, #495). Layout is not a judgment
// call, so it does not belong to the model. The model produces DATA; this renders it.
//
// The payload is DATA, not markdown. Anything with a count, a link, or a shape a documented
// consumer parses is supplied structured and derived here:
//
//   counts   — never supplied. `Open review threads (3)` and its summary suffix come from the
//              array's length, so a count can never disagree with the list it counts, and a list
//              can never be orphaned from its counter.
//   links    — never supplied as markdown. The renderer builds `[`path:line`](url)`, so a value
//              cannot arrive with the link caged in a code span (which shipped a dead link once).
//   shapes   — `Run mode` and the footer SHA line are derived from a `RUN` object, so the report
//              cannot carry a 40-char sha in one line and a 7-char sha in another, and the
//              `<mode> · <N> lines in delta` form that reviewer-report-ingest.md parses is
//              guaranteed rather than hoped for.
//
// Usage:  node render-report.mjs payload.json    (or: … < payload.json)
// Output: the report body on stdout. Any problem exits non-zero with a reason on stderr and
//         prints NOTHING to stdout — a caller that pipes stdout can never post a partial body.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TIERS, TIER_GLYPH, VERDICT_GLYPH, VERDICTS, SHA7, GATE_DETAILS_MAX, TITLE_MAX,
  worstTier, tierTally, footerLine, fixButton, anchor, assertPostable,
} from "./comment-spine.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "..", "templates", "report-body.md");

const VALID_STATUS = new Set(["✅", "⚠️", "❌", "⏭️"]);
const VALID_MODES = new Set(["full", "incremental", "incremental-quick", "zero-delta"]);
// Phase C tiers. `mode` stays the parseable grammar field reviewer-report-ingest.md keys on;
// `tier` is the routing decision that produced it, and the two are checked against each other
// below so a report cannot claim a deep review while rendering an incremental mode.
const VALID_TIERS = new Set(["deep", "standard", "quick"]);
const TIER_FOR_MODE = { full: "deep", incremental: "standard", "incremental-quick": "quick" };
const VALID_DEPTHS = new Set(["checkout", "tarball", "diff-only"]);
const DEPTH_LABEL = {
  checkout: "checkout",
  tarball: "tarball (no git history)",
  "diff-only": "diff-only — consumer, type, and test verification unavailable",
};
// The glyphs the renderer owns. RUN_NOTE may carry none of them; RUN_ANOMALY may not lead with one.
const WARN_GLYPH = /[\u26a0\u274c]|\u{1F534}/u;

// Scalar slots the model supplies verbatim. Prose only — no counts, no links, no parsed shapes.
//
// `HEADLINE` used to live here as one free-prose line, and it was the single most-read line in the
// system checked only for non-emptiness — every other slot with a count, a link or a parsed shape
// was already derived. That gap is how `Not ready — this PR adds github.check_run…` shipped on
// dash0hq/dash0#18362 against a spec (`report-rendering.md § Headlines`) defining three fixed forms
// that all open `Reviewed your changes —`. It is replaced by VERDICT + FINDINGS + SUMMARY: the
// glyph, the count and the blocking subset are now derived, and the run supplies only the one
// sentence that actually needs judgment.
const REQUIRED_SCALARS = [
  "VERDICT", "SUMMARY",
  "GATE_DESCRIPTION_STATUS", "GATE_DESCRIPTION_DETAILS",
  "GATE_PRIOR_STATUS", "GATE_PRIOR_DETAILS",
  "GATE_DOCS_STATUS", "GATE_DOCS_DETAILS",
  "GATE_SELFREVIEW_STATUS", "GATE_SELFREVIEW_DETAILS",
  "GATE_CODEREVIEW_STATUS", "GATE_CODEREVIEW_DETAILS",
  "MEMORIES_SUMMARY", "QUALITY", "INTEGRATIONS",
  "OPTIMALITY_LOG", "STANDARDS_LOG", "MEASURABILITY_LOG", "SKIPPED_FILES",
];
const OPTIONAL_SCALARS = ["CI_NOTE", "VERIFIED_NOTE", "QUALITY_DROPPED", "RUN_NOTE", "RUN_ANOMALY",
  "FIX_ALL_URL"];

// Structured slots. Each is an object or an array; the renderer turns it into markdown.
const STRUCTURED = ["RUN", "PARTIAL_REVIEW", "RESOLVED_SINCE", "MEMORIES_USED",
  "FINDINGS", "FAIL_REASONS", "WARN_REASONS",
  "OPEN_THREADS", "ADDITIONAL_FINDINGS", "LOW_CONFIDENCE_FINDINGS", "OPTIMALITY_CARDS",
  "IMPACT", "WITHHELD"];

function fail(msg) {
  process.stderr.write(`render-report: ${msg}\n`);
  process.exit(1);
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Nested objects get the same unknown-key discipline as the top level. A stray field inside RUN or
// an item is silent: it changes nothing and reports nothing, so a misremembered field name reads
// as accepted. Caught exactly that with a `delta_note` typo inside RUN.
const SHAPES = {
  RUN: ["mode", "sha", "prior_sha", "delta_lines", "at", "tier", "depth"],
  PARTIAL_REVIEW: ["calls", "scanned", "total"],
  RESOLVED_SINCE: ["count", "sha"],
  "MEMORIES_USED[]": ["key", "url", "note", "kind", "evidence"],
  "OPEN_THREADS[]": ["path", "line", "url", "ask", "blocking", "author", "is_bot"],
  "ADDITIONAL_FINDINGS[]": ["path", "line", "url", "prefix", "body", "confidence"],
  "LOW_CONFIDENCE_FINDINGS[]": ["path", "line", "url", "prefix", "body", "confidence"],
  // The findings this run posted inline — the worklist the report never had. `title` is the same
  // string `render-comment.mjs` put on the comment's own first line, which is what makes the index
  // row and the comment it links to recognisably the same finding.
  "FINDINGS[]": ["title", "path", "line", "url", "tier", "blocking"],
  IMPACT: ["telemetry", "symbols", "dependencies", "overlaps"],
  "IMPACT.symbols[]": ["name", "path", "change", "consumer_files", "verified_unaffected", "findings"],
  "IMPACT.dependencies[]": ["name", "from", "to", "delta", "usage_sites", "url"],
  "IMPACT.overlaps[]": ["pr", "author", "path", "symbol", "url"],
  "WITHHELD[]": ["path", "line", "url", "prefix", "body", "reason"],
};

function assertNoStrayFields(where, obj, allowed) {
  const stray = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (stray.length) {
    fail(`${where} has unknown field(s): ${stray.join(", ")} — allowed: ${allowed.join(", ")}`);
  }
}

/**
 * Reject markdown syntax the renderer is going to add itself.
 *
 * Two field classes, two bars:
 *   - IDENTIFIER fields (`path`, `key`) — the renderer wraps these in a code span itself, so a
 *     backtick inside one would terminate that span. Rejected.
 *   - PROSE fields (`ask`, `body`, `note`) — `allowCode: true`. An inline code span is the source
 *     comment's own wording. Step 1.0 requires `ask` be another bot's lead line "truncated, not
 *     paraphrased", and those lead lines name symbols in backticks (the `OPEN_THREADS_LIST`
 *     example in pr-reviewer.md is itself one), so rejecting a backtick here aborted the whole
 *     render on input the spec mandates.
 *
 * The hazard this guard was built for — a markdown link caged in a code span — is caught by the
 * link test below, which matches inside backticks too, and again by the rendered-body
 * post-condition in main(). Neither depends on banning backticks outright.
 */
function assertPlain(where, v, { allowCode = false } = {}) {
  const s = String(v);
  if (/\[[^\]]*\]\([^)]*\)/.test(s)) {
    fail(`${where} contains a markdown link — supply the url in its own field and let the`
      + ` renderer build the link (got: ${s.slice(0, 60)})`);
  }
  if (!allowCode && s.includes("`")) {
    fail(`${where} contains a backtick — supply plain text; the renderer adds code formatting`
      + ` (got: ${s.slice(0, 60)})`);
  }
  if (s.includes("\n")) fail(`${where} contains a newline — it must be a single line`);
}

/** `- [`path:line`](url) — ask`, or unlinked inline code when no url is available. */
function anchorBullet(where, item, textField) {
  if (!isPlainObject(item)) fail(`${where} must be an object, got ${JSON.stringify(item)}`);
  const { path, line, url } = item;
  const text = item[textField];
  if (!path || String(path).trim() === "") fail(`${where}.path is required`);
  if (text === undefined || String(text).trim() === "") fail(`${where}.${textField} is required`);
  assertPlain(`${where}.path`, path);
  assertPlain(`${where}.${textField}`, text, { allowCode: true });
  if (line !== undefined && line !== null && !/^\d+(,\d+)*$/.test(String(line))) {
    fail(`${where}.line must be a line number (or comma-separated numbers), got ${JSON.stringify(line)}`);
  }
  const anchor = line === undefined || line === null ? String(path) : `${path}:${line}`;
  if (url !== undefined && url !== null && String(url).trim() !== "") {
    if (!/^https?:\/\//.test(String(url))) fail(`${where}.url must be http(s), got ${JSON.stringify(url)}`);
    return `- [\`${anchor}\`](${url}) — ${text}`;
  }
  // No permalink: inline code, never a broken link.
  return `- \`${anchor}\` — ${text}`;
}

/**
 * An open-thread bullet: the anchor + truncated `ask`, then an author-type tag that names who
 * opened the thread and whether they are a bot or a human. The tag exists because the report used
 * to call every open thread a "bot thread" — a human reviewer's unresolved comment was reported as
 * a bot's, which read as the review mislabelling the person. `is_bot` comes from the thread
 * author's GitHub type (a GitHub App is `Bot`, everyone else `human`), captured at Step 1.0.
 *
 * The tag is best-effort, and it renders only when the author TYPE is actually known — i.e. when
 * `is_bot` is a boolean. A payload that omits `is_bot` renders the bullet untagged rather than
 * guessing, even if `author` is present: the whole point of this tag is to not mislabel a human as
 * a bot (or the inverse), so an unknown type drops the tag instead of defaulting to one side. The
 * aggregate wording is already author-neutral, so a dropped tag loses detail, never mislabels. The
 * author login is wrapped in a code span (not an `@mention`) so re-rendering the sticky each run
 * does not ping the reviewer.
 */
function openThreadBullet(where, item) {
  const line = anchorBullet(where, item, "ask");
  const { author, is_bot: isBot } = item;
  if (isBot === undefined || isBot === null) return line; // type unknown → untagged, never guessed
  if (typeof isBot !== "boolean") {
    fail(`${where}.is_bot must be a boolean, got ${JSON.stringify(isBot)}`);
  }
  if (author === undefined || author === null || String(author).trim() === "") {
    fail(`${where}.author is required when is_bot is supplied`);
  }
  assertPlain(`${where}.author`, author);
  const kind = isBot === true ? "bot" : "human";
  return `${line} (${kind} · \`${author}\`)`;
}

function findingBullets(key, arr) {
  return arr.map((item, i) => {
    const where = `${key}[${i}]`;
    const { prefix, confidence } = item;
    const CONV = ["praise", "nitpick", "suggestion", "issue", "question", "thought", "chore"];
    if (prefix !== undefined && !CONV.includes(String(prefix))) {
      fail(`${where}.prefix must be a Conventional-Comments prefix, got ${JSON.stringify(prefix)}`);
    }
    let line = anchorBullet(where, item, "body");
    if (prefix !== undefined) line = line.replace(" — ", ` — ${prefix}: `);
    if (confidence !== undefined && confidence !== null) {
      if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
        fail(`${where}.confidence must be an integer 0-100, got ${JSON.stringify(confidence)}`);
      }
      line += ` (confidence ${confidence})`;
    }
    return line;
  }).join("\n");
}

function main() {
  const file = process.argv[2];
  let raw;
  try {
    raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    fail(`cannot read payload (${file || "stdin"}): ${e.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`payload is not valid JSON: ${e.message}`);
  }
  if (!isPlainObject(data)) fail("payload must be a JSON object");

  // Unknown keys are an error, not a no-op: a typo'd slot would otherwise render empty and
  // silently drop a whole section. This is also what catches a v1 payload against v2.
  const known = new Set([...REQUIRED_SCALARS, ...OPTIONAL_SCALARS, ...STRUCTURED]);
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length) {
    const V1 = ["MEMORIES", "FOOTER_LINE", "RUN_MODE", "OPEN_THREADS_COUNT",
      "OPEN_THREADS_SUFFIX", "ADDITIONAL_COUNT", "LOW_CONFIDENCE_COUNT", "OPTIMALITY_COUNT",
      "BUDGET_CALLS", "BUDGET_SCANNED", "BUDGET_TOTAL", "PARTIAL_BANNER"];
    const V2 = ["HEADLINE", "TIER_TALLY"];
    const hint = unknown.some((k) => V2.includes(k))
      ? " — these look like v2 slots: HEADLINE is replaced by VERDICT + FINDINGS + SUMMARY (the"
        + " glyph, the count and the blocking subset are derived), and TIER_TALLY is derived from"
        + " FINDINGS[].tier so a tally can no longer disagree with the findings it counts"
      : unknown.some((k) => V1.includes(k))
      ? " — these look like v1 slots: counts are now derived from array length, MEMORIES split into"
        + " MEMORIES_SUMMARY + MEMORIES_USED, and FOOTER_LINE/RUN_MODE are derived from RUN"
      : "";
    fail(`unknown payload key(s): ${unknown.join(", ")}${hint}`);
  }

  for (const [key, allowed] of Object.entries(SHAPES)) {
    const isArray = key.endsWith("[]");
    const name = isArray ? key.slice(0, -2) : key;
    const v = data[name];
    if (v === undefined || v === null) continue;
    if (isArray) {
      if (!Array.isArray(v)) fail(`${name} must be an array, got ${typeof v}`);
      v.forEach((item, i) => {
        if (!isPlainObject(item)) fail(`${name}[${i}] must be an object`);
        assertNoStrayFields(`${name}[${i}]`, item, allowed);
      });
    } else {
      if (!isPlainObject(v)) fail(`${name} must be an object`);
      assertNoStrayFields(name, v, allowed);
    }
  }

  const missing = REQUIRED_SCALARS.filter(
    (k) => data[k] === undefined || data[k] === null || String(data[k]).trim() === "");
  if (missing.length) fail(`missing required slot(s): ${missing.join(", ")}`);

  // ── gate cells ────────────────────────────────────────────────────────────────────────────
  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith("_STATUS") && !VALID_STATUS.has(String(v).trim())) {
      fail(`${k} must be one of ✅ ⚠️ ❌ ⏭️ — got ${JSON.stringify(v)}`);
    }
    if (k.startsWith("GATE_") && k.endsWith("_DETAILS")) {
      const s = String(v);
      if (s.includes("\n")) fail(`${k} contains a newline — it would break the markdown table row`);
      if (s.includes("|")) fail(`${k} contains a pipe — it would break the markdown table row`);
      if (s.length > GATE_DETAILS_MAX) {
        fail(`${k} is ${s.length} chars, over the ${GATE_DETAILS_MAX}-char cell cap — the full`
          + ` finding belongs in an inline comment`);
      }
    }
  }

  // The advisory verdict is terminal-only, and it can be smuggled in at any depth: an
  // `OPEN_THREADS[].ask` or an `ADDITIONAL_FINDINGS[].body` reaches the rendered body just as
  // surely as a top-level scalar. A top-level `String(v)` scan reads an array of objects as
  // "[object Object]" and misses every one of them, so walk the payload instead.
  const assertNoVerdict = (where, v) => {
    if (typeof v === "string") {
      if (v.includes("**Verdict**")) {
        fail(`${where} carries a **Verdict** line — the advisory verdict is terminal-only`);
      }
      return;
    }
    if (Array.isArray(v)) return v.forEach((x, i) => assertNoVerdict(`${where}[${i}]`, x));
    if (isPlainObject(v)) {
      for (const [k, x] of Object.entries(v)) assertNoVerdict(`${where}.${k}`, x);
    }
  };
  for (const [k, v] of Object.entries(data)) assertNoVerdict(k, v);

  // ── RUN → FOOTER_LINE + the Run mode line ─────────────────────────────────────────────────
  const run = data.RUN;
  if (!isPlainObject(run)) fail("RUN is required and must be an object {mode, sha, …}");
  if (!VALID_MODES.has(String(run.mode))) {
    fail(`RUN.mode must be one of ${[...VALID_MODES].join(" | ")} — got ${JSON.stringify(run.mode)}`);
  }
  // A 7-char sha, always. A report carrying two different lengths of the same sha was a real
  // defect; taking the sha once and formatting it here makes that unrepresentable.
  for (const f of ["sha", "prior_sha"]) {
    if (run[f] === undefined || run[f] === null) continue;
    if (!SHA7.test(String(run[f]))) {
      fail(`RUN.${f} must be exactly 7 lowercase hex chars (\`\${SHA:0:7}\`) — got`
        + ` ${JSON.stringify(run[f])}`);
    }
  }
  if (!run.sha) fail("RUN.sha is required");
  const needsPrior = run.mode === "incremental" || run.mode === "incremental-quick"
    || run.mode === "zero-delta";
  if (needsPrior && !run.prior_sha) fail(`RUN.prior_sha is required when RUN.mode is ${run.mode}`);

  // RUN.at — the wall-clock moment this run wrote the sticky, rendered as UPDATED_LINE right under
  // the headline (outside the accordion). GitHub sends no notification for a comment edit, so the
  // "edited" tag was the only visible sign a rewritten report had actually changed; a reader had to
  // open the edit history to see when. A timestamp at the top of the collapsed comment is not a
  // notification either, but it turns "was this touched since I last looked?" into a glance instead
  // of a click, on every run — not only the ones that also post a review.
  if (!run.at) fail("RUN.at is required — an ISO-8601 UTC timestamp for this run (e.g. `date -u +%Y-%m-%dT%H:%M:%SZ`)");
  const atDate = new Date(String(run.at));
  if (Number.isNaN(atDate.getTime()) || !/Z$/.test(String(run.at))) {
    fail(`RUN.at must be an ISO-8601 UTC timestamp ending in "Z" — got ${JSON.stringify(run.at)}`);
  }
  const updatedStamp = atDate.toISOString().slice(0, 16).replace("T", " ");

  // The run descriptor for the footer. It is a PHRASE, not a sentence, because `footerLine` already
  // renders `commit \`<sha>\`` — the substring every consumer matches on
  // (`reviewer-report-ingest.md § Footer SHA`) and the one `pr-reviewer`'s own fallback rung reads
  // to recover a delta baseline. Repeating the sha here would put it in the line twice.
  let footer;
  if (run.mode === "full") footer = "full review";
  else if (run.mode === "zero-delta") {
    footer = `no code changes since \`${run.prior_sha}\`, gate checks only`;
  } else {
    footer = `incremental review, delta since \`${run.prior_sha}\``;
  }

  // The `<mode> · <N> lines in delta` prefix is what reviewer-report-ingest.md parses, so it is
  // derived. RUN_NOTE appends run-specific colour after it — extra context has a legal home, and
  // the parseable prefix stays intact.
  if (run.mode === "zero-delta") {
    // Zero-delta means zero lines, so the field is optional — but a non-zero value would make the
    // rendered line contradict the mode.
    if (run.delta_lines !== undefined && run.delta_lines !== 0) {
      fail(`RUN.delta_lines must be 0 or omitted when RUN.mode is zero-delta — got`
        + ` ${JSON.stringify(run.delta_lines)}`);
    }
  } else if (!Number.isInteger(run.delta_lines) || run.delta_lines < 0) {
    fail(`RUN.delta_lines must be a non-negative integer when RUN.mode is ${run.mode} — got`
      + ` ${JSON.stringify(run.delta_lines)}`);
  }
  // One shape for every mode: `<mode> · <N> lines in delta`. The zero-delta run used to render
  // `incremental · no code changes`, which left the grammar's {mode, delta_lines} unit with no
  // delta_lines to parse and forced a second alternative into every consumer's regex. The mode
  // itself is not lost — the footer line names the zero-delta form explicitly.
  const modeLabel = run.mode === "zero-delta" ? "incremental" : run.mode;
  const deltaLines = run.mode === "zero-delta" ? 0 : run.delta_lines;
  let runLine = `${modeLabel} · ${deltaLines} lines in delta`;

  // Tier and depth append AFTER the parseable `<mode> · <N> lines in delta` prefix, in the same
  // position RUN_NOTE occupies, so reviewer-report-ingest.md's grammar is untouched.
  if (run.tier !== undefined && run.tier !== null) {
    if (!VALID_TIERS.has(String(run.tier))) {
      fail(`RUN.tier must be one of ${[...VALID_TIERS].join(" | ")} — got ${JSON.stringify(run.tier)}`);
    }
    // A report claiming a deep review while rendering an incremental mode is the exact class of
    // internal contradiction this renderer exists to make unrepresentable. zero-delta is exempt:
    // it is a mode with no tier of its own (the gates ran, no finder did).
    const expected = TIER_FOR_MODE[run.mode];
    if (expected && String(run.tier) !== expected) {
      fail(`RUN.tier ${JSON.stringify(run.tier)} contradicts RUN.mode ${JSON.stringify(run.mode)}`
        + ` — mode ${run.mode} is tier ${expected}`);
    }
    runLine += ` · tier ${run.tier}`;
  }
  if (run.depth !== undefined && run.depth !== null) {
    if (!VALID_DEPTHS.has(String(run.depth))) {
      fail(`RUN.depth must be one of ${[...VALID_DEPTHS].join(" | ")} — got ${JSON.stringify(run.depth)}`);
    }
    // A `deep` tier whose deep lenses could not run is a label, not a review — depth-routing.md
    // caps the tier at standard on diff-only, so this pairing means the cap was not applied.
    if (String(run.depth) === "diff-only" && String(run.tier) === "deep") {
      fail("RUN.depth diff-only cannot carry RUN.tier deep — depth-routing.md caps the tier at"
        + " standard when there is no workspace");
    }
    runLine += ` · depth ${DEPTH_LABEL[String(run.depth)]}`;
  }

  if (data.RUN_NOTE) {
    assertPlainish("RUN_NOTE", data.RUN_NOTE);
    // Routing colour only. Anything warning-shaped changes what the review *covered* and belongs
    // on its own line, where a reader scanning the collapsed groups cannot miss it — see
    // RUN_ANOMALY below. A ⚠️ appended here rides at the tail of the densest line in the report,
    // which is exactly where the compare-range-pollution notice went unread.
    // Match the base codepoints, not the emoji-presentation sequences: `⚠` renders as a warning
    // sign with or without the U+FE0F variation selector, so an `includes("⚠️")` test misses the
    // bare form.
    if (WARN_GLYPH.test(String(data.RUN_NOTE))) {
      fail("RUN_NOTE carries a ⚠️ — a caveat about what the review covered goes in RUN_ANOMALY,"
        + " which renders on its own line; RUN_NOTE is routing colour appended to the run shape");
    }
    runLine += ` · ${data.RUN_NOTE}`;
  }

  // RUN_ANOMALY — one line naming something that changed what this run actually reviewed (a
  // polluted compare range, a capability cap, a truncated fetch). The renderer owns the ⚠️, so a
  // payload supplying its own would double it.
  let anomalyLine = "";
  if (data.RUN_ANOMALY) {
    assertPlainish("RUN_ANOMALY", data.RUN_ANOMALY);
    if (new RegExp(`^\\s*(?:${WARN_GLYPH.source})`, "u").test(String(data.RUN_ANOMALY))) {
      fail("RUN_ANOMALY must not begin with a glyph — the renderer prefixes ⚠️");
    }
    anomalyLine = `⚠️ ${data.RUN_ANOMALY}`;
  }

  // ── the log slots reviewer-report-ingest.md parses for run-state ───────────────────────────
  for (const k of ["OPTIMALITY_LOG", "STANDARDS_LOG", "MEASURABILITY_LOG"]) {
    const s = String(data[k]);
    if (!/^(ran|skipped)\b/.test(s)) {
      fail(`${k} must begin with "ran" or "skipped (reason)" so its run-state parses — got`
        + ` ${JSON.stringify(s.slice(0, 40))}`);
    }
  }
  if (!/^produced\b/.test(String(data.QUALITY))) {
    fail(`QUALITY must begin with "produced <N> → posted inline <N> …" — got`
      + ` ${JSON.stringify(String(data.QUALITY).slice(0, 40))}`);
  }

  // ── structured lists → markdown, with every count derived ──────────────────────────────────
  const arr = (k) => {
    if (data[k] === undefined || data[k] === null) return [];
    if (!Array.isArray(data[k])) fail(`${k} must be an array, got ${typeof data[k]}`);
    return data[k];
  };

  const openThreads = arr("OPEN_THREADS");
  const openBullets = openThreads
    .map((t, i) => openThreadBullet(`OPEN_THREADS[${i}]`, t)).join("\n");
  const blocking = openThreads.filter((t) => t.blocking === true).length;
  const openSuffix = openThreads.length === 0 ? ""
    : ` — ${openThreads.length} open review thread${openThreads.length === 1 ? "" : "s"}`
      + (blocking > 0 ? ` (${blocking} blocking)` : "");

  let resolvedSince = "";
  if (data.RESOLVED_SINCE !== undefined && data.RESOLVED_SINCE !== null) {
    const r = data.RESOLVED_SINCE;
    if (!isPlainObject(r)) fail("RESOLVED_SINCE must be an object {count, sha}");
    if (!Number.isInteger(r.count) || r.count < 0) {
      fail(`RESOLVED_SINCE.count must be a non-negative integer, got ${JSON.stringify(r.count)}`);
    }
    if (!SHA7.test(String(r.sha))) {
      fail(`RESOLVED_SINCE.sha must be exactly 7 lowercase hex chars, got ${JSON.stringify(r.sha)}`);
    }
    // Suppressed at 0 rather than rendering "0 resolved", and only meaningful beside a list.
    if (r.count > 0) {
      if (openThreads.length === 0) {
        fail("RESOLVED_SINCE renders beside the open-threads list, which is empty — when Gate 3 is"
          + " clean the counter belongs in the Prior review feedback Details cell instead");
      }
      resolvedSince = ` <sup>${r.count} resolved since \`${r.sha}\`</sup>`;
    }
  }

  const MEMORY_KINDS = ["knowledge", "hotspot", "rule", "lesson"];
  const kindCounts = { knowledge: 0, hotspot: 0, rule: 0, lesson: 0 };
  const memoriesUsed = arr("MEMORIES_USED").map((m, i) => {
    const where = `MEMORIES_USED[${i}]`;
    if (!isPlainObject(m)) fail(`${where} must be an object {key, url, note, kind, evidence}`);
    if (!m.key || String(m.key).trim() === "") fail(`${where}.key is required`);
    assertPlain(`${where}.key`, m.key);
    if (m.note !== undefined) assertPlain(`${where}.note`, m.note, { allowCode: true });
    if (m.kind !== undefined && m.kind !== null) {
      if (!MEMORY_KINDS.includes(String(m.kind))) {
        fail(`${where}.kind must be one of ${MEMORY_KINDS.join(" | ")} — got ${JSON.stringify(m.kind)}`);
      }
      kindCounts[String(m.kind)] += 1;
    }
    // `evidence` is the PR numbers a relevance rule accumulated. A rule that suppresses a finding
    // must be able to name where that preference came from — memory.md § Where suppression
    // applies makes an unevidenced suppression a bug, and this is where that becomes visible.
    let evidence = "";
    if (m.evidence !== undefined && m.evidence !== null) {
      if (!Array.isArray(m.evidence)) fail(`${where}.evidence must be an array of PR numbers`);
      for (const pr of m.evidence) {
        if (!Number.isInteger(pr) || pr <= 0) {
          fail(`${where}.evidence entries must be positive integers (PR numbers), got ${JSON.stringify(pr)}`);
        }
      }
      if (String(m.kind) === "rule" && m.evidence.length === 0) {
        fail(`${where} is a rule with an empty evidence list — a rule that cannot name its`
          + " evidence PRs is a bug, not a preference (memory.md)");
      }
      if (m.evidence.length) evidence = ` <sup>evidence ${m.evidence.map((n) => `#${n}`).join(" ")}</sup>`;
    }
    const label = `\`${m.key}\``;
    const kindTag = m.kind ? `**${m.kind}** ` : "";
    const head = m.url ? `- ${kindTag}[${label}](${m.url})` : `- ${kindTag}${label}`;
    if (m.url && !/^https?:\/\//.test(String(m.url))) {
      fail(`${where}.url must be http(s), got ${JSON.stringify(m.url)}`);
    }
    return (m.note ? `${head} — ${m.note}` : head) + evidence;
  }).join("\n");
  const kindBreakdown = MEMORY_KINDS
    .filter((k) => kindCounts[k] > 0)
    .map((k) => `${kindCounts[k]} ${k}${kindCounts[k] === 1 ? "" : k === "knowledge" ? "" : "s"}`)
    .join(" · ");

  // `<N> used` was the last hand-written count left standing over a derived list, so it was the
  // last one that could disagree with what it counts. The model supplies the indexed half only.
  const memoriesUsedCount = arr("MEMORIES_USED").length;
  const memoriesSummary = String(data.MEMORIES_SUMMARY).trim();
  const indexed = memoriesSummary.match(/^(\d+) indexed$/);
  if (/\bused\b/.test(memoriesSummary)) {
    fail("MEMORIES_SUMMARY carries its own used count — supply the indexed half only"
      + ` (\`<N> indexed\`, or \`not connected\`); \`· <N> used\` is derived from MEMORIES_USED`
      + ` (got: ${memoriesSummary})`);
  }
  if (!indexed && memoriesUsedCount > 0) {
    fail(`MEMORIES_SUMMARY is ${JSON.stringify(memoriesSummary)} but MEMORIES_USED has`
      + ` ${memoriesUsedCount} entr${memoriesUsedCount === 1 ? "y" : "ies"} — a run that applied a`
      + " memory must report how many it indexed");
  }
  if (indexed && memoriesUsedCount > Number(indexed[1])) {
    fail(`MEMORIES_SUMMARY reports ${indexed[1]} indexed but MEMORIES_USED has`
      + ` ${memoriesUsedCount} entries — indexed is always >= used`);
  }
  let memoriesLine = indexed ? `${memoriesSummary} · ${memoriesUsedCount} used` : memoriesSummary;
  if (kindBreakdown) memoriesLine += ` (${kindBreakdown})`;

  const cards = arr("OPTIMALITY_CARDS");
  cards.forEach((c, i) => {
    // Cards are multi-line markdown blocks by nature (a Now/Better table and prose), so they stay
    // model-authored — but each must carry its anchored heading, which is what the ingest grammar
    // keys on.
    if (typeof c !== "string") fail(`OPTIMALITY_CARDS[${i}] must be a markdown string`);
    if (!/^### Optimality proposal — \S+:\d+/m.test(c)) {
      fail(`OPTIMALITY_CARDS[${i}] must contain a "### Optimality proposal — <path>:<line>" heading`);
    }
  });

  // ── FINDINGS → the headline counts, the index, and the severity tally ──────────────────────────
  //
  // One array, three renderings. It replaces a hand-written headline, a hand-written TIER_TALLY, and
  // nothing at all — because the report never listed what it posted inline. That absence is why the
  // headline counted GATES (`1 error, 2 warnings`) while the inline comments were FINDINGS with no
  // line reconciling them, and why a posted finding resorted to "the report lists all four unwired
  // registries" — a cross-reference to a document that did not, in fact, list them.
  const findings = arr("FINDINGS");
  const findingRows = findings.map((f, i) => {
    const where = `FINDINGS[${i}]`;
    if (!f.title || String(f.title).trim() === "") fail(`${where}.title is required`);
    assertPlain(`${where}.title`, f.title, { allowCode: true });
    // The SAME title the inline renderer posts, so the SAME cap — `render-comment.mjs` rejects a
    // title over TITLE_MAX and this file accepted any length, which is a shared vocabulary held on
    // one side only: a 198-char sentence rendered a report row fine and then failed the comment
    // that row indexes, after the report had already been written. The index and the finding are
    // one string stated twice; a bound either binds both or neither.
    if (String(f.title).length > TITLE_MAX) {
      fail(`${where}.title is ${String(f.title).length} chars, over ${TITLE_MAX}`
        + " — the same cap render-comment.mjs applies to the finding this row indexes");
    }
    // A pipe would split the row into phantom columns, and a table cell cannot be escaped out of.
    if (String(f.title).includes("|")) fail(`${where}.title contains a pipe — it would break the row`);
    if (!TIERS.includes(String(f.tier))) {
      fail(`${where}.tier must be one of ${TIERS.join(" | ")} — got ${JSON.stringify(f.tier)}`);
    }
    if (f.blocking !== undefined && f.blocking !== null && typeof f.blocking !== "boolean") {
      fail(`${where}.blocking must be a boolean, got ${JSON.stringify(f.blocking)}`);
    }
    let ref;
    try {
      ref = anchor({ path: f.path, line: f.line, url: f.url });
    } catch (e) { fail(`${where}: ${e.message}`); }
    const sev = `${TIER_GLYPH[String(f.tier)]} ${f.tier}` + (f.blocking === true ? " · blocking" : "");
    return `| ${String(f.title).trim()} | ${ref} | ${sev} |`;
  });
  const findingsIndex = findingRows.length
    ? ["| Finding | Where | Severity |", "|---|---|---|", ...findingRows].join("\n")
    : "";

  const tierCounts = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const f of findings) tierCounts[String(f.tier)] += 1;
  const tierBreakdown = tierTally(tierCounts);
  const blockingFindings = findings.filter((f) => f.blocking === true).length;

  // `posted inline <N>` in QUALITY and `FINDINGS.length` are the same number stated twice, and
  // until FINDINGS existed they could not be compared: the headline counted GATES while the inline
  // comments were findings, and the only line naming the finding count sat four accordion levels
  // down in pipeline vocabulary. Now the report's worklist has to agree with its own tally.
  const postedInline = /posted inline (\d+)/.exec(String(data.QUALITY));
  if (!postedInline) {
    fail("QUALITY must name its inline count as `posted inline <N>` — the findings index is checked"
      + " against it");
  }
  if (Number(postedInline[1]) !== findings.length) {
    fail(`QUALITY says posted inline ${postedInline[1]} but FINDINGS has ${findings.length}`
      + ` entr${findings.length === 1 ? "y" : "ies"} — the index and the tally are the same number,`
      + " so one of them is wrong");
  }

  // ── IMPACT → the consequence-note section ──────────────────────────────────────────────────
  //
  // "Note me about the consequences of changing this code" renders here, and it is also the only
  // checkable record of what a deep trace actually covered: "14 consumers, 13 verified unaffected"
  // can be audited, silence cannot. Every count is derived from an array or summed from the rows,
  // so the summary cannot overstate the work — which matters more here than anywhere else in the
  // report, because a note claiming a trace that did not happen forecloses the question.
  let impactSection = "";
  let impactSummary = "";
  let telemetryLine = "";
  if (data.IMPACT !== undefined && data.IMPACT !== null) {
    const im = data.IMPACT;
    if (!isPlainObject(im)) fail("IMPACT must be an object {telemetry, symbols, dependencies, overlaps}");
    assertNoStrayFields("IMPACT", im, SHAPES.IMPACT);

    const list = (field) => {
      const v = im[field];
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) fail(`IMPACT.${field} must be an array`);
      return v;
    };
    const int = (where, v, { min = 0 } = {}) => {
      if (!Number.isInteger(v) || v < min) {
        fail(`${where} must be an integer >= ${min}, got ${JSON.stringify(v)}`);
      }
      return v;
    };

    const CHANGES = ["added", "removed", "signature", "body"];
    const symbols = list("symbols");
    const symbolBullets = symbols.map((sy, i) => {
      const where = `IMPACT.symbols[${i}]`;
      if (!isPlainObject(sy)) fail(`${where} must be an object`);
      assertNoStrayFields(where, sy, SHAPES["IMPACT.symbols[]"]);
      for (const f of ["name", "path"]) {
        if (!sy[f] || String(sy[f]).trim() === "") fail(`${where}.${f} is required`);
        assertPlain(`${where}.${f}`, sy[f]);
      }
      if (!CHANGES.includes(String(sy.change))) {
        fail(`${where}.change must be one of ${CHANGES.join(" | ")} — got ${JSON.stringify(sy.change)}`);
      }
      const files = int(`${where}.consumer_files`, sy.consumer_files);
      const ok = int(`${where}.verified_unaffected`, sy.verified_unaffected ?? 0);
      const found = int(`${where}.findings`, sy.findings ?? 0);
      // The identity that keeps the note honest: you cannot verify more consumers than exist, and
      // verified + flagged cannot exceed the total. A truncated trace reports the truncation.
      if (ok > files) {
        fail(`${where}: verified_unaffected (${ok}) exceeds consumer_files (${files})`);
      }
      if (ok + found > files) {
        fail(`${where}: verified_unaffected + findings (${ok + found}) exceeds consumer_files`
          + ` (${files}) — a consumer cannot be both`);
      }
      const parts = [`${sy.change} change`, `${files} consumer file${files === 1 ? "" : "s"}`];
      if (ok) parts.push(`${ok} verified unaffected`);
      if (found) parts.push(`${found} finding${found === 1 ? "" : "s"} inline`);
      // An untraced remainder is stated, never rounded away.
      const untraced = files - ok - found;
      if (untraced > 0) parts.push(`${untraced} not traced (budget)`);
      return `- \`${sy.name}\` (\`${sy.path}\`) — ${parts.join(" · ")}`;
    });

    const DELTAS = ["major", "minor", "patch"];
    const deps = list("dependencies");
    const depBullets = deps.map((d, i) => {
      const where = `IMPACT.dependencies[${i}]`;
      if (!isPlainObject(d)) fail(`${where} must be an object`);
      assertNoStrayFields(where, d, SHAPES["IMPACT.dependencies[]"]);
      for (const f of ["name", "from", "to"]) {
        if (!d[f] || String(d[f]).trim() === "") fail(`${where}.${f} is required`);
        assertPlain(`${where}.${f}`, d[f]);
      }
      if (!DELTAS.includes(String(d.delta))) {
        fail(`${where}.delta must be one of ${DELTAS.join(" | ")} — got ${JSON.stringify(d.delta)}`);
      }
      const sites = int(`${where}.usage_sites`, d.usage_sites);
      if (d.url !== undefined && d.url !== null && !/^https?:\/\//.test(String(d.url))) {
        fail(`${where}.url must be http(s), got ${JSON.stringify(d.url)}`);
      }
      const notes = d.url ? ` · [release notes](${d.url})` : "";
      return `- \`${d.name}\` ${d.from} → ${d.to} (${d.delta}) — ${sites} usage site`
        + `${sites === 1 ? "" : "s"} checked${notes}`;
    });

    const overlaps = list("overlaps");
    const overlapBullets = overlaps.map((o, i) => {
      const where = `IMPACT.overlaps[${i}]`;
      if (!isPlainObject(o)) fail(`${where} must be an object`);
      assertNoStrayFields(where, o, SHAPES["IMPACT.overlaps[]"]);
      int(`${where}.pr`, o.pr, { min: 1 });
      for (const f of ["author", "path"]) {
        if (!o[f] || String(o[f]).trim() === "") fail(`${where}.${f} is required`);
        assertPlain(`${where}.${f}`, o[f]);
      }
      if (o.url !== undefined && o.url !== null && !/^https?:\/\//.test(String(o.url))) {
        fail(`${where}.url must be http(s), got ${JSON.stringify(o.url)}`);
      }
      const target = o.symbol ? `\`${o.symbol}\`` : `\`${o.path}\``;
      const ref = o.url ? `[#${o.pr}](${o.url})` : `#${o.pr}`;
      // Git merges two clean edits to different lines of one function and produces code neither
      // author wrote, so this is stated as a semantic risk rather than a merge-conflict warning.
      return `- ${target} is also changed on ${ref} by @${o.author} — a semantic conflict is`
        + " likely even if git merges both cleanly";
    });

    if (im.telemetry !== undefined && im.telemetry !== null && String(im.telemetry).trim() !== "") {
      assertPlain("IMPACT.telemetry", im.telemetry, { allowCode: true });
      if (String(im.telemetry).includes("\n")) fail("IMPACT.telemetry must be a single line");
      telemetryLine = `**Telemetry:** ${im.telemetry}`;
    }

    const consumersChecked = symbols.reduce((n, sy) => n + (sy.verified_unaffected ?? 0)
      + (sy.findings ?? 0), 0);
    const bits = [];
    if (symbols.length) bits.push(`${symbols.length} changed export${symbols.length === 1 ? "" : "s"}`);
    if (consumersChecked) bits.push(`${consumersChecked} consumer${consumersChecked === 1 ? "" : "s"} checked`);
    if (deps.length) bits.push(`${deps.length} dependency delta${deps.length === 1 ? "" : "s"}`);
    if (overlaps.length) bits.push(`${overlaps.length} open-PR overlap${overlaps.length === 1 ? "" : "s"}`);
    impactSummary = bits.join(" · ");

    // One contiguous list, not three. A blank line between bullet groups makes GitHub emit three
    // separate `<ul>`s, and with no heading between them the gap reads as a missing label rather
    // than as grouping — the bullets are already self-labelling (symbol / dependency / overlap).
    const bulletBlock = [...symbolBullets, ...depBullets, ...overlapBullets].join("\n");
    const blocks = [telemetryLine, bulletBlock].filter((b) => b !== "");
    // A section with a summary but no rows would render an empty accordion; a section with rows
    // but no summary would render an unlabelled one. Either way, suppress it.
    if (blocks.length && impactSummary) impactSection = blocks.join("\n\n");
    else { impactSection = ""; impactSummary = ""; }
  }

  // ── WITHHELD → the unverified-hypothesis section ───────────────────────────────────────────
  //
  // verification-receipt.md's `unobtainable` verdict re-frames rather than drops, and this is
  // where the re-framed findings land when they have no valid anchor. Every entry names the
  // reason the check could not run, because "unverified" with no reason is indistinguishable
  // from a guess.
  const withheld = arr("WITHHELD").map((w, i) => {
    const where = `WITHHELD[${i}]`;
    if (!isPlainObject(w)) fail(`${where} must be an object {path, line, url, prefix, body, reason}`);
    assertNoStrayFields(where, w, SHAPES["WITHHELD[]"]);
    if (!w.reason || String(w.reason).trim() === "") {
      fail(`${where}.reason is required — an unverified finding names which rung was unavailable`);
    }
    assertPlain(`${where}.reason`, w.reason, { allowCode: true });
    if (!w.body || String(w.body).trim() === "") fail(`${where}.body is required`);
    assertPlain(`${where}.body`, w.body, { allowCode: true });
    const PREFIXES = ["suggestion", "question"];
    if (!PREFIXES.includes(String(w.prefix))) {
      // Never `issue:`, never blocking: nothing was verified, so nothing is asserted.
      fail(`${where}.prefix must be one of ${PREFIXES.join(" | ")} — an unverified finding is`
        + ` never an issue (got ${JSON.stringify(w.prefix)})`);
    }
    let anchor = "";
    if (w.path) {
      assertPlain(`${where}.path`, w.path);
      const label = w.line ? `${w.path}:${w.line}` : String(w.path);
      if (w.url !== undefined && w.url !== null) {
        if (!/^https?:\/\//.test(String(w.url))) {
          fail(`${where}.url must be http(s), got ${JSON.stringify(w.url)}`);
        }
        anchor = `[\`${label}\`](${w.url}) — `;
      } else anchor = `\`${label}\` — `;
    }
    return `- ${anchor}${w.prefix}: ${w.body} <sup>(unverified: ${w.reason})</sup>`;
  }).join("\n");

  // ── the three groups ───────────────────────────────────────────────────────────────────────
  //
  // The accordion used to be nine flat `**Label** — value` lines at identical visual weight, and
  // on a typical run four of them said nothing happened while costing exactly as much vertical
  // space as the ones that did. Nothing is removed here: the lines are grouped by the question
  // they answer — what needs attention, what the review found, how the review ran — and a lens
  // with nothing to say is named once in a footnote instead of on a line of its own.
  //
  // Emptiness is read from each slot's **own documented grammar**, never guessed from prose:
  //
  //   STANDARDS_LOG   `<ran|skipped (reason)> · <N> docs · <F> finding(s)`   standards-conformance.md
  //   OPTIMALITY_LOG  `<ran|skipped (reason)> · <N> judged · … · <P> proposal(s) · … · <W> withheld`
  //   MEASURABILITY_LOG `<ran|skipped (reason)> · <N> path(s) classified · <M> missing · <U> unlinked`
  //   INTEGRATIONS    `not activated` · `skipped (<reason>)` · a rung description
  //   SKIPPED_FILES   `none` · a path list
  //
  // Both logs are already required to begin `ran` or `skipped` (checked above), which is what
  // makes the `skipped` arm reliable; the quiet arms match the literal zero-counts their
  // producing rule emits. A slot whose grammar the checks below cannot recognise renders its own
  // line — the fallback is *more* visible, never silence.
  // Echo the matched clause verbatim rather than rebuilding it, so a producing rule that
  // pluralises against its own count (`1 doc` / `2 docs`) keeps its wording.
  const countClause = (s, re) => {
    const m = re.exec(s);
    return m ? m[0] : "";
  };
  const isSkipped = (s) => /^skipped\b/.test(s);
  const DOCS_RE = /\d+ docs?\b/;
  const JUDGED_RE = /\d+ judged\b/;
  const PATHS_RE = /\d+ paths? classified\b/;
  const QUIET_LENSES = [
    {
      key: "STANDARDS_LOG",
      label: "Standards",
      quiet: (s) => isSkipped(s) || /\b0 finding\(s\)/.test(s),
      footnote: (s) => (isSkipped(s) ? "standards (skipped)"
        : `standards${countClause(s, DOCS_RE) ? ` (${countClause(s, DOCS_RE)})` : ""}`),
    },
    {
      key: "OPTIMALITY_LOG",
      label: "Optimality",
      quiet: (s) => isSkipped(s) || (/\b0 proposal\(s\)/.test(s) && /\b0 withheld\b/.test(s)),
      footnote: (s) => (isSkipped(s) ? "optimality (skipped)"
        : `optimality${countClause(s, JUDGED_RE) ? ` (${countClause(s, JUDGED_RE)})` : ""}`),
    },
    {
      // A measurability run with nothing missing and nothing unlinked is the common case on a
      // refactor or a docs-adjacent diff — both gates in measurability-review.md are designed to
      // reach it — so it is quiet by the same rule the other lenses use.
      key: "MEASURABILITY_LOG",
      label: "Measurability",
      quiet: (s) => isSkipped(s) || (/\b0 missing\b/.test(s) && /\b0 unlinked\b/.test(s)),
      footnote: (s) => (isSkipped(s) ? "measurability (skipped)"
        : `measurability${countClause(s, PATHS_RE) ? ` (${countClause(s, PATHS_RE)})` : ""}`),
    },
    {
      key: "INTEGRATIONS",
      label: "Integrations",
      quiet: (s) => s === "not activated" || isSkipped(s),
      footnote: (s) => (s === "not activated" ? "integrations (not activated)" : "integrations (skipped)"),
    },
    {
      key: "SKIPPED_FILES",
      label: "Skipped files",
      quiet: (s) => s === "none",
      footnote: () => "0 files skipped",
    },
  ];
  const lens = {};
  const footnotes = {};
  for (const l of QUIET_LENSES) {
    const s = String(data[l.key]).trim();
    lens[l.key] = l.quiet(s) ? "" : `${l.label} — ${s}`;
    if (l.quiet(s)) footnotes[l.key] = l.footnote(s);
  }

  // `Found` — what the review produced. QUALITY is required, so this group is never empty.
  const foundLines = [`Quality — ${String(data.QUALITY).trim()}`];
  // `Dropped` is its own labelled line rather than a `- ` bullet under Quality: a bullet may
  // interrupt the preceding paragraph, so the same two lines rendered as a paragraph plus a
  // one-item list depending on what sat above them.
  if (data.QUALITY_DROPPED) foundLines.push(`Dropped — ${String(data.QUALITY_DROPPED).trim()}`);
  if (tierBreakdown) foundLines.push(`Severity — ${tierBreakdown}`);
  if (lens.OPTIMALITY_LOG) foundLines.push(lens.OPTIMALITY_LOG);
  if (lens.STANDARDS_LOG) foundLines.push(lens.STANDARDS_LOG);
  if (lens.MEASURABILITY_LOG) foundLines.push(lens.MEASURABILITY_LOG);
  if (data.VERIFIED_NOTE) foundLines.push(`Verified — ${String(data.VERIFIED_NOTE).trim()}`);

  // `Run` — how the review ran and what it covered. The run-shape line comes first because it is
  // both the group's headline fact and the line reviewer-report-ingest.md keys on.
  const runLines = [runLine];
  if (anomalyLine) runLines.push(anomalyLine);
  if (lens.SKIPPED_FILES) runLines.push(lens.SKIPPED_FILES);
  if (lens.INTEGRATIONS) runLines.push(lens.INTEGRATIONS);
  if (data.CI_NOTE) runLines.push(`CI — ${String(data.CI_NOTE).trim()}`);
  runLines.push(`Memories — ${memoriesLine}`);
  if (memoriesUsed) runLines.push("", memoriesUsed);

  // The footnote. Fixed order, so two runs with the same quiet lenses render the same line.
  const nothingToReport = [
    footnotes.STANDARDS_LOG,
    footnotes.OPTIMALITY_LOG,
    footnotes.MEASURABILITY_LOG,
    footnotes.INTEGRATIONS,
    tierBreakdown ? "" : "severity",
    footnotes.SKIPPED_FILES,
  ].filter((f) => f).join(", ");

  // `Needs attention` labels the gate group only when a gate is actually not passing. Rendering
  // it over an all-✅ table would assert the opposite of what the table says. Gate 2 (CI) is
  // deliberately not consulted: it warns and never fails, so it lives in `Run`.
  const gateStatuses = ["GATE_DESCRIPTION_STATUS", "GATE_PRIOR_STATUS", "GATE_DOCS_STATUS",
    "GATE_SELFREVIEW_STATUS", "GATE_CODEREVIEW_STATUS"].map((k) => String(data[k]).trim());
  const needsAttention = gateStatuses.some((v) => v === "⚠️" || v === "❌") ? "yes" : "";

  // ── VERDICT → the headline ─────────────────────────────────────────────────────────────────────
  //
  // The verdict is cross-checked against the gate table it sits above, which is a class of
  // contradiction the report could previously post: a `reviewer-lessons` entry records a posted
  // gate table reading PASS while the run's own contract said FAIL. The gates decide, so a
  // mismatched VERDICT is a rejection rather than a rendered disagreement. Gate 2 (CI) is
  // deliberately not consulted — it warns and never fails, so it cannot move the verdict.
  const verdict = String(data.VERDICT).trim();
  if (!VERDICTS.includes(verdict)) {
    fail(`VERDICT must be one of ${VERDICTS.join(" | ")} — got ${JSON.stringify(data.VERDICT)}`);
  }
  const failing = gateStatuses.filter((v) => v === "❌").length;
  // Gate 2 (CI) has no row in the table — `CI_NOTE` is its whole surface — but it is still a
  // warning gate, and a red or pending check renders the WARN headline rather than PASS
  // (`report-rendering.md`: "with no failing hard gate and no ❌ there is nothing to tally, and the
  // run renders the WARN headline"). It can raise the verdict to WARN and never past it.
  const warning = gateStatuses.filter((v) => v === "⚠️").length + (data.CI_NOTE ? 1 : 0);
  const impliedVerdict = failing > 0 ? "FAIL" : warning > 0 ? "WARN" : "PASS";
  if (verdict !== impliedVerdict) {
    fail(`VERDICT ${verdict} contradicts the gate table — ${failing} ❌ and ${warning} ⚠️`
      + `${data.CI_NOTE ? " (CI included)" : ""} imply ${impliedVerdict}. The gates decide the`
      + " verdict; fix whichever is wrong before rendering");
  }

  const reasonList = (k) => {
    const v = arr(k);
    v.forEach((r, i) => {
      if (typeof r !== "string" || r.trim() === "") fail(`${k}[${i}] must be a non-empty string`);
      assertPlain(`${k}[${i}]`, r, { allowCode: true });
    });
    // Two phrases plus a count, never a paragraph. The cap is the same one the prose spec set at
    // ~140 chars, expressed as a list bound so it cannot be exceeded by wording.
    return v.length <= 2 ? v.join("; ") : `${v.slice(0, 2).join("; ")}; +${v.length - 2} more`;
  };
  if (verdict === "FAIL" && arr("FAIL_REASONS").length === 0) {
    fail("VERDICT FAIL with no FAIL_REASONS — a failing gate names why in one noun phrase"
      + " (report-rendering.md § Headlines)");
  }
  if (arr("FAIL_REASONS").length > failing) {
    fail(`FAIL_REASONS has ${arr("FAIL_REASONS").length} phrases but only ${failing} gate(s) are ❌`
      + " — one phrase per failing gate, and CI is never among them");
  }
  if (verdict === "WARN" && arr("WARN_REASONS").length === 0) {
    fail("VERDICT WARN with no WARN_REASONS — a warning gate names why in one noun phrase"
      + " (report-rendering.md § Headlines)");
  }
  // The same cross-check FAIL_REASONS gets, and for the same reason: the reasons line is a count
  // stated twice, once as a list and once as the gate table above it. `reasonList` truncates the
  // rendering at two phrases, so an over-long list did not LOOK wrong — it silently dropped the
  // third warning while the table showed one ⚠️, which is exactly the class of contradiction this
  // renderer exists to make unrepresentable. Validating one polarity and not the other is the
  // asymmetric-validation shape `FINDINGS[].title` had in this same file. CI *is* countable here,
  // unlike in the FAIL branch: it is a warning gate, so `warning` already includes it.
  if (arr("WARN_REASONS").length > warning) {
    fail(`WARN_REASONS has ${arr("WARN_REASONS").length} phrases but only ${warning} gate(s) are ⚠️`
      + `${data.CI_NOTE ? " (CI included)" : ""} — one phrase per warning gate`);
  }

  // The count-forward headline. `<N> findings` is the number the author acts on, so it leads; the
  // gate state follows in the reasons line. A run with no findings still has a state to report,
  // which is what the two zero-finding forms are for.
  const n = findings.length;
  let headline;
  if (n > 0) {
    const glyph = TIER_GLYPH[worstTier(findings)];
    headline = `### ${glyph} ${n} finding${n === 1 ? "" : "s"}`
      + (blockingFindings > 0 ? ` — ${blockingFindings} blocking` : "");
  } else if (verdict === "PASS") {
    headline = "### ✅ No issues found";
  } else {
    const gates = failing + warning;
    headline = `### ${VERDICT_GLYPH[verdict]} No findings — ${gates} gate${gates === 1 ? "" : "s"}`
      + " need attention";
  }

  const summary = String(data.SUMMARY).trim();
  assertPlain("SUMMARY", summary, { allowCode: true });
  if (summary.length > 240) {
    fail(`SUMMARY is ${summary.length} chars, over the 240-char cap — it is one sentence about the`
      + " change, not the report");
  }
  const reasons = verdict === "FAIL" ? reasonList("FAIL_REASONS")
    : verdict === "WARN" ? reasonList("WARN_REASONS") : "";
  const reasonsLine = reasons
    ? `**${verdict === "FAIL" ? "Blocking" : "Warnings"}:** ${reasons}`
    : "";

  // A PASS headline must not overstate cleanliness while advisory `issue:` entries sit below it.
  const cadv = arr("LOW_CONFIDENCE_FINDINGS").length;
  const advisoryLine = cadv > 0
    ? `<sub>${cadv} advisory finding${cadv === 1 ? "" : "s"} below the confidence bar — see`
      + " *Less certain* below.</sub>"
    : "";

  // Fix-all Agent0 button (opt-in). Rendered only when FIX_ALL_URL is supplied — the agent builds
  // the deep link via scripts/build-agent0-link.mjs. The button image URL (ASSET) is a constant
  // here; Dash0 can repoint it at a hosted PNG for production (agent0-fix-links.md § Button markup).
  // The label must match the words rendered in the asset. It reaches only the `<img alt>`, and the
  // asset's own `<text>` is the fixed string `Fix all with Agent0` with a pinned `textLength` — so
  // a label carrying the finding count ("Fix all 5 with Agent0") was invisible to every sighted
  // reader and left the accessible name disagreeing with the visible one, which is what WCAG 2.2
  // SC 2.5.3 (Label in Name) is about. Nothing is lost by dropping it: the count is in the heading
  // and the findings index directly above the button.
  // Markup, host validation, and the light/dark variant pair all come from the spine, so the
  // report's button and the inline one cannot drift into two different chips.
  let fixAllButton = "";
  if (data.FIX_ALL_URL !== undefined && data.FIX_ALL_URL !== null && String(data.FIX_ALL_URL).trim() !== "") {
    // Zero findings and no CI note means there is nothing for Agent0 to do, and a button that
    // hands it an empty worklist is worse than no button: it invites a click that spends a run
    // discovering it has no work. The one legitimate zero-finding case is the CI-only template
    // (`agent0-fix-links.md § Fix all — CI-only`), which requires a CI note to exist.
    if (n === 0 && !data.CI_NOTE) {
      fail("FIX_ALL_URL with 0 findings and no CI_NOTE — there is nothing to fix; omit the button"
        + " (agent0-fix-links.md § Fix all — CI-only)");
    }
    try {
      fixAllButton = fixButton({ kind: "all", url: String(data.FIX_ALL_URL) });
    } catch (e) { fail(`FIX_ALL_URL: ${e.message}`); }
  }

  const derived = {
    HEADLINE: headline,
    SUMMARY_LINE: summary,
    REASONS_LINE: reasonsLine,
    ADVISORY_LINE: advisoryLine,
    FINDINGS_INDEX: findingsIndex,
    FIX_ALL_BUTTON: fixAllButton,
    // One footer, both surfaces, and outside the accordion so a reader of the collapsed report can
    // still see who reviewed what. `run` and `at` are the report's own additions; an inline comment
    // passes neither, so the two footers differ only by what only the report knows.
    FOOTER_SUP: footerLine({ sha: run.sha, run: footer, at: updatedStamp }),
    NEEDS_ATTENTION: needsAttention,
    FOUND_LINES: foundLines.join("\n"),
    RUN_LINES: runLines.join("\n"),
    NOTHING_TO_REPORT: nothingToReport,
    OPEN_THREADS: openBullets,
    OPEN_THREADS_COUNT: openThreads.length || "",
    OPEN_THREADS_SUFFIX: openSuffix,
    RESOLVED_SINCE: resolvedSince,
    ADDITIONAL_FINDINGS: findingBullets("ADDITIONAL_FINDINGS", arr("ADDITIONAL_FINDINGS")),
    ADDITIONAL_COUNT: arr("ADDITIONAL_FINDINGS").length || "",
    LOW_CONFIDENCE_FINDINGS: findingBullets("LOW_CONFIDENCE_FINDINGS", arr("LOW_CONFIDENCE_FINDINGS")),
    LOW_CONFIDENCE_COUNT: arr("LOW_CONFIDENCE_FINDINGS").length || "",
    OPTIMALITY_CARDS: cards.join("\n\n"),
    OPTIMALITY_COUNT: cards.length || "",
    IMPACT_SECTION: impactSection,
    IMPACT_SUMMARY: impactSummary,
    WITHHELD: withheld,
    WITHHELD_COUNT: arr("WITHHELD").length || "",
  };
  for (const k of [...REQUIRED_SCALARS, ...OPTIONAL_SCALARS]) {
    if (derived[k] === undefined) derived[k] = data[k] === undefined ? "" : String(data[k]);
  }

  if (data.PARTIAL_REVIEW !== undefined && data.PARTIAL_REVIEW !== null) {
    const p = data.PARTIAL_REVIEW;
    if (!isPlainObject(p)) fail("PARTIAL_REVIEW must be an object {calls, scanned, total}");
    for (const f of ["calls", "scanned", "total"]) {
      if (!Number.isInteger(p[f]) || p[f] < 0) {
        fail(`PARTIAL_REVIEW.${f} must be a non-negative integer, got ${JSON.stringify(p[f])}`);
      }
    }
    if (p.scanned > p.total) fail("PARTIAL_REVIEW.scanned cannot exceed .total");
    derived.PARTIAL_BANNER = "yes";
    derived.BUDGET_CALLS = p.calls;
    derived.BUDGET_SCANNED = p.scanned;
    derived.BUDGET_TOTAL = p.total;
  }

  let tpl;
  try {
    tpl = readFileSync(TEMPLATE, "utf8");
  } catch (e) {
    fail(`cannot read the template at ${TEMPLATE}: ${e.message}`);
  }

  // Blocks: `{{#KEY}}…{{/KEY}}` is kept when KEY is present and non-empty, removed otherwise.
  const block = /\{\{#([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
  let body = tpl;
  for (let guard = 0; block.test(body); guard++) {
    if (guard > 100) fail("block resolution did not terminate — malformed template");
    body = body.replace(block, (_m, key, inner) => {
      const v = derived[key];
      return v !== undefined && v !== null && String(v).trim() !== "" ? inner : "";
    });
  }
  for (const [k, v] of Object.entries(derived)) {
    body = body.split(`{{${k}}}`).join(v === undefined || v === null ? "" : String(v));
  }

  const leftover = body.match(/\{\{[^}]*\}\}/g);
  if (leftover) {
    fail(`unresolved placeholder(s) left in the body: ${[...new Set(leftover)].join(", ")}`
      + ` — the template names a slot the renderer does not derive`);
  }

  // Post-conditions. Unreachable for an accepted payload, which is the point: a future template
  // edit that breaks the contract fails loudly here instead of quietly posting a flat report.
  if (!body.includes("<!-- PR_REVIEWER_REPORT -->")) fail("rendered body lost the report marker");
  if (!body.includes(derived.FOOTER_SUP)) {
    fail("rendered body lost the attribution footer — it carries the reviewed sha, which a sticky"
      + " has no commit_id for, and the freshness stamp");
  }
  if (!/^### /m.test(body)) {
    fail("rendered body has no `### ` headline — the heading is what makes a report identifiable as"
      + " a report at a glance, and the one shape an inline finding never uses");
  }
  if (!/<details>\n<summary>Review details/.test(body)) fail("rendered body has no `Review details` accordion");
  if (body.includes("<details open>")) fail("rendered body pre-expands a `<details>` block");
  // The shared last-gate check (escaped inline HTML, a backtick in an href, a caged link). It runs
  // here so a payload that smuggles one in never renders, and again from the CLI on the bytes about
  // to be posted, which is the only place a corruption introduced AFTER this point can be caught.
  try {
    assertPostable("rendered body", body);
  } catch (e) {
    fail(e.message);
  }
  // The `<mode> · <N> lines in delta` shape is now the ingest anchor for the run line: the group
  // heading carries the label, so the line itself must stay line-anchored and matchable.
  if (!/^(?:full|incremental|incremental-quick) · \d+ lines in delta/m.test(body)) {
    fail("rendered body has no line starting `<mode> · <N> lines in delta` —"
      + " reviewer-report-ingest.md keys the Run mode unit on that shape");
  }
  const head = body.split("<details>")[0];
  // Only the group headings and the structural literals are listed. A plain in-group label
  // (`Quality — `, `Memories — `) is deliberately absent: model-authored optimality cards render
  // above the accordion, and a card discussing quality would trip a substring match on one.
  // The footer is NOT in this list: it now renders below the accordion by design, so it is never in
  // `head` on a well-formed body — and on a flattened one (no accordion at all, `head` = the whole
  // body) the missing-accordion check above has already fired.
  for (const owned of ["| Gate | Status | Details |", "**Needs attention**", "**Found**", "**Run**",
    "**Open review threads (", "<sup>Nothing to report —",
    "<summary>Impact —", "<summary>Withheld (", "**Telemetry:**"]) {
    if (head.includes(owned)) fail(`${owned} rendered above the accordion`);
  }
  // The findings index is the one thing that MUST be above it: a worklist inside a collapsed
  // accordion is a worklist nobody reads.
  if (findingsIndex && !head.includes("| Finding | Where | Severity |")) {
    fail("the findings index rendered inside the accordion — it is the report's worklist and has to"
      + " be visible without a click");
  }

  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

/**
 * `RUN_NOTE` is free prose appended after the parseable `Run mode` prefix. It may carry inline
 * code and links, and a `|` is fine too — it renders on a bold standalone line, not in a table
 * cell, so it has no row to break. The one thing it may not do is span lines, which would split
 * the `Run mode` line and orphan the grammar's prefix. (Table pipes are rejected where they
 * actually matter: the `GATE_*_DETAILS` cells, checked in main().)
 */
function assertPlainish(where, v) {
  const s = String(v);
  if (s.includes("\n")) fail(`${where} must be a single line`);
}

main();
