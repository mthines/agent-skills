---
title: Thread resolution — auto-resolve addressed threads and record the outcome on re-review
impact: HIGH
tags:
  - pr-reviewer
  - incremental
  - thread-resolution
  - comment-relevance
  - self-improvement
  - lorekit
---

# Thread resolution

On a re-review — the commit-triggered second (third, …) pass over a PR the agent
already reviewed — the agent reconciles its **own** prior inline comments against
the current state of the code, then does two things for each one:

1. **Resolves the GitHub review thread** when the comment has been addressed or
   explicitly declined, so a re-run cleans up after itself instead of leaving a
   growing pile of stale open threads (the behaviour a human reviewer — and
   Cursor's reviewer — is expected to have).
2. **Writes the resolution outcome to LoreKit** (`reviewer-comment-relevance`,
   the per-repo Signal bucket), so the fixed / declined / ignored signal
   accumulates and future reviews on this repo get progressively less noisy.

This is the in-run, proactive counterpart to the post-merge write path in
[`comment-relevance-memory.md`](./comment-relevance-memory.md): it fires on every
commit, not only at merge, so the cleanup and the learning happen while the PR is
still open.

---

## When this step runs

This rule is **`pr-reviewer`-only.** Resolving a GitHub thread is a write to
GitHub, and `pr-reviewer` is the review agent that writes to GitHub.
In both relations it posts a single visible `COMMENT` review at Step 4
(`REVIEW_RELATION` only adjusts the framing tone), so thread resolution applies
to both relations on a re-review pass. The relevance signal from threads that were not resolved here
comes from the post-merge path (`outcome-learning.md`) and the GitHub Action instead.

| Agent | When | Gate |
| --- | --- | --- |
| `pr-reviewer` | On every re-review (a prior `<!-- PR_REVIEWER_REPORT -->` review exists — `PRIOR_REVIEW` non-empty in Step 0.7) | Resolution + write always run; posting the new review is unaffected |

It **never** runs on a first-pass review (no prior threads to reconcile).

It consumes the `BOT_COMMENTS` set and the resolved/accepted detection already
built by [`prior-comment-awareness.md`](./prior-comment-awareness.md) — it does
not re-fetch or re-derive them.

---

## Classify each prior own-comment

For every comment in `BOT_COMMENTS` (this agent's own prior inline comments) that
sits on an **unresolved** GitHub thread, assign exactly one status. Reuse the
`prior-comment-awareness.md § What "accepted / resolved" includes` table for the
signals; this rule only adds what to DO with each.

| Status | Condition | Thread action | Memory write |
| --- | --- | --- | --- |
| **fixed** | The commented region changed after the comment was posted (a commit touched `(path, line ± 5)`) AND the current run does **not** re-produce a finding with the same fingerprint at/near that location | **Resolve** | `relevant` / `fixed` |
| **declined** | The author replied "won't fix" / "by design" / "intentional" / "n/a", or 👎-reacted the comment | **Resolve** | `not-relevant` / `wont-fix` |
| **acknowledged** | The author replied "fixed" / "done" / "addressed" and the thread is on a line the delta touched | **Resolve** | `relevant` / `fixed` |
| **persisting** | The current run re-produces the same finding (the issue is still there) | **Leave open** | none (the finding carries forward and stays posted) |
| **unaddressed** | None of the above — the line is untouched, no reply, and the delta did not cover it (so the current pass could not re-confirm it) | **Leave open** | none — absence of a re-scan is not evidence of resolution |

Two hard rules:

- **Only ever touch threads this agent authored.** Never resolve a human's or a
  different bot's thread. Match on `user.login == BOT_LOGIN`.
- **Never resolve a `persisting` or `unaddressed` thread.** Resolving a thread
  whose issue is still live would hide a real finding — the exact failure this
  feature must not cause. When in doubt, leave it open.

The fingerprint is the same `category:claim-gist` used by
`comment-relevance-memory.md` — derived from the prior comment's Conventional
Comments prefix and its one-line claim, never from `file:line`.

---

## Resolve the thread

GitHub review threads are resolved through the GraphQL `resolveReviewThread`
mutation; the thread's node id is not on the REST comment object, so map from the
comment to its thread first. All calls go through `gh api` (Bash) — no new tool.

**Reuse the Step 1.0 fetch.** `prior-comment-awareness.md § Thread state` already wrote
`/tmp/review-threads.json` at the start of the run, with the same query and a completed
pagination walk. Read that file instead of re-querying.
Re-run step 1 below in exactly two cases: the file is absent (the Step 1.0 fetch never ran),
or its `complete` field is `false` (the Step 1.0 walk stopped early).
Posting the review at Step 4 is **not** a re-fetch trigger.
The only threads the Step 1.0 snapshot can be missing are the ones this run's own review just
created, and those are never resolution candidates here — step 2 below reconciles only threads
whose root comment is a **prior** comment.
That is what makes this a call moved earlier rather than a call added.
Re-resolving a thread this run already resolved is a safe no-op either way.

```bash
# 1. List the PR's review threads with their resolved state and member comment ids.
#    This is character-for-character the query and pagination walk in
#    `prior-comment-awareness.md § fetch existing PR comment state`, so the two
#    produce the same `/tmp/review-threads.json`. Edit them together.
# Derive both halves from RESOLVED_REPO (`owner/repo`, set in `pr-reviewer` Step 0) rather
# than from REPO: Step 0 binds REPO to the bare repository name, so `${REPO%%/*}` would
# yield the repo name as the owner unless some earlier rule happened to rebind it.
OWNER="${RESOLVED_REPO%%/*}"
REPO_NAME="${RESOLVED_REPO##*/}"
THREADS_QUERY='
  query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ id isResolved comments(first:100){ nodes{ databaseId } } }
        }
      }
    }
  }'

: > /tmp/review-thread-pages.json
CURSOR=""
THREADS_COMPLETE=true
while :; do
  # Capture the page, then append it with an explicit newline: `gh api graphql`
  # emits no trailing newline, so appending its stdout directly would run page 2
  # onto page 1's line.
  if ! PAGE=$(gh api graphql -f query="$THREADS_QUERY" \
       -F owner="$OWNER" -F repo="$REPO_NAME" -F pr="$PR_NUMBER" \
       -F cursor="${CURSOR:-null}"); then
    THREADS_COMPLETE=false
    break
  fi
  printf '%s\n' "$PAGE" >> /tmp/review-thread-pages.json
  HAS_NEXT=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$PAGE")
  CURSOR=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$PAGE")
  [ "$HAS_NEXT" = "true" ] || break
done

# One merged document with every page's nodes, in the shape the checks below read.
# `complete` persists THREADS_COMPLETE into the file. An aborted walk leaves the pages
# file empty, so without this flag the merged result `{nodes: []}` is indistinguishable
# from a PR that genuinely has no threads — and THREADS_COMPLETE is a shell variable that
# does not survive to Step 4.5, which reads only the file.
jq -s --argjson complete "$THREADS_COMPLETE" \
  '{complete: $complete, nodes: [.[].data.repository.pullRequest.reviewThreads.nodes[]]}' \
  /tmp/review-thread-pages.json > /tmp/review-threads.json

# complete == false means the walk stopped early — treat the thread map as
# incomplete and resolve nothing on the strength of it, never as "no more threads".
# This is the same flag the reuse check above reads off /tmp/review-threads.json.

# 2. For a prior comment classified fixed/declined/acknowledged, find its thread
#    id where isResolved == false and the thread's root comment databaseId matches
#    the comment id, then resolve it. Skip already-resolved threads (idempotent).
gh api graphql -f query='
  mutation($threadId:ID!){
    resolveReviewThread(input:{threadId:$threadId}){ thread{ id isResolved } }
  }' -F threadId="$THREAD_ID"
```

Resolution is **idempotent and non-fatal**: a thread already resolved is skipped,
and a mutation error (permissions, a thread that vanished) is logged and never
fails the review. Count resolutions in the Quality Gate summary as
`Threads resolved: <fixed> fixed, <declined> declined`.

---

## Write the outcome to LoreKit

For each `fixed` / `declined` / `acknowledged` comment, emit one
`reviewer-comment-relevance` memory — the same record shape, key format, scope
rule, and `seen_count` UPDATE contract defined in
[`comment-relevance-memory.md`](./comment-relevance-memory.md); this rule only
adds the trigger. Writes are append-only, non-blocking, and a silent no-op when
`memory.*` is not connected.

```
memory.write {
  scope: "repo::{owner}/{repo}",            # or "global" for a universal pattern
  key:   "reviewer-comment-relevance::<fingerprint>",
  value: "<record body: relevance, resolution_method, reason, examples, seen_count, expires>",
  tags:  ["loop::reviewer-comment-relevance", "source::<resolution_method>"],
  source_agent: "pr-reviewer",
  trigger: "re-review-reconcile"
}
```

The `loop::reviewer-comment-relevance` tag conveys the bucket's kind (`signal`)
and host (`reviewer`): LoreKit records both from the tag automatically (migration
`00056`), so the tag-only call above is sufficient. You may also set them
explicitly (`kind: "signal", host: "reviewer"`) now that they are first-class
properties (lorekit #372) — it is optional and equivalent to the inferred form
(see [`memory-buckets.md`](./memory-buckets.md)).

`persisting` and `unaddressed` comments are **not** written — a still-open
finding has no resolution outcome yet, and writing one would poison the signal.

Deduplicate before writing exactly as `comment-relevance-memory.md § Write`
prescribes (`memory.search` on the fingerprint, UPDATE-in-place on a re-sighting
so `seen_count` increments). A prior write from the GitHub Action or
`implement-suggestion` for the same fingerprint is additive — LoreKit increments
`seen_count`; a conflicting direction is surfaced, never silently overwritten.

---

## Ordering

Run this **after** the new review is posted (`pr-reviewer` Step 4, in both
relations), so a failure here can never block the review itself, and so
the current run's findings — needed to decide `persisting` vs `fixed` — are
final. The sequence per re-review is: fetch prior comments
(`prior-comment-awareness.md`) → produce and post the new review → reconcile prior
threads (this rule).

---

## What this rule does not do

- Resolve a thread whose finding still reproduces — `persisting` always stays open.
- Touch a thread the agent did not author.
- Post any new comment or reply — it only resolves threads and writes memory.
- Change the posting authorization gate — the new review still posts under the
  agent's normal contract; thread resolution is a separate, self-authored action.
- Replace the post-merge outcome sweep (`outcome-learning.md`) or the GitHub
  Action write path — it is an additional, earlier producer of the same signal.
