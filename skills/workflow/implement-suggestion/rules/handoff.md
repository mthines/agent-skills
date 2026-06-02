---
title: Handoff — Lane Split and Worker Dispatch
impact: HIGH
tags:
  - handoff
  - dispatch
  - subagent
  - fast-lane
  - standard-lane
---

# Handoff

Phase 6 dispatches the per-PR work to a worker subagent. The fast-lane
hands the pack directly to the worker; the standard-lane routes through
`aw-planner` first to author a `plan.md` from the pack.

## Lane selection

Pick lane per PR using the complexity signals captured in Phase 5's pack.
**All `apply`-tagged comments must agree on lane** — one architectural
change forces the whole PR into standard-lane.

### Fast-lane preconditions (all must hold)

- Every `apply` comment edits a **single file**.
- No `/critical` finding raised `Critical` or `Major`.
- Across the PR, ≤ 3 files are touched in total.
- No `apply` comment proposes a rename / move / signature change (any
  cross-file ripple).

### Standard-lane triggers (any one)

- Any `apply` comment spans ≥ 2 files.
- Any `/critical` finding tagged `Major`.
- ≥ 4 files touched across the PR.
- Any `apply` comment proposes a rename / signature change / API surface change.
- Pack contains contradictory `apply` comments (B references A; the worker
  cannot decide ordering without a plan).

Record the chosen lane in the pack's frontmatter as `lane: fast | standard`.

## Fast-lane dispatch

Skip `aw-planner`. Dispatch the worker directly with the pack:

```
Agent(
  description: "Apply suggestion-pack to PR #<n>",
  subagent_type: "general-purpose",
  prompt: <worker prompt — see below>
)
```

The worker reads the pack at `.agent/<branch>/suggestion-pack.md`,
applies the changes, runs the project's fast checks, commits, and pushes.

## Standard-lane dispatch

Step A — `aw-planner`:

```
Agent(
  description: "Plan suggestion implementation for PR #<n>",
  subagent_type: "aw-planner",
  prompt: <planner prompt — see below>
)
```

The planner consumes the pack, authors `.agent/<branch>/plan.md` with full
acceptance criteria, gates on `confidence(plan) ≥ 90%`, and either returns
"plan ready" or "below gate".

- **Plan ready** → continue to Step B.
- **Below gate** → surface the planner's concerns, do **not** auto-apply.

Step B — worker:

```
Agent(
  description: "Apply suggestion-plan to PR #<n>",
  subagent_type: "general-purpose",
  prompt: <worker prompt, with plan.md cited as source of truth>
)
```

## Worker prompt template

Filled per PR, passed to the dispatched general-purpose subagent. Inline this
as the `prompt` field — no external file lookup required by the worker.

```text
Apply reviewer suggestions to an existing pull request.

## Context
- PR: <owner>/<repo>#<n> (<branch>)
- Worktree: <absolute-path>
- Lane: <fast | standard>
- Pack: <absolute-path>/.agent/<branch>/suggestion-pack.md
- Plan (standard-lane only): <absolute-path>/.agent/<branch>/plan.md

## Inputs you will read
1. The pack (every lane).
2. The plan (standard-lane only).

## What to do
1. cd <worktree>.
2. Verify git status --porcelain is empty and HEAD == <head-sha-from-pack>.
   If either fails, STOP and report — do not auto-stash or auto-rebase.
3. For each `apply` entry in the pack (or each Acceptance Criterion in the
   plan, for standard-lane), apply the proposed edit using Edit / Write.
4. Run the project's fast checks if wired up (lint + typecheck + unit tests
   scoped to the touched files only). If a check fails:
   - For a clear mechanical fix (formatter / lint autofix): apply, re-check.
   - For anything else: STOP and report — do not "fix until green" by
     weakening tests or types.
5. Compose a single commit message:

   ```
   address review comments

   - <one bullet per applied comment, citing reviewer handle and comment URL>

   Refs: <pr-url>
   ```

6. git commit (no --no-verify, no Co-Authored-By).
7. git push (no --force, no --force-with-lease).

## Hard rules
- DO NOT open a new PR. The PR exists at <pr-url>.
- DO NOT push --force or --force-with-lease.
- DO NOT skip hooks.
- DO NOT delete or weaken tests or types.
- DO NOT modify files outside the pack's apply list.
- If push is rejected because the branch moved on the remote, STOP and
  report. Do not auto-rebase.

## Output you return
A short report:

- Commit SHA (or "not committed: <reason>").
- Push status (success / rejected — verbatim error).
- Per-comment outcome: applied / skipped-with-reason.
- Fast-check status: passed / failed-with-excerpt.
```

## Planner prompt template (standard-lane only)

```text
Plan the implementation of reviewer suggestions for an existing pull request.

## Context
- PR: <owner>/<repo>#<n> (<branch>)
- Worktree: <absolute-path>
- Pack: <absolute-path>/.agent/<branch>/suggestion-pack.md

## Constraints unique to this task
- The PR already exists at <pr-url>. The executor will commit and push to
  the existing branch — do NOT include a "create draft PR" step in the plan.
- The plan must address every `apply`-tagged comment in the pack.
- Acceptance Criteria must be one-per-comment, testable, and traceable.
- The plan must respect the worktree's current HEAD (<head-sha>) — no rebase.

## Required plan sections
- Goal (one sentence per comment cluster)
- Acceptance Criteria (one per applied comment, with comment ID + test)
- File Changes (every file touched, with rationale)
- Risk and Rollback
- Test Plan

Gate on confidence(plan) ≥ 90%. Below-gate returns concerns; no force-proceed.
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
- **Workers never amend prior commits.** One commit per PR, per run.
- **Standard-lane below-gate stops.** No silent fallback to fast-lane.
- **Main agent does not edit files in Phase 6** — all `Edit` / `Write` calls
  happen inside the worker subagent.
