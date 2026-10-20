---
title: --merge — squash-merge a converged PR on a clean approval
impact: HIGH
tags:
  - review-loop
  - merge
  - convergence
---

# `--merge`

Read this file only when `MERGE == 1`, after Step 2 and before Step 3.
Without `--merge`, Step 2.5 does not run.
Why each gate exists: [`references/design-rationale.md` § --merge](../references/design-rationale.md#--merge).

### Step 2.5: Merge (under `--merge`, on approval)

This is the one step that overrides *never undraft*: to merge, a draft must first be marked ready.
Merge on the **first agent approval**: the loop already ran to clean convergence (every non-blocking comment fixed or answered), and the review that ended the loop was an approval.

#### Post-refresh re-review — before the gates

The loop's last review judged the PR body as it was **before** Step 2 rewrote it.
So when that review's verdict is not `PASS` and Step 2 changed the body, its verdict is stale: a `Description vs. code` warning the refresh fixed would still block the merge.
Run **exactly one** more review pass before reading the gates, when **all** of these hold:

| Condition | Why |
| --- | --- |
| `MERGE == 1` | Without `--merge` nothing reads the verdict |
| `STOP_REASON == "all-threads-resolved"` | Any other stop reason fails the first gate whatever the verdict says |
| `DESCRIPTION_REFRESHED == 1` | An unchanged body cannot change the verdict |
| `FINAL_VERDICT != "PASS"` | A `PASS` needs no second look |

How it runs:

1. Dispatch it exactly as [sub-step A](../SKILL.md#step-1-loop--review--applyresolve--simplify) does, on the same `REVIEWER_ROUTE` with the same flags (`--critical` included).
   The head has not moved since the last review, so `pr-reviewer` takes its zero-delta path: gates and threads only, with the description re-read from the live PR.
2. Set `FINAL_VERDICT` to the verdict it returns, and record it as `MERGE_REREVIEW`.
3. It is not an iteration: it does not count against `CAP`, it never runs sub-steps B, C, or D, and nothing is pushed after it.
   At most one per run, never retried.
4. Do not merge when it does not come back clean:
   - a refusal or `BLOCKED` reply → `MERGE_REREVIEW = refused`, report `not merged (post-refresh re-review refused)`;
   - new actionable findings → report `not merged (post-refresh re-review found <N> new findings)` and leave them for the next run;
   - `WARN` or `FAIL` → the Approval gate below reports it as usual.

```text
# correct: the refresh changed the body after a WARN, so the gates read a verdict on the new body
Iteration 2: WARN (Description vs. code: body omits a new attribute), 0 new findings → all-threads-resolved
Step 2:   body refreshed → DESCRIPTION_REFRESHED = 1
Step 2.5: post-refresh re-review → PASS → FINAL_VERDICT = PASS → gates pass → merged (squash)

# incorrect: gating on the verdict that predates the refresh
Step 2.5: FINAL_VERDICT == WARN (iteration 2) → not merged — the warning it carried was fixed by Step 2
```

Then merge if and **only if all** of the following hold — any single failure means *do not merge*, record the reason, and stop with the PR left review-ready:

| Gate | Merge requires | Read from |
| --- | --- | --- |
| **Clean convergence** | `STOP_REASON == "all-threads-resolved"` | the loop's exit. `no-progress` (human-judgment flags remain), `cap-reached`, `ci-red`, and `ci-error` are all **not** merge-eligible |
| **Zero open threads** | `unresolved_thread_count() == 0` | re-read now, do not trust the loop's last value |
| **Approval** | `FINAL_VERDICT == "PASS"` | the last review pass — the post-refresh re-review when one ran |
| **CI green** | CI is actually **green**, or the repo genuinely has no CI. Pending is **not** green — the loop never waits for CI, so a converged-but-pending run stops here without merging | a fresh stateless `gh pr checks "$PR_NUMBER" --repo "$RESOLVED_REPO"` read (**run this even under `--no-ci`** — `--no-ci` only skips the in-loop `ci-auto-fix` delegation) |

A non-`PASS` final verdict (`WARN` or `FAIL`) is **not** an approval: report `not merged (verdict <V> — not a clean approval)` and stop.
The Step 1.6 ui-verify verdict is report-only and never gates the merge; surface a `red` preview verdict in the report, but do not let it block or force the merge.
Under `--ui` the lane is part of convergence, so it **does** gate: when the lane's last run on the final head reported `verdict: red`, report `not merged (UI lane red on <sha7>)` and stop.
An `inconclusive` lane does not block the merge; name it in the report.

When every gate passes:

```bash
# Undraft first if the PR is a draft — the scoped override of "never undraft".
if [ "$(gh pr view "$PR_NUMBER" --repo "$RESOLVED_REPO" --json isDraft -q .isDraft)" = "true" ]; then
  gh pr ready "$PR_NUMBER" --repo "$RESOLVED_REPO"
fi

# Squash-merge (the method decided for --merge; gh requires an explicit method).
gh pr merge "$PR_NUMBER" --repo "$RESOLVED_REPO" --squash
```

If `gh pr merge` fails (branch protection needs a review approval the bot cannot give, a required check flipped, a merge conflict), do **not** retry with `--admin` or force anything: record `merge failed (<verbatim gh error>)` and stop.
The PR is already converged and review-ready; a human completes the merge.
