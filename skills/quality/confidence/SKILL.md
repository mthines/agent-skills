---
name: confidence
description: >
  Rates confidence that the current work fully solves the stated requirement.
  Supports plan validation, code review, and analysis (root-cause, refactor,
  diagnose) modes. Plan mode combines LLM judgment with deterministic rule
  checks (multi-signal gate); a failed rule caps the gate at 89% regardless
  of LLM score. Use before committing to autonomous execution, after
  implementation, or during investigation. Triggers on "confidence check",
  "validate plan", "rate confidence", "quality gate", "/confidence".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '2.2.0'
  workflow_type: advisory
  tags:
    - confidence
    - quality-gate
    - plan-validation
    - code-review
    - analysis
    - bug-analysis # deprecated alias for `analysis` — kept so tag-indexed routing still resolves
    - multi-signal
    - autonomous-workflow
---

# Confidence Assessment

Rate your confidence that the current work fully solves the stated requirement.

> **Multi-signal evaluation.** A single LLM-confidence number is unreliable as
> a stand-alone gate (token probability ≠ correctness). This skill combines
> the LLM's dimensional scoring with **deterministic rule checks** the agent
> must run alongside. The final score is gated on BOTH passing.

## Contents

- [Mode Detection](#mode-detection)
- [Assessment Dimensions](#assessment-dimensions)
  - [For `plan` mode](#for-plan-mode) — multi-signal: LLM scoring + rule checks (89% cap on failure)
  - [For `code` mode](#for-code-mode)
  - [For `analysis` mode](#for-analysis-mode)
- [Output Format](#output-format)
- [Score Thresholds](#score-thresholds)
- [Iteration Protocol (plan mode)](#iteration-protocol-plan-mode)
- [Auto-Fix (Fix Mode Only)](#auto-fix-fix-mode-only)

---

## Mode Detection

Check the arguments: `$ARGUMENTS`

| Argument         | Default | Validates                                                          | When to use                                                                  |
| ---------------- | ------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `plan`           |         | Implementation plan completeness                                   | After Phase 1 planning, before autonomous execution                          |
| `code`           | **yes** | Code implementation correctness                                    | After writing code, before PR                                                |
| `analysis`       |         | Analysis accuracy (root cause, refactor rationale, or skill gap)   | During investigation, before proposing a fix, refactor, or skill-source diff |
| `bug-analysis`   |         | **Deprecated alias for `analysis`** — behaves identically          | Backwards-compatible; emit a one-line deprecation note in the report header  |

If no argument is provided, default to `code`.

**Alias handling.** `bug-analysis` is accepted as a deprecated alias and resolves to `analysis` with identical dimensions, weights, thresholds, and Fix Mode behaviour. When invoked with the alias, prepend a single line to the report header: `> Note: \`bug-analysis\` is a deprecated alias for \`analysis\`. Update the caller when convenient.` The alias keeps in-flight workflows and existing transcripts working through the transition; remove it after callers have migrated.

If arguments contain **"fix"** (e.g., `code fix`, `plan fix`, `analysis fix`), run in **Fix Mode** — after the review, automatically apply fixes for any concerns found.

---

## Assessment Dimensions

### For `plan` mode

**Plan mode is multi-signal: LLM dimensional scoring + deterministic rule checks.** Both must pass for the gate to clear.

#### Step 1 — LLM dimensional scoring

| Dimension        | Weight | What to evaluate                                                                                                 |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| **Completeness** | 40%    | Are ALL Phase 0 requirements captured? Are the Core sections populated (and the Extended sections present where the task needs them)? Could a new session execute from this plan alone? Do NOT penalize an Extended section that is legitimately omitted because its `Include when` trigger does not apply. |
| **Feasibility**  | 30%    | Is the technical approach sound? Are patterns consistent with the codebase? Are risks identified where applicable?                |
| **No ambiguity** | 30%    | Are implementation steps specific enough to execute without interpretation? Are edge cases addressed where applicable?            |

#### Step 2 — Deterministic rule checks (run via Bash)

Every check below MUST pass for plan mode. A single failed rule caps the gate at **89% regardless of LLM score** — the agent must surface the failed rule and either fix the plan or escalate to the user.

| # | Rule check                                                | Verification                                                                                       |
| - | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1 | `plan.md` exists at the expected path                     | `test -f .agent/$(git branch --show-current)/plan.md`                                              |
| 2 | All Core sections present                                 | `grep -E '^## (TL;DR\|Requirements\|Decisions\|Acceptance Criteria\|Implementation Order\|File Changes\|Verification\|Progress Log)' plan.md \| wc -l` ≥ 8 — these are the always-on Core tier. Extended sections (Background, Technical Approach, Patterns, Edge Cases, API, Tests, Dependencies, Risks) are include-when-needed and are NOT counted here. |
| 3 | Acceptance Criteria section is non-empty                  | `awk '/^## Acceptance Criteria/,/^## /' plan.md \| grep -c '^- \|^[0-9]'` ≥ 1                       |
| 4 | Every file in `## File Changes` resolves OR is `create`   | For each modify/delete row, `git ls-files <path>` returns the path. Create rows skip this check.   |
| 5 | Every requirement is tagged `[user-stated]` or `[inferred]`| `awk '/^## Requirements/,/^## /' plan.md \| grep -c '\[user-stated\]\|\[inferred\]'` matches the requirement count |
| 6 | Every decision row has a Rationale column populated       | No empty cells in the Rationale column of the Decisions table                                      |
| 7 | All timestamps are ISO 8601 with time component           | `grep -oE '\[20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\]' plan.md` matches every Progress Log entry |
| 8 | Verification commands are non-template                    | "After editing" and "Before PR" lines do not contain `{` or `}` placeholder braces                 |

Run each check, list pass/fail in the output table. **A failing rule is a blocker the gate must surface even if the LLM dimensional score is high.**

#### Step 3 — Combined gate

```
overall_score = min(weighted_LLM_score, max_allowed_by_rule_checks)
where max_allowed_by_rule_checks = 100% if all rules pass, else 89%
```

The intent: a plan that scores 95% on LLM judgment but fails rule check #4 (references a file path that doesn't exist) is capped at 89% — and the gate fails. This catches the failure mode where the model is confident but the plan is grounded in hallucinated paths.

### For `code` mode

| Dimension          | Weight | What to evaluate                                              |
| ------------------ | ------ | ------------------------------------------------------------- |
| **Correctness**    | 40%    | Does the logic actually address the problem as described?     |
| **Completeness**   | 30%    | Are all cases, edge cases, and requirements covered?          |
| **No regressions** | 30%    | Could this break existing behavior or introduce side effects? |

### For `analysis` mode

Use this mode whenever the artifact being graded is **an analysis** — a root-cause write-up, a refactor rationale, a `/create-skill diagnose` proposal, a holistic re-analysis after a stuck loop, or any other reasoning artifact that precedes a proposed change.

| Dimension                | Weight | What to evaluate                                                                                                            |
| ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Evidence strength**    | 40%    | Is the analysis backed by concrete evidence (logs, traces, code paths, file:line references, reproduced behaviour)?         |
| **Root cause certainty** | 30%    | Is this the underlying cause or just a symptom? How deep did the investigation go? For refactor / diagnose analyses, read "root cause" as "the actual structural reason," not literal bug aetiology. |
| **Outcome confidence**   | 30%    | Will the proposed action (fix, refactor, skill-source diff) resolve the situation without introducing new problems?         |

---

## Output Format

**You MUST output in this exact format:**

```
## Confidence: X%

### LLM dimensional scoring

| Dimension | Score | Notes |
|-----------|-------|-------|
| <dim 1>   | X%    | ...   |
| <dim 2>   | X%    | ...   |
| <dim 3>   | X%    | ...   |

### Deterministic rule checks (plan mode only — omit for code/analysis)

| # | Rule                | Status      | Evidence                  |
|---|---------------------|-------------|---------------------------|
| 1 | <rule description>  | ✓ pass / ✗ fail | <command output snippet> |
| ... |                   |             |                           |

### Combined gate

- Weighted LLM score: X%
- Rule checks: <N pass> / <total> (cap: 100% if all pass, else 89%)
- **Final: X%**
```

Calculate the weighted LLM score as a weighted average using the dimension weights above. For `plan` mode, the **Final** is `min(weighted_LLM_score, rule_check_cap)`. For `code` and `analysis` modes (including invocations via the deprecated `bug-analysis` alias), omit the rule-check section and `Final = weighted_LLM_score`.

**Be honest and critical — do not inflate scores. A low score with clear reasoning is more valuable than a false 95%. A failed rule check is non-negotiable — surface it even if the LLM score is high.**

---

## Score Thresholds

| Score         | Action                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| **90-100%**   | Proceed — work is ready                                                                     |
| **70-89%**    | List specific concerns and what would raise confidence. If in Fix Mode, apply fixes.        |
| **Below 70%** | Recommend concrete next steps to validate or fix. Do NOT proceed with autonomous execution. |

---

## Iteration Protocol (plan mode)

When used as a quality gate before autonomous execution:

> If confidence is below 90%, do up to **2 iterations** of additional research, analysis, and evidence collection to raise the score.
> After each iteration, re-run the confidence assessment.
> If still below 90% after 2 iterations, present findings to the user and ask whether to proceed or refine further.

---

## Auto-Fix (Fix Mode Only)

**Skip this section entirely if not in Fix Mode.**

When running in Fix Mode (`plan fix`, `code fix`, `analysis fix` — or the deprecated `bug-analysis fix` alias), automatically address every concern that lowered your score:

### Simple Fixes (apply immediately)

Fix these without asking — they are low-risk and mechanical:

- Missing edge case handling with obvious implementation
- Missing null/undefined checks
- Off-by-one errors or incorrect boundary conditions
- Typos in strings, comments, or variable names
- Missing return types or type annotations where the type is clear
- Small logic errors with an unambiguous correction
- (plan mode) Missing sections, incomplete requirements, vague implementation steps

After applying each fix, briefly note what was changed (one line per fix).

### Complex Fixes (plan, then apply)

For issues requiring more thought:

- Missing test coverage for uncovered paths
- Incomplete implementations (missing cases, unhandled states)
- Architectural concerns or incorrect abstractions
- (plan mode) Fundamental approach issues, missing technical design

For each, output:

```
### [Issue title]
**Why:** [1-sentence explanation]
**Fix plan:**
1. [Step 1]
2. [Step 2]
**Files involved:** [list]
```

Then execute the plan.

### Post-Fix Re-Assessment

After all fixes are applied:

1. Re-run the confidence assessment with updated scores
2. List what was fixed and how each fix improved the score
3. If confidence is still below 90%, list remaining concerns that could not be auto-fixed
