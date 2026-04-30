---
name: confidence
description: >
  Rate confidence that the current work fully solves the stated requirement.
  Supports plan validation, code review, and bug analysis modes. Plan mode
  combines LLM judgment with deterministic rule checks (multi-signal gate).
  Use before committing to autonomous execution, after implementation, or
  during investigation. Triggers on confidence check, validate plan, rate
  confidence, or quality gate.
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
---

# Confidence Assessment

Rate your confidence that the current work fully solves the stated requirement.

> **Multi-signal evaluation.** A single LLM-confidence number is unreliable as
> a stand-alone gate (token probability ≠ correctness). This skill combines
> the LLM's dimensional scoring with **deterministic rule checks** the agent
> must run alongside. The final score is gated on BOTH passing.

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

**Plan mode is multi-signal: LLM dimensional scoring + deterministic rule checks.** Both must pass for the gate to clear.

#### Step 1 — LLM dimensional scoring

| Dimension        | Weight | What to evaluate                                                                                                 |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| **Completeness** | 40%    | Are ALL Phase 0 requirements captured? All sections populated? Could a new session execute from this plan alone? |
| **Feasibility**  | 30%    | Is the technical approach sound? Are patterns consistent with the codebase? Are risks identified?                |
| **No ambiguity** | 30%    | Are implementation steps specific enough to execute without interpretation? Are edge cases addressed?            |

#### Step 2 — Deterministic rule checks (run via Bash)

Every check below MUST pass for plan mode. A single failed rule caps the gate at **89% regardless of LLM score** — the agent must surface the failed rule and either fix the plan or escalate to the user.

| # | Rule check                                                | Verification                                                                                       |
| - | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1 | `plan.md` exists at the expected path                     | `test -f .agent/$(git branch --show-current)/plan.md`                                              |
| 2 | All required sections present                             | `grep -E '^## (Summary\|Background.*Context\|Requirements\|Decisions\|Technical Approach\|Acceptance Criteria\|Implementation Order\|File Changes\|Tests\|Risks\|Verification\|Progress Log)' plan.md \| wc -l` ≥ 12 |
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

### LLM dimensional scoring

| Dimension | Score | Notes |
|-----------|-------|-------|
| <dim 1>   | X%    | ...   |
| <dim 2>   | X%    | ...   |
| <dim 3>   | X%    | ...   |

### Deterministic rule checks (plan mode only — omit for code/bug-analysis)

| # | Rule                | Status      | Evidence                  |
|---|---------------------|-------------|---------------------------|
| 1 | <rule description>  | ✓ pass / ✗ fail | <command output snippet> |
| ... |                   |             |                           |

### Combined gate

- Weighted LLM score: X%
- Rule checks: <N pass> / <total> (cap: 100% if all pass, else 89%)
- **Final: X%**
```

Calculate the weighted LLM score as a weighted average using the dimension weights above. For `plan` mode, the **Final** is `min(weighted_LLM_score, rule_check_cap)`. For `code` and `bug-analysis` modes, omit the rule-check section and `Final = weighted_LLM_score`.

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
