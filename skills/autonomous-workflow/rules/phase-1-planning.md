---
title: 'Phase 1: Task Intake & Planning'
impact: HIGH
tags:
  - planning
  - analysis
  - phase-1
  - confidence-gate
---

# Phase 1: Task Intake & Planning

Deep codebase analysis and implementation planning. Phase 1 is **in-conversation
only** — `plan.md` is written in [Phase 2](./phase-2-worktree.md#plan-generation)
inside the worktree, never on the main branch.

> **Order of operations:** research (parallel `Explore` if complex) →
> optional `holistic-analysis` → technical design → `code-quality(plan)` →
> `confidence(plan)` gate → Phase 2.

---

## Prerequisite Gate

Before any Phase 1 work, the [Phase 0](./phase-0-validation.md) MODE SELECTION
block must already be emitted and the user must have said "proceed".

| Mode     | Criteria                              | Plan output       |
| -------- | ------------------------------------- | ----------------- |
| **Full** | 4+ files OR complex / architectural   | `plan.md` required (Phase 2) |
| **Lite** | 1-3 files AND simple                  | Brief mental plan only       |

The remainder of this rule covers Full Mode. Lite Mode skips to Phase 2 with a
short mental plan. `confidence(plan)` still runs in Lite Mode — it is the only
non-removable gate in any mode.

---

## Core Principles

- **Understand before changing** — read existing code thoroughly.
- **Follow existing patterns** — consistency with the codebase wins.
- **Plan file changes precisely** — know exactly what to modify.
- **Self-validate** — the `confidence(plan)` gate is mandatory.
- **Capture everything from Phase 0** — every decision, requirement, rejected
  alternative, edge case, and rationale must end up in `plan.md`.
- **Write for a future reader** — assume zero context from the original
  conversation.

---

## Parallel Research

**Anchor:** `parallel-research`

Use parallel `Explore` sub-agents when **any** of the following holds:

| Trigger                        | Detection                                     |
| ------------------------------ | --------------------------------------------- |
| 5+ files likely touched        | From Phase 0 scope estimate                   |
| 2+ packages involved           | `nx show projects --affected` or path guess   |
| User flagged complex/unfamiliar| Phrases like "complex", "unfamiliar", "deep"  |

### Fan-out pattern

Dispatch one sub-agent per concern in a single message. Suggested split:

| Sub-agent       | Scope                                                     |
| --------------- | --------------------------------------------------------- |
| Per-package     | One agent per affected package — read entry points, types |
| Past PRs        | `gh pr list` + `gh pr view` for related historical work   |
| Docs            | `README.md`, `CLAUDE.md`, `skills/*/SKILL.md`, `.claude/` |

Each sub-agent returns: relevant file paths, key functions, conventions to
follow, gotchas. Synthesize their reports into the planning context.

```bash
# Example dispatch concern-list (logical, not literal)
# Explore: package gw-tool — entry points, types, command pattern
# Explore: package autonomous-workflow-agent — phase rules, companion invocation
# Explore: past PRs — gh pr list --search "worktree" --limit 10
# Explore: docs — CLAUDE.md, skills/git-worktree-workflows/SKILL.md
```

For simple tasks (under the trigger thresholds), do sequential research using
`Glob`, `Grep`, `Read` directly — sub-agent overhead isn't worth it.

---

## Step 1: Analyze Codebase

**Project structure**

- Identify relevant directories / modules
- Map dependencies between components
- Locate configuration files

Tools: `nx_workspace`, `nx_project_details`, `Glob`.

**Existing patterns**

- Find similar features already implemented
- Study code style and naming conventions
- Understand error handling
- Review testing patterns

Tools: `Grep`, `Read`.

**Technology stack**

- Framework version and features
- Build tools and configuration
- Testing framework and conventions

---

## Complex Task Detection

**Anchor:** `complex-task-detection`

If the task triggers complexity (5+ files, 2+ packages, OR user calls it
complex / unfamiliar / deep), invoke the `holistic-analysis` companion to trace
the end-to-end execution path before designing.

```
Skill("holistic-analysis")     # skips silently if not installed
```

Log to the conversation and to `plan.md` Progress Log:

```markdown
- [TIMESTAMP] Phase 1: holistic-analysis() — invoked
- [TIMESTAMP] Phase 1: holistic-analysis() — not available, continuing
```

Use the holistic findings to refine the technical approach before drafting
file-level changes. Disable this step by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Step 2: Draft Technical Design

Be specific. The design feeds `code-quality(plan)` next, then `confidence(plan)`.

### 2a. Capture Phase 0 context

Transfer ALL Phase 0 discussion into the in-conversation plan draft (the
`aw-create-plan` skill will write it to disk in Phase 2):

- **Background & context** — why this change is needed
- **Every requirement** — explicit and implicit
- **Every decision** — what was decided, alternatives considered, why
- **Out-of-scope items** — what was discussed but excluded
- **Edge cases** — every case identified + agreed handling

### 2b. Document the technical approach

- **Architecture / design** — component interactions, data flow, integration points
- **Patterns to follow** — reference specific existing files as examples
- **API / interface design** — actual type signatures, function signatures, config shapes
- **Implementation order** — numbered sequence for Phase 3

### 2c. Detail file changes

Use one consolidated table:

```markdown
| Action | File                | Change                 | Reason             |
| ------ | ------------------- | ---------------------- | ------------------ |
| create | path/to/new-file.ts | Purpose / key exports  | Why needed         |
| modify | path/to/existing.ts | Specific modifications | Why this change    |
| modify | README.md           | Add feature docs       | User-facing change |
```

### 2d. Define testing strategy with specific cases

```markdown
| Type        | Test Case              | File              | Validates          |
| ----------- | ---------------------- | ----------------- | ------------------ |
| unit        | handles empty input    | processor.spec.ts | Returns default    |
| unit        | rejects invalid config | config.spec.ts    | Throws ConfigError |
| integration | end-to-end flow        | feature.e2e.ts    | Full pipeline      |
| manual      | toggle and verify      | —                 | Visual check       |
```

### 2e. Define verification commands

| When           | Command (example)                                  |
| -------------- | -------------------------------------------------- |
| After edit     | `npx tsc --noEmit`, `go vet ./...`, `nx run X:check` |
| Before PR      | `nx run-many -t test build lint`, `pnpm test`        |

Check `package.json`, `Makefile`, `nx.json`, or project config to determine the
right commands.

### 2f. Document risks with mitigations

```markdown
| Risk                | Likelihood | Impact | Mitigation              |
| ------------------- | ---------- | ------ | ----------------------- |
| Breaking API change | LOW        | HIGH   | Add deprecation warning |
```

---

## Design Quality

**Anchor:** `design-quality`

After drafting the technical approach but **before** the confidence gate,
invoke `code-quality` in `plan` mode. Purpose: shape the design toward
low-complexity structures **before** writing code (early returns,
single-responsibility, naming, function size). Cheaper than refactoring later.

```
Skill("code-quality", "plan")     # skips silently if not installed
```

Apply suggestions to the design. Log:

```markdown
- [TIMESTAMP] Phase 1: code-quality(plan) — applied (N suggestions integrated)
- [TIMESTAMP] Phase 1: code-quality(plan) — not available, continuing
```

Disable by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Confidence Gate

**Anchor:** `confidence-gate`

**MANDATORY in Full Mode. Cannot be disabled.**

After design is finalized and `code-quality(plan)` suggestions are applied,
run the plan-confidence gate:

```
Skill("confidence", "plan")
```

| Score   | Action                                                         |
| ------- | -------------------------------------------------------------- |
| ≥ 90%   | Proceed to Phase 2                                             |
| < 90%   | Up to 2 iterations: more research / analysis / evidence, then re-run |
| < 90% after 2 iterations | Present findings to user; ask whether to proceed or refine further |

Log every confidence run to `plan.md` Progress Log:

```markdown
- [TIMESTAMP] Phase 1: confidence(plan) — 92% (passed gate)
- [TIMESTAMP] Phase 1: confidence(plan) — 84% (iteration 1, gathering more evidence)
- [TIMESTAMP] Phase 1: confidence(plan) — 88% (iteration 2, asking user)
```

**Do NOT proceed to Phase 2 until the confidence gate passes or the user
explicitly approves a lower score.**

---

## Planner-Executor Handoff

This phase ends with the confidence gate. After `plan.md` is gated, the
planner agent stops at the end of Phase 2 and hands off to the executor — see
[`planner-executor-handoff.md`](./planner-executor-handoff.md) for the
contract and message format.

---

## Planning Checklist

- [ ] Codebase analyzed (structure, patterns, stack)
- [ ] Parallel `Explore` sub-agents used if complexity triggered (anchor: `parallel-research`)
- [ ] `holistic-analysis` invoked if complexity triggered (anchor: `complex-task-detection`)
- [ ] Technical approach designed with specific file references
- [ ] `code-quality(plan)` invoked and design refined (anchor: `design-quality`)
- [ ] `confidence(plan)` ≥ 90% OR user-approved (anchor: `confidence-gate`)
- [ ] Companion invocations logged (will move to `plan.md` Progress Log in Phase 2)

**Phase 1 ends in conversation. The `plan.md` artifact is generated in
[Phase 2](./phase-2-worktree.md#plan-generation).**

---

## References

- Previous phase: [phase-0-validation](./phase-0-validation.md)
- Next phase: [phase-2-worktree](./phase-2-worktree.md)
- Companion registry: [companion-skills](./companion-skills.md)
- Related skill: [`confidence`](../../confidence/SKILL.md)
- Related skill: [`code-quality`](../../code-quality/SKILL.md)
- Related skill: [`holistic-analysis`](../../holistic-analysis/SKILL.md)
- Related skill: [`aw-create-plan`](../../aw-create-plan/SKILL.md)
