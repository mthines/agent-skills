---
title: 'Full tier — dispatch, review recovery, verification, single-context fallback'
impact: HIGH
tags:
  - aw
  - full-tier
  - dispatch
---

# Full tier

Read when the tier is Full.

## Contents

- [Dispatch the split](#dispatch-the-split)
- [Review recovery when the executor could not dispatch](#review-recovery-when-the-executor-could-not-dispatch)
- [Verify at PR open — you dispatch `feature-pr-verifier`](#verify-at-pr-open--you-dispatch-feature-pr-verifier)
- [When sub-agent dispatch is unavailable](#when-sub-agent-dispatch-is-unavailable)

## Dispatch the split

Test for dispatch by capability: does any available tool dispatch a sub-agent (`Task` in the Claude Code CLI, `Agent` in the Claude Agent SDK harness, or another spelling)?
Never read the absence of the single name `Task` as "no dispatch".
Wherever this file writes `Task(...)`, use the tool your grant holds.

```text
Task(subagent_type="aw-planner", prompt=<user request + the lessons you matched + the flags (--no-confirm, --critical, --interview/--no-interview)>)
# wait for the gated handoff: confidence(plan) ≥ 90% or user-approved
# print the handoff's "- Goal:" line with the Full-split instruction from goal-emission.md
Task(subagent_type="aw-executor", prompt="Execute the plan at .agent/<branch>/plan.md")
```

While the split is dispatchable, never use `Edit`, `Write`, or `Bash` on production code, tests, or docs yourself — that is `aw-executor`'s job.

## Review recovery when the executor could not dispatch

`create-pr`'s Phase 6 `review-loop` needs a sub-agent dispatch, which a dispatched `aw-executor` usually lacks, so it hands back a draft PR flagged `NOT REVIEWED`.
When the executor reports the review as skipped, run it yourself before handing back, chosen by what your context can do:

| Your context | Action |
| --- | --- |
| You hold a sub-agent dispatch tool, or you cannot tell | `Skill("review-loop", "<pr-url> --critical --no-ci --no-preview-run")` — relay any skip line it returns verbatim |
| You hold none | Do not invoke the loop; hand back the draft PR flagged `NOT REVIEWED` |

Record the outcome in `Degraded:`. A green-CI draft PR is not a reviewed one.

## Verify at PR open — you dispatch `feature-pr-verifier`

You own the independent verification: dispatch it once, as soon as the executor returns a PR URL, after any review recovery, without waiting for CI.
Everything it reads lives in the planner's worktree (`Worktree:` in the handoff message):

```bash
WT=<the Worktree: path from the planner's handoff>
PR=<the PR URL the executor returned>
gh pr view "$PR" --json headRefOid,baseRefOid -q '.headRefOid + " " + .baseRefOid'
# test command: the Before-PR command in plan.md's Acceptance Criteria — never guessed
```

Preconditions — all four, else record `Verified: not run (<reason>)`:

1. Tier is Full and `$WT/.agent/<branch>/plan.md` exists.
2. The executor returned a PR URL and `gh pr view` returned both SHAs.
3. `plan.md` or `checks.yaml` names the project's test command.
4. An available tool dispatches a sub-agent and accepts `feature-pr-verifier` as its type; otherwise `not run (feature-pr-verifier not dispatchable on this host)`.

```text
Task(subagent_type="feature-pr-verifier", prompt="""
Verify this feature PR. Run every command from the worktree <WT>, never from any other checkout.
Inputs:
- plan.md path: <WT>/.agent/<branch>/plan.md
- walkthrough.md path: <WT>/.agent/<branch>/walkthrough.md
- PR head SHA: <headRefOid>
- Base SHA: <baseRefOid>
- Project test command: <from plan.md / checks.yaml>
Follow the feature-pr-verifier agent's procedure end-to-end. Run all four checks.
Return the verdict block in the exact format specified. Do not propose fixes.
""")
```

One dispatch, no retry.
The verdict is advisory and never undrafts, but a Full run is not complete until `Verified:` carries `green`, `red (<check>: <reason>)`, or `not run (<reason>)`; a `red` verdict also goes into `Needs you:`.

## When sub-agent dispatch is unavailable

When no available tool dispatches a sub-agent under any name, run a **single-context Full**: play the planner role, then the executor role, in this window.
Never drop to the Micro/Lite path instead — that discards `plan.md` and the `confidence(plan)` gate.

1. **Planner role (Phases 0–2):** validate, plan, create the worktree, write the brief + `checks.yaml` via `Skill("aw-create-plan")` with the matched lessons, and clear `confidence(plan) ≥ 90%` before any production edit. Print the goal line with the single-context instruction from `goal-emission.md`.
2. **Executor role (Phases 3–7):** implement against the brief, gate Phase 4 on the `run-checks.mjs` sentinel, update docs, open the draft PR, watch CI.
3. Log one Progress Log line: `- [TIMESTAMP] aw: sub-agent dispatch unavailable — running Full tier single-context (planner + executor roles in one window). Plan artifact + confidence gate preserved.`
4. Record `Verified: not run (sub-agent dispatch unavailable)` — grading your own work in your own window is the self-grading the verifier exists to remove.

Only when you also lack `Edit`, `Write`, and `Bash` do you tell the user to run `aw-planner` then `aw-executor` themselves.
