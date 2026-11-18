# Why the `balanced` confidence bars are 65 / 70 / 75 / 85

The bars are defined in `finalize/thresholds.mjs` (`PROFILES`) and mirrored in [`review-config.md`](../rules/review-config.md) § Profile knob.
The rule that applies them is [`per-comment-confidence.md`](../rules/per-comment-confidence.md).

## What each bar trades

| Bar | Effect |
| --- | --- |
| Lower | More findings post inline; more of them are nitpicks the author dismisses |
| Higher | Fewer comments; real findings below the bar land in the collapsed `Less certain` section, or are dropped under the near-miss floor (`bar - 15`, never below 50) |

External anchors, not measured on this reviewer: 70 gives a 5-15 % false-positive rate (Crash Override 2026 LLM security review prompt study); 80 targets under 5 % (Claude Code Review default); 90 is the enterprise tier (Bito, Qodo) and drops true positives.

## Why `low` is 85 and not 90

Advisory findings (below the bar, above the near-miss floor) cluster at 80-90, and almost all carry the `suggestion:` prefix.
They were held back by the `low` bar of 90, not by the `medium` bar.
Some of them are substantive (a feature flag that a hook never reads; a restore step that rewrites the user's file), so 90 hid findings an author would act on.
`low` at 85 releases most of that band; it stays above `medium` because trivia needs more certainty than a typical finding.

## Why `high` stays 70

A lower `high` bar surfaces a probable serious bug at moderate confidence.
Raising it to match `medium` would drop findings, the opposite of the goal, so `high` does not move.

## What the data cannot show

- Dash0 run spans carry counts only (`pr_review.posted_inline`, `.advisory_deferred`, `.confidence_dropped`, `.findings.<tier>`), no per-finding confidence and no thread outcome.
- Per-finding confidence appears only in the sticky report (`Notes` and `Less certain` tables). Inline comments carry none, so there is no resolved-rate by confidence band.
- Unposted findings have no ground truth, so the false-positive rate in the 75-84 band is unmeasured.
- Posted-thread outcomes do not track severity, so the tier fan-out is a prior, not a fitted result.

## How to re-tune

1. Export per-finding confidence and the thread outcome (resolved, outdated, open) as telemetry; until then every change here is unproven.
2. Run `node scripts/eval/l2-detection.mjs` and read recall and `fp`; the gate is `recall >= 0.7` and `fp <= 0.2`.
3. Change `PROFILES`, `review-config.md`, and the `thresholds.mjs` self-test in one commit; put the measured numbers in the PR description.
