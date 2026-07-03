---
title: Prior-comment awareness — dedup against existing review history + anti-flip-flop
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - dedup
  - incremental
  - flip-flop
---

# Prior-comment awareness

A PR review rarely starts from a blank slate.
In an incremental review (a second pass after a push), a `--watch` loop (`/implement-suggestion --watch`), or any Self-Review re-run, the agent may produce findings it already produced — or worse, findings that *contradict* ones it produced or the author already resolved.

"Recommend X → later revert X → re-recommend X" is the single most-reported complaint about automated reviewers in the 2026 field studies.
Bugbot reads prior PR comments as context specifically to prevent this flip-flop.
This rule implements that same state-awareness.

---

## When this step runs

| Agent | When | Scope |
| --- | --- | --- |
| `pr-reviewer` | **Default ON** — at the start of Step 1, before any finding is produced | All incremental and first-pass runs on an existing PR |
| `reviewer` (Self-Review sub-mode) | **Self-Review only** — at the start of Step 1.1 | Re-runs on own PR (own branch fix/report modes have no prior GitHub state) |

For `reviewer` in Fix Mode or Report Mode (no PR exists yet), skip this step entirely.

---

## Step: fetch existing PR comment state

Run once at Step 1, after Step 0.5 (authorship check) and before Step 1.1 (diff acquisition):

```bash
REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
BOT_LOGIN=$(gh api user --jq .login)

# All existing review comments on this PR (all authors)
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq '.[] | {id, path, line, body, user_login: .user.login, in_reply_to_id}' \
  > /tmp/prior-comments.json

# Comments authored by this agent (bot login)
BOT_COMMENTS=$(jq --arg login "$BOT_LOGIN" '[.[] | select(.user_login == $login)]' /tmp/prior-comments.json)

# Resolved threads (those with a reply or a 👍 reaction on the bot's comment)
# Use the already-documented outcome-learning.md Step 2 pattern for resolution check
```

Store `BOT_COMMENTS` and `/tmp/prior-comments.json` for use in the dedup and anti-flip-flop checks below.

---

## Dedup against prior bot comments

A new proposed finding is a **duplicate** of a prior bot comment when:

| Condition | Action |
| --- | --- |
| Same `(path, line ± 2)` AND same Conventional-Comments prefix | **DROP** the new finding — it was already said |
| Same `(path, line ± 2)` AND different prefix | **Keep** the new finding — a different lens on the same line is additive |
| Same pattern / claim but on a different line (code moved) | **Keep** — the location changed; re-flagging is valid |

The `± 2` tolerance handles minor line-number drift from the author's subsequent commits.

Log dedup drops:

```
[prior-comment] DROP src/foo.ts:42 — suggestion: already posted in prior review (comment #12345)
```

Count in the Quality Gate summary: `Prior-comment dedup drops: N`.

---

## Anti-flip-flop state

The flip-flop invariant: **the agent MUST NOT reverse a previously accepted or resolved suggestion.**

A suggestion is **accepted / resolved** when any of the following hold:

1. The commented line was subsequently changed in a commit after the comment was posted (outcome-learning signal c).
2. The PR thread for the comment is marked resolved.
3. The PR author replied "fixed", "done", "addressed", "resolved", or a similar acknowledgement.

Check each new proposed finding against prior accepted / resolved suggestions:

```bash
# Check if the bot previously suggested OPPOSITE of current new finding
# e.g., bot said "use Map here" (resolved) → now bot says "use Record here"
```

This is a semantic check, not a grep.
The agent must evaluate: "Does my new finding contradict a prior finding that was acted on?"

If yes → **DROP** the new finding unconditionally.
Log the drop:

```
[anti-flip-flop] DROP src/foo.ts:55 — new suggestion contradicts resolved prior comment #12345 (previously suggested `Map`, author applied it; now re-suggesting `Record`)
```

This drop is NOT subject to override or confidence gate.
A contradiction with a resolved suggestion is dropped regardless of confidence score.
The finding may be surfaced in the terminal output for human review, but it is never posted.

---

## What "accepted / resolved" includes

| State | Counts as resolved |
| --- | --- |
| Author pushed a commit touching `(path, line ± 5)` after comment | Yes |
| Thread explicitly marked resolved on GitHub | Yes |
| Author replied with acknowledgement text | Yes |
| Author replied with disagreement / explanation and no fix | **No** — the author challenged the finding; re-flagging in a later pass is allowed |
| 👎 reaction by the author | **No** — dismissal means the finding was wrong, not accepted; the noise lesson fires, but re-flagging is not prevented (the agent should have dropped it originally, and the outcome-learning loop handles that) |

---

## Hardening incremental and --watch paths

For incremental review passes (a new diff pushed, a `--watch` iteration):

1. Always re-fetch `/tmp/prior-comments.json` at the start of each iteration.
2. Treat the prior comment state as the ground truth for dedup and anti-flip-flop.
3. Do NOT assume the prior payload artifact (`.agent/pr-review/...payload.json`) is the complete picture — the author may have replied or resolved threads since that artifact was written.

The prior-comment fetch is cheap (one `gh api` call); always re-run it rather than relying on stale state.

---

## Logging

The Quality Gate summary adds two new rows:

```
Prior-comment dedup drops: N  (already said in a prior review pass)
Anti-flip-flop drops:      M  (would contradict a resolved prior suggestion)
```

Both are emitted even when N = 0 and M = 0, so the user can see the step ran.

---

## What this rule does not do

- Re-run outcome measurement — that is `outcome-learning.md`.
- Change the authorization gate (`authorization-gate.md`) — posting still requires `--publish`.
- Apply to Fix Mode or Report Mode in `reviewer` (no prior GitHub state exists on a branch-only review).
- Drop a finding because an author *challenged* (not accepted) a prior finding — disagreement does not prevent re-flagging; outcomes do.
