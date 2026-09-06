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
    // Two subsections, NOT the whole of `## Step 1`. The instruction below names exactly the
    // Step 1.0 list + Step 1.2c search, and CLAUDE.md's charter for this suite says the same;
    // `## Step 1` is heading-level-aware and so captured all ten `### 1.x` subsections —
    // 67,630 chars of impact graph, depth routing and divergence pre-check against the 27,568
    // these two hold. Same lesson as shape-depth-routing above: feed the section that OWNS the
    // decision.
    //
    // What this deliberately EXCLUDES, and why re-adding it would be a regression: `### 1.2d`
    // shortlists the Step 1.0 index by changed directory / basename / symbol / integration /
    // INTENT_PHRASE before fetching bodies. That is a real diff filter, correctly placed — but
    // it answers a DIFFERENT question ("what reaches the finders") from the one these goldens
    // label ("what the documented read returns"). With 1.2d in the rubric, a list-reachable
    // lesson unrelated to the diff is legitimately `skip`, and the suite contradicted its own
    // instruction. Widen this back and the labels stop being derivable from what the model sees.
    rubric: {
      file: "agents/pr-reviewer.md",
      sections: [
        "### 1.0 Prior-comment awareness + relevance memory load (default ON)",
        "### 1.2c Diff-keyed lesson search (all modes)",
      ],
    },
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

/**
 * The bug-detection eval — `scripts/eval/l2-detection.mjs`, its own runner and NOT a
 * `SUITES` entry, because it is not a single-choice classification (see that file's
 * header). It nonetheless has the same CI problem every suite has: something must
 * decide when to spend model tokens on it, and a hand-written `paths:` filter in the
 * workflow is the drift surface this table exists to remove — the previous one had
 * gone stale on four of nine rubric files.
 *
 * So its inputs are DECLARED here, next to the suites, and `select-suites.mjs`
 * derives the decision. `rubrics` are the rule files the runner reads live as its
 * finder and verifier prompts; `golden` is the record set; `runner` is the runner
 * itself, since a change to the scoring can flip every record. A harness file
 * selects it too, for the same fail-open reason it selects every suite.
 */
export const DETECTION = {
  name: "bug-detection",
  runner: "scripts/eval/l2-detection.mjs",
  rubrics: [
    "agents/pr-reviewer/rules/finders.md",
    "agents/shared/rules/finding-verifier.md",
  ],
  golden: "scripts/eval/golden/bug-detection.jsonl",
};

/** Every path that should trigger a detection-eval run. */
export const detectionInputs = () => [
  DETECTION.runner,
  ...DETECTION.rubrics,
  DETECTION.golden,
];

// DELIBERATELY NOT a harness file: scripts/eval/telemetry.mjs. It is imported by
// l2.mjs, so the instinct is to list it — but the fail-open rationale above turns on
// a change being able to alter a suite's ANSWER, and telemetry cannot. It observes
// the run; it does not participate in the decision. Listing it would spend all nine
// suites' tokens on a change that cannot move a single label. What guards it instead
// is the free layer: its `--self-test` is executed by L1 `G21k` on every PR, which
// is strictly better coverage for an encoding contract than nine model-call suites
// that never look at a span. If telemetry ever gains a way to influence a result
// (a retry that re-asks, a sampling decision that skips a case), it belongs here.
