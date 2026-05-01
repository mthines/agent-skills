---
title: 'Phase 2: Worktree Setup'
impact: CRITICAL
tags:
  - worktree
  - mandatory
  - isolation
  - gw
  - git-worktree
  - phase-2
---

# Phase 2: Worktree Setup (MANDATORY)

## Overview

This phase is MANDATORY before any code changes. Every autonomous run creates
an isolated worktree, navigates into it, then writes the `plan.md` artifact
(Full Mode) inside it.

The worktree can be created with [`gw`](https://github.com/mthines/gw-tools)
(recommended — adds auto-copy of secrets, pre/post-checkout hooks, smart
cleanup) or with native `git worktree` if `gw` is not installed. **Both are
supported. Detect at the start of the phase and choose accordingly.**

> **Two distinct directories — do not confuse them:**
>
> | Directory | Owned by | Purpose                                                      |
> | --------- | -------- | ------------------------------------------------------------ |
> | `.gw/`    | gw CLI   | gw config (`config.json`, `state.json`) — only if gw is installed |
> | `.agent/` | this skill | Workflow artifacts (`plan.md`, `walkthrough.md`) — gitignored  |
>
> Artifacts always live under `.agent/{branch-name}/`. Never under `.gw/`.

## Core Principles

- **Isolation is mandatory** — every autonomous execution creates a worktree.
- **Prefer `gw` if available, fall back to `git worktree` if not.**
- **Check smart detection first** — see [smart-worktree-detection](./smart-worktree-detection.md).
- **Verify setup before coding** — build must work in the worktree.
- **Artifacts go in `.agent/`** — never on the main branch, never in `.gw/`.

## Why Isolation Matters

- Preserves the user's working state
- Enables true parallel development
- Provides clean rollback (just remove the worktree)
- Lets autonomous runs operate without disturbing the user's editor

## When to Skip (Rare)

Only skip worktree creation if the user explicitly says:

- "work in current directory"
- "don't create worktree"
- "continue here" (after smart detection prompt)

---

## Procedure

### Step 0: Detect `gw` Availability

```bash
which gw >/dev/null 2>&1 && echo "gw" || echo "native"
```

If the result is `native`, **emit this warning to the user once**, then
continue with native commands:

> ⚠️ `gw` is not installed. Falling back to native `git worktree`. You're
> missing auto-copy of secrets/env files, pre/post-checkout hooks, smart
> cleanup, and shell-integrated `gw cd`. To enable these, install `gw`:
> <https://github.com/mthines/gw-tools>.

See [prerequisites](./prerequisites.md#fallback-to-native-git-worktree) for
the full feature comparison and command equivalents.

### Step 1: Smart Detection

Before creating a new worktree, check whether the current worktree matches
the task. See [smart-worktree-detection](./smart-worktree-detection.md) for
the full algorithm. The detection logic itself is gw-agnostic — it inspects
`git worktree list` output regardless of which tool created the worktrees.

### Step 2: Generate Branch Name

Pattern: `<type>/<short-description>`

| Type        | Use Case              |
| ----------- | --------------------- |
| `feat/`     | New feature           |
| `fix/`      | Bug fix               |
| `refactor/` | Code restructuring    |
| `docs/`     | Documentation only    |
| `chore/`    | Tooling, dependencies |
| `test/`     | Adding / fixing tests |

### Step 3: Create Worktree

#### With `gw` (recommended)

```bash
gw add <branch-name>
```

`gw` will auto-copy configured files (typically `.env`, `.env.local`),
run pre/post-checkout hooks, and place the worktree at the configured
path (sibling directory by default).

#### With native `git worktree` (fallback)

```bash
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BRANCH_SLUG="$(echo "<branch-name>" | tr '/' '-')"
WORKTREE_PATH="../${REPO_NAME}-${BRANCH_SLUG}"

git worktree add -b "<branch-name>" "$WORKTREE_PATH"
```

This mirrors `gw`'s default sibling-directory layout so the placement is
consistent for users who later install `gw`.

If creation fails, see [error-recovery](./error-recovery.md).

### Step 4: Navigate to Worktree

#### With `gw`

```bash
gw cd <branch-name>
```

(Requires shell integration — see [prerequisites](./prerequisites.md#shell-integration-for-gw-cd).)

#### Without `gw`

```bash
cd "$WORKTREE_PATH"
```

Verify with `pwd` — every subsequent command runs inside the worktree.

### Step 5: Sync Configuration (If Needed)

#### With `gw`

If the user has secrets / env files configured in `.gw/config.json` for
auto-copy but the new worktree is missing them, run:

```bash
gw sync <branch-name>
```

#### Without `gw`

Manually copy any env / secrets files the worktree needs. Ask the user what
to copy if unclear:

```bash
cp ../<original-worktree>/.env .
cp ../<original-worktree>/.env.local .
```

### Step 6: Install Dependencies

```bash
# Use the project's package manager
pnpm install   # or npm install / yarn install / bun install
```

When `gw` is installed and a post-checkout hook is configured, this may
already have happened — check before re-running.

### Step 7: Verify Environment

Run the project's fast check:

```bash
# Examples — use whatever the project uses
npx tsc --noEmit         # TypeScript projects
nx run <project>:check   # Nx projects
go vet ./...             # Go projects
cargo check              # Rust projects
```

If verification fails, fix the environment before continuing.

### Step 8: Ensure `.agent/` is Gitignored

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

> **Note on `.gw/`:** if `gw` is installed and the repo is initialized, the
> `gw` CLI manages its own `.gw/.gitignore` (created by `gw init`) so
> `config.json` can be committed while `state.json` and per-branch state
> stay local. That's gw's concern — leave it alone. Workflow artifacts go
> under `.agent/`, not `.gw/`.

---

## Plan Generation

**Anchor:** `plan-generation`

**Full Mode only.** After the worktree is created, navigated into, and
verified, generate the `plan.md` artifact:

```
Skill("aw-create-plan")     # skips silently if not installed
```

The skill writes to `.agent/{branch-name}/plan.md`, capturing the full Phase 0
+ Phase 1 conversation context (requirements, decisions, file changes,
testing strategy, risks, verification commands).

Log the invocation in the plan's Progress Log:

```markdown
- [TIMESTAMP] Phase 2: aw-create-plan() — invoked (.agent/{branch}/plan.md written)
- [TIMESTAMP] Phase 2: aw-create-plan() — not available, continuing without artifact
```

If `aw-create-plan` isn't installed, the workflow continues — but in Full Mode
the user should be warned that no `plan.md` exists for context recovery.

**DO NOT proceed to Phase 3 without a populated `plan.md` (Full Mode).**

### Append-to-Progress-Log Pattern

After **every** milestone in subsequent phases, append a single line to the
Progress Log section of `plan.md`. Example milestones:

| Phase | Milestone                          |
| ----- | ---------------------------------- |
| 2     | Worktree created, deps installed   |
| 2     | `aw-create-plan` invoked           |
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

## Planner Handoff

Phase 2 is the last phase the planner runs. After `plan.md` is written and
the confidence gate has cleared:

- **Confidence ≥ 90%**: emit the auto-handoff message (see [`planner-executor-handoff.md#handoff-message-format`](./planner-executor-handoff.md#handoff-message-format)) and STOP. Wait for the user (or main session) to dispatch the executor.
- **Confidence < 90%** (after up to 2 retries): emit the user-approval message and STOP.

---

## Command Reference

### With `gw`

```bash
gw add feat/my-feature                  # Create worktree
gw add feat/my-feature --from develop   # From a different source branch
gw cd feat/my-feature                   # Navigate to worktree
gw list                                 # List worktrees (state of all worktrees)
git status                              # Check current working-tree status (inside worktree)
gw sync feat/my-feature                 # Sync config files
gw remove feat/my-feature               # Remove worktree (Phase 7)
```

### With native `git worktree` (fallback)

```bash
git worktree add -b feat/foo ../<repo>-feat-foo  # Create worktree + branch
git worktree list                                # List worktrees
cd ../<repo>-feat-foo                            # Navigate (manual)
cp ../<source>/.env .                            # Sync env files (manual)
git worktree remove ../<repo>-feat-foo           # Remove worktree
git branch -d feat/foo                           # Then remove the branch
```

---

## Setup Checklist

Before Phase 3 (Implementation):

- [ ] `gw` availability detected; native fallback warning shown if missing
- [ ] Smart detection completed
- [ ] Branch name follows conventions
- [ ] Worktree created (with `gw add` or `git worktree add`)
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

With `gw`:

```bash
gw cd <branch-name>          # Navigate to existing
gw add <branch-name>-v2      # Or create with a different name
```

Without `gw`:

```bash
git worktree list            # Check existing worktrees
cd <existing-path>           # Navigate to existing
# Or pick a different branch name and re-run Step 3
```

### Dependencies Failed

```bash
rm -rf node_modules
pnpm install                 # or your package manager
```

### `gw` Not Found

Not an error — see [prerequisites](./prerequisites.md#fallback-to-native-git-worktree)
for the native fallback procedure. The workflow continues without `gw`.

---

## References

- Previous phase: [phase-1-planning](./phase-1-planning.md)
- Next phase: [phase-3-implementation](./phase-3-implementation.md)
- Smart detection: [smart-worktree-detection](./smart-worktree-detection.md)
- Tool prerequisites: [prerequisites](./prerequisites.md)
- Error recovery: [error-recovery](./error-recovery.md)
- Companion registry: [companion-skills](./companion-skills.md)
- gw-tools (recommended): <https://github.com/mthines/gw-tools>
- Native git worktree docs: <https://git-scm.com/docs/git-worktree>
- Related skill: [`aw-create-plan`](../../aw-create-plan/SKILL.md)
- Related skill: [`git-worktree-workflows`](../../git-worktree-workflows/)
