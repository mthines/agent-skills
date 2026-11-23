#!/usr/bin/env node
// Builds scripts/eval/fixtures/report-body/README.md: every pr-reviewer report variation, rendered.
//
// The gallery is built from the committed `*.expected.md` snapshots, which L1 G25 proves equal to
// render-report.mjs's output for each `*.json` payload, so what the README shows is what a run posts.
//
// Usage:  node scripts/eval/report-gallery.mjs           (write the README)
//         node scripts/eval/report-gallery.mjs --check   (exit 1 when the README is stale)

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BODY_DIR = join(ROOT, "scripts/eval/fixtures/report-body");
const POINTER_DIR = join(ROOT, "scripts/eval/fixtures/report-pointer");
const OUT = join(BODY_DIR, "README.md");

// Gallery order and the one line saying what each variation shows. A fixture missing here fails the
// `--check` that evals-l1.yml runs, so a new payload cannot land without a place in the gallery.
const REPORTS = [
  ["pass", "PASS, no findings", "Every gate ✅ in the one-line gate strip, nothing posted — the cleanest possible report."],
  ["pass-ci-pending", "PASS with CI still running", "A pending or red CI check renders as a `CI` row and never moves the verdict."],
  ["pass-notes-advisory", "PASS with notes and an advisory", "Cleared one-liners (`nitpick:`, `praise:`) count as notes in the headline; a finding below the confidence bar adds the advisory line and a *Less certain* accordion."],
  ["warn-no-findings", "WARN, zero findings", "Only a soft gate (Description vs. code) warns, so the heading stays `✅ No issues found` with a `**Before merge:**` line, and the gate's details open under Review details; also shows a size-scaled `standard` tier."],
  ["warn", "WARN, incremental re-review with findings", "Non-blocking findings table, open review threads on the summary, resolved-since progress, notes, memories used, CI and verified notes, and the Agent0 Fix-all / Re-review / Loop buttons."],
  ["incremental-quick", "Incremental-quick re-review", "A small delta since the last review on the `quick` tier; the optional lenses are skipped and say so."],
  ["zero-delta", "Zero-delta (gate checks only)", "No code changed since the last review: no finder ran, so the `Checked` row is omitted and the footer names the gate-only run."],
  ["worklist", "FAIL with the full worklist", "Blocking, `Decide:`, and plain rows in their fixed order, `Fix:` lines, the impact image above the table, and a `diff-only` depth that caps the tier and raises an anomaly. The image URL is a placeholder, so GitHub shows a broken-image icon where a real run shows its uploaded light and dark impact-map PNGs."],
  ["fail", "FAIL, partial review", "Tool budget exhausted (the partial banner sits above the headline), blocking findings, open threads, optimality cards, and low-confidence findings."],
  ["deep", "FAIL on the deep tier", "A `deep` / `checkout` run with impact data, withheld findings, memories used, a run note, and a run anomaly."],
  ["reach-none", "Reach: no dependents", "The impact trace ran and found no dependent files, so the reach is explained in the footnote rather than left silent."],
  ["reach-modules", "Reach: changed modules and importers", "A changed file no export covers, listed with the files that import it, plus file coverage."],
  ["reach-progress", "Reach with progress across rounds", "The `Progress` row tracks open threads and blocking counts across earlier reviews, alongside per-export reach."],
];

const POINTERS = [
  ["pointer", "Pointer (normal)", "The review body is marker-only; the report lives in the sticky comment."],
  ["degraded", "Pointer (degraded)", "When the sticky comment cannot be written, the review body carries a one-line summary instead."],
];

function section([name, title, what], dir, ext) {
  const snapshot = join(dir, `${name}.expected.md`);
  const body = readFileSync(snapshot, "utf8").trimEnd();
  const rel = dir === BODY_DIR ? "" : "../report-pointer/";
  return [
    `## ${title}`,
    "",
    `${what}`,
    "",
    `Payload: [\`${name}.${ext}\`](${rel}${name}.${ext}) · snapshot: [\`${name}.expected.md\`](${rel}${name}.expected.md)`,
    "",
    "<details>",
    "<summary>Markdown source</summary>",
    "",
    "````markdown",
    body,
    "````",
    "",
    "</details>",
    "",
    "**Rendered:**",
    "",
    "---",
    "",
    body,
    "",
    "---",
    "",
  ].join("\n");
}

function assertComplete(dir, listed, label) {
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  const names = new Set(listed.map(([n]) => n));
  const missing = onDisk.filter((n) => !names.has(n));
  const stale = [...names].filter((n) => !onDisk.includes(n));
  if (missing.length || stale.length) {
    process.stderr.write(`report-gallery: ${label} out of step with ${dir}` +
      (missing.length ? ` — add to the gallery: ${missing.join(", ")}` : "") +
      (stale.length ? ` — no fixture for: ${stale.join(", ")}` : "") + "\n");
    process.exit(1);
  }
}

assertComplete(BODY_DIR, REPORTS, "REPORTS");
assertComplete(POINTER_DIR, POINTERS, "POINTERS");

const toc = (list) => list.map(([, title]) =>
  `- [${title}](#${title.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-")})`).join("\n");

const readme = [
  "<!-- Generated by scripts/eval/report-gallery.mjs — edit a fixture or the script, then rerun it. -->",
  "",
  "# pr-reviewer report gallery",
  "",
  "Every variation of the sticky report comment `pr-reviewer` posts on a PR, rendered from a real payload.",
  "Each section shows the payload, the Markdown the renderer emits, and how GitHub displays it.",
  "",
  "These are test fixtures, not just examples.",
  "L1 `G25` renders every `*.json` here with [`render-report.mjs`](../../../../agents/pr-reviewer/scripts/render-report.mjs) and fails when the output differs from its `*.expected.md` snapshot, and `G25h` / `G26` parse each snapshot with the ingest grammar and the external validator.",
  "The layout contract is [`report-rendering.md`](../../../../agents/pr-reviewer/rules/report-rendering.md).",
  "",
  "## Adding or changing a variation",
  "",
  "1. Add or edit `<name>.json` in this folder; the renderer fails closed, so fix the payload until it renders.",
  "2. Write the snapshot: `node agents/pr-reviewer/scripts/render-report.mjs scripts/eval/fixtures/report-body/<name>.json > scripts/eval/fixtures/report-body/<name>.expected.md`.",
  "3. Add `<name>` with a title and a one-line description to `REPORTS` in [`report-gallery.mjs`](../../report-gallery.mjs).",
  "4. Rebuild this file with `node scripts/eval/report-gallery.mjs`, and confirm with `node scripts/eval/l1.mjs`; CI (`evals-l1.yml`) runs `--check` and fails on a stale README.",
  "",
  "```bash",
  "node scripts/eval/report-gallery.mjs --check   # exits 1 when this README is stale",
  "```",
  "",
  "## Report variations",
  "",
  toc(REPORTS),
  "",
  "Review-body pointers (the review's own body, not the sticky comment):",
  "",
  toc(POINTERS),
  "",
  ...REPORTS.map((r) => section(r, BODY_DIR, "json")),
  ...POINTERS.map((p) => section(p, POINTER_DIR, "json")),
].join("\n").trimEnd() + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== readme) {
    process.stderr.write("report-gallery: README.md is stale — run node scripts/eval/report-gallery.mjs\n");
    process.exit(1);
  }
  process.stdout.write("report-gallery: README.md is up to date\n");
} else {
  writeFileSync(OUT, readme);
  process.stdout.write(`report-gallery: wrote ${OUT}\n`);
}
