---
name: autonomous-workflow
description: >
  Execute complete feature development cycles autonomously — from task intake
  through tested PR delivery — using isolated Git worktrees. Phase-based
  workflow (0–7) with optional companion skills for planning, quality gates,
  TDD, UX, code quality, docs, and CI verification. Companions skip silently
  if not installed. Triggers on "implement autonomously", "end-to-end", "in
  isolation", "in a worktree", or independent feature work. Invoke with
  /autonomous-workflow.
license: MIT
metadata:
  author: mthines
  version: '3.3.0'
  workflow_type: orchestrator
  tags:
    - autonomous
    - workflow
    - worktree
    - feature-development
    - pr
---

# Autonomous Workflow

Phase-based autonomous feature development. Each phase has a gate that must pass
before continuing. Phases optionally invoke companion skills based on the task —
companions skip silently if not installed.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures
> live in `rules/*.md` and load on demand. Companion-skill triggers and
> disable instructions live in [`rules/companion-skills.md`](./rules/companion-skills.md).

---

## CRITICAL: Before Starting Any Work

### Step 1: Detect Workflow Mode (MANDATORY)

**Complexity is the primary signal. File count is the tie-breaker.** Walk these
questions in order — the first `yes` selects Full Mode:

| # | Question                                                                                  | If yes →     | If no →     |
| - | ----------------------------------------------------------------------------------------- | ------------ | ----------- |
| 1 | Is this task architectural / cross-cutting / does it require significant design decisions? | **Full Mode** | go to next  |
| 2 | Does the task involve unfamiliar code or domains the agent hasn't worked in before?       | **Full Mode** | go to next  |
| 3 | Is the change touching 4+ files OR 2+ packages?                                           | **Full Mode** | **Lite Mode** |

| Mode     | Artifacts |
| -------- | --------- |
| **Full** | Required  |
| **Lite** | None      |

The first two questions ground the decision in complexity rather than raw file
count (one large monolithic change can exceed four trivial edits in scope).
Question 3 is the file-count tie-breaker — only fires when complexity is low.

**When in doubt, choose Full.** Output mode selection in this exact format:

```
MODE SELECTION:
- Mode: [Full | Lite]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [simple | moderate | architectural]
```

### Step 2: Verify Prerequisites

| Tool | Status      | Check       | If missing                                                  |
| ---- | ----------- | ----------- | ----------------------------------------------------------- |
| `gh` | **REQUIRED**| `which gh`  | Stop, prompt user to install                                |
| `gw` | Recommended | `which gw`  | Continue with native `git worktree` fallback (warn user once)|

`gh` is hard-required for Phase 6 (PR creation) and Phase 7 (CI gate).
`gw` is recommended — it adds auto-copy of secrets, pre/post-checkout hooks,
and smart cleanup — but the workflow falls back to native `git worktree` if
it's not installed. See [`rules/prerequisites.md`](./rules/prerequisites.md)
for the full feature comparison and installation steps.

---

## Workflow Phases

| Phase | Name                       | Rule file                                                      | Gate                                          |
| ----- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 0     | Validation                 | [phase-0-validation.md](./rules/phase-0-validation.md)         | User confirmed understanding                  |
| 1     | Planning                   | [phase-1-planning.md](./rules/phase-1-planning.md)             | `confidence(plan)` ≥ 90% or user-approved     |
| 2     | Worktree Setup             | [phase-2-worktree.md](./rules/phase-2-worktree.md)             | Worktree created, `plan.md` written           |
| 3     | Implementation             | [phase-3-implementation.md](./rules/phase-3-implementation.md) | Code complete, fast checks pass               |
| 4     | Testing                    | [phase-4-testing.md](./rules/phase-4-testing.md)               | All tests pass OR user-approved stop          |
| 5     | Documentation              | [phase-5-documentation.md](./rules/phase-5-documentation.md)   | Docs reflect changes (incl. `CLAUDE.md`)      |
| 6     | PR Creation                | [phase-6-pr-creation.md](./rules/phase-6-pr-creation.md)       | Walkthrough shown, draft PR opened            |
| 7     | CI Gate + Optional Cleanup | [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md)               | CI green OR user-approved stop                |

**Phase 0 and Phase 2 are MANDATORY.** All others gate progression to the next.

---

## Companion Skills

Optional companions are invoked at specific phases based on task signals.
**All companions skip silently if not installed** — the workflow continues
without them. See [`rules/companion-skills.md`](./rules/companion-skills.md)
for the full registry, trigger conditions, and **how to disable any companion**.

| Phase | Companion              | Trigger                                                | Args             |
| ----- | ---------------------- | ------------------------------------------------------ | ---------------- |
| 1     | `holistic-analysis`    | Complex / multi-domain / unfamiliar task               | —                |
| 1     | `code-quality`         | Always (informs design)                                | `plan`           |
| 1     | `confidence`           | Always (plan gate, MANDATORY)                          | `plan`           |
| 2     | `create-plan`          | Full Mode only                                         | —                |
| 3     | `tdd`                  | Pure logic / business rules / "test-driven"            | —                |
| 3     | `ux`                   | UI files touched (`*.tsx`, `*.jsx`, `*.vue`, RN)       | —                |
| 3     | `code-quality`         | Once at end of Phase 3 (not per-file)                  | `code`           |
| 4     | `confidence`           | At iteration cap (3 Lite / 5 Full) on same failing area | `bug-analysis`   |
| 4     | `holistic-analysis`    | After confidence at Phase 4 if user asks for retry     | —                |
| 5     | `update-claude`        | Always (self-improving doc loop)                       | —                |
| 6     | `review-changes`       | Always before push                                     | —                |
| 6     | `create-walkthrough`   | Full Mode only                                         | —                |
| 6     | `create-pr`            | Always                                                 | —                |
| 7     | `ci-auto-fix`          | CI run completes with status `failure`                 | `<run-id\|pr-url>` |

---

## Core Principles

1. **Detect mode FIRST** — Full vs Lite before any other action.
2. **Phase 0 and Phase 2 are MANDATORY** — no skipping validation or worktree.
3. **`plan.md` is the single source of truth** in Full Mode — generated by `Skill("create-plan")`.
4. **Verify after editing** — fast check before continuing.
5. **Stuck-loop has a mode-aware limit**: 3 iterations (Lite) / 5 iterations (Full) on the same failing area triggers `Skill("confidence", "bug-analysis")` and auto-replan or escalation.
6. **Companions are optional** — never block on a missing companion.
7. **Stop and ask when blocked** — don't guess on ambiguity.
8. **No AI co-author tags** — never add `Co-Authored-By` lines to commits or PRs.

---

## Artifact System (Full Mode)

Two artifacts in `.agent/{branch-name}/`, each generated by a dedicated skill:

| File              | Generated by                  | When          |
| ----------------- | ----------------------------- | ------------- |
| `plan.md`         | `Skill("create-plan")`        | After Phase 2 |
| `walkthrough.md`  | `Skill("create-walkthrough")` | Phase 6       |

Add `.agent/` to `.gitignore`. Files are grouped by branch for easy browsing.

> The directory is named `.agent/` (singular) to align with the `~/.agents/skills/`
> cross-tool discovery convention used by Codex, Cursor, OpenCode, and other
> Agent Skills–compatible clients. The agent identity is implicit in artifact
> frontmatter; the directory itself is a per-project agent workspace.

---

## Parallelization

Two phases benefit from sub-agent fan-out:

- **Phase 1 (Planning)** — when the task is complex/multi-domain, spawn parallel `Explore` sub-agents during research (one per package, one for past PRs, one for related docs). See [phase-1-planning.md](./rules/phase-1-planning.md#parallel-research).
- **Phase 7 (CI Gate)** — when multiple CI checks fail, spawn one `ci-auto-fix` sub-agent per independent failure. Cap: 2 handoffs per PR. See [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md#parallel-ci-fixes).

Phase 3 implementation is **NOT** parallelized (file-level changes share state).

---

## Quick Reference

### Full Mode

| Phase | Action                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------- |
| Setup | MODE SELECTION + prerequisite check                                                             |
| 0     | Ask clarifying questions, get explicit "proceed"                                                |
| 1     | Analyze codebase (parallel `Explore` if complex), design with `code-quality(plan)`, `confidence(plan)` gate |
| 2     | `gw add`, `gw cd`, install deps, `Skill("create-plan")` inside worktree                         |
| 3     | Code per `plan.md` → companions per task type (`tdd`, `ux`) → fast-check after each edit; `code-quality(code)` once at end |
| 4     | Run tests → iterate (max 3 same area) → `confidence(bug-analysis)` then escalate to user        |
| 5     | Update README, CHANGELOG; `Skill("update-claude")` always                                       |
| 6     | `Skill("review-changes")` → `Skill("create-walkthrough")` → `Skill("create-pr")`                |
| 7     | Watch CI → `Skill("ci-auto-fix")` per failure (parallel) → `gw remove` after merge (optional)   |

### Lite Mode

Skip artifacts and most companions. Phase 0, Phase 2, Phase 5 (`update-claude`), and Phase 6 (`create-pr`) still required.

| Phase | Action                                          |
| ----- | ----------------------------------------------- |
| Setup | MODE SELECTION                                  |
| 0     | Quick clarification                             |
| 1     | Brief mental plan (no `plan.md`)                |
| 2     | `gw add fix/bug-name`                           |
| 3     | Code, commit                                    |
| 4     | Test, fix failures (3-iteration limit applies)  |
| 5     | `Skill("update-claude")`                        |
| 6     | `Skill("create-pr")`                            |
| 7     | Watch CI, `ci-auto-fix` if needed               |

---

## Customization

Disable companions by editing [`rules/companion-skills.md`](./rules/companion-skills.md)
(single source of truth for which skills run when) or by removing the
invocation block from the relevant phase rule. See [`README.md`](./README.md#disabling-companions)
for the full how-to.

---

## Templates

The skill installs **two agents** that share one workflow, connected by `plan.md`:

| Agent                  | Phases | Terminal artifact                              | Exit gate                                          |
| ---------------------- | ------ | ---------------------------------------------- | -------------------------------------------------- |
| `autonomous-planner`   | 0–2    | `.agent/{branch}/plan.md`                      | `confidence(plan) ≥ 90%` (or user-approved)        |
| `autonomous-executor`  | 3–7    | `.agent/{branch}/walkthrough.md` + draft PR    | Walkthrough shown inline, Phase 7 CI gate run      |

The split is along the Phase 2 → Phase 3 context boundary, mediated by
`plan.md`. The handoff is gated: high-confidence plans flow through
automatically; borderline plans pause for user approval. The design rationale
(with verbatim Anthropic citations) lives in
[`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md);
the full handoff contract is in
[`rules/planner-executor-handoff.md`](./rules/planner-executor-handoff.md).

| Template                                                         | Purpose                                  |
| ---------------------------------------------------------------- | ---------------------------------------- |
| [planner.template.md](./templates/planner.template.md)           | Planner agent definition (phases 0-2)    |
| [executor.template.md](./templates/executor.template.md)         | Executor agent definition (phases 3-7)   |
| [routing-rule.template.md](./templates/routing-rule.template.md) | Auto-trigger rule for `.claude/rules/`   |

---

## Auto-Trigger Setup (Recommended)

Install the skill + companions so Claude auto-triggers on phrases like
*"implement X independently"*, *"in isolation"*, *"end-to-end"*. Two steps:
download skills, then run [`install.sh`](./install.sh).

**Global** (personal use, all projects):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow create-plan create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --global --yes
bash ~/.agents/skills/autonomous-workflow/install.sh --global
```

**Per-project** (team use, committable):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow create-plan create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --yes
bash .agents/skills/autonomous-workflow/install.sh
```

After the script runs, two agents are linked into your `.claude/agents/`
directory: `autonomous-planner.md` and `autonomous-executor.md`. The routing
rule dispatches the planner first; once `plan.md` is gated, the executor
takes over.

To run with fewer companions, omit them from the `--skill` list. See
[`rules/companion-skills.md`](./rules/companion-skills.md) for what each does
and how to disable. Run `bash install.sh --help` for script options.

---

## Related Skills

- [`confidence`](../confidence/SKILL.md) — quality gate (plan, code, bug-analysis)
- [`create-plan`](../create-plan/SKILL.md) — `plan.md` artifact generator
- [`create-walkthrough`](../create-walkthrough/SKILL.md) — `walkthrough.md` artifact generator
- [`code-quality`](../code-quality/SKILL.md) — readability and complexity review
- [`tdd`](../tdd/SKILL.md) — RED-GREEN-REFACTOR enforcement
- [`ux`](../ux/SKILL.md) — UI / accessibility review
- [`holistic-analysis`](../holistic-analysis/SKILL.md) — execution-path analysis for complex tasks
- [`update-claude`](../update-claude/SKILL.md) — keeps `CLAUDE.md` in sync with code changes
- [`review-changes`](../review-changes/SKILL.md) — pre-PR review
- [`create-pr`](../create-pr/SKILL.md) — narrative PR description + push + watch
- [`ci-auto-fix`](../ci-auto-fix/SKILL.md) — diagnose and fix failed CI checks

---

## Research Sources

- [Addy Osmani's LLM Workflow](https://addyosmani.com/blog/ai-coding-workflow/) — fast feedback loops
- [Claude Code Worktree Support](https://code.claude.com/docs/en/common-workflows) — worktree practices
- Full Anthropic architecture citations: [`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md)
