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
//   verdicts — `RECOMMENDATION_LINE` is derived from the five gate status cells and the open-thread
//              array, never supplied. The reviewer's approval recommendation and its own gate table
//              are then the same fact rendered twice, so they cannot disagree — which is the whole
//              defect class behind `reviewer-lessons::gate-table-says-pass-while-contract-says-fail`
//              (seen 7x). Supplying a RECOMMENDATION* key is an unknown-key rejection.
//
// Usage:  node render-report.mjs payload.json    (or: … < payload.json)
// Output: the report body on stdout. Any problem exits non-zero with a reason on stderr and
//         prints NOTHING to stdout — a caller that pipes stdout can never post a partial body.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "..", "templates", "report-body.md");

const VALID_STATUS = new Set(["✅", "⚠️", "❌", "⏭️"]);
const VALID_MODES = new Set(["full", "incremental", "incremental-quick", "zero-delta"]);
const SHA7 = /^[0-9a-f]{7}$/;
const GATE_DETAILS_MAX = 120;

// Scalar slots the model supplies verbatim. Prose only — no counts, no links, no parsed shapes.
const REQUIRED_SCALARS = [
  "HEADLINE",
  "GATE_DESCRIPTION_STATUS", "GATE_DESCRIPTION_DETAILS",
  "GATE_PRIOR_STATUS", "GATE_PRIOR_DETAILS",
  "GATE_DOCS_STATUS", "GATE_DOCS_DETAILS",
  "GATE_SELFREVIEW_STATUS", "GATE_SELFREVIEW_DETAILS",
  "GATE_CODEREVIEW_STATUS", "GATE_CODEREVIEW_DETAILS",
  "MEMORIES_SUMMARY", "QUALITY", "INTEGRATIONS",
  "OPTIMALITY_LOG", "STANDARDS_LOG", "SKIPPED_FILES",
];
const OPTIONAL_SCALARS = ["CI_NOTE", "VERIFIED_NOTE", "QUALITY_DROPPED", "RUN_NOTE", "FIX_ALL_URL"];

// Structured slots. Each is an object or an array; the renderer turns it into markdown.
const STRUCTURED = ["RUN", "PARTIAL_REVIEW", "RESOLVED_SINCE", "MEMORIES_USED",
  "OPEN_THREADS", "ADDITIONAL_FINDINGS", "LOW_CONFIDENCE_FINDINGS", "OPTIMALITY_CARDS",
  "TIER_TALLY"];

function fail(msg) {
  process.stderr.write(`render-report: ${msg}\n`);
  process.exit(1);
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Nested objects get the same unknown-key discipline as the top level. A stray field inside RUN or
// an item is silent: it changes nothing and reports nothing, so a misremembered field name reads
// as accepted. Caught exactly that with a `delta_note` typo inside RUN.
const SHAPES = {
  RUN: ["mode", "sha", "prior_sha", "delta_lines", "at"],
  PARTIAL_REVIEW: ["calls", "scanned", "total"],
  RESOLVED_SINCE: ["count", "sha"],
  "MEMORIES_USED[]": ["key", "url", "note"],
  "OPEN_THREADS[]": ["path", "line", "url", "ask", "blocking", "unclearable", "author", "is_bot"],
  "ADDITIONAL_FINDINGS[]": ["path", "line", "url", "prefix", "body", "confidence"],
  "LOW_CONFIDENCE_FINDINGS[]": ["path", "line", "url", "prefix", "body", "confidence"],
  TIER_TALLY: ["critical", "high", "medium", "low"],
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

/**
 * The approval recommendation, derived from the gate cells — never supplied.
 *
 * Why it is rendered at all: the recommendation used to be terminal-only, which meant a PR whose
 * only open items were non-blocking got a report reading `no blocking issues, 3 warning(s)` and no
 * statement anywhere that the reviewer considered it approvable. A human read that as "something is
 * wrong", and a wrapping automation whose approval rule keys on a PASS token withheld the approval
 * outright (`reviewer-lessons::gate3-open-third-party-bot-threads-…`, sighting 2: `VERDICT: FAIL`
 * beside `ACTIONABLE: 0`). Saying it out loud costs one line.
 *
 * Why it is derived rather than supplied: a supplied recommendation is a second opinion about the
 * same five cells, free to disagree with them — the defect class of
 * `reviewer-lessons::gate-table-says-pass-while-contract-says-fail`. Derived, "approve" is a
 * restatement of "no ❌", not a claim that can drift from it.
 *
 * It is a recommendation to a human, not a GitHub review state: the review event stays `COMMENT`
 * in every branch (`pr-reviewer.md § What this agent does not do`).
 */
function recommendationLine(data, openThreads) {
  const GATES = ["GATE_DESCRIPTION_STATUS", "GATE_PRIOR_STATUS", "GATE_DOCS_STATUS",
    "GATE_SELFREVIEW_STATUS", "GATE_CODEREVIEW_STATUS"];
  const at = (k) => String(data[k]).trim();
  const failing = GATES.filter((k) => at(k) === "❌");
  const warned = GATES.filter((k) => at(k) === "⚠️");
  const skipped = GATES.filter((k) => at(k) === "⏭️");

  for (const [i, t] of openThreads.entries()) {
    if (t.unclearable !== undefined && typeof t.unclearable !== "boolean") {
      fail(`OPEN_THREADS[${i}].unclearable must be a boolean, got ${JSON.stringify(t.unclearable)}`);
    }
  }
  const unclearable = openThreads.filter((t) => t.unclearable === true).length;
  const blocking = openThreads.filter((t) => t.blocking === true).length;

  // Gate 3's two contradiction classes. ✅ means the open set was empty, and ❌ means at least one
  // open thread carried an unanswered blocking ask — so a payload asserting either alongside an
  // open-thread list that says otherwise has one of the two wrong, and the recommendation would
  // inherit whichever is wrong. (⚠️ is deliberately unguarded: it is also the state for
  // `thread state unavailable`, which legitimately has no list.)
  if (at("GATE_PRIOR_STATUS") === "✅" && openThreads.length > 0) {
    fail(`GATE_PRIOR_STATUS is ✅ but OPEN_THREADS has ${openThreads.length} entr`
      + `${openThreads.length === 1 ? "y" : "ies"} — Gate 3 passes only when every prior thread is`
      + " resolved, so one of the two is stale");
  }
  if (at("GATE_PRIOR_STATUS") === "❌" && blocking === 0) {
    fail("GATE_PRIOR_STATUS is ❌ but no OPEN_THREADS entry is marked `blocking: true` — Gate 3"
      + " fails only on an unanswered *blocking* ask, so either the grade or the list is wrong");
  }

  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  // Kept short on purpose: this whole line renders on the collapsed comment, and a clause long
  // enough to wrap costs the headline its glanceability — the one property it exists for.
  const unclearableClause = unclearable === 0 ? ""
    : ` ${plural(unclearable, "open thread")} here ${unclearable === 1 ? "is" : "are"} another`
      + ` reviewer's — this agent cannot resolve ${unclearable === 1 ? "it" : "them"}; a human must.`;
  const skippedClause = skipped.length === 0 ? ""
    : ` ${plural(skipped.length, "gate")} not evaluated this run.`;

  let rec;
  if (failing.length === 0) {
    rec = warned.length === 0
      ? "✅ Approve."
      : "✅ Approve with comments — nothing blocking; the warnings above are advisory."
        + unclearableClause;
  } else if (failing.length === 1 && failing[0] === "GATE_PRIOR_STATUS"
      && openThreads.length > 0 && unclearable === openThreads.length) {
    // The unclearable-gate case. Every ❌ traces to a thread this agent may not resolve and the PR
    // author may not have opened, so `Request changes` on its own would read as "this reviewer
    // found something" when it found nothing — the exact misread the lesson records. Name the
    // reason instead; the "of its own" claim is made only when the review pass actually ran.
    const ownPassRan = ["✅", "⚠️"].includes(at("GATE_CODEREVIEW_STATUS"));
    rec = "❌ Request changes — "
      + (ownPassRan ? "this review found nothing blocking of its own; " : "")
      + `the only ❌ is ${plural(blocking, "unanswered blocking thread")} from another reviewer,`
      + " which this agent cannot resolve; a human must.";
  } else {
    rec = "❌ Request changes." + unclearableClause;
  }
  return `**Recommendation** — ${rec}${skippedClause}`;
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
    const hint = unknown.some((k) => ["MEMORIES", "FOOTER_LINE", "RUN_MODE", "OPEN_THREADS_COUNT",
      "OPEN_THREADS_SUFFIX", "ADDITIONAL_COUNT", "LOW_CONFIDENCE_COUNT", "OPTIMALITY_COUNT",
      "BUDGET_CALLS", "BUDGET_SCANNED", "BUDGET_TOTAL", "PARTIAL_BANNER"].includes(k))
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

  let footer;
  if (run.mode === "full") footer = `Reviewed for commit \`${run.sha}\`.`;
  else if (run.mode === "zero-delta") {
    footer = `No code changes since \`${run.prior_sha}\` — gate checks only for commit \`${run.sha}\`.`;
  } else {
    footer = `Incremental review for commit \`${run.sha}\` (delta since \`${run.prior_sha}\`).`;
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
  if (data.RUN_NOTE) {
    assertPlainish("RUN_NOTE", data.RUN_NOTE);
    runLine += ` · ${data.RUN_NOTE}`;
  }

  // ── the log slots reviewer-report-ingest.md parses for run-state ───────────────────────────
  for (const k of ["OPTIMALITY_LOG", "STANDARDS_LOG"]) {
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

  const memoriesUsed = arr("MEMORIES_USED").map((m, i) => {
    const where = `MEMORIES_USED[${i}]`;
    if (!isPlainObject(m)) fail(`${where} must be an object {key, url, note}`);
    if (!m.key || String(m.key).trim() === "") fail(`${where}.key is required`);
    assertPlain(`${where}.key`, m.key);
    if (m.note !== undefined) assertPlain(`${where}.note`, m.note, { allowCode: true });
    const label = `\`${m.key}\``;
    const head = m.url ? `- [${label}](${m.url})` : `- ${label}`;
    if (m.url && !/^https?:\/\//.test(String(m.url))) {
      fail(`${where}.url must be http(s), got ${JSON.stringify(m.url)}`);
    }
    return m.note ? `${head} — ${m.note}` : head;
  }).join("\n");

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
  const memoriesLine = indexed ? `${memoriesSummary} · ${memoriesUsedCount} used` : memoriesSummary;

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

  // Finding-tier tally → glyph breakdown. Optional; the model's summary of the severity tiers it
  // assigned this run. Named TIER_TALLY to avoid the existing SEVERITY_TALLY term (the error/warning
  // count in the FAIL headline — a different concept). Posted inline findings are not an array in
  // the payload, so this is the one count the renderer cannot derive from a list — it validates the
  // shape and omits zero tiers.
  let tierBreakdown = "";
  if (data.TIER_TALLY !== undefined && data.TIER_TALLY !== null) {
    const t = data.TIER_TALLY;
    const GLYPH = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };
    const parts = [];
    for (const tier of ["critical", "high", "medium", "low"]) {
      const n = t[tier];
      if (n === undefined || n === null) continue;
      if (!Number.isInteger(n) || n < 0) {
        fail(`TIER_TALLY.${tier} must be a non-negative integer, got ${JSON.stringify(n)}`);
      }
      if (n > 0) parts.push(`${GLYPH[tier]} ${n}`);
    }
    tierBreakdown = parts.join(" · ");
  }

  // Fix-all Agent0 button (opt-in). Rendered only when FIX_ALL_URL is supplied — the agent builds
  // the deep link via scripts/build-agent0-link.mjs. The button image URL (ASSET) is a constant
  // here; Dash0 can repoint it at a hosted PNG for production (agent0-fix-links.md § Button markup).
  let fixAllButton = "";
  if (data.FIX_ALL_URL !== undefined && data.FIX_ALL_URL !== null && String(data.FIX_ALL_URL).trim() !== "") {
    const u = String(data.FIX_ALL_URL);
    if (!/^https?:\/\//.test(u)) fail(`FIX_ALL_URL must be http(s), got ${JSON.stringify(u.slice(0, 60))}`);
    if (/[)\s]/.test(u)) fail("FIX_ALL_URL must be a bare URL (no spaces or ')') — encode per build-agent0-link.mjs");
    if (!/^https:\/\/app\.dash0(-dev)?\.com\//.test(u)) fail("FIX_ALL_URL host must be app.dash0.com or app.dash0-dev.com (agent0_environment)");
    const ASSET = "https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-all-agent0.svg";
    fixAllButton = `[![Fix all with Agent0](${ASSET})](${u})`;
  }

  const derived = {
    HEADLINE: data.HEADLINE,
    RECOMMENDATION_LINE: recommendationLine(data, openThreads),
    FIX_ALL_BUTTON: fixAllButton,
    UPDATED_LINE: `<sub>Updated ${updatedStamp} UTC</sub>`,
    TIER_BREAKDOWN: tierBreakdown,
    FOOTER_LINE: footer,
    RUN_MODE: runLine,
    MEMORIES_SUMMARY: memoriesLine,
    MEMORIES_BULLETS: memoriesUsed,
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
  if (!body.includes(derived.UPDATED_LINE)) fail("rendered body lost the top-level UPDATED_LINE — a template edit dropped the freshness cue");
  // Visible while collapsed, or it does not do its job: the whole point of the recommendation is
  // that a reader (and a wrapping approval rule) sees the approval without opening the accordion.
  if (!body.split("<details>")[0].includes(derived.RECOMMENDATION_LINE)) {
    fail("the recommendation line is missing or rendered inside the accordion — it must sit above"
      + " the first <details>, where a collapsed report still shows it");
  }
  if (!/<details>\n<summary>Review details/.test(body)) fail("rendered body has no `Review details` accordion");
  if (body.includes("<details open>")) fail("rendered body pre-expands a `<details>` block");
  const caged = body.match(/``?\s*\[[^\]]*\]\([^)]*\)\s*``?/g);
  if (caged) fail(`a markdown link is trapped inside a code span: ${caged[0].slice(0, 90)}`);
  const head = body.split("<details>")[0];
  for (const owned of ["| Gate | Status | Details |", "**Run mode**", "**Memories**",
    "**Quality**", "**Integrations**", "**Optimality (2.4c)**", "**Standards (2.4d)**",
    "**Skipped files**", "**Open review threads (", "<sup>Reviewed for commit",
    "<sup>Incremental review for commit", "<sup>No code changes since", "<sup>Reviewed by the"]) {
    if (head.includes(owned)) fail(`${owned} rendered above the accordion`);
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
