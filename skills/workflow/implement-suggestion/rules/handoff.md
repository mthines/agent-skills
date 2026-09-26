---
title: Handoff — Worker Dispatch
impact: HIGH
tags:
  - handoff
  - dispatch
  - subagent
---

# Handoff

Phase 6 dispatches each PR's pack to **one worker sub-agent**. There is one lane:
no planner runs between the pack and the worker.

## Before dispatching — order the pack

The worker applies `apply` entries sequentially, in pack order, so ordering is
decided here, not by the worker:

- **B builds on A** (B's edit assumes A's) → A comes first in the pack.
- **B contradicts A** (no order makes both true) → move **both** to `surface`
  with the contradiction named; never pick a winner silently.
- Everything else keeps Phase 4's order.

## Why there is no planner lane

Up to v2.4 a PR whose comments spanned ≥ 2 files, touched ≥ 4 files, or proposed
a rename / signature change went through `aw-planner` first ("standard lane").
It was removed in v3.0.0:

1. **Every change is already judged.** Each `apply` entry passed `/critical` and
   `/confidence` in Phase 4; a planner's `confidence(plan)` gate re-scored the same
   decisions a second time.
2. **The ripple it guarded against is caught mechanically.** The worker's step 3.5
   runs the repo's fast checks unscoped before the single push, which is what sees
   a consumer broken in a file no comment listed — and it stops the push instead
   of predicting.
3. **It was unreachable where the loop runs unattended.** `aw-planner` is a custom
   agent type that Dash0 Agent0 cannot dispatch, and a `review-loop` iteration's
   apply step already sits one dispatch deep.
4. **Two lanes meant two contracts** (pack vs `plan.md`) for one worker prompt.

A `/critical` `Must-fix` still forces `surface` in Phase 4, exactly as before.

## Dispatch

```
Agent(
  description: "Apply suggestion-pack to PR #<n>",
  subagent_type: "general-purpose",   # or "general" — see Generic sub-agent type
  prompt: <worker prompt — see below>
)
```

The worker reads the pack at `.agent/<branch>/suggestion-pack.md`, then for
each `apply` comment: applies the edit, runs the project's fast checks, and
makes one commit citing that comment. After all commits it runs the unscoped
pre-push check, pushes once, then resolves each addressed review thread (reply
with the commit SHA, then `resolveReviewThread`) so the PR is left clean.

## Generic sub-agent type

The worker is a **generic** sub-agent, and hosts spell that type differently:
`general-purpose` in Claude Code, `general` in OpenCode-based hosts such as Dash0 Agent0.
Pass whichever of the two the dispatch tool's `subagent_type` accepts.
A missing `general-purpose` is a spelling difference, never evidence that dispatch is unavailable.

```text
❌ WRONG — a name check; strands the worker on every OpenCode-based host
if "general-purpose" not in subagent_types: skip

✅ RIGHT — the capability, whichever spelling the host lists
TYPE = "general-purpose" if "general-purpose" in subagent_types else "general"
```

The dispatch block writes `"general-purpose"`; read it as `TYPE`.

## Worker prompt template

Filled per PR, passed to the dispatched generic sub-agent ([type](#generic-sub-agent-type)). Inline this
as the `prompt` field — no external file lookup required by the worker.

```text
Apply reviewer suggestions to an existing pull request.

## Context
- PR: <owner>/<repo>#<n> (<branch>)
- Worktree: <absolute-path>
- Pack: <absolute-path>/.agent/<branch>/suggestion-pack.md

## Inputs you will read
1. The pack — the only input. Its `apply` entries are already ordered.

## What to do
1. cd <worktree>.
2. Verify git status --porcelain is empty and HEAD == <head-sha-from-pack>.
   If either fails, STOP and report — do not auto-stash or auto-rebase.
3. Process each `apply` entry in the pack SEQUENTIALLY, in pack order. This is
   ONE COMMIT PER COMMENT — do not batch multiple
   comments into a single commit. For each entry:

   a. Apply that comment's proposed edit using Edit / Write. Touch only the
      files that comment's pack entry lists.
   b. Run the project's fast checks scoped to the touched files (lint +
      typecheck + unit tests) if wired up. This is the FAST per-comment signal;
      it is scoped, so it cannot see a consumer this comment's edit broke in a
      file it did not touch — step 3.5 catches that. If a check fails:
      - For a clear mechanical fix (formatter / lint autofix): apply, re-check.
      - For anything else: STOP and report — do not "fix until green" by
        weakening tests or types. Leave the commits already made in place as
        LOCAL-ONLY, and do NOT proceed to steps 4 or 5: push nothing and
        resolve nothing. A partial batch must not reach the remote.
   c. git add the files for THIS comment only, then git commit (no --no-verify,
      no Co-Authored-By) with this message:

      ```
      address review comment: <one-line summary of this comment's fix>

      Addresses @<author>'s comment: <comment-url>

      Refs: <pr-url>
      ```

   d. Record the resulting commit SHA and the comment's `threadId` for step 5.

3.5. BEFORE pushing, run the project's fast checks ONCE MORE over the WHOLE
   repository — unscoped (lint + typecheck + unit tests, whatever the repo wires
   up as its local pre-push bar). Step 3b's checks are scoped to each comment's
   own touched files, so a rename, a signature change, or a moved export can
   commit cleanly per-comment and still leave a consumer broken in a file no
   entry listed. That is the cross-file breakage a per-comment check cannot see,
   and pushing it turns CI red for a reason this worker already had in hand.

   If the full pass fails:
   - For a clear mechanical fix (formatter / lint autofix): apply it and add ONE
     FIXUP COMMIT naming the comment it belongs to, then re-run the full pass.
     Never amend — amending rewrites the SHA step 3d recorded, and step 5a posts
     that SHA to the thread as `Addressed in <commit-sha>`, so an amended batch
     replies with SHAs that are not on the remote. This is the same reason the
     Hard rules below say workers never amend prior commits.
   - For anything else: STOP and report exactly as in step 3b — leave the commits
     LOCAL-ONLY, push nothing, resolve nothing. Report which check failed, its
     output excerpt, and which comment's change most plausibly caused it. Do NOT
     weaken a test, loosen a type, or narrow the check's scope to get past it.

   Skip this step ONLY if the repo wires up no such command at all. If step 3b
   was skipped for that reason, this step is skipped too — say so in the report
   rather than implying the batch was verified.

4. git push (no --force, no --force-with-lease). Only reach this step if EVERY
   `apply` entry committed without a STOP in step 3b AND the full pre-push pass
   in step 3.5 came back clean — otherwise you already aborted above. Push ONCE,
   after every per-comment commit is made, so all the fix commits reach the
   remote before any thread is resolved.

5. Resolve each addressed thread so the PR is left clean — one thread per
   committed comment, IN THE SAME ORDER you committed. For each `apply` entry
   whose commit landed AND whose `threadId` is non-null:

   a. Post a brief reply on the thread tying the commit to the comment (this is
      the visible "which commit resolved which comment" trail). Reply to the
      thread's top-level comment id (the pack's comment `id`):

      ```bash
      gh api --method POST \
        "repos/<owner>/<repo>/pulls/<n>/comments/<comment-id>/replies" \
        -f body="Addressed in <commit-sha>. ✅"
      ```

   b. Resolve the thread:

      ```bash
      gh api graphql -f query='
        mutation($threadId: ID!) {
          resolveReviewThread(input: {threadId: $threadId}) {
            thread { isResolved }
          }
        }' -f threadId="<threadId>"
      ```

   If `threadId` is null (an `issues` comment, a top-level `review` summary, or
   a `report-*` entry expanded from a reviewer report — these have no resolvable
   thread), SKIP the reply + resolve for that entry and note it as
   "no thread to resolve" in your report. Do NOT resolve threads for
   `surface` / `skip` comments — only the ones you actually addressed.

   A `report-*` entry is never resolvable and must not be counted as an
   unresolved failure either: the finding lives in a review body, and the trail
   that it was addressed is the fix commit citing it. `pr-reviewer`'s next pass
   re-checks its own body-only findings and drops the ones that are gone
   (`agents/shared/rules/prior-comment-awareness.md § Carry-forward of
   anchorless findings`), which is what closes the loop instead of a thread
   resolution.

   Resolve-side failures do NOT abort — the commits are already on the remote,
   so unlike step 3b there is nothing to hold back. If a reply or
   `resolveReviewThread` call errors on one thread (permission denied, or a bot
   already resolved it — `resolveReviewThread` on an already-resolved thread is
   a safe no-op), record that thread as `not-resolved: <verbatim error>` and
   CONTINUE to the next thread. Never unwind a landed commit because a
   resolution call failed.

6. RESOLVE-ALL PASS — run this step ONLY if the pack frontmatter has
   `resolve-all: true`. It closes the non-fix threads and makes NO code changes,
   NO commits, and NO push. For each entry in the pack's `## Reply-only`
   section, post a reply then resolve the thread (same two `gh api` calls as
   step 5a/5b — reply to the comment id, then `resolveReviewThread` on its
   `threadId`), using the reply text the pack supplies:

   - `question`   → the answer to the question.
   - `discussion` → the agent's take / decision on the discussion.
   - declined `actionable` / `nit` → the rationale for not applying (a decline).

   EXCEPTION — a `human-judgment flag` entry (`disposition: flag`): post the
   reply noting why it is flagged, then DO NOT resolve — leave the thread open.
   These are the only threads left open under resolve-all.

   Resolve-side failures here are non-fatal exactly as in step 5 — record
   `not-resolved: <verbatim error>` and continue. If the pack has no
   `## Reply-only` section, skip this step.

## Hard rules
- DO NOT open a new PR. The PR exists at <pr-url>.
- DO NOT push --force or --force-with-lease.
- DO NOT skip hooks.
- DO NOT delete or weaken tests or types.
- DO NOT modify files outside the pack's apply list.
- DO NOT batch comments — exactly one commit per addressed comment.
- DO NOT push a partial batch. If step 3b STOPs on any comment, push nothing
  and resolve nothing — leave the completed commits local and report them as
  un-pushed.
- DO NOT resolve a thread whose commit did not land. Only resolve a fix thread
  you addressed with a landed commit. (Under `resolve-all`, step 6 additionally
  resolves reply-only threads — but never a `flag` entry, and never a thread
  whose intended fix was aborted.)
- If push is rejected because the branch moved on the remote, STOP and
  report BEFORE resolving any thread. Do not auto-rebase. (Resolving a thread
  whose fix is not on the remote would leave a misleading trail.)

## Output you return
A short report, one row per `apply` comment:

- Comment ID / @author → commit SHA (or "not committed: <reason>") →
  thread status (resolved / no-thread / not-resolved: <reason>).
- Push status (success / rejected — verbatim error).
- Fast-check status per comment: passed / failed-with-excerpt.
- Full pre-push check status (step 3.5): passed / failed-with-excerpt / skipped (no command wired up).
```

## Parallelization

Per-PR dispatches in Phase 6 run in **parallel across PRs** (one message,
multiple Agent calls). The worker subagents do not share state. The Phase 7
report aggregates after all return.

## Stuck-loop and retries

The worker subagent has **no retry budget** by design. A failed apply
(test broken, push rejected, file moved) surfaces immediately. The skill
does not auto-retry — the user reads Phase 7, decides, re-runs
`/implement-suggestion` against the specific comment URL if they want a
second attempt.

This is the opposite policy from `aw-executor`'s 5-iteration stuck-loop
because reviewer comments are usually trivially scoped — a stuck loop on
a one-comment apply is almost always a sign the comment was
misclassified, not that the agent needs more attempts.

## Hard rules

- **Workers never open new PRs.** Push to existing branch only.
- **Workers never amend prior commits.** One commit per addressed comment.
- **Workers resolve every thread they addressed** — reply with the commit SHA,
  then `resolveReviewThread`. A landed fix whose thread is left open is a
  reporting bug. Without `resolve-all`, `surface` / `skip` threads stay open.
  With `resolve-all`, the step-6 pass also closes reply-only threads (answered
  question, taken discussion, declined change); only `flag` entries stay open.
- **Contradictory `apply` comments are surfaced, never ordered by guess.** See [Before dispatching](#before-dispatching--order-the-pack).
- **Main agent does not edit files in Phase 6** — all `Edit` / `Write` calls
  happen inside the worker subagent.
