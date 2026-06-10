---
title: Per-comment confidence — Skill("confidence") not LLM self-grade
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - confidence
  - self-grade
---

# Per-comment confidence

The single LLM that wrote a finding is a poor judge of whether the finding is correct. The AAAI SELF-[IN]CORRECT result and Anthropic's own published guidance ("Pride and Prejudice", ACL 2024) both show that naïve self-grading either amplifies bias or adds no gain over self-consistency. The current 70 % per-comment threshold in the legacy reviewer was self-graded — exactly the failure mode the literature warns against.

After the rewrite, per-comment confidence is routed through the dedicated `confidence` skill, run in `code` mode, with an 80 % drop threshold.

## The check

For each finding that survives `finding-grounding.md` and the dedupe pass in `rubric-composition.md`:

1. Construct a `confidence(code)` call with the finding as input:
   - **Target**: `<file:line>`
   - **Claim**: the comment body (without prefix and decoration)
   - **Evidence**: the changed-file patch hunk that contains the line
   - **Acceptance criteria** (the reviewer's own rubric questions — inputs to the call, NOT scores the skill returns):
     - Is the claim factually correct given the patch hunk?
     - Can the PR author act on it without additional context?
     - Does posting this comment improve the PR more than it adds noise?
2. Run `Skill("confidence", "code")`.
3. If the returned **Final** score is `< 80`, drop the comment. Log the drop with the score.

## Why 80, not 70

| Threshold | Source | Outcome |
| --- | --- | --- |
| 70 | legacy reviewer.md Step 5.4 | Targets the published industry mean for self-graded threshold; produces 5–15 % false-positive rate (Crash Override 2026 LLM security review prompt study) |
| 80 | Claude Code Review default; 2026 FindSkill.ai field comparison | Targets the < 5 % false-positive rate above which devs read every comment |
| 90 | Bito / Qodo enterprise tier defaults | Drops too many true positives at typical SOTA model output quality; reserve for high-stakes-only repos |

80 is the recommended setting. Repos with `.review.yaml` overrides can tune via:

```yaml
per_comment_confidence_threshold: 85  # default 80
```

## What `confidence(code)` returns

`confidence(code)` scores three dimensions — **Correctness** (40 %), **Completeness** (30 %), **No regressions** (30 %) — and returns one weighted **Final** score (see `skills/quality/confidence/SKILL.md` § For `code` mode).
The drop decision is on the **Final** score.
A finding whose Final is dragged below 80 by any dimension is noise — a claim that is correct but incomplete, or complete but wrong, does not help the author.

```python
def passes_confidence(final_score: int) -> bool:
    # final_score = weighted average of Correctness (40%),
    # Completeness (30%), No-regressions (30%)
    return final_score >= 80
```

The acceptance-criteria questions in step 1 (accurate? actionable? helpful?) are the reviewer's rubric for framing the call — they are NOT scores the skill returns.

## What this check does not catch

- Findings that the model is over-confident on across all three dimensions. This is the residual false-positive that `finding-grounding.md` is designed to catch.
- Findings that are correct but redundant with another rubric. Handled by dedupe in `rubric-composition.md` before this step.
- Findings that are correct and useful but stylistically wrong (too long, has bullets). Handled by `comment-shape.md` before this step.

## Order

The pipeline runs strict left-to-right:

```
review pass
  → rubric-composition.md (dedupe + cap)
  → finding-grounding.md   (claimed symbols exist?)
  → per-comment-confidence (Skill("confidence", "code") ≥ 80?)
  → conventional-comments.md (prefix prepend + decoration)
  → comment-shape.md       (≤ 240 chars, ≤ 2 sentences, no structure?)
  → (PR Mode only) line-validity.md (hunk-bounds RIGHT-side check)
  → emit / post
```

Each step is a hard gate. A finding that fails any of them is dropped, with the drop logged in the terminal Quality Gate summary.

## Logging

The Quality Gate summary in the agent's terminal output reports:

```
Quality Gate:
  Findings produced:        24
  Dedupe drops:              6
  Grounding drops:           3
  Confidence drops:          7 (avg score: 64)
  Shape drops:               2
  Final findings posted:     6
```

A run that posts 6 findings out of 24 produced is healthy. A run that posts 22 out of 24 is suspicious — the gates are not biting.
