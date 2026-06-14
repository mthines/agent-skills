---
title: Regression Detection
impact: HIGH
tags:
  - ci
  - regression
  - revert
  - iteration
---

# Regression Detection

After every push, the new CI run is compared against the previous failure set.
The outcome determines whether the loop continues, restarts, or reverts.

Stacking fixes onto a regression is how a 4-iteration loop ships net-negative code.
This rule is non-optional.

## When to run

In Phase 8 of [`../SKILL.md`](../SKILL.md), after the new CI run completes and its failed-job logs have been fetched.

## Decision table

| Outcome | What it means | Action |
| --- | --- | --- |
| Same failure(s) as the previous run | The fix did not address the root cause | Go back to verdict classification ([`verdicts.md`](./verdicts.md)). Do not just repeat the same fix shape. |
| Strict subset of the previous failures | Partial progress — the fix worked for what it touched | Continue with the remaining failures (back to verdict classification for the new top failure). |
| New failure(s) that did NOT exist before this push | The fix introduced a regression | **Revert the last commit.** Record the attempt in the plan artifact. Re-plan or escalate. |

## How to revert a regression

```bash
git revert HEAD --no-edit
git push origin "<branch>"
```

Then:

1. Append a `## Iteration <N> — reverted` section to the plan artifact (see [`../templates/plan-artifact.md`](../templates/plan-artifact.md)).
2. Re-classify from the original failure set in [`verdicts.md`](./verdicts.md).
3. If the second attempt also regresses, escalate — do not try a third.

## Why `git revert`, not `git reset`

`git reset --hard HEAD~1 && git push --force` rewrites shared history.
Other clones, PR review comments, and CI artifacts pinned to the reverted SHA all break.
`git revert` creates a new commit that undoes the prior one — non-destructive, traceable, and CI-safe.

## Iteration cap

Maximum 4 iterations.
If still failing after 4 attempts (including any reverts), escalate with the structured exit summary from Phase 9.

## Definition of "new failure"

A failure is "new" if:

- The failing **job/step** name is different from anything in the previous failure set, OR
- The failing job/step is the same but the **error signature** (exit code + first ~3 lines of error) is materially different.

Cosmetic differences (line numbers shifting by ±5, timestamps, run IDs) do not count as new.
When in doubt, treat it as new — false positives revert one extra commit, false negatives compound regressions.
