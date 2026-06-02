# Review Mode (`--review`)

Detailed rule for the `--review` flag of `/create-pr`.
Loaded only when the user invokes review mode; default invocations skip this file.

`--review` is an **additive flag** that composes with default mode.
After the PR is created (Step 6), it triggers Claude's GitHub App to perform a code review on the PR in a fresh, isolated session, waits for the review to land, then dispatches `/implement-suggestion` to apply the review's actionable feedback automatically.

This runs **in parallel** with the existing CI watch + auto-fix loop (Steps 7–9 of `SKILL.md`).
The two paths can both push commits to the same branch — that race is expected and handled by each downstream skill's own pull-rebase logic.

## When to use review mode

Use `--review` when:

- You want a second-opinion code review from Claude before merging — independent of any human reviewer.
- The change benefits from a fresh-session lens that hasn't seen this conversation's reasoning.
- You want trivial style / naming / refactor suggestions auto-applied without a separate `/implement-suggestion` invocation later.

Don't use `--review` when:

- The PR is a draft you intend to iterate on heavily before review — the review will be stale by the time you're done.
- The change is a hotfix where waiting ~5 minutes for review feedback is unacceptable.
- You've already requested a Claude review via the GitHub UI on this PR — double review is wasteful.

## Composition rules

| Combination                       | Behaviour                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/create-pr --review`             | Default mode + Step 6.5 review trigger + parallel `/implement-suggestion` loop                           |
| `/create-pr --split --review`     | **Refuse.** Print one line: `--review is not supported with --split.` Exit before Step S1.                |
| `/create-pr` (no flag)            | Skip review mode entirely. The rest of this file does not apply.                                          |

Per-PR review across a stack of split PRs is technically possible but introduces ordering and rebase complexity that's not worth the cost. Run `/create-pr --split` first, land the stack, then invoke `/implement-suggestion <pr-url>` manually on any PR that needs a review pass.

## Precondition check (before Step 6.5)

Before posting the `@claude review` comment, verify Claude's GitHub App is installed on the repo. If it isn't, the comment will sit there with no response and the wait loop will time out.

```bash
gh api /repos/<owner>/<repo>/installation 2>/dev/null \
  | jq -r '.app_slug // empty' \
  | grep -E '^(claude|anthropic-claude|claude-code)$' >/dev/null \
  && echo "claude-app-installed" \
  || echo "claude-app-not-installed"
```

If the app isn't installed, print one line, skip Step 6.5, and continue with Step 7:

```
Skipping --review: Claude GitHub App not installed on <owner>/<repo>. Continuing with CI watch.
```

Do **not** attempt to auto-install the app — that's a user-authorised action.

## Step 6.5: Trigger Claude Review and dispatch background follow-up

Run this immediately after Step 6 (PR creation), only if `--review` is set.

### Step 6.5.1 — Post the trigger comment

```bash
COMMENT_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh pr comment <pr-url> --body "@claude review"
echo "Posted @claude review at $COMMENT_TS"
```

Record `$COMMENT_TS` — the background subagent uses it to distinguish Claude's review from any pre-existing reviews on the PR.

### Step 6.5.2 — Dispatch the background subagent

Spawn a `general-purpose` subagent with `run_in_background: true` and **continue to Step 7 in the main thread immediately** — do not block on the subagent.

Subagent brief:

```
description: Await Claude review, then implement suggestions
subagent_type: general-purpose
run_in_background: true
prompt: |
  Claude's GitHub App was just asked to review PR <pr-url> (trigger comment
  posted at <COMMENT_TS>). Your job has three parts, in order. Do not stop
  early.

  PART 1 — Poll for Claude's review.

  Run this Bash command (single call, internal loop). It polls every 30s
  for up to 10 minutes. Stop as soon as a review by Claude's app account
  lands AFTER <COMMENT_TS>.

  ```bash
  TIMEOUT=600
  POLL_INTERVAL=30
  PR_URL="<pr-url>"
  COMMENT_TS="<COMMENT_TS>"
  START=$(date +%s)

  # Resolve owner/repo/number from the PR URL
  read OWNER REPO NUMBER < <(echo "$PR_URL" \
    | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\1 \2 \3|')

  while true; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START))
    if [ $ELAPSED -ge $TIMEOUT ]; then
      echo "STATUS=timeout"
      exit 0
    fi

    # New review by Claude submitted after our trigger?
    REVIEW_COUNT=$(gh api "/repos/$OWNER/$REPO/pulls/$NUMBER/reviews" \
      --jq "[.[] | select(.user.login | test(\"claude\"; \"i\")) | select(.submitted_at > \"$COMMENT_TS\")] | length")

    # New review comment (line comment) by Claude after our trigger?
    LINE_COUNT=$(gh api "/repos/$OWNER/$REPO/pulls/$NUMBER/comments" \
      --jq "[.[] | select(.user.login | test(\"claude\"; \"i\")) | select(.created_at > \"$COMMENT_TS\")] | length")

    # New issue comment by Claude after our trigger?
    ISSUE_COUNT=$(gh api "/repos/$OWNER/$REPO/issues/$NUMBER/comments" \
      --jq "[.[] | select(.user.login | test(\"claude\"; \"i\")) | select(.created_at > \"$COMMENT_TS\")] | length")

    TOTAL=$((REVIEW_COUNT + LINE_COUNT + ISSUE_COUNT))
    if [ "$TOTAL" -gt 0 ]; then
      echo "STATUS=review-detected reviews=$REVIEW_COUNT line=$LINE_COUNT issue=$ISSUE_COUNT elapsed=${ELAPSED}s"
      exit 0
    fi

    sleep $POLL_INTERVAL
  done
  ```

  Interpret the output:
  - `STATUS=timeout` → skip PART 2, jump to PART 3 and report `timeout`.
  - `STATUS=review-detected …` → continue to PART 2.

  PART 2 — Implement the suggestions.

  Invoke the implement-suggestion skill against this PR. It will fetch the
  comments, validate them via /critical + /confidence, apply approved
  edits, and push to the existing PR branch — it does not open a new PR.

  Skill('implement-suggestion', '<pr-url>')

  Capture its final per-PR table from the response — applied / surfaced /
  skipped counts plus the head commit SHA.

  PART 3 — Report.

  Return exactly this structured summary (no narration around it):

  - review_wait_status: review-detected | timeout
  - wait_elapsed_seconds: <number>
  - suggestions_applied: <number or "n/a (timeout)">
  - suggestions_surfaced: <number or "n/a">
  - suggestions_skipped: <number or "n/a">
  - implement_suggestion_outcome: success | partial | failed | not-run
  - head_commit_after: <sha or "unchanged">
  - notes: one short sentence if anything is worth flagging, else empty

  Keep the whole report under 150 words. Do not paste comment bodies or
  full diffs.
```

State one line in the main thread before continuing to Step 7:

```
Dispatched background review subagent (PR: <pr-url>). Continuing with CI watch.
```

The user will see a notification when the background subagent completes.
The main thread proceeds with Step 7 immediately — do not poll, do not sleep.

## Parallelism and conflict handling

While the background subagent waits for Claude's review and then runs `/implement-suggestion`, the main thread is running Steps 7–9: watching CI and dispatching `/ci-auto-fix` subagents for mechanical failures.

Both paths can push commits to the same PR branch. Conflicts are handled as follows:

- **`/ci-auto-fix`** has its own pull-rebase-retry logic. If `/implement-suggestion` pushes a commit between auto-fix's fetch and push, auto-fix will rebase and retry.
- **`/implement-suggestion`**'s dispatched worker also pulls before pushing. If `/ci-auto-fix` lands a commit first, the worker rebases on top.
- In the rare case both push at the same instant and one loses the race repeatedly, the loser will exit after its internal retry cap. That outcome surfaces in the final report and the user can manually rerun the loser.

Do not add explicit serialisation between the two subagents. The 5-minute review wait makes natural overlap rare; the cost of synchronisation outweighs the benefit.

## Step 10 update — consolidating both paths

When the main thread reaches Step 10, the background review subagent may still be running.
Wait for it to complete (you will be notified) before producing the final report, then include its result.

Final report shape with `--review`:

```
PR: <pr-url>
Title: <imperative title>

CI:
  Final status: <green | <which checks red>>
  Auto-fixed: <one line per fix, or "none">
  Iterations: <total /ci-auto-fix subagent dispatches>

Claude Review (--review):
  Wait outcome: <review-detected after Xs | timeout after 10m | skipped (app not installed)>
  Suggestions applied: <N>
  Suggestions surfaced (not applied): <N>
  Suggestions skipped: <N>
  Head commit after review pass: <sha or "unchanged">

Outstanding:
  - <any items left for the user, only if escalation hit a cap>
```

If both paths pushed commits, surface the final head SHA so the user can see the latest state at a glance.

## Hard rules — never do these

- Never block the main thread waiting for Claude's review. Always dispatch the wait as a background subagent so CI watching proceeds in parallel.
- Never run `/implement-suggestion` from the main thread under `--review`. It belongs in the dispatched subagent; running it inline serialises with CI watch and defeats the parallelism the user asked for.
- Never combine `--review` with `--split` in v1. Refuse the combination at parse time.
- Never undraft the PR as part of `--review`. The skill's existing rule that auto-fix cannot mark a draft ready-for-review applies here too — the user decides when the PR is ready.
- Never post the `@claude review` comment more than once per `/create-pr` invocation. If the precondition check passes, post exactly one trigger. Re-runs are the user's call via `/implement-suggestion`.
- Never extend the poll timeout beyond 10 minutes without explicit user request. If Claude's review hasn't landed in 10 minutes, something is off — surface the timeout and let the user investigate.
- Never silently swallow `/implement-suggestion` failures. Its outcome (`success | partial | failed | not-run`) must appear in the final report.
