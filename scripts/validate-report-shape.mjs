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
  // Current shape — the three group headings and the collapsed-lens footnote. Only the headings
  // are listed, never a plain in-group label (`Quality — `, `Memories — `): model-authored
  // optimality cards render above the accordion, and a card discussing quality would trip a
  // substring match on one.
  "**Needs attention**",
  "**Found**",
  "**Run**",
  "<sup>Nothing to report —",
  // Pre-grouping shape. Kept because this validator runs against LIVE bodies, and a report posted
  // before the accordion was grouped is still judged by the contract it was written under — the
  // same reason `**Open bot threads (` survives below.
  "**Run mode**",
  "**Memories**",
  "**Quality**",
  "**Integrations**",
  "**Optimality (2.4c)**",
  "**Standards (2.4d)**",
  "**Skipped files**",
  // The qualifier is optional: the one captured drift body wrote `**Open threads (6)**`, so
  // requiring the canonical wording let a hand-written heading — the exact class this file exists
  // to catch — through both this list and the count check below. `bot` is the pre-rename wording,
  // still emitted by bodies posted before the author-neutral rename; `review` is the current one.
  "**Open threads (",
  "**Open bot threads (",
  "**Open review threads (",
  // The three retired run-mode footer sentences and the retired `Reviewed by the …` attribution
  // line. Kept because this validator runs against LIVE bodies: a report posted before the shared
  // footer landed is still judged by the contract it was written under.
  "<sup>Reviewed for commit",
  "<sup>Incremental review for commit",
  "<sup>No code changes since",
  "<sup>Reviewed by the",
];

// The current shared footer (comment-spine.mjs's footerLine()). It renders BELOW the accordion, so
// on a well-formed body it is never in `head` — which makes it a free extra signal on a flattened
// one, where `head` is the whole body. It is listed separately from ACCORDION_OWNED only because
// its violation message should say "flattened", not "renders above the accordion".
const SHARED_FOOTER = "<sup>`pr-reviewer` · commit `";

// Signals that a body is a full report even WITHOUT the marker. A drifting run drops the marker
// first, so marker-presence cannot decide whether the contract applies — that is precisely the
// body this script exists to catch.
//
// The gate-table header is decisive on its own: no other object in this pipeline emits a
// `| Gate | Status | Details |` header, and the real flat body carried the table while omitting
// `**Run mode**`, so a two-of-N rule over the diagnostic lines missed it. Column spacing varies
// between runs (`| --- |` vs `|---|`), so match the header cells, not a fixed string.
const GATE_TABLE_RE = /^\|\s*Gate\s*\|\s*Status\s*\|\s*Details\s*\|/m;
// Both shapes are listed: a current body carries `**Found**` + `**Run**`, a pre-grouping one
// carries two or more of the bold diagnostic labels. Two signals is still the bar, so one
// incidental bold label in a human comment never classifies as a report.
const REPORT_SIGNALS = [
  "**Found**",
  "**Run**",
  SHARED_FOOTER,
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
    // A pointer must stay a pointer: prose only. The ledger strip is BACK-COMPAT — current
    // pr-reviewer runs put no ledger on any body (run state is the PR-state record), but a
    // pointer posted before that change still carries one, and this validator runs against
    // live bodies on PRs that may not have been re-reviewed since. Stripping it keeps an old
    // body from failing a budget it was never measured against; it is not a licence to write one.
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
    // Describe the marker, never emit it verbatim. The workflow renders these details into its
    // notice comment, and a notice quoting `<!-- PR_REVIEWER_REPORT -->` classifies as a report
    // itself — so the guard's own output failed the guard when re-validated.
    add("missing-report-marker", "body carries report sections but no PR_REVIEWER_REPORT marker comment");
  }
  if (kind === "report-mismarked-as-pointer") {
    add("report-marked-as-pointer", "a full report body carries the PR_REVIEWER_POINTER marker"
      + " comment, so a later run's prior-run detection will recover it as a pointer and read the"
      + " report as absent");
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

  // ── the report's own identity: a `### ` headline ─────────────────────────────────────────────
  // A `### ` heading is what makes a report identifiable as a report at a glance, and it is the one
  // shape an inline finding never uses (a finding opens with its Conventional-Comments prefix and a
  // bold title). A hand-written body — the class this file exists to catch — reads as a long
  // comment because it loses the heading first.
  //
  // Scoped to bodies that carry the current footer: a report posted before the heading existed
  // opened with a plain sentence and must not be failed for conforming to its own contract.
  if (body.includes(SHARED_FOOTER) && !/^### /m.test(body)) {
    add("no-headline-heading",
      "the report has no `### ` headline — it renders as a long comment rather than a report");
  }

  // ── the markup survived the trip ─────────────────────────────────────────────────────────────
  //
  // This is the one violation class that is invisible from inside the agent. Every other guard —
  // the renderer's post-conditions, the Step 4a assertions, the ingest round-trip — runs before the
  // body leaves the shell, and on the MCP write path the body then has to be reproduced into a
  // tool-call argument. On mthines/agent-skills#165 that copy arrived HTML-escaped and wrapped in a
  // code span on all six of a run's artifacts, and no in-agent check could have seen it.
  //
  // Fenced regions are excluded: a ``` fence contains a double backtick as a substring, and a
  // quoted diff can legitimately contain escaped markup.
  const unfenced = body.replace(/^```[\s\S]*?^```/gm, "");
  for (const sig of ["&lt;picture", "&lt;source", "&lt;a href", "&gt;&lt;", "&lt;img"]) {
    if (unfenced.includes(sig)) {
      add("escaped-inline-html",
        `the posted body carries escaped inline HTML (${sig}) — the markup was re-encoded after the`
        + " renderer wrote it, so the buttons render as literal text with dead links");
      break;
    }
  }
  for (const h of unfenced.match(/href="[^"]*"/g) ?? []) {
    if (h.includes("`")) {
      add("backtick-in-href",
        `a backtick sits inside an href (${h.slice(0, 50)}…) — it closes the attribute and opens a`
        + " code span, which escapes the surrounding markup");
      break;
    }
  }
  if (/\]\(\s*`/.test(unfenced)) {
    add("caged-link-target",
      "a code span opens inside a link target — the URL must sit bare between the parentheses,"
      + " or the link renders as dead monospace text");
  }

  // The findings index is the report's worklist. Inside the accordion it is a worklist nobody
  // reads, so its position is part of the contract, not a layout preference.
  if (/^\|\s*Finding\s*\|\s*Where\s*\|\s*Severity\s*\|/m.test(body)
      && !/^\|\s*Finding\s*\|\s*Where\s*\|\s*Severity\s*\|/m.test(head)) {
    add("findings-index-inside-accordion",
      "the findings index renders inside the accordion — it has to be visible without a click");
  }

  // ── the advisory verdict is terminal-only ────────────────────────────────────────────────────
  if (body.includes("**Verdict**")) {
    add("verdict-in-posted-body", "the Step 3 advisory verdict is terminal-only");
  }

  // ── a link caged in a code span renders as dead monospace text ────────────────────────────────
  const caged = body.match(/``?\s*\[[^\]]*\]\([^)]*\)\s*``?/g);
  if (caged) add("link-caged-in-code-span", `${caged[0].slice(0, 80)}`);

  // ── a declared count must equal the bullets rendered under it ──────────────────────────────────
  const declared = body.match(/\*\*Open (?:bot |review )?threads \((\d+)\)\*\*/);
  if (declared) {
    const after = body.slice(body.indexOf(declared[0]) + declared[0].length);
    const block = after.split(/\n\s*\n/).find((p) => p.trim().startsWith("- ")) || "";
    const bullets = block.split("\n").filter((l) => l.trim().startsWith("- ")).length;
    if (Number(declared[1]) !== bullets) {
      add("count-disagrees-with-list",
        `**Open threads (${declared[1]})** but ${bullets} bullet(s) rendered`);
    }
    const suffix = body.match(/<summary>Review details — (\d+) open (?:bot |review )?thread/);
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
