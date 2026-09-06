#!/usr/bin/env node
// Maps a changed-file list to the L2 suites those changes can affect, so CI runs a
// SUBSET instead of all nine. Selection is DERIVED from the suite table
// (./suites.mjs) — every suite already declares its own inputs (`rubric.file`,
// `golden`), so nothing here restates them and nothing can drift out of sync.
//
//   git diff --name-only main...HEAD | node scripts/eval/select-suites.mjs
//   node scripts/eval/select-suites.mjs --json  skills/quality/severity/SKILL.md
//   node scripts/eval/select-suites.mjs --all           # every suite (workflow_dispatch)
//   node scripts/eval/select-suites.mjs --self-test     # offline, no changed files
//
// Paths come from argv (positional) or, when none are given, newline-separated on
// stdin. They are matched EXACTLY (repo-relative, forward slashes) — the same
// spelling `git diff --name-only` prints and the suite table stores.
//
// Selection rules, first match wins per changed path:
//   1. a harness file (SUITES.HARNESS_FILES) → EVERY suite; a change to the runner,
//      the rubric extractor, or the table itself can alter any suite's behaviour.
//   2. a suite's `rubric.file`  → that suite (a shared rubric file selects both).
//   3. a suite's golden JSONL   → that suite.
//   4. anything else            → no suite.
//
// Rule 1 is the deliberate fail-open direction: widening costs API tokens, narrowing
// costs coverage, and a missed suite is the failure that hides itself.
import { SUITES, HARNESS_FILES, goldenPath } from "./suites.mjs";

const ALL = SUITES.map((s) => s.name);

/**
 * @param {string[]} changed  repo-relative changed paths
 * @returns {{ suites: string[], reason: string, matches: Record<string, string[]> }}
 *   `suites` in SUITES order (stable, so a matrix key is reproducible);
 *   `matches` maps each selecting path to the suites it selected.
 */
export function selectSuites(changed) {
  const matches = {};
  const picked = new Set();
  let harness = null;

  for (const path of changed) {
    if (HARNESS_FILES.includes(path)) {
      harness ??= path;
      matches[path] = [...ALL];
      for (const n of ALL) picked.add(n);
      continue;
    }
    const hits = SUITES.filter(
      (s) => s.rubric.file === path || goldenPath(s) === path,
    ).map((s) => s.name);
    if (hits.length) {
      matches[path] = hits;
      for (const n of hits) picked.add(n);
    }
  }

  const suites = ALL.filter((n) => picked.has(n));
  const reason = harness
    ? `harness change (${harness}) → all ${ALL.length} suites`
    : suites.length
      ? `${suites.length} of ${ALL.length} suites affected by ${Object.keys(matches).length} changed file(s)`
      : "no rubric, golden, or harness file changed → no suite affected";
  return { suites, reason, matches };
}

// ── self-test ──────────────────────────────────────────────────────────────────
// Asserts the MAPPING, not a remembered list: every claim is derived from SUITES,
// so adding a suite extends the coverage instead of aging the test. Executed by
// L1 (G21h) so a broken selector fails a PR rather than silently narrowing CI.
function selfTest() {
  const fails = [];
  const t = (label, ok, detail = "") => { if (!ok) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  t("the table is non-empty", ALL.length > 0);

  for (const s of SUITES) {
    // Its own rubric file selects it — and nothing selects a suite it does not name.
    const byRubric = selectSuites([s.rubric.file]);
    t(`${s.name}: its rubric file selects it`, byRubric.suites.includes(s.name),
      `${s.rubric.file} → [${byRubric.suites}]`);
    for (const other of byRubric.suites) {
      const o = SUITES.find((x) => x.name === other);
      t(`${s.name}: ${other} co-selected only because it shares the rubric file`,
        o.rubric.file === s.rubric.file, `${other} reads ${o.rubric.file}`);
    }

    const byGolden = selectSuites([goldenPath(s)]);
    t(`${s.name}: its golden file selects exactly it`,
      byGolden.suites.length === 1 && byGolden.suites[0] === s.name,
      `${goldenPath(s)} → [${byGolden.suites}]`);
  }

  for (const h of HARNESS_FILES) {
    const all = selectSuites([h]);
    t(`harness file ${h} selects every suite`, all.suites.length === ALL.length,
      `→ ${all.suites.length}/${ALL.length}`);
  }

  // An unrelated path selects nothing (the narrowing half — without it a selector
  // that returned ALL for everything would pass every assertion above).
  const none = selectSuites(["README.md", "packages/vscode-agent-tasks/src/extension.ts"]);
  t("an unrelated path selects no suite", none.suites.length === 0, `→ [${none.suites}]`);

  // A near-miss must NOT match: matching is exact, not prefix/substring, so a
  // sibling file in a rubric's directory cannot drag its suite in.
  const near = selectSuites([`${SUITES[0].rubric.file}.bak`, "scripts/eval/golden/"]);
  t("a near-miss path selects no suite", near.suites.length === 0, `→ [${near.suites}]`);

  // Output order is the table's order, whatever order the changed files arrive in.
  const shuffled = selectSuites([goldenPath(SUITES[SUITES.length - 1]), goldenPath(SUITES[0])]);
  t("selection is returned in table order",
    shuffled.suites.join(",") === [SUITES[0].name, SUITES[SUITES.length - 1].name].join(","),
    `→ [${shuffled.suites}]`);

  if (fails.length) {
    console.error(`✗ select-suites self-test: ${fails.length} failure(s)`);
    for (const f of fails) console.error(`    ✗ ${f}`);
    process.exit(1);
  }
  console.log(`✓ select-suites self-test passed (${ALL.length} suites, ${HARNESS_FILES.length} harness files)`);
  process.exit(0);
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--self-test")) selfTest();

const asJson = argv.includes("--json");
const positional = argv.filter((a) => !a.startsWith("--"));

let result;
if (argv.includes("--all")) {
  result = { suites: [...ALL], reason: `--all → every suite (${ALL.length})`, matches: {} };
} else {
  const changed = positional.length
    ? positional
    : (await readStdin()).split("\n").map((l) => l.trim()).filter(Boolean);
  result = selectSuites(changed);
}

if (asJson) {
  // One line, machine-read by the workflow: `suites` feeds the matrix, `count`
  // gates whether the matrix job runs at all (an empty matrix is an error in GHA).
  console.log(JSON.stringify({ suites: result.suites, count: result.suites.length, reason: result.reason }));
} else {
  console.log(result.reason);
  for (const [path, names] of Object.entries(result.matches)) console.log(`  ${path} → ${names.join(", ")}`);
  for (const n of result.suites) console.log(n);
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
