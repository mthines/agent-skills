#!/usr/bin/env node
/**
 * validate-report-shape.mjs
 *
 * Validates a POSTED pr-reviewer body against the shape contract, from outside the agent.
 *
 * Why this exists — and why it cannot live in the agent. Every other guard on this contract runs
 * somewhere the agent controls:
 *
 *   L1 / G25 (439 checks)      runs in CI against the repository, and never sees a posted report
 *   render-report.mjs          fails closed, but only if the run invokes it
 *   Step 4a pre-write asserts  prose in the same file a drifting run has already skipped
 *   the ingest round trip      runs against committed fixtures, not live output
 *
 * So a run that simply hand-writes the body is unobserved by all of them. That is not theoretical:
 * on mthines/lorekit#503 the same definition produced the correct shape three times and a flat,
 * marker-less body on the fourth run 24 minutes later. This script is the first check that looks
 * at what was actually published.
 *
 * Input:  the body text on stdin, or a file path as argv[2].
 * Output: a JSON verdict on stdout ({ok, kind, violations[]}) plus a human summary on stderr.
 * Exit:   0 = conforms or not a pr-reviewer body; 1 = violations found; 2 = usage error.
 *
 * It never edits or deletes anything. Reporting is the caller's job (see the workflow).
 */

import { readFileSync } from "node:fs";

const REPORT_MARKER = "<!-- PR_REVIEWER_REPORT -->";
const POINTER_MARKER = "<!-- PR_REVIEWER_POINTER -->";
const LEDGER_RE = /<!-- PR_REVIEWER_LEDGER [\s\S]*?-->/;

// Lines the `Review details` accordion owns. Any of these above the first `<details>` means the
// report was flattened — the exact regression seen in production.
// The gate table is NOT in this list: its column spacing varies between runs, so a literal misses
// `|  Gate  | Status | Details |`. It is matched with GATE_TABLE_RE below, the same regex the
// classifier uses — otherwise a body could classify as a report on the regex and then escape this
// check on the literal.
const ACCORDION_OWNED = [
  "**Run mode**",
  "**Memories**",
  "**Quality**",
  "**Integrations**",
  "**Optimality (2.4c)**",
  "**Standards (2.4d)**",
  "**Skipped files**",
  "**Open bot threads (",
  "<sup>Reviewed for commit",
  "<sup>Incremental review for commit",
  "<sup>No code changes since",
  "<sup>Reviewed by the",
];

// Signals that a body is a full report even WITHOUT the marker. A drifting run drops the marker
// first, so marker-presence cannot decide whether the contract applies — that is precisely the
// body this script exists to catch.
//
// The gate-table header is decisive on its own: no other object in this pipeline emits a
// `| Gate | Status | Details |` header, and the real flat body carried the table while omitting
// `**Run mode**`, so a two-of-N rule over the diagnostic lines missed it. Column spacing varies
// between runs (`| --- |` vs `|---|`), so match the header cells, not a fixed string.
const GATE_TABLE_RE = /^\|\s*Gate\s*\|\s*Status\s*\|\s*Details\s*\|/m;
const REPORT_SIGNALS = [
  "**Run mode**",
  "**Standards (2.4d)**",
  "**Optimality (2.4c)**",
  "**Memories**",
  "**Skipped files**",
  "**Integrations**",
];

function classify(body) {
  const hasReportMarker = body.includes(REPORT_MARKER);
  const hasPointerMarker = body.includes(POINTER_MARKER);
  const signals = REPORT_SIGNALS.filter((s) => body.includes(s)).length;
  const isReport = GATE_TABLE_RE.test(body) || signals >= 2;
  // A pointer is one line plus an optional ledger; a report carries sections.
  if (hasReportMarker) return "report";
  if (isReport) return hasPointerMarker ? "report-mismarked-as-pointer" : "report-unmarked";
  if (hasPointerMarker) return "pointer";
  return "not-a-reviewer-body";
}

export function validate(body) {
  const kind = classify(body);
  const violations = [];
  const add = (code, detail) => violations.push({ code, detail });

  if (kind === "not-a-reviewer-body") return { ok: true, kind, violations };

  if (kind === "pointer") {
    // A pointer must stay a pointer: prose only, plus an optional ledger.
    // Strip the LEDGER only — not the marker. The agent's own Step 4b pre-flight measures the same
    // 600-char budget against the body with just the ledger block removed, so also stripping the
    // 27-char POINTER_MARKER here made this budget looser than the one it is meant to validate, and
    // a body the agent rejects could pass the external guard.
    const prose = body.replace(LEDGER_RE, "").trim();
    if (prose.length > 600) {
      add("pointer-too-long", `${prose.length} chars of prose (budget 600) — a pointer is one line`);
    }
    if (prose.includes("<details>")) add("pointer-carries-sections", "a pointer has no <details> blocks");
    return { ok: violations.length === 0, kind, violations };
  }

  if (kind === "report-unmarked") {
    add("missing-report-marker", `body carries report sections but no ${REPORT_MARKER}`);
  }
  if (kind === "report-mismarked-as-pointer") {
    add("report-marked-as-pointer", `a full report body carries ${POINTER_MARKER}, so a later run's`
      + ` prior-run detection will recover it as a pointer and read the report as absent`);
  }

  // ── the accordion ────────────────────────────────────────────────────────────────────────────
  // Adjacency, checked line-wise. A `<details>` followed by `<summary>Review details` is the only
  // thing that counts; the presence of some other <details> block is not evidence.
  const lines = body.split("\n");
  const accordionAt = lines.findIndex((l, i) =>
    l.trim() === "<details>" && (lines[i + 1] || "").startsWith("<summary>Review details"));
  if (accordionAt === -1) {
    add("no-review-details-accordion",
      "no `<details>` immediately followed by `<summary>Review details` — the report renders expanded");
  }
  if (/<details\s+open/.test(body)) {
    add("accordion-pre-expanded", "a <details> block carries `open`, so it renders expanded");
  }

  // ── nothing the accordion owns may sit above the `Review details` accordion ───────────────────
  // Anchor on the accordion itself, never on `body.indexOf("<details>")`. A report may legitimately
  // carry an earlier, unrelated <details> block (an `Additional findings` fold, for one), and
  // slicing at that one truncates the head before the flattened lines, so the flat body this check
  // exists to catch would sail through. When there is no accordion the whole body is the head.
  const head = accordionAt === -1
    ? body
    : lines.slice(0, accordionAt).join("\n");
  for (const owned of ACCORDION_OWNED) {
    if (head.includes(owned)) {
      add("accordion-owned-line-at-top-level", `\`${owned}\` renders above the accordion`);
    }
  }
  if (GATE_TABLE_RE.test(head)) {
    add("accordion-owned-line-at-top-level", "`| Gate | Status | Details |` renders above the accordion");
  }

  // ── the advisory verdict is terminal-only ────────────────────────────────────────────────────
  if (body.includes("**Verdict**")) {
    add("verdict-in-posted-body", "the Step 3 advisory verdict is terminal-only");
  }

  // ── a link caged in a code span renders as dead monospace text ────────────────────────────────
  const caged = body.match(/``?\s*\[[^\]]*\]\([^)]*\)\s*``?/g);
  if (caged) add("link-caged-in-code-span", `${caged[0].slice(0, 80)}`);

  // ── a declared count must equal the bullets rendered under it ──────────────────────────────────
  const declared = body.match(/\*\*Open bot threads \((\d+)\)\*\*/);
  if (declared) {
    const after = body.slice(body.indexOf(declared[0]) + declared[0].length);
    const block = after.split(/\n\s*\n/).find((p) => p.trim().startsWith("- ")) || "";
    const bullets = block.split("\n").filter((l) => l.trim().startsWith("- ")).length;
    if (Number(declared[1]) !== bullets) {
      add("count-disagrees-with-list",
        `**Open bot threads (${declared[1]})** but ${bullets} bullet(s) rendered`);
    }
    const suffix = body.match(/<summary>Review details — (\d+) open bot thread/);
    if (suffix && Number(suffix[1]) !== Number(declared[1])) {
      add("summary-count-disagrees", `summary says ${suffix[1]}, list says ${declared[1]}`);
    }
  }

  return { ok: violations.length === 0, kind, violations };
}

function main() {
  const arg = process.argv[2];
  let body;
  try {
    body = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`validate-report-shape: cannot read input: ${e.message}\n`);
    process.exit(2);
  }
  const result = validate(body);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.kind === "not-a-reviewer-body") {
    process.stderr.write("not a pr-reviewer body — nothing to check\n");
  } else if (result.ok) {
    process.stderr.write(`${result.kind}: conforms\n`);
  } else {
    process.stderr.write(`${result.kind}: ${result.violations.length} violation(s)\n`);
    for (const v of result.violations) process.stderr.write(`  - ${v.code}: ${v.detail}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
