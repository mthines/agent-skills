// The L2 suite table — the ONE home of "which behavioral evals exist and what
// each one reads". Lifted out of l2.mjs so three consumers share one definition
// instead of mirroring it:
//
//   1. l2.mjs            — runs the suites.
//   2. select-suites.mjs — maps a changed-file list to the affected suites, so CI
//                          runs a subset instead of all of them.
//   3. l1.mjs (G21)      — asserts the table's contracts, against the file that
//                          OWNS the table rather than a re-parse of the runner.
//
// The second consumer is why a regex parse of `l2.mjs` was not good enough: a
// mapping derived by re-parsing the table is a drift surface, and this repo has
// paid for that twice. Once in `l1.mjs`'s `,?` trailing-comma exemption, invisible
// until a mutation added a comma; and once in the workflow's hand-written `paths:`
// mirror of these rubric files, which had gone stale on four of nine (two listed
// paths backed no suite at all). Selection is now DERIVED from this array, so "the
// table says X but the selector thinks Y" is unrepresentable — the same reason
// `READ_TOOLS` is held to the tool catalog by assertion rather than restated.
//
// Add a suite: drop a golden JSONL in golden/ and append a config object here.
// Nothing else — the workflow has no rubric-path list to update.
//
// `rubric.section` (or `rubric.sections`, for a decision split across sibling
// subsections) is read LIVE from the skill source, so the eval always tests the
// shipped instructions — not a copy. Point it at the prose that OWNS the decision
// the goldens label: a rubric broader than the question invites the model to apply
// a filter the labels never accounted for.
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
    // The question is deliberately scoped to what the two READS RETURN, and says so twice.
    // It previously asked whether the read surfaces the record "to the finders" — which the
    // rubric itself answers the other way: §1.0 uses that exact phrase for a record dropped
    // by attribution ("such a record does not reach the finders"), and states that Step 1.2d
    // shortlists the merged index by changed path before the finders see anything. So for a
    // diff-unrelated lesson "skip" was the CORRECT answer to the question asked, while the
    // labels encode list-reachability — the prompt and the ground truth disagreed. Naming the
    // downstream step and excluding it is the boundary this question needs; it is not a hint.
    // Do NOT add a summary of which filters apply — the model extracting those from the rubric
    // is the thing being measured, and restating them here would grade the prompt, not the read.
    instruction: "You are pr-reviewer at Step 1. Using ONLY the memory-read procedure below (Step 1.0's mcp__lorekit__memory_list calls + Step 1.2c's mcp__lorekit__memory_search), decide whether that read RETURNS the candidate record — that is, whether the record is among what those calls load. Do NOT consider whether it would later survive Step 1.2d's diff-keyed shortlist, or whether its gist looks relevant to the diff: that is a separate, later step and is out of scope for this question. The PR diff is supplied only because Step 1.2c builds its search query from it. Reply 'surface' if the read returns the record, or 'skip' if it does not.",
    inputKey: "input", inputLabel: "Candidate + diff",
    choices: ["surface", "skip"],
  },
  {
    name: "observe-run-rung-selection",
    golden: "golden/observe-run-rung-selection.jsonl",
    // 28 cases, 15 `rung-1` / 13 `rung-2` — a 53.6% majority-class baseline. Real baseline, not a
    // bootstrap seed — see the sibling .NOTES.md. Fourteen of the twenty-eight are `decoy-` cases
    // whose SURFACE VOCABULARY points at the wrong rung (a rung-1 claim that names a
    // separately-deployed service but asserts only on the caller's own span; a rung-2 claim that
    // never says "cross-process"), because the original fourteen were balanced AND
    // keyword-separable — 78.6% off the word "process" alone. L1 G52e scores three declared tells
    // per suite in both polarities against the EVAL_GATE floor, so deleting the decoys reds L1.
    rubric: { file: "skills/quality/observe-run/rules/rungs.md", section: null }, // whole file
    instruction: "You are the observe-run skill choosing a rung for a claim. Using ONLY the rung rules below, pick the cheapest rung that can decide the claim — never escalate to rung 2 when rung 1 can already decide it.",
    inputKey: "input", inputLabel: "Claim",
    choices: ["rung-1", "rung-2"],
  },
  {
    name: "observe-run-assertion-provenance",
    golden: "golden/observe-run-assertion-provenance.jsonl",
    // 39 cases, 21 `behavioral` / 18 `by-construction` — a 53.8% majority-class baseline. Real
    // baseline, not a bootstrap seed — see the sibling .NOTES.md. Twenty-five of the thirty-nine are
    // `decoy-` cases whose SURFACE VERB points at the wrong label (a by-construction check fronted
    // by "run the suite, then grep the source"; a behavioral one fronted by "grep the exported
    // OTLP"; a behavioral one that names `startSpan`), because the original fourteen were balanced
    // AND keyword-separable — a responder keying on the run verb alone scored a perfect 14/14.
    // L1 G52e scores three declared tells per suite in both polarities against the EVAL_GATE
    // floor, so deleting the decoys reds L1.
    rubric: { file: "skills/quality/observe-run/rules/assertion-provenance.md", section: null }, // whole file
    instruction: "You are the observe-run skill's assertion-provenance check. Using ONLY the discriminator rule below, classify the claim-plus-assertion pair as 'behavioral' (verifiable only by observing a run) or 'by-construction' (satisfiable by reading source alone).",
    inputKey: "input", inputLabel: "Claim + assertion",
    choices: ["behavioral", "by-construction"],
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
