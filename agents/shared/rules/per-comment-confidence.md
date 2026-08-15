---
title: Per-comment confidence — Skill("confidence") not LLM self-grade
impact: HIGH
tags:
  - pr-reviewer
  - confidence
  - self-grade
---

# Per-comment confidence

The single LLM that wrote a finding is a poor judge of whether the finding is correct. The AAAI SELF-[IN]CORRECT result and Anthropic's own published guidance ("Pride and Prejudice", ACL 2024) both show that naïve self-grading either amplifies bias or adds no gain over self-consistency. The current 70 % per-comment threshold in the legacy reviewer was self-graded — exactly the failure mode the literature warns against.

After the rewrite, per-comment confidence is routed through the dedicated `confidence` skill, run in `code` mode, with an 80 % drop threshold.

## The check

For each finding that survives `finding-grounding.md` (2.6) and `verification-receipt.md` (2.6b):

1. Resolve the effective confidence threshold for this finding's file.
   The threshold is set by the resolved `profile` from `review-config.md` (Step 1.7).
   The default (no review config present or `profile: balanced`) is **80**.
   See `review-config.md` for the full profile→threshold table.

2. Construct a `confidence(code)` call with the finding as input:
   - **Target**: `<file:line>`
   - **Claim**: the comment body (without prefix and decoration)
   - **Evidence**: the changed-file patch hunk that contains the line, PLUS any verification receipt from Step 2.6b (raw tool output that supports or modifies the claim)
   - **Acceptance criteria** (the reviewer's own rubric questions — inputs to the call, NOT scores the skill returns):
     - Is the claim factually correct given the patch hunk?
     - Can the PR author act on it without additional context?
     - Does posting this comment improve the PR more than it adds noise?
3. Run `Skill("confidence", "code")`.
4. Apply the drop/defer decision below on the returned **Final** score. Log the outcome with the score and the effective threshold.

## Drop vs. defer — the near-miss band

A finding scoring just under the bar is not noise; it is a real observation the scorer is not yet confident enough to inline. Dropping it silently is how a genuine weakness disappears from one review and reappears "new" in the next — the single most common cause of a reviewer that "keeps finding more stuff it could have caught the first time".

So a near-miss `issue` or `suggestion` is **deferred to an advisory surface, not dropped**. Define the defer floor:

```python
def defer_floor(threshold: int) -> int:
    # near-miss band is [defer_floor, threshold); default threshold 80 → band [65, 80)
    return max(threshold - 15, 65)
```

For a finding that survived `finding-grounding.md` (2.6) and `verification-receipt.md` (2.6b), on its **Final** score:

| Final score | `issue` / `suggestion` | `question` / `nitpick` |
| --- | --- | --- |
| `>= threshold` | **clears** — eligible to post inline (2.8 → 2.9 → 2.9b) | **clears** |
| `defer_floor <= Final < threshold` | **defer** to the review body's `Low-confidence findings` advisory section — never inline, never dropped | **drop** (a low-confidence nitpick/question is genuinely not worth surfacing) |
| `Final < defer_floor` | **drop** | **drop** |

Only `issue` and `suggestion` are deferred — they are the finding types whose loss actually costs the author. A sub-threshold `question` or `nitpick` is still dropped, because a hedged nitpick surfaced anywhere is noise.

**Advisory findings are a distinct class, not "cleared".** They:

- never post inline and never consume an inline slot;
- bypass `comment-shape.md` (2.8), `conventional-comments.md` (2.9), and placement (2.9b) — they render only in the body's `Low-confidence findings` `<details>` section;
- are **never** auto-applied by `implement-suggestion` — they are advisory (below the confidence bar), and `reviewer-report-ingest.md` marks the section non-actionable;
- never affect any gate, the `FAILING_GATE_COUNT`, or the verdict;
- are **not** carried forward — a full re-review re-derives them from the diff, so an incremental run that skips them loses nothing durable.

This keeps the `Findings cleared` / `Deferred (over inline cap)` / `Final findings posted` identity below untouched: advisory findings are neither `cleared` nor over-cap-deferred, so they are tracked on their own `Confidence-deferred (advisory)` counter and excluded from `<CL> - <DEF> == <F>`.

## Why 80, not 70

| Threshold | Source | Outcome |
| --- | --- | --- |
| 70 | legacy reviewer.md Step 5.4 | Targets the published industry mean for self-graded threshold; produces 5–15 % false-positive rate (Crash Override 2026 LLM security review prompt study) |
| 80 | Claude Code Review default; 2026 FindSkill.ai field comparison | Targets the < 5 % false-positive rate above which devs read every comment |
| 90 | Bito / Qodo enterprise tier defaults | Drops too many true positives at typical SOTA model output quality; reserve for high-stakes-only repos |

80 is the recommended setting, established by `profile: balanced` in `review-config.md`.
Repos tune the threshold by setting `profile: chill` (90) or `profile: assertive` (70) in `.github/review.yaml`.
A bare `per_comment_confidence_threshold: N` without a `profile:` field is accepted as a direct override for backwards compatibility.
See `agents/shared/rules/review-config.md` for the full profile table and hierarchical discovery rules.

## What `confidence(code)` returns

`confidence(code)` scores three dimensions — **Correctness** (40 %), **Completeness** (30 %), **No regressions** (30 %) — and returns one weighted **Final** score (see `skills/quality/confidence/SKILL.md` § For `code` mode).
The drop decision is on the **Final** score.
A finding whose Final is dragged below 80 by any dimension is noise — a claim that is correct but incomplete, or complete but wrong, does not help the author.

```python
def passes_confidence(final_score: int, threshold: int = 80) -> bool:
    # threshold resolved from review-config.md profile (default: 80 = balanced)
    # final_score = weighted average of Correctness (40%),
    # Completeness (30%), No-regressions (30%)
    return final_score >= threshold
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
  → rubric-composition.md (dedupe + cap)                      [2.5]
  → finding-grounding.md   (claimed symbols exist?)            [2.6]
  → verification-receipt.md (behavioral claim proven?)         [2.6b]
  → per-comment-confidence (Skill("confidence", "code") ≥ threshold?) [2.7]
  → conventional-comments.md (prefix prepend + decoration)    [2.9]
  → comment-shape.md       (≤ 240 chars, ≤ 2 sentences?)      [2.8]
  → (PR Mode only) line-validity.md (hunk-bounds RIGHT-side)  [3.5]
  → emit / post
```

Each step is a hard gate. A finding that fails any of them is dropped, with the drop logged in the terminal Quality Gate summary — with one exception: at 2.7 a near-miss `issue` or `suggestion` (score in `[defer_floor, threshold)`) is deferred to the `Low-confidence findings` advisory section rather than dropped (see § Drop vs. defer).

## Logging

The Quality Gate summary in the agent's terminal output reports:

```
Quality Gate:
  Findings produced:        24
  Dedupe drops:              6
  Grounding drops:           3
  Receipt drops:             2  (behavioral claims with null/contradicting proof)
  Receipt downgrades:        1  (ambiguous proof → downgraded to question:)
  Filter drops:              1  (suppressed by review-config filters)
  Materiality drops:         0  (cosmetic nitpick/suggestion dropped on a docs-only incremental delta — pre-clearing)
  Prior-comment dedup:       2  (already said in a prior review pass)
  Anti-flip-flop drops:      0  (would contradict a resolved prior suggestion)
  Confidence drops:          7 (avg score: 64, threshold: 80)
  Confidence-deferred (advisory): 2  (issue/suggestion in [65,80) — advisory body section, not dropped)
  Shape drops:               2
  Carried forward:           1  (deferred by a prior incremental run)
  Findings cleared:          7  (survived every quality gate)
  Deferred (over inline cap): 1  (pr-reviewer only — listed in the review body, not dropped)
  Final findings posted:     6
```

`Findings cleared` is the honest measure of what the review found; `Final findings posted` is only how many fit inline.
The two differ solely by `Deferred (over inline cap)`, and in `reviewer` they are always equal (no placement cap).
A finding that cleared every gate is never subtracted anywhere else in this summary — if `Findings cleared` minus `Deferred` does not equal `Final findings posted`, the pipeline has a bug.

A run that posts 6 findings out of 24 produced is healthy. A run that posts 22 out of 24 is suspicious — the gates are not biting.
