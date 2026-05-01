# Autonomous Workflow

> Execute complete feature development cycles autonomously using isolated worktrees, layered companion skills, and a CI gate.

> **📦 VS Code extension available.** Install [**Agent Tasks**](https://marketplace.visualstudio.com/items?itemName=mthines.agent-tasks) from the Marketplace to visualize `plan.md`, `task.md`, and `walkthrough.md` artifacts directly in your VS Code sidebar — see in-progress phases, completed task checkboxes, decisions, and blockers at a glance. Defaults to scanning `.agent/` (with `.gw/` as fallback), configurable via `agentTasks.directories`. Source lives in [`packages/vscode-agent-tasks/`](../../packages/vscode-agent-tasks/).

## What This Skill Does

This skill enables AI agents to autonomously execute complete feature
development workflows from requirements to merged PR. It provides a phase-based
procedure (0–7) where each phase has a gate and optionally invokes companion
skills based on task signals. **Companions skip silently if not installed** —
the workflow never blocks on a missing companion.

| Phase | Name                       | Gate                                             |
| ----- | -------------------------- | ------------------------------------------------ |
| 0     | Validation                 | User confirmed understanding, mode selected      |
| 1     | Planning                   | `confidence(plan)` >= 90% (or user-approved)     |
| 2     | Worktree Setup             | Worktree created, `plan.md` written              |
| 3     | Implementation             | Code complete, fast checks pass                  |
| 4     | Testing                    | All tests pass OR user-approved stop             |
| 5     | Documentation              | Docs reflect changes (incl. `CLAUDE.md`)         |
| 6     | PR Creation                | Walkthrough shown, draft PR opened               |
| 7     | CI Gate + Optional Cleanup | CI green OR user-approved stop                   |

---

## Repository Structure

| File / Directory                   | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| [`SKILL.md`](./SKILL.md)           | Thin index (entry point loaded by Claude). Lists phases, companions, principles. |
| [`rules/`](./rules/)               | Detailed procedure files — each phase, plus shared concerns.    |
| [`rules/companion-skills.md`](./rules/companion-skills.md) | Single-source-of-truth registry for which companion runs at which phase, trigger conditions, and disable instructions. |
| [`rules/phase-N-*.md`](./rules/)   | One file per phase (0–7) with the procedure, gate, and companion invocations. |
| [`rules/overview.md`](./rules/overview.md) | High-level workflow narrative.                          |
| [`rules/artifacts-overview.md`](./rules/artifacts-overview.md) | Artifact pattern (`.agent/{branch}/`).      |
| [`rules/error-recovery.md`](./rules/error-recovery.md)         | Recovery procedures for common errors.      |
| [`rules/safety-guardrails.md`](./rules/safety-guardrails.md)   | Validation checkpoints and resource caps.   |
| [`rules/parallel-coordination.md`](./rules/parallel-coordination.md) | Sub-agent fan-out and multi-agent handoff. |
| [`templates/`](./templates/)       | Agent template + auto-trigger routing rule.                     |
| [`references/`](./references/)     | Lazy-loaded examples (full execution trace, error scenarios).   |

`SKILL.md` is intentionally thin — it's the index Claude loads first. The
phase rules and the companion registry carry the procedural detail.

---

## Installation

### Step 1: Install prerequisites

| Tool | Status                       | Why                                                                 |
| ---- | ---------------------------- | ------------------------------------------------------------------- |
| `gh` | **Required**                 | PR creation (Phase 6) and CI watching (Phase 7)                     |
| `gw` | **Recommended** *(optional)* | Worktree management with auto-copy of secrets, pre/post-checkout hooks, smart cleanup, and shell-integrated `gw cd`. The workflow falls back to native `git worktree` if `gw` is absent. |

```bash
# Required
brew install gh && gh auth login

# Recommended — gw makes worktree-heavy workflows nicer, but is NOT required
brew install mthines/gw-tools/gw
```

`gw` is **not a hard requirement** — if it's not on `PATH`, Phase 2 detects
that at Step 0 and falls through to native `git worktree` commands using the
same sibling-directory layout (`../<repo>-<branch-slug>/`). You'll be warned
once about the features you're missing (auto-copy of secrets, pre/post-checkout
hooks, smart cleanup, shell-integrated `gw cd`), then the workflow continues
normally. See [`rules/prerequisites.md#fallback-to-native-git-worktree`](./rules/prerequisites.md#fallback-to-native-git-worktree)
for the full feature comparison.

### Step 2: Install the skill + agents

The skill ships with [`install.sh`](./install.sh) which handles the agent +
routing-rule symlinks for you. Two steps: download skills, then run install.

> **Pass `--agent claude-code`.** Without it, `npx skills` symlinks every skill
> into ~24 different AI-tool directories at once (`.codebuddy/`, `.continue/`,
> `.crush/`, `.factory/`, `.goose/`, `.junie/`, `.kilocode/`, …). Scoping the
> install to the tool you actually use keeps your workspace tidy and your
> `git status` short. Drop the flag (or use `--agent '*'`) only if you really
> want the universal install.

#### Option A: Global (personal use, all projects)

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --global --yes
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

#### Option B: Per-project (team use, committable)

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --yes
bash .claude/skills/autonomous-workflow/install.sh
```

To run with fewer companions, omit them from the `--skill` list. See
[Disabling Companions](#disabling-companions) below. Run
`bash install.sh --help` for script options.

Then say *"implement X independently"* — the routing rule dispatches the
planner first; once `plan.md` is gated, the executor takes over.

#### What `install.sh` sets up

Two agents linked into your `.claude/agents/` directory:

| Agent | Phases | Terminal artifact | Exit gate |
|---|---|---|---|
| `aw-planner` | 0–2 (validation, planning, worktree + plan.md) | `.agent/{branch}/plan.md` | `confidence(plan) ≥ 90%` (or user-approved override) |
| `aw-executor` | 3–7 (implement, test, docs, PR, CI) | `.agent/{branch}/walkthrough.md` + draft PR | Walkthrough shown inline, Phase 7 CI gate run |

See [`rules/planner-executor-handoff.md`](./rules/planner-executor-handoff.md) for the full handoff contract and [`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md) for the design rationale (with verbatim Anthropic citations).

---

## Companion Skills

Companions are invoked at specific phases based on task signals. The full
trigger registry is in
[`rules/companion-skills.md`](./rules/companion-skills.md).

| Phase | Companion              | Required? | What it does                                  |
| ----- | ---------------------- | --------- | --------------------------------------------- |
| 1     | `holistic-analysis`    | Optional  | Multi-domain execution-path tracing           |
| 1     | `code-quality`         | Optional  | Design-quality review (informs the plan)      |
| 1     | `confidence`           | **Required** | Plan gate (>= 90% to proceed)              |
| 2     | `aw-create-plan`       | Optional  | Writes `.agent/{branch}/plan.md`              |
| 3     | `tdd`                  | Optional  | RED-GREEN-REFACTOR for pure logic / business rules |
| 3     | `ux`                   | Optional  | UI / accessibility review when UI files touched |
| 3     | `code-quality`         | Optional  | End-of-Phase-3 code-quality pass              |
| 4     | `confidence`           | Optional  | `bug-analysis` at iteration cap (3 Lite / 5 Full) |
| 4     | `holistic-analysis`    | Optional  | Step-back analysis after stuck-loop confidence |
| 5     | `update-claude`        | Optional  | Self-improving doc loop (keeps `CLAUDE.md` in sync) |
| 6     | `review-changes`       | Optional  | Pre-PR diff review                            |
| 6     | `aw-create-walkthrough` | Optional  | Writes `.agent/{branch}/walkthrough.md`      |
| 6     | `create-pr`            | Optional  | Narrative PR description + push + watch       |
| 7     | `ci-auto-fix`          | Optional  | Diagnose + fix failed CI checks               |

**`confidence` at Phase 1 is the only non-removable companion.** Without it,
the plan gate is gone and the workflow loses its primary safety mechanism.

---

## Disabling Companions

Two ways to disable a companion:

### 1. Edit `rules/companion-skills.md` + remove invocation

Best for permanent project-level customization:

1. Open [`rules/companion-skills.md`](./rules/companion-skills.md).
2. Delete the row for the companion you want to remove.
3. Open the relevant `rules/phase-N-*.md` and remove the
   `Skill("<name>")` invocation block (the file is referenced from each
   row's "Disable by" link).
4. Commit. Future runs in this project will skip the companion.

### 2. Skip at install time (omit from `--skill` list)

Best for per-machine or one-off customization. When running
`npx skills add ...`, simply omit the companion from the `--skill` list:

```bash
# Install everything except `tdd` and `ux`
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --yes
```

When the workflow tries to invoke the missing companion, Claude will return an
error and the workflow will log:

> `companion: <name> — not available, continuing`

…and continue without it. This is by design.

The only exception is `confidence` at Phase 1 — if it's missing, the workflow
stops and asks you to install it before proceeding.

See [`rules/companion-skills.md`](./rules/companion-skills.md) for full
trigger conditions and per-row disable instructions.

---

## Workflow Modes

### Full Mode (complex changes, 4+ files)

Generates artifacts under `.agent/{branch-name}/`:

- `plan.md` — implementation strategy, decisions, progress log (single
  source of truth)
- `walkthrough.md` — final summary generated at Phase 6

### Lite Mode (simple changes, 1-3 files)

No artifact files created. Plan exists only in conversation. Phase 0,
Phase 2, Phase 5 (`update-claude`), and Phase 6 (`create-pr`) still required.

### Decision Guide

| Complexity | Files Changed | Artifacts | Worktree |
| ---------- | ------------- | --------- | -------- |
| Trivial    | 1 file        | No        | Optional |
| Small      | 2-3 files     | No        | Yes      |
| Medium     | 4-10 files    | Yes       | Yes      |
| Large      | 10+ files     | Yes       | Yes      |

---

## Migration Note: `.gw/` → `.agent/`

Earlier versions of this workflow stored artifacts under `.gw/{branch}/`.
**As of v3.0.0, artifacts live under `.agent/{branch}/`** to align with the
`~/.agents/skills/` cross-tool discovery convention used by Codex, Cursor,
OpenCode, and other Agent Skills–compatible clients.

| Old path                          | New path                              |
| --------------------------------- | ------------------------------------- |
| `.gw/{branch}/plan.md`            | `.agent/{branch}/plan.md`             |
| `.gw/{branch}/walkthrough.md`     | `.agent/{branch}/walkthrough.md`      |

Add `.agent/` to your repo's `.gitignore`. Existing `.gw/` directories are
untouched — only new artifacts land in `.agent/`. Migrate manually with
`git mv .gw .agent` if desired.

---

## Key Principles

1. **Mode detection FIRST** — Full vs Lite before any other action.
2. **Phase 0 and Phase 2 are MANDATORY** — never skip validation or worktree.
3. **`plan.md` is the single source of truth** in Full Mode (generated by
   `aw-create-plan`).
4. **Verify after editing** — fast check before continuing.
5. **Stuck-loop cap is mode-aware** — 3 iterations (Lite) / 5 iterations (Full); at
   the cap, run `confidence(bug-analysis)` and auto-replan or escalate.
6. **Companions skip silently** — never block on a missing companion (except
   `confidence` at Phase 1).
7. **Stop and ask when blocked** — don't guess on ambiguity.
8. **No AI co-author tags** — never add `Co-Authored-By` lines to commits or
   PRs.

---

## Usage

After installing, trigger autonomous execution with natural language:

```
"Implement dark mode toggle independently"
"Add user authentication feature end-to-end"
"Handle this in isolation — refactor the API client to use retry logic"
```

You can also invoke explicitly: `@autonomous-workflow implement X`.

---

## When to Use This Skill

**Use when:**

- Complete feature implementation from requirements to PR
- Autonomous task execution with minimal human intervention
- Isolated worktree-based development
- Self-validating implementation with continuous iteration

**Do NOT use for:**

- Interactive coding sessions (use conversational mode)
- Exploratory research tasks (use the explore agent)

---

## Related Skills

- [`confidence`](../confidence/) — quality gate (plan / code / bug-analysis)
- [`aw-create-plan`](../aw-create-plan/) — `plan.md` artifact generator
- [`aw-create-walkthrough`](../aw-create-walkthrough/) — `walkthrough.md` artifact generator
- [`code-quality`](../code-quality/) — readability and complexity review
- [`tdd`](../tdd/) — RED-GREEN-REFACTOR enforcement
- [`ux`](../ux/) — UI / accessibility review
- [`holistic-analysis`](../holistic-analysis/) — execution-path analysis
- [`update-claude`](../update-claude/) — keeps `CLAUDE.md` in sync
- [`review-changes`](../review-changes/) — pre-PR review
- [`create-pr`](../create-pr/) — narrative PR description + push + watch
- [`ci-auto-fix`](../ci-auto-fix/) — diagnose and fix failed CI checks
- [`git-worktree-workflows`](../git-worktree-workflows/) — worktree basics

---

## Need Help?

- Read [`SKILL.md`](./SKILL.md) for the index of phases and companions.
- Read individual `rules/phase-N-*.md` files for procedures.
- Read [`rules/companion-skills.md`](./rules/companion-skills.md) to see what
  runs when, and how to disable any companion.
- Check the [`references/`](./references/) directory for full execution
  traces and recovery scenarios.

---

*Part of the [agent-skills collection](../).*
