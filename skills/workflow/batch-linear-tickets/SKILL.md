---
name: batch-linear-tickets
description: >
  Batch-analyze and resolve multiple Linear tickets — bug fixes and feature
  work. For each ticket: classifies as bug or feature (auto from Linear
  labels, or via the --type flag), dispatches the appropriate per-ticket
  analysis (linear-ticket-investigator + holistic-analysis for bugs, just
  linear-ticket-investigator for features), gates on confidence, correlates
  findings across tickets, asks for user approval, then fans out aw-planner
  + aw-executor to ship PRs. Posts PR links back to each Linear ticket on
  completion. Triggers on "batch-linear-tickets", "batch analyze",
  "solve these tickets", "implement these tickets", "analyze tickets",
  "/batch-linear-tickets".
argument-hint: '[--type=auto|bug|feature] <ticket-ids>'
user-invocable: true
metadata:
  author: mthines
  version: '3.1.0'
  workflow_type: orchestrator
  architecture: classify/fan-out-analyse/correlate/gate/fan-out-execute
  composes:
    - linear-ticket-investigator
    - holistic-analysis
    - autonomous-workflow
    - confidence
    - persistent-memory
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
    - bug-fix
    - feature-development
---

# Batch Linear Ticket Resolver

Orchestrate parallel analysis and resolution of multiple Linear tickets — bug fixes **and**
feature work. This skill owns batch-level concerns: per-ticket type classification, parallel
fan-out of the right analysis tools, cross-ticket correlation, the user-facing approval gate,
and Linear writeback.

Per-ticket investigation lives in `linear-ticket-investigator`. Per-ticket bug root-cause
analysis lives in `holistic-analysis`. Per-ticket planning lives in `aw-planner`. Per-ticket
implementation lives in `aw-executor`. This skill wires them together for batch operation.

## Architecture

```text
Phase 1: Per-Ticket Analysis    → per ticket: classify type → investigator → (holistic-analysis if bug) → confidence
Phase 2: Cross-Ticket Correlation → detect shared root causes, file conflicts, duplicates
Phase 3: Approval Gate          → user picks tickets to ship
Phase 4: Parallel Execution     → fan out aw-planner + aw-executor for approved tickets
Phase 5: Results & Linear Updates → status table + per-ticket PR comments
```

Phase 1's analysis runs **once per ticket**. Phase 4 dispatches `aw-planner` directly using the
analysis from Phase 1.

---

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| Linear MCP (`mcp__claude_ai_Linear__*` or `mcp__linear-server__*`) | Read tickets + labels, post PR comments | **Yes** |
| `linear-ticket-investigator` agent | Per-ticket evidence extraction | **Yes** |
| `holistic-analysis` skill | Per-ticket bug root-cause analysis | **Yes** (for bug tickets) |
| `confidence` skill | Per-ticket gate scoring | **Yes** |
| `aw-planner` + `aw-executor` agents (from [`autonomous-workflow`](../autonomous-workflow/SKILL.md)) | Phase 4 dispatch | **Yes** |
| `gh` CLI | PR creation by `aw-executor` | **Yes** |
| `gw` CLI | Worktree management (planner) | Recommended |
| `persistent-memory` skill | `batch-lessons` self-improvement loop (read Phase 1, write Phase 5) | Optional — loop skips silently if absent |
| Project domain-navigator skill | Investigation accuracy in monorepos | Optional — see [Customization](#customization) |

---

## Rules

| Rule | When it loads |
|------|---------------|
| [ticket-type-classification](./rules/ticket-type-classification.md) | Phase 1 — classify each ticket as bug or feature |
| [cross-ticket-correlation](./rules/cross-ticket-correlation.md) | Phase 2 — detect shared root causes, duplicates, conflicts |
| [batch-approval-ux](./rules/batch-approval-ux.md) | Phase 3 — summary table format, status values, approval commands |
| [self-improvement-loop](./rules/self-improvement-loop.md) | Cross-cutting — `batch-lessons` fast tier (read Phase 1 / write Phase 5) + promotion to `diagnose` |
| [diagnostic-surface](./rules/diagnostic-surface.md) | Consumed by `/create-skill diagnose batch-linear-tickets` — phase model, guards, hard invariants |

> Investigation rules live in `linear-ticket-investigator`.
> Bug root-cause rules live in `holistic-analysis`.
> Planning and execution rules live in `aw-planner` and `aw-executor`.
> This skill only owns batch-level fan-out, classification, and the user-facing approval gate.

---

## Arguments

Parse `$ARGUMENTS` for ticket identifiers and the optional `--type` flag.

- If `$ARGUMENTS` contains ticket IDs (e.g., `SUP-123 ENG-456`), use them directly.
- If `$ARGUMENTS` contains a Linear filter / project URL, extract the relevant ticket IDs first.
- If `$ARGUMENTS` is empty, ask the user to provide ticket IDs.

Accept ticket formats: `SUP-123`, `ENG-456`, `123` (bare number), Linear URLs.
Comma-, space-, or newline-separated.

### Type flag (optional)

| Flag | Effect |
|------|--------|
| `--type=auto` (default) | Classify each ticket via Linear labels (see [ticket-type-classification](./rules/ticket-type-classification.md)) |
| `--type=bug` | Force every ticket in the batch to bug pipeline (investigator + holistic-analysis) |
| `--type=feature` | Force every ticket in the batch to feature pipeline (investigator only) |

The flag applies to the whole batch.
For mixed batches with no labels, surface the unclassified tickets as `Needs Info` and ask the
user to either tag them in Linear or re-run with explicit `--type`.

---

## Phase 1: Per-Ticket Analysis (Fan-Out)

For each ticket, run the analysis pipeline appropriate to its type. **Launch homogeneous calls
in a single message** so they run in parallel.

### Step 1.read — Read prior batch lessons

Before classifying, load `batch-lessons` so prior classification and correlation
misfires bias this batch:

```text
Skill("persistent-memory", "read batch-lessons --tier project-shared")     # skips silently if not installed
```

Match lessons by label set / ticket-type / affected-area; apply as **advisory
inputs** to classification (Step 1a) and correlation (Phase 2). Lessons never
override an explicit `--type` flag or auto-approve a `Needs Info` ticket. Full
contract: [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#read-lessons-phase-1).
(The planning / implementation phases inherit the `aw-lessons` loop automatically
via the `aw-planner` / `aw-executor` fan-out in Phase 4 — no action needed here.)

### Step 1a — Classify

If `--type=bug` or `--type=feature`: every ticket inherits that type. Skip to Step 1b.

Otherwise (`--type=auto`):

1. Fetch each ticket's labels via `mcp__claude_ai_Linear__get_issue` (or the equivalent
   `mcp__linear-server__*` tool). **Launch all fetches in one message** for parallelism.
2. Apply the classification rules in
   [ticket-type-classification](./rules/ticket-type-classification.md):
   - Has any label in `{bug, defect, incident, regression, hotfix, fix, kind/bug}` → **bug**
   - Otherwise → **feature**
   - No labels at all → **unknown** (status becomes `Needs Info`)

Record the type per ticket. Surface any `unknown` tickets to the user before continuing.

### Step 1b — Dispatch the investigator (every ticket)

Dispatch the `linear-ticket-investigator` agent for every ticket — bug or feature.
**Launch all investigator calls in one message** for parallelism.

The investigator returns an Evidence Record (problem description, affected code, certainty
markers, information gaps). It does not implement; it investigates.

### Step 1c — Dispatch holistic-analysis (bug tickets only)

For tickets classified as **bug**, also dispatch `Skill("holistic-analysis", ...)` with the
Evidence Record from Step 1b. This runs the full root-cause analysis.

Feature tickets skip this step — the investigator's Evidence Record (intent + acceptance
criteria + affected code) is the analysis output. Root-cause analysis is bug-shaped and would
mis-frame feature work.

### Step 1d — Gate per ticket

Run `Skill("confidence", "<mode>")` per ticket, where mode is:

- **`analysis`** for bug tickets — scores evidence strength, root cause certainty, fix
  confidence.
- **`plan`** for feature tickets — scores completeness, feasibility, ambiguity of the proposed
  approach captured in the investigator's Evidence Record.

Status mapping (same shape for both types, different source skill):

| Status | Bug source | Feature source | Approvable? |
|--------|-----------|---------------|-------------|
| **Ready** | `confidence(analysis)` ≥ 90% | `confidence(plan)` ≥ 90% | Yes |
| **Needs Review** | `confidence(analysis)` 70–89% | `confidence(plan)` 70–89% | Yes (with warning) |
| **Needs Info** | Information gap from investigator | Acceptance criteria missing or unclassified | **No** |
| **Stopped** | `confidence(analysis)` < 70% | `confidence(plan)` < 70% | **No** |

### Capture per ticket

- **Type** (`bug` | `feature`).
- The **Evidence Record** from the investigator.
- For bugs: the **root cause** and **proposed fix** from holistic-analysis.
- For features: the **proposed approach** + **acceptance criteria** from the Evidence Record.
- The **confidence score** and **status**.

If some sub-calls fail, proceed with what returned and offer to re-run the failed ones.

---

## Phase 2: Cross-Ticket Correlation

Analyze findings **in the main context** (no agent needed).
See [cross-ticket-correlation](./rules/cross-ticket-correlation.md) for the methodology.

Detect: shared root causes (bug clusters), shared affected files (any type), duplicates,
dependencies. Group correlated tickets so a single PR can resolve multiple.

Correlation works across types — a feature and a bug touching the same file is still a conflict
worth surfacing.

---

## Phase 3: Approval Gate

Present findings using the format in [batch-approval-ux](./rules/batch-approval-ux.md): summary
table (with Type column), per-ticket details, correlation notes, information gaps, and an
approval prompt.

Tickets with status `Needs Info` cannot be approved until gaps are resolved.
If the user provides missing info, re-run only the relevant Phase 1 steps for those tickets and
re-present.

Approval commands: `all`, `1, 3, 5`, `all including risky`, `none`.

---

## Phase 4: Parallel Execution (Fan-Out)

For each approved ticket (or correlated group), dispatch `aw-planner` directly using the analysis
from Phase 1.

Use the Agent tool with `subagent_type: "aw-planner"` and `isolation: "worktree"`. Pass the
appropriate pack:

| Ticket type | Pack template | Source |
|-------------|---------------|--------|
| **Bug** | [`bug-fix-pack.md`](../fix-bug/templates/bug-fix-pack.md) | `fix-bug` skill |
| **Feature** | [`feature-pack.md`](./templates/feature-pack.md) | This skill |

Fill in the pack from the Phase 1 analysis. **Launch ALL approved planners in a single message.**

For correlated tickets that resolve to a single PR, list all ticket IDs in the pack's
"Correlated Tickets" addendum so the executor's PR description references each one with
"Fixes {TICKET_ID}" (bug) or "Implements {TICKET_ID}" (feature).

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

Lesson-write serialization: do NOT write to shared lesson scopes (aw-lessons)
during this run — return your lesson candidates in your result payload; the
orchestrator writes them serially after the fan-out completes.
```

The executor runs autonomous-workflow Phases 3–7: implement, test, document, open the draft PR,
watch CI.

**Lesson-write serialization (batch fan-out contract).**
Parallel executors return lesson candidates in their result payload; the orchestrator writes all lessons serially after fan-out completes.
Executors MUST NOT write to shared lesson scopes directly during fan-out.
Concurrent writes to `memory/aw-lessons/INDEX.md` can interleave; the serial post-fan-out write (one `Skill("persistent-memory", "write aw-lessons --tier project-shared --auto")` per candidate batch, in Phase 5) is the only safe path.

---

## Phase 5: Results & Linear Updates

As executors complete, present a final status table:

```markdown
## Execution Results

| Ticket | Type | Status | PR | Branch | Notes |
|--------|------|--------|----|--------|-------|
| SUP-123 | bug | Done | #456 | fix/SUP-123 | Confidence 95%, all tests pass |
| AI-1165 | feature | Done | #457 | feat/AI-1165 | Confidence 92%, 3 components updated |
| SUP-789 | bug | Failed | — | fix/SUP-789 | Stuck-loop in Phase 4 |
```

For each successful PR, comment on the Linear ticket with the PR link via
`mcp__claude_ai_Linear__save_comment`:

```text
PR created: {PR_URL}
Branch: {BRANCH}
Type: {bug | feature}
Phase 1 confidence: {X%}
Plan confidence: {Y%}
```

Ask the user whether to update ticket state (e.g., move to "In Progress").

For failed executions, surface the error and suggested next steps (manual fix, re-plan, more
context).

### Step 5.write — Capture batch lessons

When the batch's own orchestration misfired, write a lesson so the next batch
does better:

```text
Skill("persistent-memory", "write batch-lessons --tier project-shared --auto")     # skips silently if not installed
```

Capture: a ticket whose type was wrong (label set → correct type), a
cross-ticket conflict Phase 2 correlation missed, or a chronically `Needs Info`
ticket shape. `--auto` skips consent, not the privacy pre-flight. A lesson
recurring `seen_count >= 3` becomes promotion-eligible — see
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md#write-lessons-phase-5).

---

## Self-Improvement

`/batch-linear-tickets` improves across batches through a **two-tier loop**
(full contract: [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)).

- **Inherited for free:** the planning and implementation phases use the
  `aw-lessons` loop because Phase 4 dispatches `aw-planner` / `aw-executor`.
  **Serialization contract:** parallel executors return lesson candidates in
  their result payload; the orchestrator writes all lessons serially after
  fan-out completes. Executors MUST NOT write to shared lesson scopes directly
  during fan-out.
- **Fast tier (this skill):** `batch-lessons` — read at Phase 1, written at
  Phase 5 — covers batch-level orchestration only (type classification,
  cross-ticket correlation, chronic `Needs Info`). Advisory; skips silently if
  `persistent-memory` is absent.
- **Slow tier:** a lesson recurring `seen_count >= 3` (or tagged `structural`)
  is promoted via `/create-skill diagnose batch-linear-tickets`, which reads the
  [diagnostic surface](./rules/diagnostic-surface.md) and `batch-lessons`
  history and emits a confidence-gated diff (commonly into
  `ticket-type-classification.md` / `cross-ticket-correlation.md`) behind the
  `confidence(analysis) ≥ 90 %` + user-approval gate.

---

## Customization

### Domain Context

`linear-ticket-investigator` uses the project's domain context to ground its evidence
extraction. For monorepos this dramatically improves the accuracy of the Affected-Code table.

The agent looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`.
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at.
3. A project-shipped **domain navigator skill** (invoked via `Skill()`).
4. Top-level `README.md`.

To add a domain navigator for your project, create a skill named e.g.
`<project>-domain-navigator` that maps ticket terminology to component directories. The
investigator picks it up automatically as long as it is in the host project's installed skills.

See the [`linear-ticket-investigator`](../../../agents/linear-ticket-investigator.md) agent file
for the exact lookup procedure.

### Type Classification Overrides

If your workspace uses non-standard labels (e.g., `type:bug` instead of `bug`), edit
[ticket-type-classification](./rules/ticket-type-classification.md)'s default label list or
always pass `--type=bug` / `--type=feature` explicitly.

---

## Key Principles

1. **Type-aware orchestration.** Bugs run through investigator + holistic-analysis. Features run
   through investigator only. Both gate on `confidence` (different modes). Phase 4 and Phase 5
   are type-agnostic.
2. **Single user gate (Phase 3 approval).** No checkpoint/resume machinery. Below-gate plan
   surfacing in Phase 4 is per-planner, not a separate batch gate.
3. **Analyse once, execute once.** Phase 1 is the only place analysis runs per ticket. Phase 4
   dispatches `aw-planner` directly using that analysis — no re-investigation.
4. **Parallelize every fan-out — but serialize lesson writes.** Label fetches, investigators,
   holistic-analyses, planners, and executors all launch in one message each (per homogeneous
   group). Parallel executors return lesson candidates in their result payload; the orchestrator
   writes all lessons serially after fan-out completes. Executors MUST NOT write to shared lesson
   scopes directly during fan-out.
5. **Correlate before executing.** Detect shared root causes, shared files, and conflicts so one
   plan can resolve multiple tickets — across types.
6. **Handle partial failures at every phase.** If some agents fail, present what you have and
   offer to retry.
7. **User stays in control.** Every batch requires explicit approval at Phase 3. Information
   gaps and unclassified tickets must be resolved before approval.
8. **Learn across batches, but only advisory.** `batch-lessons` (read Phase 1,
   write Phase 5) biases type classification and correlation from prior misfires;
   it never auto-approves a ticket or overrides `--type`. Planning / implementation
   learning is inherited from `aw-lessons` via the Phase 4 fan-out. Recurring
   lessons (`seen_count >= 3`) promote into the skill's rules only through the
   confidence-gated `diagnose` apply.
