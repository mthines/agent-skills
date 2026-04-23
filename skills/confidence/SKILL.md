---
name: confidence
description: >
  Rate confidence that the current work fully solves the stated requirement.
  Supports plan validation, code review, and bug analysis modes.
  Use before committing to autonomous execution, after implementation, or during investigation.
  Triggers on confidence check, validate plan, rate confidence, or quality gate.
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
---

# Confidence Assessment

Rate your confidence that the current work fully solves the stated requirement.

---

## Mode Detection

Check the arguments: `$ARGUMENTS`

| Argument       | Default | Validates                        | When to use                                         |
| -------------- | ------- | -------------------------------- | --------------------------------------------------- |
| `plan`         |         | Implementation plan completeness | After Phase 1 planning, before autonomous execution |
| `code`         | **yes** | Code implementation correctness  | After writing code, before PR                       |
| `bug-analysis` |         | Root cause analysis accuracy     | During investigation, before proposing fix          |

If no argument is provided, default to `code`.

If arguments contain **"fix"** (e.g., `code fix`, `plan fix`), run in **Fix Mode** — after the review, automatically apply fixes for any concerns found.

---

## Assessment Dimensions

### For `plan` mode

| Dimension        | Weight | What to evaluate                                                                                                 |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| **Completeness** | 40%    | Are ALL Phase 0 requirements captured? All sections populated? Could a new session execute from this plan alone? |
| **Feasibility**  | 30%    | Is the technical approach sound? Are patterns consistent with the codebase? Are risks identified?                |
| **No ambiguity** | 30%    | Are implementation steps specific enough to execute without interpretation? Are edge cases addressed?            |

### For `code` mode

| Dimension          | Weight | What to evaluate                                              |
| ------------------ | ------ | ------------------------------------------------------------- |
| **Correctness**    | 40%    | Does the logic actually address the problem as described?     |
| **Completeness**   | 30%    | Are all cases, edge cases, and requirements covered?          |
| **No regressions** | 30%    | Could this break existing behavior or introduce side effects? |

### For `bug-analysis` mode

| Dimension                | Weight | What to evaluate                                                             |
| ------------------------ | ------ | ---------------------------------------------------------------------------- |
| **Evidence strength**    | 40%    | Is the analysis backed by concrete evidence (logs, traces, code paths)?      |
| **Root cause certainty** | 30%    | Is this the root cause or just a symptom? How deep did the investigation go? |
| **Fix confidence**       | 30%    | Will the proposed fix resolve the issue without introducing new problems?    |

---

## Output Format

**You MUST output in this exact format:**

```
## Confidence: X%

| Dimension | Score | Notes |
|-----------|-------|-------|
| <dim 1>   | X%    | ...   |
| <dim 2>   | X%    | ...   |
| <dim 3>   | X%    | ...   |
```

Calculate the overall score as the weighted average using the weights above.

**Be honest and critical — do not inflate scores. A low score with clear reasoning is more valuable than a false 95%.**

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

When running in Fix Mode (`plan fix`, `code fix`, `bug-analysis fix`), automatically address every concern that lowered your score:

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
