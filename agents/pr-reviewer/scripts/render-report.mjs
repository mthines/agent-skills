#!/usr/bin/env node
// Render a pr-reviewer REPORT_BODY from a JSON payload.
//
// Why this exists: the report layout used to live in three ~85%-identical markdown templates
// inside a 2752-line agent definition, 280 lines below the step that posts them. Runs did not
// copy them — they averaged them into a remembered shape and dropped the marker, the accordion,
// or both (five observed cases across mthines/lorekit#482, #492, #495). Layout is not a judgment
// call, so it does not belong to the model. The model produces DATA; this renders it.
//
// Usage:  node render-report.mjs payload.json    (or: … < payload.json)
// Output: the report body on stdout. Any problem exits non-zero with a reason on stderr and
//         prints NOTHING to stdout — a caller that pipes stdout can never post a partial body.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, "..", "templates", "report-body.md");

// Slots that must always be present and non-empty. Everything else is optional: an absent
// optional key omits its whole `{{#KEY}}…{{/KEY}}` block.
const REQUIRED = [
  "HEADLINE",
  "FOOTER_LINE",
  "GATE_DESCRIPTION_STATUS", "GATE_DESCRIPTION_DETAILS",
  "GATE_PRIOR_STATUS", "GATE_PRIOR_DETAILS",
  "GATE_DOCS_STATUS", "GATE_DOCS_DETAILS",
  "GATE_SELFREVIEW_STATUS", "GATE_SELFREVIEW_DETAILS",
  "GATE_CODEREVIEW_STATUS", "GATE_CODEREVIEW_DETAILS",
  "RUN_MODE", "MEMORIES", "QUALITY", "INTEGRATIONS",
  "OPTIMALITY_LOG", "STANDARDS_LOG", "SKIPPED_FILES",
];

// Optional slots, and the block key that governs each. A slot whose governing block is absent
// is never substituted, because the block containing it is removed first.
const OPTIONAL = [
  "PARTIAL_BANNER", "BUDGET_CALLS", "BUDGET_SCANNED", "BUDGET_TOTAL",
  "OPTIMALITY_CARDS", "OPTIMALITY_COUNT",
  "ADDITIONAL_FINDINGS", "ADDITIONAL_COUNT",
  "LOW_CONFIDENCE_FINDINGS", "LOW_CONFIDENCE_COUNT",
  "OPEN_THREADS", "OPEN_THREADS_COUNT", "OPEN_THREADS_SUFFIX", "RESOLVED_SINCE",
  "CI_NOTE", "VERIFIED_NOTE", "QUALITY_DROPPED",
];

const VALID_STATUS = new Set(["✅", "⚠️", "❌", "⏭️"]);

function fail(msg) {
  process.stderr.write(`render-report: ${msg}\n`);
  process.exit(1);
}

/** Remove `{{#KEY}}…{{/KEY}}` when absent/empty; unwrap it when present. Innermost-first. */
function resolveBlocks(tpl, data) {
  const block = /\{\{#([A-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/;
  let out = tpl;
  for (let guard = 0; block.test(out); guard++) {
    if (guard > 100) fail("block resolution did not terminate — malformed template");
    out = out.replace(block, (_m, key, body) => {
      const v = data[key];
      const present = v !== undefined && v !== null && String(v).trim() !== "" && v !== false;
      return present ? body : "";
    });
  }
  return out;
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
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    fail("payload must be a JSON object");
  }

  // Unknown keys are an error, not a no-op: a typo'd slot would otherwise render as an empty
  // string and silently drop a whole section from the report.
  const known = new Set([...REQUIRED, ...OPTIONAL]);
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length) fail(`unknown payload key(s): ${unknown.join(", ")}`);

  const missing = REQUIRED.filter(
    (k) => data[k] === undefined || data[k] === null || String(data[k]).trim() === "",
  );
  if (missing.length) fail(`missing required slot(s): ${missing.join(", ")}`);

  for (const [k, v] of Object.entries(data)) {
    if (k.endsWith("_STATUS") && !VALID_STATUS.has(String(v).trim())) {
      fail(`${k} must be one of ✅ ⚠️ ❌ ⏭️ — got ${JSON.stringify(v)}`);
    }
  }

  // The advisory verdict is terminal-only and must never reach a posted body.
  for (const [k, v] of Object.entries(data)) {
    if (String(v).includes("**Verdict**")) {
      fail(`${k} carries a **Verdict** line — the advisory verdict is terminal-only`);
    }
  }

  let tpl;
  try {
    tpl = readFileSync(TEMPLATE, "utf8");
  } catch (e) {
    fail(`cannot read the template at ${TEMPLATE}: ${e.message}`);
  }

  let body = resolveBlocks(tpl, data);
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    body = body.split(`{{${key}}}`).join(data[key] === undefined ? "" : String(data[key]));
  }

  const leftover = body.match(/\{\{[^}]*\}\}/g);
  if (leftover) fail(`unresolved placeholder(s) left in the body: ${[...new Set(leftover)].join(", ")}`);

  // Post-conditions. These cannot fail for a payload this script accepted, which is the point:
  // they are here so that a future template edit that breaks the contract fails loudly at render
  // time instead of quietly posting a flat report.
  if (!body.includes("<!-- PR_REVIEWER_REPORT -->")) fail("rendered body lost the report marker");
  if (!/<details>\n<summary>Review details/.test(body)) {
    fail("rendered body has no `Review details` accordion");
  }
  if (body.includes("<details open>")) fail("rendered body pre-expands a `<details>` block");
  const head = body.split("<details>")[0];
  for (const owned of ["| Gate | Status | Details |", "**Run mode**", "**Memories**",
    "**Quality**", "**Skipped files**", "<sup>Reviewed for commit",
    "<sup>Incremental review for commit"]) {
    if (head.includes(owned)) fail(`${owned} rendered above the accordion`);
  }

  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
}

main();
