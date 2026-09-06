// The L2 suite table — the ONE home of "which behavioral evals exist and what
// each one reads". Lifted out of l2.mjs so three consumers share one definition
// instead of mirroring it:
//
//   1. l2.mjs            — runs the suites.
//   2. select-suites.mjs — maps a changed-file list to the affected suites, so CI
//                          runs a subset instead of all of them.
//   3. l1.mjs (G21)      — asserts the table's contracts.
//
// Every suite DECLARES its own inputs (`rubric.file`, `golden`), which is what
// makes selection derivable. The workflow used to carry a hand-written `paths:`
// mirror of these files; it drifted (four of nine rubric files were missing, two
// listed paths backed no suite), because a mirror of a data structure is a drift
// surface — the same reason `READ_TOOLS` is held to the tool catalog by assertion
// rather than restated by hand.
//
// Add a suite: drop a golden JSONL in golden/ and append a config object here.
// `rubric.section` is read LIVE from the skill source, so the eval always tests
// the shipped instructions — not a copy.
export const SUITES = [
  {
    name: "tier-routing",
    golden: "golden/tier-routing.jsonl",
    // The dispatcher (skills/workflow/autonomous-workflow/aw/SKILL.md) deliberately
    // does NOT restate the table — it links this section. Read the canonical home.
    rubric: { file: "skills/workflow/autonomous-workflow/SKILL.md", section: "### Step 1: Detect Workflow Mode (MANDATORY)" },
    instruction: "You are the autonomous-workflow dispatcher. Using ONLY the tier-detection rules below, classify the task into exactly one tier.",
    inputKey: "task", inputLabel: "Task",
    choices: ["Micro", "Lite", "Full"],
  },
  {
    name: "bug-class",
    golden: "golden/bug-class.jsonl",
    rubric: { file: "skills/workflow/fix-bug/SKILL.md", section: "### Step 0c — Infer bug class" },
    instruction: "You are /fix-bug at Phase 0c. Using ONLY the bug-class table below, infer the single best bugClass for the evidence.",
    inputKey: "input", inputLabel: "Evidence",
    choices: ["contract-mismatch", "null-deref", "off-by-one", "regression", "race", "perf", "config", "logic", "unknown"],
  },
  {
    name: "complexity-triage",
    golden: "golden/complexity-triage.jsonl",
    rubric: { file: "skills/workflow/fix-bug/SKILL.md", section: "## Phase 0.5 — Complexity Triage" },
    instruction: "You are /fix-bug at Phase 0.5. Using ONLY the triage rules below (conservative: pick complex when in doubt), classify the bug.",
    inputKey: "input", inputLabel: "Bug",
    choices: ["simple", "complex"],
  },
  {
    name: "aw-should-trigger",
    golden: "golden/aw-should-trigger.jsonl",
    rubric: { file: "skills/workflow/autonomous-workflow/templates/routing.rule.md", section: null }, // whole file
    instruction: "You apply the autonomous-workflow routing rule below. Decide whether it should auto-trigger on the user's message. Reply 'trigger' or 'skip'.",
    inputKey: "input", inputLabel: "User message",
    choices: ["trigger", "skip"],
  },
  {
    name: "optimize-approach-optimality",
    golden: "golden/optimize-approach-optimality.jsonl",
    rubric: { file: "skills/quality/optimize-approach/rules/optimality-rubric.md", section: null }, // whole rubric
    instruction: "You are the optimize-approach skill at Phase O2. Using ONLY the optimality rubric below, classify the described approach unit: 'suboptimal' only when a materially better approach exists AND no anti-overlap guard fires AND the materiality bar clears; otherwise 'optimal'.",
    inputKey: "input", inputLabel: "Approach unit",
    choices: ["optimal", "suboptimal"],
  },
  {
    name: "reviewer-agreement-bump",
    golden: "golden/reviewer-agreement-bump.jsonl",
    rubric: { file: "agents/shared/rules/rubric-composition.md", section: "## Cross-rubric agreement" },
    instruction: "You apply the Cross-rubric agreement rule from the reviewer pipeline. Given a scenario describing dedupe pass results, classify whether the surviving finding would be marked agreement-promoted.",
    inputKey: "input", inputLabel: "Scenario",
    choices: ["promoted", "not-promoted"],
  },
  {
    name: "severity-tiering",
    golden: "golden/severity-tiering.jsonl",
    rubric: { file: "skills/quality/severity/SKILL.md", section: "## Severity rubric" },
    instruction: "You are the severity skill. Using ONLY the rubric below, classify the finding into exactly one severity tier. Run the exclusion gate and the reachability cap before applying any path floor or escalator.",
    inputKey: "input", inputLabel: "Finding",
    choices: ["critical", "high", "medium", "low"],
  },
  {
    name: "shape-depth-routing",
    golden: "golden/shape-depth-routing.jsonl",
    // The routing table moved into its own rule file with the Phase C split, so the rubric reads
    // the file that OWNS the decision. Reading pr-reviewer.md § 1.2b instead would extract the
    // step that routes here and none of the rows the labels are derived from.
    rubric: { file: "agents/pr-reviewer/rules/depth-routing.md", section: null }, // whole file
    instruction: "You are pr-reviewer at Step 1.2b Phase C, after the delta, its shape classification, and the impact graph are computed. Using ONLY the depth-routing rules below, pick the tier. Apply the two pre-table rules first (the quick override, then the size exclusion), then the three-tier table first-match-wins top to bottom.",
    inputKey: "input", inputLabel: "Delta",
    choices: ["deep", "standard", "quick"],
  },
  {
    name: "code-review-retrieval-relevance",
    golden: "golden/code-review-retrieval-relevance.jsonl",
    rubric: { file: "agents/pr-reviewer.md", section: "## Step 1: Fetch all inputs + load memories" },
    instruction: "You are pr-reviewer at Step 1. Using ONLY the Step 1 memory-read procedure below (Step 1.0 mcp__lorekit__memory_list + Step 1.2c mcp__lorekit__memory_search), decide whether the described candidate memory would be surfaced by the documented read for the given PR diff. Reply 'surface' if the documented read would return it, or 'skip' if it would not.",
    inputKey: "input", inputLabel: "Candidate + diff",
    choices: ["surface", "skip"],
  },
];

/** Repo-relative path of a suite's golden file (the `golden` field is relative to scripts/eval/). */
export const goldenPath = (suite) => `scripts/eval/${suite.golden}`;

/**
 * Files that belong to the runner rather than to any one suite. A change to one of
 * these can alter EVERY suite's behaviour (the request shape, the rubric extraction,
 * the suite table itself), so it selects all of them. Fail-open by construction:
 * the widening direction costs tokens, the narrowing direction costs coverage.
 */
export const HARNESS_FILES = [
  "scripts/eval/l2.mjs",
  "scripts/eval/lib.mjs",
  "scripts/eval/suites.mjs",
  "scripts/eval/select-suites.mjs",
];
