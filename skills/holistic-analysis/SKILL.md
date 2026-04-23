---
name: holistic-analysis
description: >
  Force a full holistic re-analysis when a fix or refactor isn't working. Instead
  of continuing to patch in isolation, this skill triggers a structured step-back
  analysis that traces the entire execution path end-to-end — from entry point to
  exit — analyzing each block, every contract boundary, and the full data flow.
  Two modes: "fix" (default) for bugs and broken behavior, "refactor" for
  restructuring/improvement. Use when the user says "step back", "think holistically",
  "analyze the whole thing", "zoom out", "look at the bigger picture", "rethink this",
  or when an attempt has failed and the user wants a fresh, thorough analysis.
  Also triggers on "/holistic", "/step-back", "/rethink", "/zoom-out".
---

# Holistic Analysis

When this skill activates, STOP all incremental patching. Do not attempt another
narrow change. Instead, execute the full analysis protocol below before writing any
code.

## Mode Detection

Check `$ARGUMENTS` for mode:

| Mode       | Default | Use case |
|------------|---------|----------|
| `fix`      | **yes** | Bug, broken behavior, failing test — something is wrong and needs root cause analysis |
| `refactor` |         | Restructuring, cleanup, improvement — the code works but needs to be better |

The mode determines how certain phases are framed (noted inline below).

## Context Gathering

Before analyzing, gather all relevant context:

1. **The full function/component** — not just the lines around the bug
2. **All callers** — grep for every call site; understand how the function is used
3. **All dependencies** — read every function, type, and module this code imports or calls
4. **Tests** — read existing tests to understand intended behavior and edge cases
5. **Recent changes** — run `git log -10 --oneline -- <file>` and `git diff HEAD~5 -- <file>` to see what changed recently
6. **Related files** — if this is a component, read the parent; if a utility, read its consumers
7. **Find the entry point** — Where does this execution path begin? For an API endpoint, this is the route handler or middleware entry. For a UI flow, this is the user action or event trigger. For a background job, this is the scheduler or queue consumer. Walk **upstream** from the user's focus point until you reach the boundary of the system.
8. **Find the exit point** — Where does this execution path end? The HTTP response, the database commit, the rendered output, the emitted event. Walk **downstream** from the user's focus point until you reach the boundary.
9. **Map the full chain** — Read every file, function, and middleware between entry and exit. Build an ordered list of every step in the execution path. Use Explore agents in parallel to trace imports and call sites if the chain spans many files.
10. **Read every step in full** — Do not skim. Read each function body completely. Bugs hide in the parts you'd normally skip.
11. **Identify all side effects** — Database writes, cache mutations, event emissions, external API calls, logging, metrics — anything that modifies state outside the current function scope.

Do NOT skip any of these. The point is to build a complete mental model before reasoning.

---

## Phase 1: Full Execution Path Walkthrough

After gathering context, walk through the execution path **sequentially from entry to exit**.

### Step 1a: Draw the Execution Map

Create a numbered list of every step in the execution path:

```
## Execution Path: [name of the flow, e.g., "POST /api/v1/ingest"]

1. [file:line] Route registration / middleware entry
2. [file:line] Authentication middleware
3. [file:line] Request validation
4. [file:line] Business logic - step A
5. [file:line] Business logic - step B
6. [file:line] Database interaction
7. [file:line] Response construction
8. [file:line] Error handler / response send
```

### Step 1b: Analyze Each Block

For **each step** in the execution map, answer:

| Question | Answer |
|----------|--------|
| **What does this block expect?** | Input shape, preconditions, assumptions about prior state |
| **What does this block guarantee?** | Output shape, postconditions, side effects |
| **Does the previous block's guarantee match this block's expectation?** | YES / NO / PARTIALLY — explain any gaps |
| **Are there implicit assumptions?** | Types that aren't validated, null checks that are missing, ordering that isn't enforced |
| **What happens on the unhappy path?** | Error handling, edge cases, timeouts, empty inputs |
| **Is there a "hole in the cheese" here?** | A subtle issue that only matters in combination with other blocks |

### Step 1c: Contract Boundary Analysis

After analyzing each block individually, check every **boundary between blocks**:

1. **Type contracts** — Does block N's return type match block N+1's parameter type? Not just structurally — semantically. (e.g., a `string` that's supposed to be a UUID but nothing validates that)
2. **Null/undefined propagation** — Can block N return null/undefined where block N+1 doesn't handle it?
3. **Error contract mismatches** — Does block N throw/reject in ways block N+1 doesn't catch? Are error types preserved or lost?
4. **State assumptions** — Does block N+1 assume block N modified some shared state (DB, cache, context) that block N might skip under certain conditions?
5. **Concurrency gaps** — Between block N and N+1, can another process/request modify the state they share?
6. **Timing and ordering** — async operations, event ordering, lifecycle methods — is the sequence guaranteed?

### Step 1d: Synthesize Findings

Produce a **Walkthrough Summary** before continuing:

```
## Execution Path Summary

### Health
- Total blocks analyzed: X
- Blocks with no issues: X
- Blocks with potential issues: X
- Contract boundary mismatches found: X

### Issues Found (ordered by severity)

#### Critical
- [block N → block N+1]: Description of the issue

#### Warning
- [block N]: Description of the concern

#### Info
- [block N]: Observation worth noting

### The Full Picture
[2-3 paragraphs explaining what the end-to-end analysis reveals that isolated
analysis would miss. Connect the dots across the entire chain.]
```

---

## Phase 2: Step Back — Identify the Principle

> Based on step-back prompting research (Zheng et al., 2023 — up to 36% improvement over chain-of-thought).

Answer these questions explicitly in your thinking:

- **What general principle or domain concept governs this code?** (e.g., "this is a state machine", "this follows the observer pattern", "this implements eventual consistency")
- **What are the fundamental rules and invariants that must hold?**
- **What is the business intent?** Not what the code does — what should it accomplish for the user/system?

---

## Phase 3: Scene Set — Explain the Situation to the Duck

> Based on rubber duck debugging protocol — forces externalization of hidden assumptions.

Before any analysis, state clearly:

### Fix mode:
1. **Expected behavior**: What should happen, with specific inputs/scenarios?
2. **Actual behavior**: What is happening instead? Include error messages, wrong outputs, or symptoms.
3. **The gap**: Where exactly does expected diverge from actual?
4. **Prior attempts**: What fixes were already tried and why did they fail?

### Refactor mode:
1. **Current state**: What does the code look like now? What's wrong with the structure?
2. **Desired state**: What should it look like after? What quality attributes are we optimizing for? (readability, performance, extensibility, testability, etc.)
3. **The gap**: What specifically makes the current structure inadequate?
4. **Prior attempts**: What refactor approaches were already tried and why didn't they work?

Write this out explicitly. Do not skip to hypotheses.

---

## Phase 4: Structured Hypothesis Generation

> Based on structured RCA frameworks and the 5 Whys technique.

### Fix mode — Root Cause Hunt

Generate **at least 3 distinct hypotheses** for the root cause:

| # | Hypothesis | Supporting Evidence | Contradicting Evidence | Confidence |
|---|-----------|-------------------|----------------------|------------|
| 1 | ... | ... | ... | low/med/high |
| 2 | ... | ... | ... | low/med/high |
| 3 | ... | ... | ... | low/med/high |

Then ask:
- **What changed?** Check git history — did a recent commit introduce this?
- **What's the simplest explanation?** Prefer Occam's razor.
- **Am I treating a symptom or the disease?** Trace the causal chain deeper.

### Refactor mode — Approach Exploration

Generate **at least 3 distinct refactoring approaches**:

| # | Approach | Pros | Cons | Risk level |
|---|---------|------|------|------------|
| 1 | ... | ... | ... | low/med/high |
| 2 | ... | ... | ... | low/med/high |
| 3 | ... | ... | ... | low/med/high |

Then ask:
- **Who are the consumers?** Will this refactor require changes in callers?
- **What's the migration path?** Can this be done incrementally or is it all-or-nothing?
- **Am I restructuring for a real problem or aesthetics?** What concrete benefit does each approach deliver?

---

## Phase 5: Meta-Cognitive Check — Challenge Your Own Reasoning

> Based on metacognitive prompting research (Wang & Zhao, 2023 — up to 26.9% improvement).

Answer honestly:

1. **What assumptions am I making?** List every assumption, especially ones that feel "obvious."
2. **If my leading hypothesis turned out to be wrong, why might that be?** Force yourself to argue against it.
3. **What contradictory evidence have I dismissed or not looked for?**
4. **What alternative explanations have I not considered?**
5. **Am I anchored on my first idea?** If the first hypothesis still leads, deliberately spend time on hypothesis #2 and #3.

---

## Phase 6: Confidence Gate — Analysis Validation

Run the appropriate `/confidence` mode based on the analysis type:

### Fix mode → `/confidence bug-analysis`

Scores:
- **Evidence strength** (40%) — Is the analysis backed by concrete evidence?
- **Root cause certainty** (30%) — Is this the root cause or just a symptom?
- **Fix confidence** (30%) — Will the proposed fix resolve the issue?

### Refactor mode → `/confidence plan`

Scores:
- **Completeness** (40%) — Are all affected areas identified? Is the scope fully understood?
- **Feasibility** (30%) — Is the approach sound and consistent with the codebase?
- **No ambiguity** (30%) — Are the refactoring steps specific enough to execute without interpretation?

**Thresholds (both modes):**
- **90%+**: Proceed to Phase 7 (planning).
- **70-89%**: Address the specific concerns the confidence assessment raises before proceeding. Re-run the confidence check after.
- **Below 70%**: Do NOT proceed. Return to Phase 4 with new hypotheses/approaches informed by what the assessment flagged. Up to 2 iterations to raise the score before escalating to the user.

---

## Phase 7: Plan the Change — Words Before Code

> No code until this phase is complete.

1. **Describe the change in plain language.** What will change and why?
2. **Impact analysis**: What other code paths, components, or tests will this affect?
3. **What could go wrong?** Pre-mortem: if this change introduced a new bug or regression, what would it be?
4. **Is this the minimal change?** Or am I over-engineering? (Fix mode: address the root cause and nothing else. Refactor mode: address the structural problem without scope creep.)
5. **How will I verify it works?** What test, command, or check confirms success?
6. **Refactor mode only — Migration steps**: If the change affects callers or consumers, list the ordered steps to migrate without breaking anything.

---

## Phase 8: Implement and Verify

Only now write code. After implementing:

1. Run the relevant tests
2. Manually trace through the fix to confirm it addresses the root cause from Phase 4
3. Check that no new issues were introduced (run the broader test suite if available)
4. Run `/confidence code` to validate the implementation:
   - **90%+**: The fix is ready. Present the summary.
   - **70-89%**: Address the flagged concerns. If in doubt, run `/confidence code fix` to auto-fix mechanical issues and re-assess.
   - **Below 70%**: The fix is insufficient. Do NOT patch further — return to Phase 4 with the new information from the confidence assessment.

---

## Output Format

Present the analysis using this structure:

```
## Holistic Analysis

### Context Gathered
[List files read and key findings from each]

### Execution Path Walkthrough
[Full execution map from Phase 1]
[Per-block analysis table]
[Contract boundary findings]
[Walkthrough Summary with severity-ordered issues]

### Step Back: The Principle
[What general concept governs this code and what invariants must hold]

### The Situation (Scene Set)
[Fix mode: Expected / Actual / Gap / Prior attempts]
[Refactor mode: Current state / Desired state / Gap / Prior attempts]

### Hypotheses / Approaches
[Fix mode: Root cause hypothesis table from Phase 4]
[Refactor mode: Approach comparison table from Phase 4]

### Meta-Cognitive Check
[Key assumptions challenged, strongest counter-argument]

### Root Cause / Chosen Approach
[Fix mode: The identified root cause]
[Refactor mode: The selected approach and rationale]

### Analysis Confidence
[Fix mode: /confidence bug-analysis score and breakdown]
[Refactor mode: /confidence plan score and breakdown]

### Change Plan
[Plain-language description, impact analysis, verification plan]

### Implementation Confidence (/confidence code)
[Score and dimension breakdown from Phase 8]
```

---

## Anti-Patterns — What NOT to Do

- Do NOT skip context gathering and jump to hypotheses
- Do NOT generate only one hypothesis
- Do NOT write code before completing Phase 7
- Do NOT ignore contradicting evidence for a favored hypothesis
- Do NOT treat this as a formality — if the analysis reveals a different root cause than expected, follow the evidence
- Do NOT apply this skill to trivial one-line fixes — it is for when isolated fixes have failed
- Do NOT analyze only the isolated failure point — always trace the full execution path from entry to exit
