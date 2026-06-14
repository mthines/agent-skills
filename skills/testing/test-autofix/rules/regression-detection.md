---
title: Regression Detection
impact: HIGH
tags:
  - tests
  - regression
  - revert
  - iteration
---

# Regression Detection

After every fix batch, the new test run is compared against the previous
failure set.
The outcome determines whether the loop continues, restarts, or reverts.

Stacking fixes onto a regression is how a 5-iteration loop ships net-negative
test coverage.
This rule is non-optional.

## When to run

In Phase 6 of [`../SKILL.md`](../SKILL.md), after each full-surface re-run.

## Decision table

| Outcome | What it means | Action |
| --- | --- | --- |
| Same failure(s) as before | The fix did not address the root cause | Go back to verdict classification ([`verdicts.md`](./verdicts.md)). Do not repeat the same fix shape. |
| Strict subset of the previous failures | Partial progress — the fix worked for what it touched | Continue with the remaining failures (back to verdict classification for the new top failure). |
| New failure(s) that did NOT exist before this fix | The fix introduced a regression | **Revert the last fix.** Record the attempt in the plan artifact. Re-plan or escalate. |

## How to revert a test-file regression

For a `test-bug` fix, the edit was scoped to a test file.
Revert using file-level restore (not `git revert` which creates a commit):

```bash
git restore <test-file>
```

This undoes the in-progress edit without creating a revert commit.
Then re-run the single-test command to confirm the file is back to its original state.

If the fix had already been committed (e.g., between batches):

```bash
git revert HEAD --no-edit
```

Then sync before re-planning:

```bash
git pull --rebase origin "<branch>"
git log -1 --format='Baseline after revert: %H'
```

Record the printed baseline SHA in the plan artifact's `## Iteration <N> — reverted`
section so the user can verify the post-revert HEAD matches the expected baseline.
If the rebase conflicts, stop and report — do not auto-resolve.

## Iteration cap

Maximum 5 iterations (adjustable via `--max-iterations`).
If still failing after the cap, escalate with the structured exit summary from Phase 9.

## Definition of "new failure"

A failure is "new" if:

- The **test name or file** is different from anything in the previous failure set, OR
- The test name is the same but the **error message signature** (first ~3 lines) is materially different.

Cosmetic differences (line numbers shifting, timestamps, run IDs) do not count as new.
When in doubt, treat it as new — false positives revert one extra fix; false negatives
compound regressions.

## Why `git restore` (not `git reset --hard`)

`git restore <file>` restores a single file to its last committed state.
It is surgical and does not affect other staged or unstaged changes.
`git reset --hard HEAD` would discard all uncommitted work across the entire tree —
wrong scope when multiple fixes are in progress.

For a committed regression, `git revert HEAD` creates a new revert commit —
non-destructive, traceable, CI-safe, and does not rewrite shared history.
