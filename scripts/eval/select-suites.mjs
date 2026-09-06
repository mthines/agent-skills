#!/usr/bin/env node
// Maps a set of changed files onto the L2 suites those files can affect, so a PR pays for the
// suites it touched instead of all nine.
//
//   node scripts/eval/select-suites.mjs <file> [<file> …]   # names on argv
//   git diff --name-only base...head | node scripts/eval/select-suites.mjs   # or on stdin
//   node scripts/eval/select-suites.mjs --self-test          # offline, executed by L1 G50
//
// Prints the selected suite names comma-separated on ONE line (the `--suite a,b,c` form
// `l2.mjs` accepts), or nothing at all when no changed file can affect any suite.
//
// Why this exists: a full nine-suite run is ~273k input tokens for 149 one-word answers, and
// `evals-l2.yml`'s `pull_request` trigger ran all nine on ANY change under `golden/**` or any
// rubric path — so editing one golden file billed for the other eight suites' rubrics too.
//
// Why it imports `suites.mjs` rather than parsing `l2.mjs`: the mapping must agree with the
// table it maps, and a re-parse is a drift surface this repo has already paid for once.
import { readFileSync } from "node:fs";
import { SUITES } from "./suites.mjs";

// Files that change how EVERY suite behaves rather than what one of them reads. A change here
// selects all suites, and that is the deliberately conservative direction: the harness decides
// how every rubric is extracted, prompted, and graded, so a bug in it can move any suite's
// score. Under-selecting here is a silent loss of coverage — the failure mode this whole
// selector must not introduce — while over-selecting only costs tokens.
const HARNESS_FILES = [
  "scripts/eval/l2.mjs",
  "scripts/eval/lib.mjs",
  "scripts/eval/suites.mjs",
  "scripts/eval/select-suites.mjs",
  ".github/workflows/evals-l2.yml",
];

/**
 * @param {string[]} changed Repo-relative paths (as `git diff --name-only` prints them).
 * @returns {string[]} Suite names, in `SUITES` order, that the changed files can affect.
 */
export function selectSuites(changed) {
  const files = changed.map((f) => f.trim()).filter(Boolean);
  if (files.some((f) => HARNESS_FILES.includes(f))) return SUITES.map((s) => s.name);

  const picked = [];
  for (const suite of SUITES) {
    // Two inputs decide a suite's result and nothing else does: the rubric file it reads live,
    // and the golden set that labels it. `golden` is stored relative to `scripts/eval`.
    const goldenPath = `scripts/eval/${suite.golden}`;
    if (files.includes(suite.rubric.file) || files.includes(goldenPath)) picked.push(suite.name);
  }
  return picked;
}

// ── self-test ───────────────────────────────────────────────────────────────────────────
// Executed by L1 (G50) so the selection is regression-tested without spending an API call.
// Every expectation is DERIVED from the imported table, never hardcoded, so adding a suite
// does not require editing this block — and a hardcoded name here would be exactly the
// second copy of the table this module exists to avoid.
function selfTest() {
  const fails = [];
  const eq = (label, got, want) => {
    const g = [...got].sort().join(","), w = [...want].sort().join(",");
    if (g !== w) fails.push(`${label}\n    got:  ${g || "(none)"}\n    want: ${w || "(none)"}`);
  };
  const all = SUITES.map((s) => s.name);

  // 1. A suite's own golden file selects exactly that suite.
  for (const s of SUITES) {
    eq(`golden of ${s.name} selects only it`, selectSuites([`scripts/eval/${s.golden}`]), [s.name]);
  }

  // 2. A rubric file selects EVERY suite reading it — not just the first. Two suites share
  //    `skills/workflow/fix-bug/SKILL.md`, so a first-match-wins bug would silently drop one.
  for (const s of SUITES) {
    const sharers = SUITES.filter((x) => x.rubric.file === s.rubric.file).map((x) => x.name);
    eq(`rubric ${s.rubric.file} selects all ${sharers.length} suite(s) reading it`,
      selectSuites([s.rubric.file]), sharers);
  }
  // 2b. That shared-rubric case must actually exist, or check 2 proves nothing about it.
  const shared = [...new Set(SUITES.map((s) => s.rubric.file))]
    .filter((f) => SUITES.filter((s) => s.rubric.file === f).length > 1);
  if (shared.length === 0) {
    fails.push("no rubric file is shared by two suites, so the multi-select case above is vacuous"
      + " — check the table, or delete check 2b if a one-suite-per-rubric table is now intended");
  }

  // 3. Every harness file selects all suites.
  for (const f of HARNESS_FILES) eq(`harness file ${f} selects every suite`, selectSuites([f]), all);

  // 4. An unrelated file selects nothing. This is the half that makes the selector worth
  //    having; if it over-selected here, CI would be paying the old price with extra steps.
  eq("unrelated file selects nothing", selectSuites(["README.md", "skills/design/ux/SKILL.md"]), []);

  // 5. A directory PREFIX of a real input is not a match — the check is whole-path equality,
  //    so `scripts/eval/golden` (no trailing file) must not select the whole world.
  eq("bare golden directory selects nothing", selectSuites(["scripts/eval/golden"]), []);

  // 6. Union, deduplicated, in table order.
  const [a, b] = SUITES;
  eq("two goldens select both, once each",
    selectSuites([`scripts/eval/${a.golden}`, `scripts/eval/${b.golden}`, `scripts/eval/${a.golden}`]),
    [a.name, b.name]);

  // 7. Empty input selects nothing — and must never be read as "all".
  eq("empty change set selects nothing", selectSuites([]), []);

  if (fails.length > 0) {
    console.error(`✗ select-suites self-test: ${fails.length} failure(s)`);
    for (const f of fails) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`✓ select-suites self-test passed (${SUITES.length} suites)`);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // stdin is read only when no paths were passed, so a piped-but-empty stdin cannot quietly
  // widen an explicit argv selection.
  let files = argv;
  if (files.length === 0) {
    let stdin = "";
    try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; }
    files = stdin.split("\n");
  }
  const picked = selectSuites(files);
  if (picked.length > 0) process.stdout.write(`${picked.join(",")}\n`);
}
