---
title: Outcome learning — resolution-rate feedback loop
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - self-improvement
  - lessons
  - resolution-rate
---

# Outcome learning

The goal of an automated reviewer is not to generate findings — it is to generate findings that authors **act on**.
The difference matters: a tool that correctly flags 10 issues but the author ignores 8 of them is not 80 % accurate, it is 20 % useful.

Bugbot's core insight (DOCUMENTED): they hill-climb on **resolution rate** measured at MERGE time — "did the author actually fix the flagged issue" — not on a self-graded "is-this-a-bug" label.
That outcome loop is what lets them turn generation aggression up while keeping perceived noise down.
Today's `reviewer` / `pr-reviewer` read and write `reviewer-lessons` via `persistent-memory`, but promotion is driven by self-authored `seen_count` alone, not real outcomes.
This rule upgrades the loop to ingest resolution signals.

---

## The three resolution signals

After a PR is merged (or on-demand via `/review-outcomes <pr>`), measure the following for each comment the agent posted:

| Signal | Meaning | How to detect |
| --- | --- | --- |
| **(a) Dismissed / 👎-reacted** | Author found the comment unhelpful or wrong | `gh api .../reactions` returns 👎 from PR author |
| **(b) Author reply correcting the finding** | Finding was wrong for a stated reason | Thread contains an author reply, no follow-up commit touching the line |
| **(c) Author pushed a fix touching the commented line** | Finding was acted on | A commit after the review comment touches `(path, line ± 5)` |

Signal (c) is the primary resolution signal — it is the Bugbot metric.
Signals (a) and (b) are the noise signals — they teach the agent where it over-flags.

A fourth implicit signal, absent from the above three: a **human reviewer independently caught something the bot missed**.
Detect this by checking review comments from other human reviewers on lines the bot did NOT flag.
These become new **detection candidates** — patterns to watch for in future runs.

---

## Measurement mechanism

Use `gh api` (read-only).
Run after merge, or on-demand.

### Step 1 — Resolve the comment list

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BOT_LOGIN=$(gh api user --jq .login)

# All review comments by the current user on this PR
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.user.login == \"$BOT_LOGIN\") | {id, path, line, body, created_at}"
```

### Step 2 — Signal (a): 👎 reactions

```bash
# For each comment_id from Step 1:
gh api repos/$REPO/pulls/comments/$COMMENT_ID/reactions \
  --jq ".[] | select(.content == \"-1\") | .user.login"
```

If the PR author's login appears in the output → signal (a) fired: the comment was dismissed.

### Step 3 — Signal (b): author reply correcting the finding

```bash
# Fetch the review thread for this comment
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.in_reply_to_id == $COMMENT_ID) | {user_login: .user.login, body}"
```

If a reply exists from the PR author AND no fix commit touches the commented line (Step 4 returns empty) → signal (b): the finding was challenged without action.

### Step 4 — Signal (c): author pushed a fix touching the commented line

```bash
# Commits on the PR branch after the review comment's created_at
gh api repos/$REPO/pulls/$PR_NUMBER/commits \
  --jq ".[] | select(.commit.author.date > \"$COMMENT_CREATED_AT\") | .sha"

# For each sha, check whether (path, line ± 5) was touched
gh api repos/$REPO/commits/$SHA \
  --jq ".files[] | select(.filename == \"$COMMENT_PATH\") | {patch}"
# If the patch hunk includes line ± 5 → resolution confirmed
```

Signal (c) requires at least one commit SHA that touches `(path, line ± 5)` after the comment was posted.

### Step 5 — Human-missed detection candidates

```bash
# All review comments from reviewers OTHER than the bot on lines the bot did NOT flag
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.user.login != \"$BOT_LOGIN\") | {path, line, body}"
```

Cross-reference against the bot's comment list (Step 1).
Lines in the human reviews but NOT in the bot reviews are detection candidates — flag for the lesson-write step.

---

## Entry points

**Automatic (lightweight):** the post-push reviewer-feedback loop that `/create-pr` backgrounds (`/implement-suggestion --watch`) already runs after the PR is open.
When that loop detects a PR merge event (`state: MERGED`), it MAY trigger outcome measurement as a tail step — this keeps the measurement co-located with the existing feedback path and avoids a separate cron.
The `--watch` loop already uses `gh api` for status polling; outcome measurement adds ~3 extra `gh api` calls.

**On-demand:** `/review-outcomes <pr>` runs the five steps above against any merged PR and writes the result to the lesson store.
Useful for retrospective audits or when the automatic path was not active.

Both entry points call the same shared `gh api` sequence above and write to the same lesson store.

---

## Writing outcome lessons

After collecting signals, write findings to `reviewer-lessons` via `persistent-memory`.

### Noise lesson (signals a or b)

When signal (a) or (b) fires for a comment:

```
Skill("persistent-memory", "write reviewer-lessons --tier home --auto")
```

Lesson body: "Last run's [category] comment on [path]:[line] was dismissed/challenged — over-flagging pattern: [short description of what was flagged]. Consider lowering confidence or using `question:` framing in [context]."

Classify: if the pattern is universal (e.g. "null-check assertions in safe-context `!` non-null assertions"), write to `home`; if repo-specific (e.g. "this repo's `EnsureMcpIntegrationId` is always guaranteed non-null by construction"), write to `project-shared` when opted in.

### Resolution lesson (signal c)

When signal (c) fires — the author acted on the finding:

UPDATE the existing lesson entry (if one exists for this pattern) with `seen_count` incremented.
See the existing promotion contract in `skills/authoring/persistent-memory/rules/write-pipeline.md` for the `seen_count` UPDATE sentence — do not restate it here; follow the contract as documented there.
Resolution signal (c) is an **additional trigger** for promotion alongside `seen_count`: a lesson that accumulates ≥ 3 resolution confirmations is promoted even if `seen_count` has not reached the standard threshold.

### Detection candidate lesson (Step 5)

When a human reviewer independently catches something the bot missed:

```
Skill("persistent-memory", "write reviewer-lessons --tier home --auto")
```

Lesson body: "Human reviewer caught [pattern] on [path]:[line] that was not flagged — detection candidate: [short description]. Add to rubric or lower confidence threshold for this class."

---

## Outcome-driven promotion

The standard promotion gate (`seen_count ≥ 3`) remains unchanged for pattern-based lessons.
Outcome signals add a parallel gate:

| Condition | Promotion action |
| --- | --- |
| ≥ 3 resolution confirmations (signal c) for the same pattern | Promote to `diagnose` slow tier — this pattern reliably gets fixed |
| ≥ 3 dismissals (signal a) for the same pattern | Promote as a **noise pattern** — consider adding to a `filters:` entry in `.review.yaml` |
| ≥ 2 human-catch candidates of the same class | Surface as a detection candidate to the user; suggest rubric expansion |

---

## What this does not change

- The existing `reviewer-lessons` fast-tier read/write contract in `reviewer.md` Step 0.7.
- The `seen_count` UPDATE contract (owned by `persistent-memory/rules/write-pipeline.md`).
- The two-tier lesson storage model (`home` vs opt-in `project-shared`).
- The per-comment confidence threshold (still 80 — outcome signals inform lessons, not the per-run gate).

Outcome learning is an **async improvement loop**, not an in-run gate.
It runs after the PR closes, not during the review.

---

## What this rule does not do

- Re-run or re-score in-flight comments based on outcomes.
- Change the posting authorization gate (`authorization-gate.md`) — posting is always gated by `--publish`.
- Access private PR data beyond what the `gh` CLI exposes to the authenticated user.
