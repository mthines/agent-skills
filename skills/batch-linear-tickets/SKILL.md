---
name: batch-linear-tickets
description: >
  Batch-analyze and resolve multiple Linear tickets. Fans out
  /fix-bug --analyse-only per ticket (which itself invokes
  linear-ticket-investigator + holistic-analysis + confidence),
  correlates findings across tickets, gates on user approval, then
  fans out aw-planner + aw-executor for approved tickets using the
  pre-computed analyses. Posts PR links back to each Linear ticket on
  completion. This skill is a thin batching wrapper around /fix-bug;
  per-ticket investigation, analysis, and confidence scoring all live
  in /fix-bug. Triggers on "batch-linear-tickets", "batch analyze",
  "solve these tickets", "analyze tickets", "/batch-linear-tickets".
user-invocable: true
disable-model-invocation: true
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: orchestrator
  architecture: fan-out-analyse/correlate/gate/fan-out-execute
  composes:
    - fix-bug
    - linear-ticket-investigator
    - autonomous-workflow
  agents:
    investigator: linear-ticket-investigator
    planner: aw-planner
    executor: aw-executor
  phases:
    - parallel_analysis
    - correlation
    - approval
    - parallel_execution
    - results
  tags:
    - batch
    - tickets
    - linear
    - parallel
    - multi-agent
    - fix-bug-wrapper
---

# Batch Linear Ticket Resolver

Orchestrate parallel analysis and resolution of multiple Linear tickets. This skill is a **thin
batching wrapper** around `/fix-bug` — per-ticket investigation, analysis, and confidence scoring
all live in `/fix-bug` (which itself invokes `linear-ticket-investigator` for evidence and
`holistic-analysis` for root-cause). This skill owns only batch-level concerns: parallel
fan-out, cross-ticket correlation, user-facing approval gate, and Linear writeback.

## Architecture

```text
Phase 1: Parallel Analysis      → fan out /fix-bug --analyse-only per ticket
Phase 2: Cross-Ticket Correlation → detect shared root causes, file conflicts, duplicates
Phase 3: Approval Gate          → user picks tickets to ship
Phase 4: Parallel Execution     → fan out aw-planner + aw-executor for approved tickets
Phase 5: Results & Linear Updates → status table + per-ticket PR comments
```

`/fix-bug --analyse-only` runs all of `/fix-bug`'s Phases 0–4 (input classification, evidence
resolution via `linear-ticket-investigator`, source mapping, holistic analysis, confidence gate)
and stops at the proposal. Phase 4 below dispatches `aw-planner` directly using the analysis from
Phase 1 — `/fix-bug` is **not** re-invoked, so holistic-analysis runs once per ticket.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| Linear MCP (`mcp__claude_ai_Linear__*`) | Read tickets, post PR comments | **Yes** |
| `/fix-bug` skill | Phase 1 per-ticket analysis primitive | **Yes** |
| `linear-ticket-investigator` agent | Invoked transitively by `/fix-bug`'s Linear input route | **Yes** |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 4 dispatch | **Yes** |
| `gh` CLI | PR creation by `aw-executor` | **Yes** |
| `gw` CLI | Worktree management (planner) | Recommended |
| Project domain-navigator skill | Investigation accuracy in monorepos | Optional — see [Customization](#customization) |

---

## Rules

| Rule | When it loads |
|------|---------------|
| [cross-ticket-correlation](./rules/cross-ticket-correlation.md) | Phase 2 — detect shared root causes, duplicates, conflicts |
| [batch-approval-ux](./rules/batch-approval-ux.md) | Phase 3 — summary table format, status values, approval commands |

> Investigation rules live in `linear-ticket-investigator`.
> Analysis, confidence, and per-ticket fix logic live in `/fix-bug`.
> Planning and execution rules live in `aw-planner` and `aw-executor`.
> This skill only owns batch-level fan-out and the user-facing approval gate.

---

## Arguments

Parse `$ARGUMENTS` for ticket identifiers.

- If `$ARGUMENTS` contains ticket IDs (e.g., `SUP-123 ENG-456`), use them directly.
- If `$ARGUMENTS` contains a Linear filter / project URL, extract the relevant ticket IDs first.
- If `$ARGUMENTS` is empty, ask the user to provide ticket IDs.

Accept formats: `SUP-123`, `ENG-456`, `123` (bare number), Linear URLs.
Comma-, space-, or newline-separated.

---

## Phase 1: Parallel Analysis (Fan-Out)

For each ticket, invoke `/fix-bug --analyse-only` via `Skill()`. **Launch all calls in a single
message** so they run in parallel.

```text
Skill("fix-bug", "--analyse-only https://linear.app/<workspace>/issue/<TICKET-ID>")
```

Each `/fix-bug` call:

1. Routes the Linear URL through its Phase 1 Linear-input handler, which spawns
   `linear-ticket-investigator` to extract an Evidence Record from the ticket.
2. Runs holistic-analysis on the Evidence Record (Phase 3).
3. Runs `confidence(bug-analysis)` (Phase 4).
4. Stops at Phase 5 (because of `--analyse-only`) and returns the proposal + confidence score
   without dispatching `aw-planner`.

**Wait for all calls to return** before proceeding. If some fail, proceed with what you have and
offer to re-run the failed ones.

Capture per ticket:

- The Evidence Record (from `/fix-bug` output's "Evidence" section).
- The root cause (from `/fix-bug` output's "Root cause" section).
- The proposed change.
- The confidence score and breakdown.
- The status: `Ready` (>= 90%), `Needs Review` (70–89%), `Needs Info` (information gaps), or
  `Stopped` (< 70% with no escape hatch).

---

## Phase 2: Cross-Ticket Correlation

Analyze findings **in the main context** (no agent needed).
See [cross-ticket-correlation](./rules/cross-ticket-correlation.md) for the methodology.

Detect: shared root causes, file conflicts, duplicates, dependencies.
Group correlated tickets so a single PR can resolve multiple.

---

## Phase 3: Approval Gate

Present findings using the format in [batch-approval-ux](./rules/batch-approval-ux.md): summary
table, per-ticket details, correlation notes, information gaps, and an approval prompt.

Tickets with status `Needs Info` cannot be approved until gaps are resolved.
If the user provides missing info, re-run `/fix-bug --analyse-only` for those tickets only and
re-present.

Approval commands: `all`, `1, 3, 5`, `all including risky`, `none`.

---

## Phase 4: Parallel Execution (Fan-Out)

For each approved ticket (or correlated group), dispatch `aw-planner` directly using the analysis
from Phase 1 — do **not** re-invoke `/fix-bug`. The analysis is already complete; running it
again would re-run holistic-analysis for nothing.

Use the Agent tool with `subagent_type: "aw-planner"` and `isolation: "worktree"`. Pass the
**Bug Fix Pack** from
[`fix-bug/templates/bug-fix-pack.md`](../fix-bug/templates/bug-fix-pack.md), filled in from the
Phase 1 analysis. **Launch ALL approved planners in a single message.**

For correlated tickets that resolve to a single PR, list all ticket IDs in the pack's
"Correlated Tickets" addendum so the executor's PR description references each one with
"Fixes {TICKET_ID}".

Each planner returns one of:

- **Plan ready** (confidence ≥ 90%) — worktree + `plan.md` ready for execution.
- **Below gate** (confidence < 90% after retries) — concerns surfaced for user decision.

For below-gate plans, present the planner's concerns and offer:

- **refine** — re-spawn the planner for another iteration.
- **proceed** — accept and dispatch the executor anyway (NOT recommended).
- **stop** — abandon this ticket.

For each plan that cleared the gate (or was force-proceeded), dispatch `aw-executor` with
`subagent_type: "aw-executor"` and `isolation: "worktree"` pointing at the same worktree the
planner used. **Launch ALL executors in a single message:**

```text
Execute the plan at .agent/<branch>/plan.md in the current worktree.
```

The executor runs autonomous-workflow Phases 3–7: implement, test, document, open the draft PR,
watch CI.

See [`fix-bug/rules/autonomous-handoff.md`](../fix-bug/rules/autonomous-handoff.md) for the
single-ticket version of this handoff — the per-ticket dispatch logic is identical.

---

## Phase 5: Results & Linear Updates

As executors complete, present a final status table:

```markdown
## Execution Results

| Ticket | Status | PR | Branch | Notes |
|--------|--------|----|--------|-------|
| SUP-123 | Done | #456 | fix/SUP-123 | Confidence 95%, all tests pass |
| ENG-456 | Done | #457 | fix/ENG-456 | Confidence 92%, added 3 test cases |
| SUP-789 | Failed | — | fix/SUP-789 | Stuck-loop in Phase 4 |
```

For each successful PR, comment on the Linear ticket with the PR link via
`mcp__claude_ai_Linear__save_comment`:

```text
PR created: {PR_URL}
Branch: fix/{TICKET_ID}
Bug-analysis confidence: {X%}
Plan confidence: {Y%}
```

Ask the user whether to update ticket state (e.g., move to "In Progress").

For failed executions, surface the error and suggested next steps (manual fix, re-plan, more
context).

---

## Customization

### Domain Context

`linear-ticket-investigator` (invoked transitively by `/fix-bug`) uses the project's domain
context to ground its evidence extraction. For monorepos this dramatically improves the accuracy
of the Affected-Code table.

The agent looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`.
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at.
3. A project-shipped **domain navigator skill** (invoked via `Skill()`).
4. Top-level `README.md`.

To add a domain navigator for your project, create a skill named e.g. `<project>-domain-navigator`
that maps ticket terminology to component directories. The investigator picks it up automatically
as long as it is in the host project's installed skills.

See the [`linear-ticket-investigator`](../../agents/linear-ticket-investigator.md) agent file for
the exact lookup procedure.

---

## Key Principles

1. **Thin wrapper, not re-implementation.** Investigation lives in `linear-ticket-investigator`,
   analysis and confidence in `/fix-bug` (via `holistic-analysis` and `confidence`), planning in
   `aw-planner`, execution in `aw-executor`. This skill only coordinates and runs the user-facing
   approval gate.
2. **Single user gate (Phase 3 approval).** No checkpoint/resume machinery. Below-gate plan
   surfacing in Phase 4 is per-planner, not a separate batch gate.
3. **Analyse once, execute once.** Phase 1's `/fix-bug --analyse-only` is the only place
   holistic-analysis runs per ticket. Phase 4 dispatches `aw-planner` directly using that
   analysis — `/fix-bug` is not re-invoked.
4. **Parallelize every fan-out.** Analyses, planners, and executors all launch in one message
   each.
5. **Correlate before executing.** Detect shared root causes and conflicts so one plan can
   resolve multiple tickets.
6. **Handle partial failures at every phase.** If some agents fail, present what you have and
   offer to retry.
7. **User stays in control.** Every batch requires explicit approval at Phase 3. Information gaps
   must be resolved before approval.
