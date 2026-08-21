#!/usr/bin/env node
// Render a pr-reviewer review-body POINTER from a JSON payload.
//
// Why this exists: render-report.mjs made the sticky REPORT_BODY deterministic (one template,
// one script, fail-closed) after five production runs averaged three near-identical hand-written
// templates into a remembered shape and dropped the marker or the accordion. The pointer — the
// one-line review body posted alongside (or instead of) the sticky — stayed hand-authored prose
// in agents/pr-reviewer.md, and inherited the exact same failure class: when a caller's policy
// blocks the sticky write outright (as opposed to the access path being technically unable to
// write it), a run with no deterministic fallback improvised a full ad-hoc report body directly
// into the review instead of the documented DEGRADED_POINTER_BODY shape — observed across
// mthines/lorekit#514-#518 as four different headline formats on the same PR. This script closes
// that gap the same way render-report.mjs closed it for the sticky: the model supplies DATA, this
// renders the one allowed shape for it.
//
// Usage:  node render-pointer.mjs payload.json    (or: … < payload.json)
// Output: the pointer body on stdout. Any problem exits non-zero with a reason on stderr and
//         prints NOTHING to stdout — a caller that pipes stdout can never post a partial pointer.

import { readFileSync } from "node:fs";

const SHA7 = /^[0-9a-f]{7}$/;
const VERDICTS = new Set(["PASS", "WARN", "FAIL"]);
const FORMS = new Set(["pointer", "escalation", "no_prior", "degraded"]);
const PROSE_BUDGET = 600;
const LEDGER_BUDGET = 1500;

function fail(msg) {
  process.stderr.write(`render-pointer: ${msg}\n`);
  process.exit(1);
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function assertPlain(where, v) {
  const s = String(v);
  if (/\[[^\]]*\]\([^)]*\)/.test(s)) {
    fail(`${where} contains a markdown link — supply STICKY_URL separately and let the renderer`
      + ` build the link (got: ${s.slice(0, 60)})`);
  }
  if (s.includes("\n")) fail(`${where} must be a single line`);
}

function requireSha(field, v) {
  if (!v || !SHA7.test(String(v))) {
    fail(`${field} must be exactly 7 lowercase hex chars (\`\${SHA:0:7}\`) — got ${JSON.stringify(v)}`);
  }
}

function requireUrl(field, v) {
  if (!v || !/^https?:\/\//.test(String(v))) {
    fail(`${field} must be an http(s) URL — got ${JSON.stringify(v)}`);
  }
}

function requireCount(field, v) {
  if (!Number.isInteger(v) || v < 0) {
    fail(`${field} must be a non-negative integer — got ${JSON.stringify(v)}`);
  }
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

  const { FORM } = data;
  if (!FORMS.has(FORM)) fail(`FORM must be one of ${[...FORMS].join(" | ")} — got ${JSON.stringify(FORM)}`);

  const known = new Set(["FORM", "HEAD_SHA", "FINDINGS_COUNT", "STICKY_URL", "VERDICT",
    "PRIOR_VERDICT", "REASONS", "HEADLINE_LINE", "LEDGER", "DEGRADED_REASON"]);
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length) fail(`unknown payload key(s): ${unknown.join(", ")}`);

  requireSha("HEAD_SHA", data.HEAD_SHA);
  const shortSha = data.HEAD_SHA;

  let body;

  if (FORM === "pointer") {
    requireCount("FINDINGS_COUNT", data.FINDINGS_COUNT);
    requireUrl("STICKY_URL", data.STICKY_URL);
    const n = data.FINDINGS_COUNT;
    body = `<!-- PR_REVIEWER_POINTER -->\n`
      + `Reviewed \`${shortSha}\` — ${n} finding(s) inline. [Full report](${data.STICKY_URL})`;
  } else if (FORM === "no_prior") {
    if (!VERDICTS.has(data.VERDICT)) fail(`VERDICT must be one of PASS | WARN | FAIL — got ${JSON.stringify(data.VERDICT)}`);
    requireUrl("STICKY_URL", data.STICKY_URL);
    body = `<!-- PR_REVIEWER_POINTER -->\n`
      + `Reviewed \`${shortSha}\` — ${data.VERDICT}, no prior report on record. [Full report](${data.STICKY_URL})`;
  } else if (FORM === "escalation") {
    if (!VERDICTS.has(data.VERDICT)) fail(`VERDICT must be one of PASS | WARN | FAIL — got ${JSON.stringify(data.VERDICT)}`);
    if (!VERDICTS.has(data.PRIOR_VERDICT)) {
      fail(`PRIOR_VERDICT must be one of PASS | WARN | FAIL — got ${JSON.stringify(data.PRIOR_VERDICT)}`
        + ` (an empty/unknown prior verdict is the "no_prior" form, never "escalation")`);
    }
    if (!data.REASONS || String(data.REASONS).trim() === "") fail("REASONS is required and must be non-empty for the escalation form");
    assertPlain("REASONS", data.REASONS);
    requireUrl("STICKY_URL", data.STICKY_URL);
    body = `<!-- PR_REVIEWER_POINTER -->\n`
      + `⚠️ Verdict moved ${data.PRIOR_VERDICT} → ${data.VERDICT} at \`${shortSha}\` — ${data.REASONS}.`
      + ` [Full report](${data.STICKY_URL})`;
  } else if (FORM === "degraded") {
    requireCount("FINDINGS_COUNT", data.FINDINGS_COUNT);
    if (!data.HEADLINE_LINE || String(data.HEADLINE_LINE).trim() === "") fail("HEADLINE_LINE is required for the degraded form");
    assertPlain("HEADLINE_LINE", data.HEADLINE_LINE);
    if (data.HEADLINE_LINE.includes("<!-- PR_REVIEWER_REPORT -->")) {
      fail("HEADLINE_LINE must not carry the report marker — the degraded pointer is never a report");
    }
    if (!data.DEGRADED_REASON || String(data.DEGRADED_REASON).trim() === "") {
      fail("DEGRADED_REASON is required for the degraded form — state WHY the sticky was not written"
        + " (an access-path failure or a caller policy refusal), never leave it implicit");
    }
    assertPlain("DEGRADED_REASON", data.DEGRADED_REASON);
    if (!isPlainObject(data.LEDGER)) fail("LEDGER is required and must be an object for the degraded form");
    const ledgerJson = JSON.stringify(data.LEDGER);
    if (ledgerJson.length > LEDGER_BUDGET) {
      fail(`LEDGER is ${ledgerJson.length} chars, over the ${LEDGER_BUDGET}-char pointer-ledger cap`
        + " — reduce it (drop open_bot_comment_ids, then blocking_fingerprints) before calling this renderer");
    }
    const n = data.FINDINGS_COUNT;
    body = `<!-- PR_REVIEWER_POINTER -->\n`
      + `Reviewed \`${shortSha}\` — ${data.HEADLINE_LINE} ${n} finding(s) inline. ${data.DEGRADED_REASON}\n\n`
      + `<!-- PR_REVIEWER_LEDGER ${ledgerJson} -->`;
  }

  // ── fail-closed post-conditions, mirroring render-report.mjs ──────────────────────────────
  if (!body.startsWith("<!-- PR_REVIEWER_POINTER -->")) fail("rendered body lost the pointer marker");
  if (body.includes("<!-- PR_REVIEWER_REPORT -->")) fail("rendered body carries the report marker — the report belongs in the sticky only");
  const prose = body.replace(/<!-- PR_REVIEWER_LEDGER .*? -->/s, "").trim();
  if (prose.length > PROSE_BUDGET) {
    fail(`rendered body is ${prose.length} chars of prose — a pointer, not a report (budget ${PROSE_BUDGET})`);
  }

  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

main();
