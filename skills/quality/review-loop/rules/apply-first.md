---
title: Iteration 1 — apply first when the last review still stands
impact: HIGH
tags:
  - review-loop
  - apply-first
  - convergence
---

# Iteration 1 — apply first when the last review still stands

Read this file at iteration 1, before sub-step A, unless `NO_FEEDBACK == 1`.
Why each condition is required: [`references/design-rationale.md` § Iteration 1 apply-first](../references/design-rationale.md#iteration-1-apply-first).

When the last `pr-reviewer` review judged the current head, iteration 1 skips sub-step A and starts at sub-step B on the threads that review left open.
Skip only when **all** of these hold; review first otherwise:

| Condition | Read from |
| --- | --- |
| `ITERATION == 1` | the loop counter |
| `NO_FEEDBACK == 0` | Step 0 |
| `.mode == "zero-delta"` | `context.json` from one `prepare-review.mjs` run |
| `OPEN >= 1` | the block's thread query — unresolved threads |
| `REPLIED == 0` | the block's thread query — unresolved threads holding more than one comment (a finding someone replied to) |

Read the mode from exactly one `prepare-review.mjs` run in the loop's own context:

| `REVIEWER_ROUTE` | Where `context.json` comes from | After the check |
| --- | --- | --- |
| `named` | The `prepare-review.mjs` run of [the named dispatch](../SKILL.md#sub-step-a--the-named-dispatch), item 1 — run it before the check | Passed: run its `--cleanup` and dispatch nothing. Failed: hand the same `context.json` to the dispatch |
| `agent0` | `node /tmp/workspace/pr-reviewer/pr-reviewer/scripts/prepare-review.mjs --pr <PR-URL> --out <dir>/context.json`, run in the loop's context | Run its `--cleanup` either way; the `general` reviewer runs its own prepare ([`agent0-runtime.md`](./agent0-runtime.md#sub-step-a--dispatch-a-general-reviewer-pointed-at-the-bundle)) |

Run the block as **one** Bash call with the loop's values written in for `<ITERATION>`, `<NO_FEEDBACK>`, `<OWNER>`, `<REPO>`, `<PR_NUMBER>`, and `<dir>`, and read `APPLY_FIRST` from its printed line, never from a variable set in another call.

```bash
# Iteration 1 only. Every failed read leaves APPLY_FIRST=0, so the iteration reviews first.
ITERATION=<ITERATION>; NO_FEEDBACK=<NO_FEEDBACK>; OWNER=<OWNER>; REPO=<REPO>; PR_NUMBER=<PR_NUMBER>
MODE=$(jq -r '.mode // empty' "<dir>/context.json" 2>/dev/null)
PRIOR_SHA=$(jq -r '.priorRun.priorSha // empty' "<dir>/context.json" 2>/dev/null)
THREADS=$(gh api graphql -f query='
  query($owner:String!,$repo:String!,$pr:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100){ nodes{ isResolved comments{ totalCount } } }
      }
    }
  }' -F owner="$OWNER" -F repo="$REPO" -F pr="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes' 2>/dev/null)
OPEN=$(printf '%s' "$THREADS" | jq '[.[] | select(.isResolved==false)] | length' 2>/dev/null)
REPLIED=$(printf '%s' "$THREADS" | jq '[.[] | select(.isResolved==false and .comments.totalCount > 1)] | length' 2>/dev/null)
APPLY_FIRST=0
if [ "$ITERATION" -eq 1 ] && [ "$NO_FEEDBACK" -eq 0 ] && [ "$MODE" = "zero-delta" ] \
   && [ "${OPEN:-0}" -ge 1 ] && [ "${REPLIED:-1}" -eq 0 ]; then
  APPLY_FIRST=1
fi
echo "APPLY_FIRST=$APPLY_FIRST MODE=${MODE:-none} OPEN=${OPEN:-unread} REPLIED=${REPLIED:-unread} PRIOR_SHA=${PRIOR_SHA:-none}"
```

Never skip a review on a state you could not read: a failed prepare, a `context.json` with no `.mode`, or a failed thread query all leave `APPLY_FIRST=0`.

When the check passes:

1. Set `NEW_FINDINGS = true` and go straight to sub-step B; the run converges — and `--merge` merges — only after a review pass, from iteration 2 on.
2. Leave `FINAL_VERDICT = "n/a"`; iteration 2's review sets it.
3. Change nothing else: B, C, D, the no-progress guard, and the cap run as in every iteration.
4. Report iteration 1 as `review skipped (prior review at <PRIOR_SHA> still stands)`; when the loop stops before iteration 2 reviews, report the final verdict as `n/a (no review this run — prior review at <PRIOR_SHA>)`.

```text
# correct: unmoved head, two open threads nobody replied to → apply first
Iteration 1: zero-delta · 2 open · 0 replied → review skipped → B applies 2 → C → push
Iteration 2: pr-reviewer (incremental) → PASS, 0 new → all-threads-resolved

# incorrect: skipping with no open thread — polish simplify pushes to a finished PR
Iteration 1: zero-delta · 0 open → review skipped → C applies a recipe → push

# incorrect: skipping when the author replied "won't fix" — B meets the declined thread still open
Iteration 1: zero-delta · 1 open · 1 replied → review skipped → B re-applies the declined fix
```
