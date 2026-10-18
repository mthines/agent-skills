---
name: confidence
description: >
  Rates confidence that work fully solves the stated requirement, in plan, code (default), or analysis mode; plan mode adds deterministic rule checks, and a failed rule caps the gate at 89% regardless of LLM score.
  Use before autonomous execution, after implementation, or during investigation; triggers on "confidence check", "validate plan", "rate confidence", "quality gate", "/confidence".
disable-model-invocation: false
argument-hint: '[plan|code|analysis] [fix]'
license: MIT
metadata:
  author: mthines
  version: '2.3.0'
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
Plan mode is gated on two signals — LLM dimensional scoring and deterministic rule checks; rationale: [`references/multi-signal-rationale.md`](./references/multi-signal-rationale.md).

**Contents:** [Mode Detection](#mode-detection) · [Assessment Dimensions](#assessment-dimensions) · [Output Format](#output-format) · [Score Thresholds](#score-thresholds) · [Iteration Protocol](#iteration-protocol-plan-mode)

## Mode Detection

Check the arguments: `$ARGUMENTS`

| Argument | Default | Validates | When to use |
| --- | --- | --- | --- |
| `plan` | | Implementation plan completeness | After Phase 1 planning, before autonomous execution |
| `code` | **yes** | Code implementation correctness | After writing code, before PR |
| `analysis` | | Analysis accuracy (root cause, refactor rationale, or skill gap) | During investigation, before proposing a fix, refactor, or skill-source diff |
| `bug-analysis` | | **Deprecated alias for `analysis`** — behaves identically | Backwards-compatible; emit a one-line deprecation note in the report header |

If no argument is provided, default to `code`.

**Alias handling.** `bug-analysis` resolves to `analysis` with identical dimensions, weights, thresholds, and Fix Mode behaviour. When invoked with the alias, prepend a single line to the report header: `> Note: \`bug-analysis\` is a deprecated alias for \`analysis\`. Update the caller when convenient.`

If arguments contain **"fix"** (e.g., `code fix`, `plan fix`, `analysis fix`), run in **Fix Mode**: after the review, apply fixes for every concern found — read [`rules/fix-mode.md`](./rules/fix-mode.md) when in Fix Mode.

## Assessment Dimensions

### For `plan` mode

Both signals must pass for the gate to clear.

**Step 1 — LLM dimensional scoring**

| Dimension | Weight | What to evaluate |
| --- | --- | --- |
| **Completeness** | 40% | Are ALL Phase 0 requirements captured? Are the Core sections populated (and the Extended sections present where the task needs them)? Could a new session execute from this plan alone? Do not penalize an Extended section legitimately omitted because its `Include when` trigger does not apply (e.g. no Existing Code Survey on a modification-only plan). Score down an Existing Code Survey whose "Searched for" column is vague ("looked around") or whose `BUILD NEW` verdicts show no searches — rule #10 checks presence, this dimension checks search quality. |
| **Feasibility** | 30% | Is the technical approach sound? Are patterns consistent with the codebase? Are risks identified where applicable? |
| **No ambiguity** | 30% | Are implementation steps specific enough to execute without interpretation? Are edge cases addressed where applicable? |

**Step 2 — Deterministic rule checks (run via Bash).**
Run all 11 rules in [`rules/plan-rule-checks.md`](./rules/plan-rule-checks.md) — read it in every plan-mode run.
A single failed rule caps the gate at **89% regardless of LLM score**; surface the failed rule and either fix the plan or escalate to the user.

**Step 3 — Combined gate**

```
overall_score = min(weighted_LLM_score, max_allowed_by_rule_checks)
where max_allowed_by_rule_checks = 100% if all rules pass, else 89%
```

### For `code` mode

| Dimension | Weight | What to evaluate |
| --- | --- | --- |
| **Correctness** | 40% | Does the logic actually address the problem as described? |
| **Completeness** | 30% | Are all cases, edge cases, and requirements covered? |
| **No regressions** | 30% | Could this break existing behavior or introduce side effects? |

### For `analysis` mode

Use when the graded artifact is an analysis — a root-cause write-up, a refactor rationale, a `/create-skill diagnose` proposal, a holistic re-analysis after a stuck loop, or any reasoning artifact that precedes a proposed change.

| Dimension | Weight | What to evaluate |
| --- | --- | --- |
| **Evidence strength** | 40% | Is the analysis backed by concrete evidence (logs, traces, code paths, file:line references, reproduced behaviour)? |
| **Root cause certainty** | 30% | Is this the underlying cause or just a symptom? How deep did the investigation go? For refactor / diagnose analyses, read "root cause" as "the actual structural reason," not literal bug aetiology. |
| **Outcome confidence** | 30% | Will the proposed action (fix, refactor, skill-source diff) resolve the situation without introducing new problems? |

## Output Format

Output in this exact format:

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

The weighted LLM score is the weighted average over the dimension weights above.
For `plan` mode, **Final** is `min(weighted_LLM_score, rule_check_cap)`.
For `code` and `analysis` modes (including the deprecated `bug-analysis` alias), omit the rule-check section and `Final = weighted_LLM_score`.

Do not inflate scores: a low score with clear reasoning beats a false 95%, and a failed rule check is always surfaced, even when the LLM score is high.

## Score Thresholds

| Score | Action |
| --- | --- |
| **90-100%** | Proceed — work is ready |
| **70-89%** | List specific concerns and what would raise confidence. If in Fix Mode, apply fixes. |
| **Below 70%** | Recommend concrete next steps to validate or fix. Do NOT proceed with autonomous execution. |

## Iteration Protocol (plan mode)

When used as a quality gate before autonomous execution:

> If confidence is below 90%, do up to **2 iterations** of additional research, analysis, and evidence collection to raise the score.
> After each iteration, re-run the confidence assessment.
> If still below 90% after 2 iterations, present findings to the user and ask whether to proceed or refine further.
