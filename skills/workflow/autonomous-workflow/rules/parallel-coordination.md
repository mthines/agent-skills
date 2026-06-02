---
title: 'Parallel Agent Coordination'
impact: HIGH
tags:
  - parallel
  - multi-agent
  - coordination
  - handoff
  - sub-agents
---

# Parallel Agent Coordination

## Contents

- [Overview](#overview)
- [Sub-Agent Parallelization (within one run)](#sub-agent-parallelization-within-one-run)
- [Multi-Agent Handoff (across runs)](#multi-agent-handoff-across-runs)
- [Handoff Protocol](#handoff-protocol)
- [Receiving Handoff](#receiving-handoff)
- [Parallel Execution Patterns](#parallel-execution-patterns)
- [Conflict Resolution](#conflict-resolution)
- [References](#references)

## Overview

Two distinct concerns live in this rule:

1. **Sub-agent fan-out within a single workflow run** (Phase 1 research,
   Phase 7 CI fixes) — when one agent spawns multiple sub-agents in parallel.
2. **Multi-agent handoff** — when separate worktrees are owned by separate
   agents and need to coordinate on naming and hand-off.

Phase 3 implementation allows **controlled fan-out** when slices are
file-disjoint — see [Phase 3: Controlled fan-out under per-slice scoping](#phase-3-controlled-fan-out-under-per-slice-scoping)
and [Sub-Agent Resource Discipline](#sub-agent-resource-discipline).

---

## Sub-Agent Parallelization (within one run)

| Phase | Pattern                                          | Cap                          |
| ----- | ------------------------------------------------ | ---------------------------- |
| 1     | Parallel `Explore` sub-agents for research       | One per package / concern    |
| 7     | Parallel `ci-auto-fix` per independent failure   | 2 handoffs per PR            |
| 3     | Controlled fan-out — file-disjoint slices only   | 3 concurrent sub-agents      |

> **Cap asymmetry note.** The Phase 3 cap (3) and Phase 7 cap (2) serve
> different concerns: Phase 3 is concurrent-within-a-phase (RAM-bounded —
> bounds peak RSS); Phase 7 is total handoffs per PR (token-bounded — bounds
> token spend and retry surface). They are independently justified.

### Phase 1: Parallel Research (when complex/multi-domain)

When the task touches multiple packages, domains, or unfamiliar areas,
spawn parallel `Explore` sub-agents during planning. Suggested partitions:

- One sub-agent per affected package (e.g. `packages/api`, `packages/ui`)
- One sub-agent for past PRs / commit history search
- One sub-agent for related docs (`CLAUDE.md`, READMEs, `skills/`)

Each sub-agent returns findings; the main agent integrates them into the
plan. Run only when complexity warrants — for simple tasks, sequential
research is cheaper. See
[phase-1-planning.md#parallel-research](./phase-1-planning.md#parallel-research).

### Phase 7: Parallel CI Auto-Fix

When CI completes with multiple **independent** failed checks (lint AND
tests, not lint with secondary test failures), spawn one
`Skill("ci-auto-fix", "<run-id>")` sub-agent per failure.

**Cap: 2 parallel handoffs per PR.** If 2 handoffs don't resolve the failures,
escalate to the user — do not chain a third. See
[phase-7-ci-gate.md#parallel-ci-fixes](./phase-7-ci-gate.md#parallel-ci-fixes).

### Phase 3: Controlled fan-out under per-slice scoping

When the implementation task decomposes cleanly into **file-disjoint slices**
(e.g. backend handler, frontend component, migration script — no two slices
edit the same file), the orchestrator may fan out up to **3 concurrent
sub-agents**, one per slice.

**Pre-conditions for fan-out (all must be true):**

1. Slices are file-disjoint — no two slices write the same file.
2. No slice depends on the output of another slice at write time (no
   "A generates a type that B imports" dependency within the same fan-out).
3. Each sub-agent receives the [Sub-Agent Resource Discipline](#sub-agent-resource-discipline)
   embedding (see below).

**Hard cap: 3 concurrent sub-agents.** Three concurrent sub-agent processes
(each with their own Node.js heap, editor state, and scoped compile invocations)
at approximately the peak RSS footprint measured during multi-slice testing is
survivable on a 16 GB developer host; four concurrent processes is not.
(Note: whole-project `tsc` is forbidden inside sub-agents — the RSS bound
covers the sub-agent process overhead itself, not a whole-program type-check.)

**If the task does not decompose cleanly, keep Phase 3 sequential.** Sequential
is still the default for mixed-concern tasks.

After all sub-agents return, the orchestrator runs a coordinated commit and the
Phase 4 full-suite validation as normal.

**Sub-agent prompt template (one per file-disjoint slice):**

```
description: Implement <slice-name> in isolation
subagent_type: general-purpose
prompt: |
  Implement the <slice-name> slice of <task-name>. Inputs:

  - Plan: .agent/<branch>/plan.md (read the File Changes table and
    Implementation Order for your slice only — do not touch files outside it)
  - Slice scope: <list-of-files-this-sub-agent-owns>
  - Worktree: <absolute-worktree-path>

  Follow the Phase 3 procedure. Commit at logical milestones with conventional
  commit messages. Do NOT add Co-Authored-By lines.

  Sub-Agent Resource Discipline: use scoped commands only — narrow
  tsc/eslint/jest to the files/paths you touched. Do NOT run
  whole-project npm run lint, npx tsc --noEmit (without project refs), npm test
  (without --testPathPattern), or npm run build. The orchestrator runs
  whole-project verification after all sub-agents return.
```

This template is committed reference text. At runtime the orchestrator writes
its dispatch prompt inline; the runtime gate is the LLM reading the rule below
and including the resource-discipline language in the prompt it sends.

---

## Sub-Agent Resource Discipline {#sub-agent-resource-discipline}

> **Hard rule.** Sub-agents MUST run scoped / path-narrowed validation commands only.
> Whole-project lint, type-check, test, and build commands are FORBIDDEN
> inside sub-agents. Whole-project commands are reserved for the orchestrator
> at well-defined boundaries (Phase 4 Step 6, Phase 6 pre-PR).

### Command translation table

| Forbidden inside sub-agents | Scoped equivalent |
|-----------------------------|-------------------|
| `npx tsc --noEmit` | If `tsconfig.json` has `"references"`: `npx tsc --noEmit -p <project-tsconfig>`. If NO project references: **SKIP type checking in the sub-agent** — leave it to the orchestrator's Phase 4 Step 6. Note: `tsc --noEmit <file>` does NOT scope the program load — it still resolves all imports. |
| `npm run lint` (no args) | `npx eslint <changed-files>` or `npm run lint -- <changed-files>` |
| `npm test` | `npm test -- --testPathPattern="<area>"` (also pin `--maxWorkers=2` if Jest) |
| `npm run build` | Avoid in sub-agents entirely — build is the orchestrator's job at Phase 6 pre-PR |
| `nx run-many -t build test lint` | `nx affected -t lint --files=<files>` or scope to the touched project(s) only |

### Orchestrator-only checkpoints

| Checkpoint | Where | Who runs it |
|------------|-------|-------------|
| Full type-check | Phase 4 Step 6 | Orchestrator only |
| Full lint | Phase 4 Step 6 | Orchestrator only |
| Full test suite | Phase 4 | Orchestrator only |
| Full build | Phase 6 pre-PR | Orchestrator only |

### Embedding requirement

Every sub-agent dispatch block the orchestrator writes — both the committed
templates in `rules/` and `templates/` and the inline dispatch prompts the
executor produces at runtime — **MUST** include the following text in the
prompt body:

> "Sub-Agent Resource Discipline: use scoped commands only — narrow
> `tsc`/`eslint`/`jest` to the files/paths you touched. Do NOT run
> whole-project `npm run lint`, `npx tsc --noEmit` (without project refs), `npm test`
> (without `--testPathPattern`), or `npm run build`. The orchestrator runs
> whole-project verification after all sub-agents return."

Enforcement at maintenance time is the diff review (this language is easy to
eyeball in a PR). Enforcement at runtime is the executor reading this rule
when it writes the dispatch prompt.

---

## Multi-Agent Handoff (across runs)

When multiple autonomous agents work in parallel on separate worktrees, or
one agent hands off to another, follow these rules.

### Core Principles

- **Unique worktree names**: prevent conflicts between agents.
- **Never share branches**: each agent works on its own branch.
- **Document state for handoff**: clear notes when handing off.
- **Check before creating**: always run `gw list` (or `git worktree list` if `gw` is not installed) first.

### Worktree Naming Convention

When multiple agents may run in parallel, include a unique identifier:

**Pattern:** `<type>/<name>-<identifier>`

| Identifier type | Example                             |
| --------------- | ----------------------------------- |
| Timestamp       | `feat/auth-20240315-143022`         |
| Agent ID        | `feat/auth-agent-abc123`            |
| Session ID      | `feat/auth-session-xyz`             |

```bash
# With timestamp (with gw)
gw add feat/dark-mode-$(date +%Y%m%d-%H%M%S)

# With agent identifier (with gw)
gw add feat/dark-mode-agent-${AGENT_ID}

# Native git worktree equivalent
BRANCH="feat/dark-mode-$(date +%Y%m%d-%H%M%S)"
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BRANCH_SLUG="$(echo "$BRANCH" | tr '/' '-')"
git worktree add -b "$BRANCH" "../${REPO_NAME}-${BRANCH_SLUG}"
```

### Avoiding Conflicts

```bash
# Always check existing worktrees
gw list                  # with gw
git worktree list        # native (works in both cases)

# Check for similar branches
git branch --list "*dark-mode*"
```

Rules:

1. Never work on the same branch as another worktree.
2. Use descriptive names to avoid confusion.
3. Check `gw list` (or `git worktree list`) before every worktree creation.

---

## Handoff Protocol

When handing off work to another agent:

### Step 1: Commit All Changes

```bash
git add .
git commit -m "WIP: [current state description]"
```

### Step 2: Update plan.md Progress Log

The plan.md at `.agent/{branch}/plan.md` is the canonical handoff document.
Append a final Progress Log entry capturing:

- Current phase and gate status
- Last completed step
- Next step to take
- Outstanding issues / open questions
- Companion skills already invoked (and their findings)

A separate `HANDOFF.md` is no longer needed — `plan.md` already carries the
state.

### Step 3: Push Branch

```bash
git push -u origin <branch-name>
```

### Step 4: Provide Handoff Info

Share with the next agent:

- Worktree path: `/path/to/worktree`
- Branch name: `feat/feature-name`
- PR (if created): `https://github.com/...`
- Plan: read `.agent/{branch}/plan.md` for full context

---

## Receiving Handoff

| Step | Command (with `gw`)              | Command (native `git worktree`)                                |
| ---- | -------------------------------- | -------------------------------------------------------------- |
| 1    | `gw cd <branch-name>`            | `cd ../<repo>-<branch-slug>` (manual; see `git worktree list`) |
| 2    | Read `.agent/{branch}/plan.md`   | Same                                                           |
| 3    | `git status` and run fast checks | Same                                                           |
| 4    | Resume from documented state     | Same                                                           |

---

## Parallel Execution Patterns

### Independent Features

Multiple agents on unrelated features — no coordination needed:

```
Agent A: feat/dark-mode-agent-a
Agent B: feat/user-profile-agent-b
Agent C: fix/login-error-agent-c
```

### Related Features (sequential dependency)

```
Agent A: feat/auth-base-agent-a     (foundation)
Agent B: feat/auth-oauth-agent-b    (depends on A)
```

Coordination:

1. Agent B waits for Agent A to complete.
2. Agent B branches from Agent A:
   ```bash
   # With gw
   gw add feat/auth-oauth --from feat/auth-base

   # Native git worktree fallback
   git worktree add -b feat/auth-oauth ../<repo>-feat-auth-oauth feat/auth-base
   ```

### Split Task

Single task split across agents:

```
Agent A: feat/dashboard-charts
Agent B: feat/dashboard-filters
```

Coordination:

1. Both start from the same base (`main`).
2. Merge both PRs to `main`, OR have one agent integrate both at the end.

---

## Conflict Resolution

```bash
# Check who owns the worktree
gw list                  # with gw
git worktree list        # native (works in both cases)

# If another agent's worktree:
# - Use a different branch name
# - Coordinate with that agent

# If orphaned worktree:
gw remove <conflicting-worktree>                      # with gw
# or, native fallback:
git worktree remove ../<repo>-<branch-slug> \
  && git branch -D <conflicting-branch>
```

---

## References

- Related rule: [companion-skills](./companion-skills.md) — parallelization
  caps
- Related rule: [phase-1-planning](./phase-1-planning.md#parallel-research)
- Related rule: [phase-7-ci-gate](./phase-7-ci-gate.md#parallel-ci-fixes)
- Related rule: [phase-2-worktree](./phase-2-worktree.md)
- Related rule: [smart-worktree-detection](./smart-worktree-detection.md)
- Research: [Claude Code Worktree Support](https://code.claude.com/docs/en/common-workflows)
