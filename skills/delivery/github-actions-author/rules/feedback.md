---
title: Feedback — Reactions and Status for Comment-Triggered Workflows
impact: HIGH
tags:
  - feedback
  - reactions
  - issue_comment
  - slash-command
  - observability
  - acknowledgement
---

# Feedback

A `push` or `pull_request` run announces itself: it shows up as a status
check on the PR, so the user always knows it fired.
A **comment-triggered** workflow does not.
A user types `/deploy` (or `/rebase`, `/format`, `/preview`) and then
stares at a comment with no indication that anything is happening — no
status check, no spinner, nothing.
If the run silently fails, they never find out.

**Rule:** every workflow triggered by a comment or a review — directly, or
through a `workflow_dispatch` that a comment or a bot fired — and that
produces no obvious PR status check **must** report back: an
acknowledgement when it starts, and an outcome when it ends.
Deliver both on the triggering comment whenever there is one.
A `pull_request_review` trigger has none — GitHub exposes no reactions
endpoint for a review — so it acknowledges and reports with a single
sticky PR comment instead, found by marker and updated in place
(see [The sticky comment](#the-sticky-comment-for-a-review-trigger)).
A `workflow_dispatch` fired from the Actions UI has no triggering comment
at all, so it is out of scope.

## When this rule applies

| Trigger                                                    | Needs feedback? | Why                                                        |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `issue_comment` (slash command on an issue/PR)             | **Yes**         | No status check; user has no signal it ran.               |
| `pull_request_review_comment` (slash command on a diff)    | **Yes**         | Same — invisible without feedback.                        |
| `pull_request_review` (`submitted`) acting on a command    | **Yes**         | Same.                                                     |
| `workflow_dispatch` fired from a comment/bot               | **Yes**         | The requester is watching the comment, not the Actions UI. |
| `pull_request` / `push` CI                                 | No (optional)   | The status check **is** the feedback. Summaries are extra. |

## The three-beat loop

Every comment-triggered workflow follows the same shape.

Which surface each beat writes to depends on the trigger — read
[Pick the reaction route from the trigger](#pick-the-reaction-route-from-the-trigger--the-id-namespaces-are-disjoint)
once, then apply the beats below on that surface.

1. **Acknowledge — first step, before any real work.**
   Signal "picked up" the moment the run starts: 👀 (`eyes`) on the
   triggering comment where the trigger has one, otherwise the sticky PR
   comment.
   This must be the **first** step after gating (below), not the last —
   an acknowledgement that only lands after a 4-minute build is useless.
2. **Progress (optional).** For long runs, create **one** sticky status
   comment and update it in place (never post a fresh comment per tick —
   that is notification spam).
3. **Report outcome — always, on both paths.**
   On success, a 🚀/🎉/👍 reaction, or the sticky comment rewritten to say
   so.
   On failure, a 👎 reaction **and** a comment with the reason and a link
   to the run — or the same two facts in the sticky comment — so the user
   can act without hunting.

## Reaction vocabulary

The reactions REST API accepts exactly these `content` values:
`+1`, `-1`, `laugh`, `confused`, `heart`, `hooray`, `rocket`, `eyes`.

| Beat                     | `content`                    | Renders  | Meaning                        |
| ------------------------ | ---------------------------- | -------- | ------------------------------ |
| Acknowledge (picked up)  | `eyes`                       | 👀       | Received — run has started.     |
| Success                  | `rocket` / `hooray` / `+1`   | 🚀 🎉 👍 | Completed OK.                   |
| Failure                  | `-1` / `confused`            | 👎 😕    | Failed — see comment + run link. |

Pick **one** success reaction and **one** failure reaction per repo and
stay consistent, so contributors learn to read them at a glance.

## Permissions

Reacting and commenting need write scope on the discussion surface.
Grant the minimum at the job level:

```yaml
permissions:
  issues: write          # react to / comment on issue comments
  pull-requests: write   # react to / comment on PR + review comments
```

Without these the reactions API returns `403` — a common silent breakage.

## Implementation with `gh api`

`gh` is preinstalled on GitHub-hosted runners and reads `GH_TOKEN`.

### Pick the reaction route from the trigger — the id namespaces are disjoint

An `issue_comment` id and a `pull_request_review_comment` id live in
**different namespaces**, and each 404s on the other's route.
A pull request **review** has no reactions endpoint at all.
Read the row for your trigger before you copy any snippet below.

| Trigger                        | Comment id                                            | Reaction route                                                | PR / issue number                            |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `issue_comment`                | `${{ github.event.comment.id }}`                       | `/repos/{owner}/{repo}/issues/comments/{id}/reactions`          | `${{ github.event.issue.number }}`            |
| `pull_request_review_comment`  | `${{ github.event.comment.id }}`                       | `/repos/{owner}/{repo}/pulls/comments/{id}/reactions`           | `${{ github.event.pull_request.number }}`     |
| `pull_request_review`          | none — the payload carries `github.event.review.id`    | none — use the sticky PR comment below instead of a reaction | `${{ github.event.pull_request.number }}` |
| `workflow_dispatch` (comment/bot-fired) | none — the dispatching bot passes it, e.g. `${{ inputs.comment_id }}` | the route matching the id the caller passed (`issues` or `pulls`) | pass it as an input too, e.g. `${{ inputs.pr_number }}` |

Confirm the row once with a read-only probe before you rely on it:

```bash
# Substitute a real id. Exactly one of these returns 200; the other returns 404.
gh api "/repos/$OWNER/$REPO/issues/comments/$ID/reactions"
gh api "/repos/$OWNER/$REPO/pulls/comments/$ID/reactions"
```

Every snippet below uses the `issue_comment` row.
For `pull_request_review_comment`, swap `issues/comments` for
`pulls/comments` and `github.event.issue.number` for
`github.event.pull_request.number`.

### The sticky comment for a review trigger

A trigger with no reactable comment needs a surface that can be written
once and rewritten on every later beat.
That is one PR comment, found by a hidden marker and updated in place.
Three routes, all on the **issue** namespace because a PR is an issue:

| Step | Route |
| ---- | ----- |
| Find it | `GET /repos/{owner}/{repo}/issues/{pr}/comments`, then match on the marker |
| Create it (first beat only) | `POST /repos/{owner}/{repo}/issues/{pr}/comments` |
| Update it (every later beat) | `PATCH /repos/{owner}/{repo}/issues/comments/{id}` |

Put the find-or-create in one step and reuse it for all three beats:

```yaml
- name: Acknowledge (sticky comment)
  env:
    GH_TOKEN: ${{ github.token }}
    PR: ${{ github.event.pull_request.number }}
    MARKER: '<!-- deploy-status -->'
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    set -euo pipefail
    ID=$(gh api "/repos/${{ github.repository }}/issues/$PR/comments" --paginate \
      --jq "[.[] | select(.body | startswith(\"$MARKER\"))] | .[0].id // empty")
    BODY=$(printf '%s\n👀 Command picked up — [view run](%s)' "$MARKER" "$RUN_URL")
    if [ -n "$ID" ]; then
      gh api --method PATCH \
        "/repos/${{ github.repository }}/issues/comments/$ID" \
        -f body="$BODY" 2>&1 | tee sticky.log
    else
      ID=$(gh api --method POST \
        "/repos/${{ github.repository }}/issues/$PR/comments" \
        -f body="$BODY" --jq '.id' | tee sticky.log)
    fi
    echo "STICKY_ID=$ID" >> "$GITHUB_ENV"
```

The later beats reuse `STICKY_ID` and `PATCH` the same comment, so the
run leaves exactly one comment behind however many beats it reports.
The same recipe is the progress comment of beat 2 for **any** trigger.

### Gate the command first (security)

Comment triggers fire for **anyone with read access**.
Gate before you react, or any user can drive your bot — see
[`security.md`](./security.md).

```yaml
jobs:
  command:
    # Only run for the intended command, on a PR, from a trusted author.
    if: >-
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '/deploy') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),
               github.event.comment.author_association)
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write
    steps:
      # ... acknowledge / work / report, below
```

### Acknowledge — the first step

```yaml
- name: Acknowledge command
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    set -euo pipefail
    gh api --method POST \
      "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
      -f content='eyes' 2>&1 | tee reaction-ack.log
```

### Do the work

```yaml
- name: Run the command
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    set -euo pipefail
    ./scripts/deploy.sh 2>&1 | tee deploy.log
```

### Report the outcome — both paths, always

```yaml
- name: Report success
  if: success()
  env:
    GH_TOKEN: ${{ github.token }}
  run: |
    set -euo pipefail
    gh api --method POST \
      "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
      -f content='rocket' 2>&1 | tee reaction-ok.log

- name: Report failure
  if: failure()
  env:
    GH_TOKEN: ${{ github.token }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    set -euo pipefail
    gh api --method POST \
      "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
      -f content='-1' 2>&1 | tee reaction-fail.log
    gh api --method POST \
      "/repos/${{ github.repository }}/issues/${{ github.event.issue.number }}/comments" \
      -f body="❌ \`/deploy\` failed — [view run]($RUN_URL)" 2>&1 | tee comment-fail.log
```

`if: success()` / `if: failure()` guarantee exactly one outcome step
runs even after an earlier step aborts the job.
The failure comment **must** carry the `RUN_URL`; a 👎 with no link
tells the user it broke but not where to look.

## Implementation with a maintained action

`peter-evans/create-or-update-comment` handles reactions and sticky
comments in one place. Use it when you also want a progress comment.

```yaml
- name: Acknowledge
  uses: peter-evans/create-or-update-comment@<sha>   # v4.x
  with:
    comment-id: ${{ github.event.comment.id }}
    reactions: eyes
```

SHA-pin it like any third-party action ([`security.md`](./security.md)).
`comment-id` on this action addresses an **issue** comment only, so it
cannot acknowledge a `pull_request_review_comment` — use the `gh api`
`pulls/comments` route above for that trigger.

## Examples

### Good — acknowledge first, outcome on both paths

```yaml
steps:
  - name: Acknowledge command
    env: { GH_TOKEN: ${{ github.token }} }
    run: |
      set -euo pipefail
      gh api --method POST \
        "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
        -f content='eyes' 2>&1 | tee reaction-ack.log

  - name: Run command
    env: { GH_TOKEN: ${{ github.token }} }
    run: |
      set -euo pipefail
      ./scripts/preview.sh 2>&1 | tee preview.log

  - name: Report success
    if: success()
    env: { GH_TOKEN: ${{ github.token }} }
    run: |
      set -euo pipefail
      gh api --method POST \
        "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
        -f content='rocket' 2>&1 | tee reaction-ok.log

  - name: Report failure
    if: failure()
    env:
      GH_TOKEN: ${{ github.token }}
      RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
    run: |
      set -euo pipefail
      gh api --method POST \
        "/repos/${{ github.repository }}/issues/comments/${{ github.event.comment.id }}/reactions" \
        -f content='-1' 2>&1 | tee reaction-fail.log
      gh api --method POST \
        "/repos/${{ github.repository }}/issues/${{ github.event.issue.number }}/comments" \
        -f body="❌ Preview failed — [view run]($RUN_URL)" 2>&1 | tee comment-fail.log
```

### Bad — silent, or feedback only at the end

```yaml
steps:
  - run: ./scripts/deploy.sh        # no ack, no reaction, no outcome
```

```yaml
steps:
  - run: ./scripts/deploy.sh
  - if: success()                   # ack missing — user was blind the whole run
    run: gh api ... -f content='rocket'
  # no failure branch — a failed deploy leaves the comment with no signal
```

Why bad: the user has no idea the command was received, and a failure is
completely invisible — no reaction, no comment, no link.

## Common mistakes

- **Feedback only at the end.** The user is blind during the run.
  **Fix:** acknowledge as the **first** step, on the surface the trigger
  provides.
- **No failure branch.** Success is signalled, failure is silent.
  **Fix:** an `if: failure()` step that reacts **and** links the run.
- **Failure reaction with no run link.** User knows it broke, not where.
  **Fix:** post a comment with `RUN_URL` alongside the 👎.
- **Missing `issues: write` / `pull-requests: write`.** Reactions API
  `403`. **Fix:** grant the scope at the job level.
- **Reacting before gating the command.** Any read-access user drives the
  bot. **Fix:** gate on `author_association` / command prefix **first**,
  then react — see [`security.md`](./security.md).
- **A fresh comment per progress tick.** Notification spam.
  **Fix:** one sticky comment, updated in place
  (`create-or-update-comment`).
- **Using `/issues/comments/{id}/reactions` for a review comment.** The id
  404s — the two namespaces are disjoint, and a review has no reactions
  endpoint at all. **Fix:** pick the route from the per-trigger table in
  [Implementation with `gh api`](#implementation-with-gh-api).
- **Assuming the comment is on a PR.** `issue_comment` also fires on
  plain issues. **Fix:** gate on `github.event.issue.pull_request` when
  the command only makes sense on a PR.
