---
name: batch-linear-tickets
description: >
  Batch-analyze and resolve multiple Linear tickets with parallel investigation,
  cross-ticket correlation, confidence validation, and autonomous execution.
  Triggers on: "batch-linear-tickets", "batch analyze", "solve these tickets", "analyze tickets".
user-invocable: true
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: orchestrator
  architecture: fan-out/gate/fan-out/gate/fan-out
  agents:
    investigator: linear-ticket-investigator
    planner: aw-planner
    executor: aw-executor
  phases:
    - intake
    - parallel_investigation
    - correlation
    - approval
    - parallel_planning
    - plan_review
    - parallel_execution
    - results
  tags: [batch, tickets, linear, investigation, parallel, multi-agent]
---

# Batch Linear Ticket Resolver

Orchestrate parallel investigation, planning, and implementation of multiple Linear tickets.
This skill is a **thin orchestrator** — it coordinates specialized agents and handles user-facing gates in the main conversation context.

## Architecture

```
Phase 1: Fan-Out Investigation        → linear-ticket-investigator agents
Phase 2: Correlation (main context)   → cross-ticket analysis
Phase 3: Approval Gate (main context) → user picks tickets to proceed
Phase 4: Fan-Out Planning             → aw-planner agents (in worktrees)
Phase 5: Plan Review Gate (optional)  → user inspects plans before execution
Phase 6: Fan-Out Execution            → aw-executor agents
Phase 7: Results (main context)       → status table + Linear updates
```

The autonomous-workflow is split into two agents — `aw-planner` and
`aw-executor` (the `aw-` prefix is short for "autonomous-workflow" and
groups the pair together) — connected by `plan.md`:
- **aw-planner** runs Phases 0–2 (validate, plan, create worktree, gate on `confidence(plan) ≥ 90%`).
- **aw-executor** runs Phases 3–7 (implement, test, document, draft PR, watch CI).

The planner already runs `confidence(plan)` internally.
Phase 5 of this skill is an **optional, additional human review** for batch contexts where the user wants to compare plans across tickets before dispatching executors in parallel.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| Linear MCP (`mcp__claude_ai_Linear__*`) | Read tickets, post PR comments | **Yes** |
| `linear-ticket-investigator` agent | Phase 1 fan-out | **Yes** |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md), under the `aw-` namespace) | Phases 4 & 6 | **Yes** |
| `gh` CLI | PR creation by the executor | **Yes** |
| `gw` CLI | Worktree management (planner) | Recommended |
| Project domain-navigator skill | Step 2 of investigation in monorepos | Optional — see [Customization](#customization) |

---

## Rules

| Rule | Description |
|------|-------------|
| [cross-ticket-correlation](./rules/cross-ticket-correlation.md) | Detect shared root causes, duplicates, conflicts |
| [batch-approval-ux](./rules/batch-approval-ux.md) | Summary table, approval commands, status values |

> Investigation rules live in `linear-ticket-investigator`.
> Planning and execution rules live in `aw-planner` and `aw-executor`.
> This skill only owns batch-level orchestration and the two user-facing gates.

---

## Arguments

Parse `$ARGUMENTS` for ticket identifiers.

- If `$ARGUMENTS` contains ticket IDs (e.g., `SUP-123 ENG-456`), use them directly.
- If `$ARGUMENTS` contains a Linear filter/project URL, extract relevant ticket IDs.
- If `$ARGUMENTS` is empty, ask the user to provide ticket IDs.

Accept formats: `SUP-123`, `ENG-456`, `123` (bare number), Linear URLs.
Comma-, space-, or newline-separated.

---

## Phase 1: Parallel Investigation (Fan-Out)

Spawn one `linear-ticket-investigator` agent per ticket using the Agent tool with `subagent_type: "linear-ticket-investigator"`.
**Launch ALL agents in a single message.**

Each agent's prompt is minimal — the agent definition contains the full investigation methodology:

```
Investigate Linear ticket {TICKET_ID}.

{Optional context from the user, e.g., "this is in the alerting component"}
```

**Wait for all agents to return** before proceeding.
If some fail, proceed with what you have and offer to re-run the failed ones.

---

## Phase 2: Cross-Ticket Correlation

Analyze findings **in the main context** (no agent needed).
See [cross-ticket-correlation](./rules/cross-ticket-correlation.md) for the methodology.

Detect: shared root causes, file conflicts, duplicates, dependencies.
Group correlated tickets so a single PR can resolve multiple.

---

## Phase 3: Approval Gate

Present findings using the format in [batch-approval-ux](./rules/batch-approval-ux.md): summary table, per-ticket details, correlation notes, information gaps, and an approval prompt.

Tickets with status `Needs Info` cannot be approved until gaps are resolved.
If the user provides missing info, re-run `linear-ticket-investigator` for those tickets only and re-present.

Approval commands: `all`, `1, 3, 5`, `all including risky`, `review plans`, `none`.

---

## Phase 4: Parallel Planning (Fan-Out)

For each approved ticket (or correlated group), launch an `aw-planner` agent using the Agent tool with `subagent_type: "aw-planner"` and `isolation: "worktree"`.
**Launch ALL approved planners in a single message.**

Each planner receives the full Decision Pack from the investigator — it does not re-investigate, but it will validate, refine, and produce a self-contained `plan.md` gated by `confidence(plan)`.

```
Plan a fix for Linear ticket {TICKET_ID}: {Title}

## Context
{Full ticket description and relevant comments}

## Investigation Findings
{Root cause + certainty markers from linear-ticket-investigator}

## Approved Proposal
- Root cause: ...
- Proposed fix: ...
- Affected files: ...
- Risk: ...

## Correlated Tickets
{If this PR resolves multiple tickets, list them all with IDs and titles}

## Requirements
- Branch: fix/{TICKET_ID}
- The PR description (created later by the executor) must reference Linear ticket(s) with "Fixes {TICKET_ID}"
```

Each planner returns one of:
- **Plan ready** (confidence ≥ 90%) — worktree path + plan.md ready for execution.
- **Below gate** (confidence < 90% after retries) — concerns surfaced for user decision.

---

## Phase 5: Plan Review Gate (Optional)

By default, **proceed straight to Phase 6** for any planner that returned "Plan ready".
This is the fast path.

If **any** planner returned "Below gate", or if the user requested `review plans` at approval time, pause here:

```
## Plans Ready for Review

| # | Ticket | Confidence | Worktree | Action |
|---|--------|------------|----------|--------|
| 1 | SUP-123 | 95% (passed gate) | .agent/fix/SUP-123/ | execute |
| 2 | ENG-456 | 82% (below gate) | .agent/fix/ENG-456/ | review concerns |
```

For below-gate plans, list the concerns from the planner and offer:
- **refine** — re-spawn the planner for another iteration
- **proceed** — accept and dispatch executor anyway (NOT recommended)
- **stop** — abandon this ticket

For plans that passed the gate, the user can optionally inspect `plan.md` before dispatch.
Default: dispatch all gated plans without further prompting.

---

## Phase 6: Parallel Execution (Fan-Out)

For each plan that cleared the gate (or was force-proceeded by the user), launch an `aw-executor` agent using the Agent tool with `subagent_type: "aw-executor"` and `isolation: "worktree"` pointing at the **same worktree the planner used**.
**Launch ALL executors in a single message.**

The executor reads `plan.md` directly — it does not need a Decision Pack from this skill.
A minimal prompt is enough:

```
Execute the plan at .agent/{branch}/plan.md in the current worktree.
```

The executor runs Phases 3–7 of autonomous-workflow: implement, test, document, open draft PR, watch CI.

---

## Phase 7: Results & Linear Updates

As executors complete, present a final status table:

```
## Execution Results

| Ticket | Status | PR | Branch | Notes |
|--------|--------|----|--------|-------|
| SUP-123 | Done | #456 | fix/SUP-123 | All tests pass, CI green |
| ENG-456 | Done | #457 | fix/ENG-456 | Added 3 test cases |
| SUP-789 | Failed | — | fix/SUP-789 | Stuck-loop in Phase 4 |
```

For each successful PR, comment on the Linear ticket with the PR link via `mcp__claude_ai_Linear__save_comment`:

```
PR created: {PR_URL}
Branch: fix/{TICKET_ID}
Plan confidence: {X%}
```

Ask the user whether to update ticket state (e.g., move to "In Progress").

For failed executions, surface the error and suggested next steps (manual fix, re-plan, more context).

---

## Customization

### Domain Context

`linear-ticket-investigator` uses the project's domain context to ground its search.
For monorepos, this dramatically improves investigation accuracy.

The agent looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at
3. A project-shipped **domain navigator skill** (invoked via `Skill()`)
4. Top-level `README.md`

To add a domain navigator for your project, create a skill named e.g. `<project>-domain-navigator` that:
- Maps Linear labels (or ticket terminology) to component directories
- Surfaces cross-component dependencies an outsider wouldn't infer
- Lists where each domain's docs/runbooks live

The investigator will pick it up automatically as long as it's in the host project's installed skills.
See the [`linear-ticket-investigator`](../../agents/linear-ticket-investigator.md) agent file for the exact lookup procedure.

---

## Key Principles

1. **Orchestrate, don't investigate or plan or implement** — investigation lives in `linear-ticket-investigator`, planning in `aw-planner`, execution in `aw-executor`.
   This skill only coordinates and runs user-facing gates.
2. **Two user gates: approval (Phase 3) and optional plan review (Phase 5)** — both happen in main context where the user is.
   No checkpoint/resume machinery.
3. **Decision Pack to planners, not to executors** — planners need full investigation context to write `plan.md`.
   Executors just read `plan.md`.
4. **Parallelize every fan-out** — investigators, planners, and executors all launch in one message each.
5. **The planner's confidence gate is authoritative** — if it returns "Plan ready", the plan is safe to execute.
   Phase 5 only intercepts below-gate plans or user-requested review.
6. **Correlate before planning** — detect shared root causes and conflicts so one plan can resolve multiple tickets.
7. **Handle partial failures at every phase** — if some agents fail, present what you have and offer to retry.
8. **User stays in control** — every batch requires explicit approval at Phase 3.
   Information gaps must be resolved before that approval.
