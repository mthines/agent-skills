---
name: aw
description: >
  Ships coding work to a tested draft PR from one opt-in entry point: detects the tier, runs
  Micro/Lite here, hands Full to aw-planner → aw-executor, and prints a paste-ready /goal. Use when
  asked to "implement autonomously", "independently", "in isolation", "in a worktree", "end-to-end",
  "all the way to a PR", "ship this", "land this", "take care of this", "handle this without me", or /aw.
disable-model-invocation: false
argument-hint: '<task-description> [--no-confirm] [--critical] [--interview|--no-interview] [--observability-strict]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: orchestrator
  tags:
    - autonomous
    - workflow
    - dispatcher
    - autonomous-workflow
---

# Autonomous Workflow Dispatcher (`aw`)

You are the single opt-in entry point for autonomous work.
You do two things: match the process to the task (detect the tier and route), and own the lessons loop for every tier.
The planning, coding, and testing procedures live in the workflow skill, its companions, and the planner/executor agents.

You are a skill, so you run in the caller's context:

- **Dispatch happens at your caller's level.** `aw-planner` / `aw-executor` are dispatched from the invoking session and keep whatever nested dispatch the harness grants. The dispatch tool is a capability, not a name: `Task` in the Claude Code CLI, `Agent` in the Claude Agent SDK harness.
- **You inherit tools rather than declaring them.** A tool absent from the caller's tool grant (LoreKit `memory.*`, `gh`, GitHub MCP) degrades its step, and the step is named in `Degraded:` — never silently skipped.
- **Your output is the caller's output.** The terminal contract below is what the user reads.

Why it is built this way: [`references/dispatcher-rationale.md`](references/dispatcher-rationale.md) — read when changing this skill.

## Contents

- [First actions](#first-actions)
- [Tier detection](#tier-detection)
- [Routing](#routing)
- [Brief and goal](#brief-and-goal)
- [Follow-ups after completion](#follow-ups-after-completion)
- [Terminal contract](#terminal-contract)
- [Hard rules](#hard-rules)

## First actions

1. Load the workflow: `Skill("autonomous-workflow")`. If unavailable, ask the user to install the companion set and stop.
2. Read lessons per [`rules/lessons.md`](rules/lessons.md) — read it now; the matches inform both the tier and the approach.
3. Detect the tier and emit the MODE SELECTION block.

## Tier detection

The tier table lives in one place: [`autonomous-workflow/SKILL.md` → *Step 1: Detect Workflow Mode*](../SKILL.md#step-1-detect-workflow-mode-mandatory).
Walk its four questions in order; the first `yes` wins; when in doubt, go heavier.
Do not restate the table here — L1 `G2b` asserts this file carries no tier rows.

```text
MODE SELECTION:
- Tier: [Micro | Lite | Full]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [trivial | simple | moderate | architectural]
- Lessons applied: [N matched, or none]
```

## Routing

| Tier | Who runs it | Plan artifact | Companions |
| ---- | ----------- | ------------- | ---------- |
| **Micro** | You, single-pass: Phase 0 quick confirm → Phase 2 worktree → edit → fast check → `docs update` only on drift → `create-pr` | in-conversation brief | none (docs if needed) |
| **Lite** | You, single-pass: the Lite path from `SKILL.md`; no `confidence(plan)` (no `plan.md` to gate) | in-conversation brief | per signal; Phase 5 docs and Phase 6 `create-pr` always |
| **Full** | `aw-planner` → `aw-executor` when sub-agent dispatch is available; otherwise a single-context Full run that keeps `plan.md` and the `confidence(plan)` gate | `plan.md` + `checks.yaml` | all applicable |

Full tier: [`rules/full-tier.md`](rules/full-tier.md) — read when the tier is Full. It holds the dispatch, the review recovery, the `feature-pr-verifier` dispatch at PR open, and the single-context fallback.

`--interview` / `--no-interview`: Full runs the `interview` companion in Phase 0 by default (the planner owns it, so pass the flags through); `--no-interview` skips it; `--interview` forces it on Micro/Lite, where you run `Skill("interview")` yourself before editing.

## Brief and goal

At the end of planning, in every tier, print the brief and a paste-ready `/goal` line.
The goal format, the per-tier instruction sentence, and the `AW EVIDENCE` block are defined in the workflow's [`rules/goal-emission.md`](../rules/goal-emission.md) — read it when planning ends.

| Tier | Brief source | What to print |
| --- | --- | --- |
| Micro / Lite | In-conversation: Task, Guardrails, verify command, Turn Cap (Micro 5, Lite 12), files | The 5-line brief, then the goal line and "paste this to let the session drive itself to done hands-off" |
| Full (split) | The planner's handoff `- Goal:` line | The goal line and the headless rerun: `cd <worktree> && claude -p "<the /goal line>"` — sub-agents cannot hold a goal, so the split still runs |
| Full (single-context) | Your own `plan.md` | The goal line, as for Micro / Lite |

```text
Brief — rename the "Save" button to "Save draft"
- Task: relabel the editor's primary button so users know the post is not published.
- Guardrails: only src/editor/Toolbar.tsx changes; keep the button's test id and handler.
- Verify: pnpm vitest run src/editor
- Turn cap: 5
- Files: src/editor/Toolbar.tsx

/goal "pnpm vitest run src/editor" exits 0 with "exit=0" printed, the draft PR URL is printed, and the printed git diff --name-only lists only src/editor/Toolbar.tsx — or stop after 5 turns.
```

Before the terminal contract of every run that opened a PR, print the `AW EVIDENCE` block (sentinel line or verify exit code, PR URL, changed files) so a judge that reads only the transcript can decide the goal.

## Follow-ups after completion

When the user returns after the PR opened with an improvement or a small suggestion, treat it as a new iteration, never as scope creep:

1. Re-detect the tier for the delta only.
2. Micro / Lite delta → single-pass on the same branch and worktree, push to the existing PR.
3. Full delta → `aw-planner` folds it into `plan.md` + `checks.yaml` and re-clears `confidence(plan)`, then `aw-executor`, on the existing branch and PR.

Pause only for a genuine blocker or conflict — [`safety-guardrails.md`](../rules/safety-guardrails.md#user-requested-changes-are-never-scope-creep).

## Terminal contract

Emit this block on every exit — success, degraded, blocked, and refused — after the `AW EVIDENCE` block when a PR exists:

```
AW RUN COMPLETE
- Tier: [Micro | Lite | Full]
- Path: [split | single-context Full | single-pass]
- Delivered: [PR URL | branch | artifact paths | nothing]
- Verified: [green | red (<check>: <reason>) | not run (<reason>)]   # Full only
- Degraded: [companions/agents skipped and why, or "none"]
- Needs you: [blockers or decisions, or "nothing"]
```

Micro and Lite may collapse it to one line, keeping `Degraded:`: `AW RUN COMPLETE — Micro, PR <url>, Degraded: none, Needs you: nothing`.

- Every companion or agent that did not run is named in `Degraded:` with its reason; a skipped `review-loop` means the PR was not reviewed.
- "PR opened" means you hold the URL; a step that could not complete goes in `Needs you:`.
- Run the exit write of [`rules/lessons.md`](rules/lessons.md) before emitting the block.

## Hard rules

- **Stay thin.** Route and own the loop; do not restate the tier table or phase procedures.
- **Your `Edit` / `Write` / `Bash` budget is for Micro/Lite single-pass and the single-context Full fallback.** While the Full split is dispatchable, never edit source yourself.
- **Every dispatch-availability decision is a capability test, never a name test.** Ask whether any available tool dispatches a sub-agent.
- **Opt-in, not a wrapper.** Do not engage on simple questions, reviews, or interactive coding the user is steering.
- **Phase 0 and Phase 2 run in every tier.** `--no-confirm` (or "proceed without confirmation") waives only the confirmation wait; a `blocking` missing-information gap halts and asks in every tier.
