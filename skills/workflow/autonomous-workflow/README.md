# `@aw` — Autonomous Workflow

> Execute complete feature development cycles autonomously using isolated worktrees, layered companion skills, and a CI gate.

> **📦 VS Code extension available.** Install [**Agent Tasks**](https://marketplace.visualstudio.com/items?itemName=mthines.agent-tasks) from the Marketplace to visualize `plan.md`, `task.md`, and `walkthrough.md` artifacts directly in your VS Code sidebar — see in-progress phases, completed task checkboxes, decisions, and blockers at a glance. Defaults to scanning `.agent/` (with `.gw/` as fallback), configurable via `agentTasks.directories`. Source lives in [`packages/vscode-agent-tasks/`](../../../packages/vscode-agent-tasks/).

## What This Skill Does

This skill enables AI agents to autonomously execute complete feature
development workflows from requirements to merged PR. It provides a phase-based
procedure (0–7) where each phase has a gate and optionally invokes companion
skills based on task signals. **Companions skip silently if not installed** —
the workflow never blocks on a missing companion.

| Phase | Name                       | Gate                                             |
| ----- | -------------------------- | ------------------------------------------------ |
| 0     | Validation                 | User confirmed understanding, mode selected      |
| 1     | Planning                   | `confidence(plan)` >= 90% (or user-approved); `specs.md` drafted for UI tasks |
| 2     | Worktree Setup             | Worktree created, `plan.md` (+ `specs.md`) written |
| 3     | Implementation             | Code complete, fast checks pass                  |
| 4 (UI)| Spec Verification          | `aw-tester` verdict `green`/`inconclusive` — runs before lint/type/test |
| 4     | Testing                    | All tests pass OR user-approved stop             |
| 5     | Documentation              | Docs reflect changes (incl. `CLAUDE.md`)         |
| 6     | PR Creation                | Walkthrough shown, draft PR opened               |
| 7     | CI Gate + Optional Cleanup | CI green OR user-approved stop; optional spec rehearsal against preview |

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
| [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) | Fast-tier episodic-lessons loop (`aw-lessons`) + promotion to `diagnose`. |
| [`rules/phase-4-spec-verification.md`](./rules/phase-4-spec-verification.md) | Spec-driven UI verification sub-rule (before lint/type/test). |
| [`rules/parallel-coordination.md`](./rules/parallel-coordination.md) | Sub-agent fan-out and multi-agent handoff. |
| [`templates/`](./templates/)       | Agent templates + auto-trigger routing rule + aw-target/specs templates. |
| [`templates/aw-tester.agent.md`](./templates/aw-tester.agent.md) | `aw-tester` spec-driven UI verification agent. |
| [`templates/aw-target.yml.template`](./templates/aw-target.yml.template) | Aw-Target schema (base URL, auth strategy, fixtures, constraints). |
| [`templates/specs.md.template`](./templates/specs.md.template)   | Specs file format with example blocks for new features and refactors. |
| [`aw-setup/SKILL.md`](./aw-setup/SKILL.md) | Interactive one-time aw-target scaffolding skill (`/aw-setup`). |
| [`memory/aw-tester-lessons/`](../../../memory/aw-tester-lessons/) | Cross-run lessons for `aw-tester` (mirrors `aw-lessons` format). |
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

### Step 2: Clone and install

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills
bash scripts/sync-symlinks.sh --aw
```

`--aw` symlinks the autonomous-workflow skill and its 12 companion skills,
plus the `aw` / `aw-planner` / `aw-executor` agents, into your `~/.claude/`
directory. Edits to the cloned repo are picked up live on the next agent
turn — `git pull` is the whole upgrade story.

To install **every** skill and agent in this repo (not just the AW bundle),
drop the `--aw` flag. To preview without applying, add `--dry-run` (or `-n`).

> **Prefer a no-clone install?** `npx skills add` still works — see the root
> [README](../../../README.md#install) for the npx path and other options.

Then say *"implement X independently"* (or invoke `@aw`) — the routing rule
dispatches the **`aw` dispatcher**, which detects the tier and routes: Micro/Lite
run single-pass; Full hands off to the planner→executor split.

#### What gets installed

Four agents linked into your `.claude/agents/` directory under the
**`aw-` namespace** (short for "autonomous-workflow") so they group together
and are unmistakable when listed alongside unrelated agents:

| Agent | Role | Terminal artifact | Exit gate |
|---|---|---|---|
| `aw` | **Opt-in dispatcher.** Reads lessons, detects tier (Micro/Lite/Full), routes, owns the self-improvement loop for every tier. | — (delegates) | Task routed + exit lesson written |
| `aw-planner` | Full tier, phases 0–2 (validation, planning, worktree + plan.md + specs.md) | `.agent/{branch}/plan.md` + `specs.md` (UI tasks) | `confidence(plan) ≥ 90%` (or user-approved override) |
| `aw-executor` | Full tier, phases 3–7 (implement, test, docs, PR, CI) | `.agent/{branch}/walkthrough.md` + draft PR | Walkthrough shown inline, Phase 7 CI gate run |
| `aw-tester` | Phase 4 spec-driven UI verification — dispatched by executor before lint/type/test | Verdict block (~200 tokens) | `green` or `inconclusive` |

`aw` is **adaptive and opt-in**: it only pays the planner→executor handoff cost
on Full tasks (where context isolation + a resumable `plan.md` earn it), and runs
Micro/Lite single-pass. It is invoked deliberately, not as a wrapper on every prompt.

**One-time UI setup:** run `/aw-setup` once per project before the first autonomous
UI task. This scaffolds `.claude/aw-targets/local.yml` (the aw-target `aw-tester` reads)
and validates it with a smoke spec. The planner halts and prompts if no aw-target exists.
See [`aw-setup/SKILL.md`](./aw-setup/SKILL.md).

> **Upgrading from a pre-`aw-` install?** The installer detects legacy
> `autonomous-planner.md` / `autonomous-executor.md` symlinks pointing at
> these templates and removes them before linking the new `aw-` names —
> no manual cleanup needed. Hand-authored files at those paths are left
> untouched.

See [`rules/planner-executor-handoff.md`](./rules/planner-executor-handoff.md) for the full handoff contract and [`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md) for the design rationale (with verbatim Anthropic citations).

---

## Companion Skills

Companions are invoked at specific phases based on task signals. The full
trigger registry is in
[`rules/companion-skills.md`](./rules/companion-skills.md).

| Phase | Companion              | Required? | What it does                                  |
| ----- | ---------------------- | --------- | --------------------------------------------- |
| 1     | `persistent-memory`    | Optional  | Reads `aw-lessons` — applies prior workflow lessons as plan constraints (fast-tier self-improvement) |
| 1     | `holistic-analysis`    | Optional  | Multi-domain execution-path tracing           |
| 1     | `code-quality`         | Optional  | Design-quality review (informs the plan)      |
| 1     | `confidence`           | **Required** | Plan gate (>= 90% to proceed)              |
| 2     | `aw-create-plan`       | Optional  | Writes `.agent/{branch}/plan.md`              |
| 3     | `tdd`                  | Optional  | RED-GREEN-REFACTOR for pure logic / business rules |
| 3     | `ux`                   | Optional  | UI / accessibility review when UI files touched |
| 3     | `code-quality`         | Optional  | End-of-Phase-3 code-quality pass              |
| 4 (UI)| `aw-tester` *(agent)*  | Optional  | Spec-driven UI verification — dispatched before lint/type/test when `specs.md` + aw-target exist |
| 4     | `confidence`           | Optional  | `analysis` at iteration cap (3 Lite / 5 Full) |
| 4     | `holistic-analysis`    | Optional  | Step-back analysis after stuck-loop confidence |
| 5     | `docs update`          | Optional  | Self-improving doc loop (keeps `CLAUDE.md`, `README.md`, and `docs/` in sync) |
| 6     | `reviewer` *(agent)*   | Optional  | Pre-PR diff review — dispatched directly via the Agent tool with `--critical` + auto-fix-all-severities prompt (Fix Mode on own branch) |
| 6     | `aw-create-walkthrough` | Optional  | Writes `.agent/{branch}/walkthrough.md`      |
| 6     | `create-pr`            | Optional  | Narrative PR description + push + watch       |
| 4     | `persistent-memory`    | Optional  | Writes a lesson at stuck-loop escalation (`write aw-lessons`) |
| 7     | `ci-auto-fix`          | Optional  | Diagnose + fix failed CI checks               |
| 7     | `persistent-memory`    | Optional  | End-of-run: writes durable run lessons; suggests promotion when `seen_count >= 3` |
| 7     | `reviewer` *(agent)*   | Optional  | After CI green: dispatches as PR Mode sub-agent with `--critical` + auto-fix-all-severities prompt — self-review sub-mode auto-fixes every Simple finding (incl. Nitpick / Nice-to-have) + emits an inline terminal report (cross-author PRs are redirected to `pr-reviewer`; the reviewer never writes to GitHub) |

**`confidence` at Phase 1 is the only non-removable companion.** Without it,
the plan gate is gone and the workflow loses its primary safety mechanism.

`reviewer` is an **agent**, not a skill — see
[`rules/companion-skills.md#agent-companions`](./rules/companion-skills.md#agent-companions)
for the dispatch and detection contract. Like every other companion, it
**skips silently** if its definition file isn't present in any of
`.claude/agents/`, `~/.agents/agents/`, or `~/.claude/agents/`.

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

### 2. Remove individual symlinks after install

Best for per-machine or one-off customization. After running
`bash scripts/sync-symlinks.sh --aw`, delete the symlink for any companion
you don't want:

```bash
# Drop tdd and ux from this machine's install
rm ~/.claude/skills/tdd ~/.claude/skills/ux
```

Re-running `bash scripts/sync-symlinks.sh --aw` would re-create them, so commit
to the removal: either don't re-run, or edit the `AW_SKILLS` list in
[`scripts/sync-symlinks.sh`](../../../scripts/sync-symlinks.sh) to drop them
permanently.

When the workflow tries to invoke the missing companion, Claude will return an
error and the workflow will log:

> `companion: <name> — not available, continuing`

…and continue without it. This is by design.

The only exception is `confidence` at Phase 1 — if it's missing, the workflow
stops and asks you to install it before proceeding.

See [`rules/companion-skills.md`](./rules/companion-skills.md) for full
trigger conditions and per-row disable instructions.

---

## Workflow Tiers

The `aw` dispatcher picks one of three tiers (when in doubt, the heavier one).

### Full (complex changes, 4+ files / unfamiliar)

Planner → `plan.md` → executor (the split). Generates artifacts under
`.agent/{branch-name}/`:

- `plan.md` — implementation strategy, decisions, progress log (single
  source of truth)
- `walkthrough.md` — final summary generated at Phase 6

### Lite (simple changes, 2-3 files)

Single-pass (no planner/executor split). No artifact files; plan exists only in
conversation. Phase 0, Phase 2, Phase 5 (`docs update`), and Phase 6
(`create-pr`) still required.

### Micro (1-file mechanical: typo / copy / version-or-config bump)

Single-pass, planning and quality companions skipped. Phase 0 (quick confirm),
Phase 2 (worktree), and Phase 6 (`create-pr`) still required; docs only if they
drift. The "skip planning when it's trivial" tier.

### Decision Guide

| Tier   | Files / shape                     | Artifacts | Planner split | Worktree |
| ------ | --------------------------------- | --------- | ------------- | -------- |
| Micro  | 1 file, mechanical                | No        | No (single-pass) | Yes   |
| Lite   | 2-3 files, simple logic           | No        | No (single-pass) | Yes   |
| Full   | 4+ files OR complex / unfamiliar  | Yes       | Yes           | Yes      |

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

1. **Tier detection FIRST** — Micro vs Lite vs Full before any other action.
2. **Phase 0 and Phase 2 are MANDATORY** — never skip validation or worktree.
3. **`plan.md` is the single source of truth** in Full Mode (generated by
   `aw-create-plan`).
4. **Verify after editing** — fast check before continuing.
5. **Stuck-loop cap is mode-aware** — 3 iterations (Lite) / 5 iterations (Full); at
   the cap, run `confidence(analysis)` and auto-replan or escalate.
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

## Self-Improvement

The workflow improves across runs through a **two-tier loop** (full contract:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)).

### Fast tier — episodic lessons (`persistent-memory`)

When `persistent-memory` is installed, the workflow **reads** accumulated
lessons before planning (Phase 1) and **writes** new ones when it gets stuck
(Phase 4) or finishes (Phase 7), in the committed `aw-lessons` scope at
`<repo>/memory/aw-lessons/`. Lessons are **advisory** — they bias the plan
(applied like Acceptance Criteria), never silently change a gate. The fast tier
is fully optional: uninstall `persistent-memory` and it degrades to nothing.
Lessons expire (default 90 days) and `/persistent-memory consolidate aw-lessons`
prunes stale ones, so a wrong lesson decays instead of entrenching.

### Slow tier — retrospective diagnosis

If the workflow ships incorrect code despite all gates passing — or a
post-merge bug traces back to a missed check, or a lesson recurs
`seen_count >= 3` — invoke
`/create-skill diagnose autonomous-workflow` **while the failing session is
still in context**. It does not run the phases. It analyses the failed run,
classifies the failure against this skill's taxonomy, walks every phase to
find the earliest gate that could have caught it, and emits a unified diff
against **this skill's source** so the same failure class cannot recur.

```
/create-skill diagnose autonomous-workflow
/create-skill diagnose autonomous-workflow --symptom "tests passed but didn't import the SUT"
/create-skill diagnose autonomous-workflow --apply        # apply the proposed diff locally (asks first)
/create-skill diagnose autonomous-workflow --pr           # open a PR upstream against agent-skills.git
```

Output lands at `.agent/{branch}/diagnose-autonomous-workflow-{YYYYMMDD-HHMMSS}.md`
and is self-contained — another user can read the report, run `git apply` on
the embedded diff, and inherit the improvement without access to the original
session.

`create-skill` owns the generic procedure (seven steps + confidence gate +
apply / PR flow); this skill owns its [diagnostic surface](./rules/diagnostic-surface.md)
(phase model, failure taxonomy, existing-guards table, hard invariants).
Diagnose Mode never modifies user product code — it only proposes changes
to this skill's source.

> **Migrating from v3.6:** the old `/autonomous-workflow --diagnose` flag
> was removed in v3.7. Replace any saved invocations with
> `/create-skill diagnose autonomous-workflow`. Behavior is unchanged.

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

- [`confidence`](../../quality/confidence/) — quality gate (plan / code / analysis)
- [`aw-create-plan`](../aw-create-plan/) — `plan.md` artifact generator
- [`aw-create-walkthrough`](../aw-create-walkthrough/) — `walkthrough.md` artifact generator
- [`code-quality`](../../quality/code-quality/) — readability and complexity review
- [`tdd`](../../quality/tdd/) — RED-GREEN-REFACTOR enforcement
- [`ux`](../../design/ux/) — UI / accessibility review
- [`holistic-analysis`](../../analysis/holistic-analysis/) — execution-path analysis
- [`docs`](../../authoring/docs/) — keeps `CLAUDE.md`, `README.md`, and `docs/` in sync
- [`review-changes`](../../quality/review-changes/) — pre-PR review
- [`create-pr`](../../delivery/create-pr/) — narrative PR description + push + watch
- [`ci-auto-fix`](../../delivery/ci-auto-fix/) — diagnose and fix failed CI checks
- [`persistent-memory`](../../authoring/persistent-memory/) — backs the `aw-lessons` fast-tier self-improvement loop
- Worktree basics without `gw`: native [`git worktree`](https://git-scm.com/docs/git-worktree) (`add -b <branch> <path>`, `list`, `remove <path>`)

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
