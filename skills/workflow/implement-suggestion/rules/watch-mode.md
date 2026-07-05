# Watch Mode (`--watch`)

Detailed rule for the `--watch` flag of `/implement-suggestion`.
Loaded only when `--watch` is present in `$ARGUMENTS`; normal invocations skip this file.

`--watch` turns the single-pass apply into a **feedback loop on one PR**: after each apply-and-push, wait for the repo's review bots (and humans) to re-review the new commit, then apply the next round of actionable comments — repeating until the reviewers go quiet or an iteration cap is hit.

This is what `/create-pr` dispatches (as a background subagent) after it opens a PR, so a freshly-created PR converges to "all actionable bot feedback addressed" without the user babysitting it.

## Preconditions and parameters

- **Exactly one PR.** `--watch` operates on a single PR. If `$ARGUMENTS` resolves to more than one PR, refuse: print `--watch operates on a single PR; pass exactly one.` and exit. With empty `$ARGUMENTS`, use the active-PR auto-detection (mode rule #4).
- The PR must be `OPEN`. A `MERGED` / `CLOSED` PR refuses as usual.

Defaults (override via flags):

| Parameter        | Flag                  | Default |
| ---------------- | --------------------- | ------- |
| Max iterations   | `--max-iters <n>`     | `5`     |
| Poll interval    | `--interval <secs>`   | `300` (5 min) |

Hard cap: `--max-iters` may not exceed `10`. Clamp silently.

## The loop

```text
resolve PR  →  baseline = HEAD sha + current UTC timestamp
iter = 0
while iter < max-iters:
    iter++
    wait for new review activity (poll up to <interval>, see snippet below)
    if no NEW actionable comment since `baseline.timestamp` AND iter > 1:
        stop  → reason "reviewers quiet"
    run ONE standard single-pass (Phases 1–7) scoped to comments newer than baseline.timestamp
    baseline = new HEAD sha + new UTC timestamp        # so next round only sees fresh feedback
    if the pass applied 0 changes AND surfaced 0:
        stop  → reason "nothing actionable left"
stop  → reason "iteration cap (<max-iters>)"
```

Key invariants:

- **Only process comments newer than the last processed timestamp.** Each iteration advances `baseline.timestamp` to "now" *after* the pass, so the next iteration sees only feedback the bots posted in response to the latest push. This is what prevents re-applying the same comment in a churn loop.
- **Resolved threads are skipped at fetch time** (inherited from Phase 2). A comment the worker addressed and the bot then resolves will not reappear.
- **The two-gate validation (`/critical` + `/confidence`) runs every iteration.** Watch mode never lowers the bar; a low-confidence comment is surfaced, not force-applied, on every pass.
- **One commit per applied comment, every iteration** (inherited from the per-comment commit rule). Each iteration applies, commits per comment, pushes, then resolves the threads it addressed — so an iteration that lands 2 fixes leaves 2 commits and 2 newly-resolved threads. This is also why the next iteration sees fewer open comments: threads resolved in a prior iteration are skipped at fetch time.

## Lesson capture on re-flag

Watch mode surfaces the loop's **strongest self-improvement signal**: a reviewer
re-commenting on a location or topic that a **prior iteration already applied**
means that earlier apply was wrong or incomplete. When an iteration's new
feedback overlaps (same file:line region or same topic + reviewer source) a
comment an earlier iteration tagged `apply`, write a `implement-suggestion-lessons` lesson
for that reviewer source + topic before running the pass — this is the `Watch
re-flag` write point in
[`self-improvement-loop.md#write-lessons`](./self-improvement-loop.md#write-lessons).
The lesson is advisory (it biases the next run's Phase 3 / Phase 4); it never
changes the current iteration's gates.

## Waiting for new review activity

Poll instead of sleeping the full interval — proceed as soon as a bot posts, so a fast reviewer doesn't cost a full 5 minutes. Run this as a single Bash call per wait step (internal loop, so it is not a bare `sleep`):

```bash
PR_URL="<pr-url>"; SINCE="<baseline-timestamp>"; INTERVAL=300; POLL=30
read OWNER REPO NUMBER < <(echo "$PR_URL" \
  | sed -E 's|https://github.com/([^/]+)/([^/]+)/pull/([0-9]+).*|\1 \2 \3|')
START=$(date +%s)
while :; do
  NEW=$(gh api "/repos/$OWNER/$REPO/pulls/$NUMBER/comments" \
        --jq "[.[] | select(.created_at > \"$SINCE\")] | length")
  NEW_REVIEWS=$(gh api "/repos/$OWNER/$REPO/pulls/$NUMBER/reviews" \
        --jq "[.[] | select(.submitted_at > \"$SINCE\")] | length")
  NEW_ISSUE=$(gh api "/repos/$OWNER/$REPO/issues/$NUMBER/comments" \
        --jq "[.[] | select(.created_at > \"$SINCE\")] | length")
  if [ $((NEW + NEW_REVIEWS + NEW_ISSUE)) -gt 0 ]; then echo "NEW_FEEDBACK"; break; fi
  [ $(( $(date +%s) - START )) -ge $INTERVAL ] && { echo "NO_FEEDBACK"; break; }
  sleep $POLL
done
```

- `NEW_FEEDBACK` → run the pass.
- `NO_FEEDBACK` → on iteration 1, still run one pass (there may be feedback that predates the loop, e.g. a bot that reviewed before the watch started); on later iterations, stop with reason "reviewers quiet".

Note the `comments` / `reviews` / `issues` counts above are a *liveness probe* (did anyone post?). The actual actionable/nit classification and filtering still happens in Phases 2–4 of the pass — the probe only decides whether to run a pass, not what to apply.

## Report (watch mode)

Replace the single Phase 7 table with a per-iteration roll-up, then the standard final state:

```markdown
## Implement-Suggestion (watch) — <owner>/<repo>#<n>

| Iter | New feedback | Applied | Surfaced | Skipped | Commits | Pushed | Resolved |
|------|--------------|---------|----------|---------|---------|--------|----------|
| 1    | 4            | 3       | 1        | 0       | abc1234, def5678, 9a0bcde | ✓ | 3/3 |
| 2    | 1            | 1       | 0        | 0       | c0ffee1 | ✓ | 1/1 |
| 3    | 0            | —       | —        | —       | —       | —      | —   |

Stopped: reviewers quiet after 3 iterations.
Head commit: def5678
Surfaced (needs you): <one line per surfaced comment across all iterations, or "none">
```

`Stopped:` is one of: `reviewers quiet`, `nothing actionable left`, `iteration cap (<n>)`.

## Hard rules (in addition to the skill's global Hard Rules)

- **Never exceed the iteration cap.** The loop is bounded; a runaway bot conversation must terminate.
- **Never undraft the PR.** Watch mode applies and pushes; it never marks the PR ready-for-review. The user decides readiness.
- **Never lower the confidence gate to "make progress".** A surfaced comment stays surfaced across every iteration.
- **Never re-apply a comment already processed in an earlier iteration.** Advance the baseline timestamp after each pass.
- **Never `--force` push.** Inherited; watch mode pushes fast-forward only.
