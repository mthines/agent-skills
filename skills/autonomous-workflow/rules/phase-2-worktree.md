---
title: 'Phase 2: Worktree Setup'
impact: CRITICAL
tags:
  - worktree
  - mandatory
  - isolation
  - gw
  - phase-2
---

# Phase 2: Worktree Setup (MANDATORY)

## Overview

This phase is MANDATORY before any code changes. Every autonomous run creates
an isolated worktree using `gw add`, navigates into it, then writes the
`plan.md` artifact (Full Mode) inside it.

> **Two distinct directories — do not confuse them:**
>
> | Directory | Owned by | Purpose                                                      |
> | --------- | -------- | ------------------------------------------------------------ |
> | `.gw/`    | gw CLI   | gw config (`config.json`, `state.json`) — committed selectively |
> | `.agent/` | this skill | Workflow artifacts (`plan.md`, `walkthrough.md`) — gitignored  |
>
> Artifacts always live under `.agent/{branch-name}/`. Never under `.gw/`.

## Core Principles

- **Isolation is mandatory** — every autonomous execution creates a worktree.
- **Use `gw add`** — not raw `git worktree add`.
- **Check smart detection first** — see [smart-worktree-detection](./smart-worktree-detection.md).
- **Verify setup before coding** — build must work in the worktree.
- **Artifacts go in `.agent/`** — never on the main branch, never in `.gw/`.

## Why Isolation Matters

- Preserves the user's working state
- Enables true parallel development
- Provides clean rollback (just remove the worktree)
- Follows gw-tools best practices

## When to Skip (Rare)

Only skip worktree creation if the user explicitly says:

- "work in current directory"
- "don't create worktree"
- "continue here" (after smart detection prompt)

---

## Procedure

### Step 0: Smart Detection

Before creating, check whether the current worktree matches the task. See
[smart-worktree-detection](./smart-worktree-detection.md) for the full
algorithm.

### Step 1: Generate Branch Name

Pattern: `<type>/<short-description>`

| Type        | Use Case              |
| ----------- | --------------------- |
| `feat/`     | New feature           |
| `fix/`      | Bug fix               |
| `refactor/` | Code restructuring    |
| `docs/`     | Documentation only    |
| `chore/`    | Tooling, dependencies |
| `test/`     | Adding / fixing tests |

### Step 2: Create Worktree

```bash
gw add <branch-name>
```

If this fails, see [error-recovery](./error-recovery.md). If `gw` is missing,
see [prerequisites](./prerequisites.md).

### Step 3: Navigate to Worktree

```bash
gw cd <branch-name>
```

Verify with `pwd` — every subsequent command runs inside the worktree.

### Step 4: Install Dependencies

```bash
# Use the project's package manager
pnpm install   # or npm install / yarn install / bun install
```

### Step 5: Verify Environment

Run the project's fast check:

```bash
# Examples — use whatever the project uses
npx tsc --noEmit         # TypeScript projects
nx run <project>:check   # Nx projects
go vet ./...             # Go projects
cargo check              # Rust projects
```

If verification fails, fix the environment before continuing.

### Step 6: Sync Configuration (If Needed)

```bash
gw sync <branch-name>
```

### Step 7: Ensure `.agent/` is Gitignored

Workflow artifacts are per-developer state and must not be committed. Add
`.agent/` to the repo's root `.gitignore` if it isn't already:

```bash
if ! grep -q '^\.agent/$' .gitignore 2>/dev/null; then
  printf '\n# Autonomous workflow artifacts\n.agent/\n' >> .gitignore
fi
```

Alternatively, create a nested `.agent/.gitignore`:

```bash
mkdir -p .agent
if [ ! -f .agent/.gitignore ]; then
  printf '# Workflow artifacts (per-developer, not committed)\n*\n!.gitignore\n' > .agent/.gitignore
fi
```

> **Note on `.gw/`:** the `gw` CLI manages its own `.gw/.gitignore` (created
> by `gw init` / `gw checkout`) so `config.json` can be committed while
> `state.json` and per-branch state stay local. That's gw's concern — leave it
> alone. Workflow artifacts go under `.agent/`, not `.gw/`.

---

## Plan Generation

**Anchor:** `plan-generation`

**Full Mode only.** After the worktree is created, navigated into, and
verified, generate the `plan.md` artifact:

```
Skill("create-plan")     # skips silently if not installed
```

The skill writes to `.agent/{branch-name}/plan.md`, capturing the full Phase 0
+ Phase 1 conversation context (requirements, decisions, file changes,
testing strategy, risks, verification commands).

Log the invocation in the plan's Progress Log:

```markdown
- [TIMESTAMP] Phase 2: create-plan() — invoked (.agent/{branch}/plan.md written)
- [TIMESTAMP] Phase 2: create-plan() — not available, continuing without artifact
```

If `create-plan` isn't installed, the workflow continues — but in Full Mode
the user should be warned that no `plan.md` exists for context recovery.

**DO NOT proceed to Phase 3 without a populated `plan.md` (Full Mode).**

### Append-to-Progress-Log Pattern

After **every** milestone in subsequent phases, append a single line to the
Progress Log section of `plan.md`. Example milestones:

| Phase | Milestone                          |
| ----- | ---------------------------------- |
| 2     | Worktree created, deps installed   |
| 2     | `create-plan` invoked              |
| 3     | Each file modified, fast-check run |
| 3     | `code-quality(code)` at end        |
| 4     | Each test run + result             |
| 5     | Docs updated, `update-claude` run  |
| 6     | `review-changes`, `create-pr`      |
| 7     | CI status, `ci-auto-fix` runs      |

Format:

```markdown
- [2026-04-29T15:30:00Z] Phase N: <event> — <result>
```

The log is the durable trail a fresh Claude session uses to resume mid-flight.

---

## gw Commands Reference

```bash
gw add feat/my-feature                  # Create worktree
gw add feat/my-feature --from develop   # From a different source branch
gw cd feat/my-feature                   # Navigate to worktree
gw list                                 # List worktrees
gw status                               # Check current status
gw sync feat/my-feature                 # Sync config files
gw remove feat/my-feature               # Remove worktree (Phase 7)
```

---

## Setup Checklist

Before Phase 3 (Implementation):

- [ ] Smart detection completed
- [ ] Branch name follows conventions
- [ ] Worktree created with `gw add`
- [ ] Currently inside worktree directory (`pwd` verified)
- [ ] Dependencies installed
- [ ] Environment fast-check passes
- [ ] `.agent/` is gitignored (root `.gitignore` or nested `.agent/.gitignore`)
- [ ] `plan.md` created in `.agent/{branch}/plan.md` (Full Mode only — anchor: `plan-generation`)
- [ ] First Progress Log entry written

**If any checkbox is unchecked, STOP and complete Phase 2.**

---

## Troubleshooting

### Branch Already Exists

```bash
gw cd <branch-name>          # Navigate to existing
gw add <branch-name>-v2      # Or create with a different name
```

### Dependencies Failed

```bash
rm -rf node_modules
pnpm install                 # or your package manager
```

### `gw` Not Found

See [prerequisites](./prerequisites.md) for installation.

---

## References

- Previous phase: [phase-1-planning](./phase-1-planning.md)
- Next phase: [phase-3-implementation](./phase-3-implementation.md)
- Smart detection: [smart-worktree-detection](./smart-worktree-detection.md)
- Tool prerequisites: [prerequisites](./prerequisites.md)
- Error recovery: [error-recovery](./error-recovery.md)
- Companion registry: [companion-skills](./companion-skills.md)
- Related skill: [`create-plan`](../../create-plan/SKILL.md)
- Related skill: [`git-worktree-workflows`](../../git-worktree-workflows/)
