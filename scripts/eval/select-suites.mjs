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
// The extra runners (bug-detection, memory-efficacy) ride the same derivation: each
// declares its inputs in suites.mjs and is reported as its OWN boolean, because each is
// a separate runner with its own gates rather than a matrix entry.
import { SUITES, HARNESS_FILES, goldenPath, detectionInputs, EXTRA_RUNNERS } from "./suites.mjs";

const ALL = SUITES.map((s) => s.name);
const DETECTION_INPUTS = detectionInputs();
// Resolved once: `inputs` is a function on the declaration so the table can stay a
// plain literal, but the selector wants the paths.
const EXTRA = EXTRA_RUNNERS.map((r) => ({ key: r.key, name: r.decl.name, inputs: r.inputs() }));

/**
 * @param {string[]} changed  repo-relative changed paths
 * @returns {{ suites: string[], detection: boolean, memoryEfficacy: boolean, reason: string, matches: Record<string, string[]> }}
 *   `suites` in SUITES order (stable, so a matrix key is reproducible);
 *   `detection` / `memoryEfficacy` are the separate runners' own decisions — neither is
 *   a `suites` entry, so the workflow reads each as its own job condition;
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
  // Each extra runner is orthogonal to the matrix: a change to `finders.md` selects
  // bug-detection and no suite, and a suite rubric selects a suite and neither runner.
  // A harness change selects everything, on the same fail-open reasoning.
  const extra = {};
  for (const r of EXTRA) {
    extra[r.key] = changed.some((p) => r.inputs.includes(p) || HARNESS_FILES.includes(p));
  }
  const parts = [];
  if (harness) parts.push(`harness change (${harness}) → all ${ALL.length} suites`);
  else if (suites.length) parts.push(`${suites.length} of ${ALL.length} suites affected by ${Object.keys(matches).length} changed file(s)`);
  for (const r of EXTRA) if (extra[r.key]) parts.push(`+ ${r.name}`);
  const reason = parts.length
    ? parts.join(" ")
    : "no rubric, golden, or harness file changed → no suite affected";
  return { suites, ...extra, reason, matches };
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

  // The co-selection assertion above only proves something if a rubric file IS shared by
  // two suites. Two read `skills/workflow/fix-bug/SKILL.md` today, and a first-match-wins
  // bug would silently drop one of them — but if the table ever stops sharing a rubric,
  // that loop passes vacuously and nothing says so. Assert the premise, not just the claim.
  const sharedRubrics = [...new Set(SUITES.map((s) => s.rubric.file))]
    .filter((f) => SUITES.filter((s) => s.rubric.file === f).length > 1);
  t("at least one rubric file is shared by two suites", sharedRubrics.length > 0,
    "no shared rubric, so the co-selection check above proves nothing about multi-select"
    + " — either the table regressed, or delete this check if one-rubric-per-suite is now intended");

  for (const h of HARNESS_FILES) {
    const all = selectSuites([h]);
    t(`harness file ${h} selects every suite`, all.suites.length === ALL.length,
      `→ ${all.suites.length}/${ALL.length}`);
    for (const r of EXTRA) {
      t(`harness file ${h} also selects ${r.name}`, all[r.key] === true);
    }
  }

  // Each extra runner: every declared input selects it, and — the half that matters —
  // selects it WITHOUT dragging in the nine suites or the OTHER runner, which is the
  // whole point of keeping them out of the matrix. Derived from the table, so adding a
  // runner extends this coverage instead of aging it.
  t("the extra-runner table is non-empty", EXTRA.length > 0);
  for (const r of EXTRA) {
    t(`${r.name} declares at least one input`, r.inputs.length > 0);
    for (const p of r.inputs) {
      const d = selectSuites([p]);
      t(`${r.name} input ${p} selects it`, d[r.key] === true);
      t(`${r.name} input ${p} selects no classification suite`, d.suites.length === 0,
        `→ [${d.suites}]`);
      for (const other of EXTRA) {
        if (other.key === r.key) continue;
        t(`${r.name} input ${p} does not select ${other.name}`, d[other.key] === false);
      }
    }
  }
  // And the inverse: a suite's own rubric must not select either runner, or the
  // "derived" claim would be cover for running them on everything.
  const rubricOnly = selectSuites([SUITES[0].rubric.file]);
  t("a suite rubric does not select bug-detection", rubricOnly.detection === false);
  for (const r of EXTRA) {
    t(`a suite rubric does not select ${r.name}`, rubricOnly[r.key] === false);
  }

  // An unrelated path selects nothing (the narrowing half — without it a selector
  // that returned ALL for everything would pass every assertion above).
  const none = selectSuites(["README.md", "packages/vscode-agent-tasks/src/extension.ts"]);
  t("an unrelated path selects no suite", none.suites.length === 0, `→ [${none.suites}]`);
  t("an unrelated path selects no detection run", none.detection === false);
  for (const r of EXTRA) {
    t(`an unrelated path selects no ${r.name} run`, none[r.key] === false);
  }

  // A near-miss must NOT match: matching is exact, not prefix/substring, so a
  // sibling file in a rubric's directory cannot drag its suite in.
  const near = selectSuites([`${SUITES[0].rubric.file}.bak`, "scripts/eval/golden/"]);
  t("a near-miss path selects no suite", near.suites.length === 0, `→ [${near.suites}]`);

  // An EMPTY change set selects nothing, and must never be read as "all". This is the
  // cheapest catastrophic bug available here: stdin arriving empty (a piped command that
  // produced no output) would put every PR back on the full nine-suite bill, and the
  // reason would be invisible because the run looks exactly like a legitimate full run.
  const empty = selectSuites([]);
  t("an empty change set selects no suite", empty.suites.length === 0, `→ [${empty.suites}]`);
  t("an empty change set selects no detection run", empty.detection === false);
  for (const r of EXTRA) {
    t(`an empty change set selects no ${r.name} run`, empty[r.key] === false);
  }

  // The union is deduplicated: the same path twice, and two paths hitting one suite, must
  // not emit a suite name twice — the matrix key has to stay unique.
  const dup = selectSuites([goldenPath(SUITES[0]), goldenPath(SUITES[1]), goldenPath(SUITES[0])]);
  t("a repeated path selects each suite once",
    dup.suites.length === new Set(dup.suites).size && dup.suites.length === 2,
    `→ [${dup.suites}]`);

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
  result = {
    suites: [...ALL],
    ...Object.fromEntries(EXTRA.map((r) => [r.key, true])),
    reason: `--all → every suite (${ALL.length}) + ${EXTRA.map((r) => r.name).join(" + ")}`,
    matches: {},
  };
} else {
  const changed = positional.length
    ? positional
    : (await readStdin()).split("\n").map((l) => l.trim()).filter(Boolean);
  result = selectSuites(changed);
}

if (asJson) {
  // One line, machine-read by the workflow: `suites` feeds the matrix, `count`
  // gates whether the matrix job runs at all (an empty matrix is an error in GHA).
  console.log(JSON.stringify({
    suites: result.suites, count: result.suites.length,
    detection: result.detection === true,
    memoryEfficacy: result.memoryEfficacy === true,
    reason: result.reason,
  }));
} else {
  console.log(result.reason);
  for (const [path, names] of Object.entries(result.matches)) console.log(`  ${path} → ${names.join(", ")}`);
  for (const n of result.suites) console.log(n);
  for (const r of EXTRA) if (result[r.key]) console.log(`${r.name} (separate runner)`);
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
