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

## Overview

Two distinct concerns live in this rule:

1. **Sub-agent fan-out within a single workflow run** (Phase 1 research,
   Phase 7 CI fixes) — when one agent spawns multiple sub-agents in parallel.
2. **Multi-agent handoff** — when separate worktrees are owned by separate
   agents and need to coordinate on naming and hand-off.

Phase 3 implementation is **NOT parallelized** — file-level changes share
state and concurrent edits cause conflicts.

---

## Sub-Agent Parallelization (within one run)

| Phase | Pattern                                          | Cap                          |
| ----- | ------------------------------------------------ | ---------------------------- |
| 1     | Parallel `Explore` sub-agents for research       | One per package / concern    |
| 7     | Parallel `ci-auto-fix` per independent failure   | 2 handoffs per PR            |
| 3     | **Sequential only** — no fan-out                 | n/a                          |

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

### Phase 3: Why no fan-out

Implementation edits share file state. Two sub-agents editing the same module
race; two editing different modules still need a coordinated commit history.
Keep Phase 3 sequential and let the inner companions (`tdd`, `ux`,
`code-quality(code)`) provide the structure.

---

## Multi-Agent Handoff (across runs)

When multiple autonomous agents work in parallel on separate worktrees, or
one agent hands off to another, follow these rules.

### Core Principles

- **Unique worktree names**: prevent conflicts between agents.
- **Never share branches**: each agent works on its own branch.
- **Document state for handoff**: clear notes when handing off.
- **Check before creating**: always run `gw list` first.

### Worktree Naming Convention

When multiple agents may run in parallel, include a unique identifier:

**Pattern:** `<type>/<name>-<identifier>`

| Identifier type | Example                             |
| --------------- | ----------------------------------- |
| Timestamp       | `feat/auth-20240315-143022`         |
| Agent ID        | `feat/auth-agent-abc123`            |
| Session ID      | `feat/auth-session-xyz`             |

```bash
# With timestamp
gw add feat/dark-mode-$(date +%Y%m%d-%H%M%S)

# With agent identifier
gw add feat/dark-mode-agent-${AGENT_ID}
```

### Avoiding Conflicts

```bash
# Always check existing worktrees
gw list

# Check for similar branches
git branch --list "*dark-mode*"
```

Rules:

1. Never work on the same branch as another worktree.
2. Use descriptive names to avoid confusion.
3. Check `gw list` before every `gw add`.

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

| Step | Command                          |
| ---- | -------------------------------- |
| 1    | `gw cd <branch-name>`            |
| 2    | Read `.agent/{branch}/plan.md`   |
| 3    | `git status` and run fast checks |
| 4    | Resume from documented state     |

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
   gw add feat/auth-oauth --from feat/auth-base
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
gw list

# If another agent's worktree:
# - Use a different branch name
# - Coordinate with that agent

# If orphaned worktree:
gw remove <conflicting-worktree>
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
