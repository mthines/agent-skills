// L2 suite table — the single origin of which rubric each behavioral suite reads and
// which golden set labels it.
//
// This lives in its own module because it has TWO consumers that must never disagree:
// `l2.mjs` runs the suites, and `select-suites.mjs` maps a PR's changed files back to the
// suites those files can affect, so CI runs only those. The second consumer is why a
// regex parse of `l2.mjs` was not good enough — a mapping derived by re-parsing the table
// is a drift surface, and this repo has already paid for one (`l1.mjs`'s `,?` trailing-comma
// exemption, invisible until a mutation added a comma). Both consumers now import the same
// array, so "the table says X but the selector thinks Y" is unrepresentable.
//
// `l1.mjs`'s G21 guards parse THIS file for the same reason: they assert against the file
// that owns the table.
//
// Add a suite: append a config object here, drop its golden JSONL in `golden/`, and add
// the rubric's file to `.github/workflows/evals-l2.yml`'s `paths:`.
// `rubric.section` (or `rubric.sections`, for a decision split across sibling subsections)
// is read LIVE from the skill source, so the eval always tests the shipped instructions —
// not a copy. Point it at the prose that OWNS the decision the goldens label: a rubric
// broader than the question invites the model to apply a filter the labels never
// accounted for.
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
    // 14 cases, 8 `surface` / 6 `skip` — a 57.1% majority-class baseline, asserted by L1 `G21h`
    // against the floor grepped out of evals-l2.yml. The split IS the measurement: at the seed
    // set's 4/1 an always-`surface` responder scored 80% and cleared the 70% floor, so a green
    // said only that the model had stopped answering `skip`.
    //
    // The six `skip` decoys are one per FILTER DIMENSION of the read under test, derived from
    // the rubric rather than invented, so none is answerable without reading it: tag
    // (`codebase-knowledge` — this agent's own bucket, but read at Step 1.2a and by neither path
    // in scope), scope (a `branch::` scope, and a different repo's `repo::` carrying a
    // deliberately on-topic gist), expiry, and source attribution (`source.agent: 'aw-executor'`).
    // `global` and `source.explicit: true` are their positive counterparts, so scope and
    // attribution are tested in both directions instead of only as rejections.
    //
    // The two originals this suite kept missing were NOT edited. They have explicitly-scoped
    // superseding twins (`…-scoped`) that state the scope and source fields the originals leave
    // silent, and the originals stay runnable as regression guards — per eval-iterate's
    // no-overwrite-in-place rule.
    //
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
    // The instruction asks a PROCEDURE-APPLICATION question, not a relevance question.
    // The prior wording — "would be surfaced by the documented read FOR THE GIVEN PR DIFF" —
    // put the diff in the framing of the question itself, which reads as an invitation to judge
    // whether the record is relevant to the change. Two of the five seed cases turn on exactly
    // that distinction (a list-reachable lesson whose gist has no overlap with the diff, and one
    // below the promotion threshold), and both were answered `skip` with the reason the model
    // could not state — including on a run where the rubric already said in as many words that
    // narrowing this read by apparent relevance is a defect. The diff is still in the input, so
    // the one sentence explaining WHY it is there is scoped to Step 1.2c, the only path that
    // builds a query from it; whether Step 1.0 also keys on it is left to the rubric to state,
    // because supplying that answer here is what would turn the instruction into an answer key.
    //
    // The verb is SURFACES, not "returns", and the difference is load-bearing for one whole
    // dimension. Step 1.0's source-attribution filter runs on what the four calls returned, so a
    // record another tool wrote IS returned by the call and then dropped — under "returns" the
    // two source-attribution cases are answerable both ways and grade nothing. "Surfaces" is
    // also the label vocabulary the suite already uses, so the question and the answers now
    // name the same thing.
    instruction: "You are pr-reviewer at Step 1. Using ONLY the memory-read procedure below (Step 1.0's mcp__lorekit__memory_list calls + Step 1.2c's mcp__lorekit__memory_search), decide whether that read surfaces the candidate record described to the finders. The PR diff is supplied as context because Step 1.2c builds its search query from it. Reply 'surface' if the read surfaces the record, or 'skip' if it does not.",
    inputKey: "input", inputLabel: "Candidate + diff",
    choices: ["surface", "skip"],
  },
];
