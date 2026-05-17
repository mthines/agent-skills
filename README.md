# Agent Skills

> Skills and agents for AI coding assistants — autonomous workflows, code review, TDD, UX, DX, debugging, and more.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Agent Skills spec](https://img.shields.io/badge/spec-Agent%20Skills-7c3aed)](https://agentskills.io/)
[![Skills](https://img.shields.io/badge/skills-37-0a7)](#skills-at-a-glance)
[![Agents](https://img.shields.io/badge/agents-4-0a7)](#agents-at-a-glance)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-supported-d97706)](https://claude.com/claude-code)

Works with Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and any other [Agent Skills](https://agentskills.io)-compatible tool.

```bash
npx skills add https://github.com/mthines/agent-skills --all --agent claude-code
```

---

## Table of contents

- [Install](#install)
- [Skills at a glance](#skills-at-a-glance)
  - [Autonomous workflows](#autonomous-workflows)
  - [Analysis & validation](#analysis--validation)
  - [Testing](#testing)
  - [UI, UX & visual design](#ui-ux--visual-design)
  - [Code review & PRs](#code-review--prs)
  - [Performance & debugging](#performance--debugging)
  - [Docs, meta-skills & memory](#docs-meta-skills--memory)
  - [AI engineering & DX](#ai-engineering--dx)
  - [Workflow companions](#workflow-companions)
- [Agents at a glance](#agents-at-a-glance)
- [Claude Code plugins](#claude-code-plugins)
- [Featured: autonomous workflow](#featured-autonomous-workflow)
- [Linear ticket investigator (per-project plug-in)](#linear-ticket-investigator-per-project-plug-in)
- [Usage examples](#usage-examples)
- [VS Code extension](#vs-code-extension)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Contributing](#contributing)
- [License](#license)

## Install

> **Tip — keep it tidy.** Always pass `--agent <your-tool>` (e.g. `--agent claude-code`). Without it, `npx skills` symlinks every skill into ~24 different AI-tool directories at once.

**Recommended — Claude Code, single skill:**

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill confidence --agent claude-code --yes
```

**All skills, Claude Code:**

```bash
npx skills add https://github.com/mthines/agent-skills --all --agent claude-code
```

**Universal — any Agent Skills tool:**

```bash
npx skills add https://github.com/mthines/agent-skills --all
```

<details>
<summary>Other tools (Claude Code marketplace, Gemini, Cursor, Copilot, Codex, manual)</summary>

**Claude Code plugin marketplace:**

```bash
/plugin marketplace add mthines/agent-skills
/plugin install mthines-agent-skills@mthines
```

**Gemini CLI:**

```bash
gemini extensions install https://github.com/mthines/agent-skills
```

**Cursor / Copilot / Codex / manual:**

```bash
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

Most tools auto-discover skills from `~/.agents/skills/`.

</details>

## Skills at a glance

Two invocation styles:

- **`auto`** — the model invokes the skill when it detects a matching task. Its `description` field sits in your available-skills list every session (~50–150 tokens). The body loads only on invocation.
- **`/name`** — slash command only. Zero baseline context cost; loads only when you type `/name` or another skill calls it via `Skill()`.

### Autonomous workflows

Coordinate other skills to ship complete changes.

| Skill | What it does | Type |
|-------|--------------|------|
| **[autonomous-workflow](./skills/autonomous-workflow/SKILL.md)** | Phase-based orchestrator (0–7): task → plan → worktree → code → test → docs → draft PR → CI gate. See [featured section](#featured-autonomous-workflow). | `auto` |
| **[fix-bug](./skills/fix-bug/SKILL.md)** | 10-phase bug pipeline: intake → triage → evidence → repro-lock → analyse → gate → handoff → verify → telemetry. Lane-split: fast for simple, standard for complex. | `/` |
| **[batch-linear-tickets](./skills/batch-linear-tickets/SKILL.md)** | Fan out `/fix-bug --analyse-only` across many Linear tickets, gate user approval, then dispatch planners and executors in parallel. Requires Linear MCP. | `/` |
| **[implement-suggestion](./skills/implement-suggestion/SKILL.md)** | Apply reviewer suggestions across one or more PRs. Reads humans and AI bots (`claude[bot]`, `coderabbit`, `sourcery`), validates each via `/critical` + `/confidence`, applies in the existing branch. | `/` |

### Analysis & validation

Decide whether a plan, fix, or analysis is sound before you commit to it.

| Skill | What it does | Type |
|-------|--------------|------|
| **[confidence](./skills/confidence/SKILL.md)** | Rates confidence that work fully solves the requirement. Modes: `plan`, `code`, `analysis`. Multi-signal gate; deterministic rule checks cap LLM score. | `auto` |
| **[critical](./skills/critical/SKILL.md)** | Adversarial pre-mortem: hostile-persona walk through failure modes, blast radius, rollback, hidden coupling, and a mandatory steelman alternative. Never iterates. | `auto` |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full entry-to-exit execution-path trace when incremental fixes aren't working. | `auto` |
| **[code-quality](./skills/code-quality/SKILL.md)** | Authors and reviews code for low cognitive complexity, guard clauses, early returns, single-responsibility. | `/` |

### Testing

| Skill | What it does | Type |
|-------|--------------|------|
| **[tdd](./skills/tdd/SKILL.md)** | Strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code, refactors. | `auto` |
| **[test-provenance-guard](./skills/test-provenance-guard/SKILL.md)** | Detects tests that pass by construction (re-declare the SUT instead of importing it) via static + mutation checks. Self-heals by extracting inline logic and rewriting the test. | `auto` |
| **[/e2e-testing](./skills/e2e-testing/SKILL.md)** | Spec-first Playwright Test Agents loop (Planner / Generator / Healer, v1.56). Locator ladder, `data-testid` source diffs, 3-attempt heal cap. | `/` |
| **[/e2e-testing-mobile](./skills/e2e-testing-mobile/SKILL.md)** | Mobile counterpart on Maestro YAML flows for Expo / React Native. `testID`-first locator ladder; runs on Maestro Cloud via EAS Workflow. | `/` |

### UI, UX & visual design

| Skill | What it does | Type |
|-------|--------------|------|
| **[ux](./skills/ux/SKILL.md)** | Reviews UI for usability, WCAG 2.2 accessibility, platform compliance (Apple HIG, Material Design 3), and **dark-pattern detection**. Hard rule: never recommends a dark pattern. | `auto` |
| **[screen-recorder](./skills/screen-recorder/SKILL.md)** | Records short cropped videos of UI sections via Playwright + ffmpeg. Validates multi-frame interactions a screenshot can't prove. | `auto` |
| **[/animations](./skills/animations/SKILL.md)** | CSS-first web animation. Three modes: Brainstorm, Perceived-Performance, technical workflow (CSS → WAAPI → Motion → R3F). | `/` |
| **[/visual-design](./skills/visual-design/SKILL.md)** | Generative, brand-aware visual design. Style-direction taxonomy (minimal, swiss, brutalist, glass, …), color systems, typography, signature details. Defers WCAG math to `/ux`. | `/` |
| **[/charting](./skills/charting/SKILL.md)** | Selects chart type + visualization library for web (React/Next.js) and mobile (Expo/RN). Maps intent → chart → library based on platform and dataset size. | `/` |
| **[/storybook](./skills/storybook/SKILL.md)** | Scaffolds three artefacts per component: visual regression story, Playground, interaction test. Opt-in OS-keychain auth profiles. | `/` |

### Code review & PRs

| Skill | What it does | Type |
|-------|--------------|------|
| **[/create-pr](./skills/create-pr/SKILL.md)** | Narrative PR description, push, open PR, watch CI, auto-fix simple failures. Flags: `--split` (multi-PR breakdown), `--review` (Claude GitHub App + auto-implement loop). | `/` |
| **[/review-changes](./skills/review-changes/SKILL.md)** | Reviews branch changes or a PR. Dispatches to the [`reviewer`](#agents-at-a-glance) agent. | `/` |
| **[/ci-auto-fix](./skills/ci-auto-fix/SKILL.md)** | Diagnoses a failed CI check, applies a minimal fix, pushes, iterates until green. Refuses to disable or weaken checks. | `/` |
| **[/resolve-conflicts](./skills/resolve-conflicts/SKILL.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolutions, asks for ambiguous cases. | `/` |

### Performance & debugging

| Skill | What it does | Type |
|-------|--------------|------|
| **[/profile-optimizer](./skills/profile-optimizer/SKILL.md)** | Analyses React DevTools Profiler exports or Chrome Performance traces. Maps hotspots to source. Iterates via `confidence(analysis)` until ≥ 90%. | `/` |
| **[/playwright-trace-analyzer](./skills/playwright-trace-analyzer/SKILL.md)** | Analyses Playwright `trace.zip` (or downloads from a GitHub Actions run URL). Names the race behind a flake, emits a ranked fix plan. | `/` |
| **[/video-analyser](./skills/video-analyser/SKILL.md)** | Analyses a screen recording for bugs. Resolves input from a Linear ticket URL, local path, or direct URL. Optional Tesseract OCR and Whisper transcription. | `/` |

### Docs, meta-skills & memory

| Skill | What it does | Type |
|-------|--------------|------|
| **[/documentation](./skills/documentation/SKILL.md)** | Authors and audits `CLAUDE.md`, `AGENTS.md`, `README.md`, and Diátaxis `docs/` trees. Modes: `init`, `update`, `readme`, `audit`. | `/` |
| **[/create-skill](./skills/create-skill/SKILL.md)** | Scaffold, review, upgrade, or diagnose agent skills. `diagnose <target>` is the retrospective self-improvement entry point. | `/` |
| **[/optimize-claude-md](./skills/optimize-claude-md/SKILL.md)** | Audits `CLAUDE.md` for context bloat. Modes: `audit`, `trim`, `extract`. Flags rarely-used agent-invokable skills that should become slash-only. | `/` |
| **[/optimize-mock-data](./skills/optimize-mock-data/SKILL.md)** | Optimizes JSON/JSONL fixture directories via shared-schema inference, drift detection, safe shrink/normalize. | `/` |
| **[/changelog](./skills/changelog/SKILL.md)** | Generates a personal markdown changelog of merged PRs and closed Linear tickets over a configurable window (default 7 days). | `/` |
| **[/persistent-memory](./skills/persistent-memory/SKILL.md)** | Persists context across conversations as plain markdown, scoped per topic. Operations: `write`, `read`, `consolidate`, `forget`. Three storage tiers. | `/` |

### AI engineering & DX

| Skill | What it does | Type |
|-------|--------------|------|
| **[/ai-engineering](./skills/ai-engineering/SKILL.md)** | Reviews LLM/AI application engineering across 13 concerns: prompts, caching, RAG, agents, resilience, memory, evals, safety, observability. | `/` |
| **[/dx](./skills/dx/SKILL.md)** | Reviews CLI tools, shell scripts, developer tooling against clig.dev, 12 Factor CLI, Heroku CLI Style Guide. | `/` |
| **[/github-actions-author](./skills/github-actions-author/SKILL.md)** | Authors and reviews fast, cheap, maintainable GitHub Actions workflows (2026 best practices). Modes: `scaffold`, `review`. | `/` |

### Workflow companions

Slash-only. Called by `autonomous-workflow` via `Skill()` at runtime. Install on their own to reuse the artifact-generation logic.

| Skill | What it does |
|-------|--------------|
| **[aw-create-plan](./skills/aw-create-plan/SKILL.md)** | Generates `.agent/{branch}/plan.md` — the source of truth a new session can resume from. |
| **[aw-create-walkthrough](./skills/aw-create-walkthrough/SKILL.md)** | Generates `.agent/{branch}/walkthrough.md` — the PR-delivery summary. |
| **[aw-review-quality-gate](./skills/aw-review-quality-gate/SKILL.md)** | Self-check quality gate for review findings: filters noise, dedupes, ranks severity. |

## Agents at a glance

Agents are specialized sub-processes with their own model and tool configuration. Dispatched by other skills, not invoked directly.

| Agent | What it does |
|-------|--------------|
| **[reviewer](./agents/reviewer.md)** | Code reviewer with three modes: `fix` (auto-fix), `report` (findings only), `comments` (PR review comments). Orthogonal `--with <skill>` flag loads up to 3 additional review lenses (`ai-engineering`, `animations`, `charting`, `dx`, `holistic-analysis`, `ux`). |
| **[linear-ticket-investigator](./agents/linear-ticket-investigator.md)** | Reads a Linear ticket, returns an Evidence Record matching `/fix-bug` Phase 2. Customizable via a per-project [domain navigator](#linear-ticket-investigator-per-project-plug-in). |
| **[bug-fix-verifier](./agents/bug-fix-verifier.md)** | Independent fresh-context verifier for `/fix-bug` PRs. Runs FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity. Only agent allowed to undraft. |
| **[feature-pr-verifier](./agents/feature-pr-verifier.md)** | Feature-PR counterpart to `bug-fix-verifier`. Verifies acceptance criteria, pass-to-pass, walkthrough integrity for `autonomous-workflow` Full Mode. |

## Claude Code plugins

Plugins live in `plugins/` and ship via [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) at the repo root.

| Plugin | What it does |
|--------|--------------|
| **[agent-tasks-hooks](./plugins/agent-tasks-hooks/README.md)** | Emits privacy-safe NDJSON lifecycle events (`UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, `Notification`) for the [Agent Tasks](https://marketplace.visualstudio.com/items?itemName=mthines.agent-tasks) VS Code extension. |

## Featured: autonomous workflow

`autonomous-workflow` orchestrates a complete feature cycle — from a one-line task to a tested draft PR — using isolated Git worktrees.

### Two agents, one workflow

The skill installs **two agents** that share workflow knowledge, connected by `plan.md`:

| Agent | Phases | Exit gate |
|-------|--------|-----------|
| `aw-planner`  | 0–2 (validate, plan, worktree + `plan.md`) | `confidence(plan) ≥ 90%` |
| `aw-executor` | 3–7 (implement, test, docs, PR, CI) | CI green, walkthrough delivered |

Both share the **`aw-`** prefix ("autonomous-workflow"): deliberate namespace so the pair groups together in `~/.claude/agents/` and disambiguates from agents installed by other skills.

### Phases

| Phase | Name | Companions (optional unless marked) |
|-------|------|-------------------------------------|
| 0 | Validation | — |
| 1 | Planning | `holistic-analysis`, `code-quality`, **`confidence(plan)` (mandatory)** |
| 2 | Worktree + plan.md | `aw-create-plan` (Full Mode) |
| 3 | Implementation | `tdd`, `ux`, `code-quality` |
| 4 | Testing | `confidence(analysis)`, `holistic-analysis` (auto-replan once at cap) |
| 5 | Documentation | `documentation update` |
| 6 | PR creation | `review-changes`, `aw-create-walkthrough`, `create-pr` |
| 7 | CI gate | `ci-auto-fix` |

The mode-aware stuck-loop cap at Phase 4 (3 Lite / 5 Full) is the biggest cost-saver: it prevents agents burning tokens on hallucinated fixes when their root-cause analysis is wrong.

### Install

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis tdd ux documentation \
          review-changes create-pr ci-auto-fix \
  --agent claude-code --yes
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

For per-project install, drop `--global` from both lines.

### Usage

```
Implement dark mode toggle independently
Build the user settings screen end-to-end
Take care of issue #42 in a worktree
```

Companions skip silently if not installed. The only non-removable companion is `confidence` at Phase 1.

### Prerequisites

- [`gw`](https://github.com/mthines/gw-tools) — Git worktree manager (`brew install mthines/gw-tools/gw`)
- [`gh`](https://cli.github.com) — GitHub CLI

### Further reading

- [`skills/autonomous-workflow/README.md`](./skills/autonomous-workflow/README.md) — install, customize, migrate from v2
- [`skills/autonomous-workflow/CLAUDE.md`](./skills/autonomous-workflow/CLAUDE.md) — design intent
- [`skills/autonomous-workflow/rules/companion-skills.md`](./skills/autonomous-workflow/rules/companion-skills.md) — companion registry
- [`skills/autonomous-workflow/references/anthropic-architecture-research.md`](./skills/autonomous-workflow/references/anthropic-architecture-research.md) — rationale for the two-agent split

## Linear ticket investigator (per-project plug-in)

The [`linear-ticket-investigator`](./agents/linear-ticket-investigator.md) agent returns an Evidence Record from a Linear ticket. Investigation accuracy depends on grounding the agent in your project's structure.

The agent looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`.
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at.
3. A **domain-navigator skill**, auto-discovered by name.
4. Top-level `README.md` (fallback).

Steps 1, 2, and 4 work out of the box. Step 3 is the high-leverage customization for monorepos.

### Naming convention

The investigator scans its available-skills list at runtime for any skill whose name is:

- **exactly `domain-navigator`**, or
- **ending in `-domain-navigator`** — e.g. `dash0-domain-navigator`, `acme-domain-navigator`.

Any match is invoked automatically. No agent code changes, no registration.

### Starter template

Create `.claude/skills/<project>-domain-navigator/SKILL.md`:

```markdown
---
name: <project>-domain-navigator
description: >
  Maps Linear labels and ticket terminology to component directories in <project>.
  Surfaces cross-component dependencies. Use during investigation or planning.
user-invocable: true
---

# <Project> Domain Navigator

## Label → directory map

| Label | Component paths                       |
| ----- | ------------------------------------- |
| ui    | components/ui/, packages/web/         |
| api   | components/api/, packages/server/api/ |

## Cross-component dependencies

- `ui` calls `api` via `packages/web/src/client/`
- `api` reads from `db-migrator` schemas in `packages/db/`

## Where the docs live

- Architecture overview: `docs/architecture.md`
- API contract: `packages/server/api/openapi.yaml`
```

That is the entire integration.

## Usage examples

Agent-invokable skills activate from natural language — just describe what you need.

```
Implement this feature autonomously / end-to-end / in a worktree
Check the accessibility of this component
I've tried fixing this bug three times — step back and analyze holistically
Add this feature using TDD
Rate your confidence in this implementation
```

Slash commands are typed explicitly.

```
/batch-linear-tickets SUP-123 SUP-456
/fix-bug https://app.dash0.com/.../trace?spanId=...
/dx review my CLI tool
/profile-optimizer ./trace.json
/video-analyser ./bug-recording.mp4
/documentation init
/documentation update
/documentation readme
/documentation audit
/resolve-conflicts
/review-changes --comments 42
/implement-suggestion <pr-url> [<pr-url> ...]
/create-pr
/ci-auto-fix <run-id|pr-url>
```

## VS Code extension

The [`vscode-agent-tasks`](./packages/vscode-agent-tasks/) package visualizes `plan.md`, `task.md`, and `walkthrough.md` in the VS Code sidebar — phase progress, decisions, blockers, and completed checkboxes update live as the agent works.

Install from the Marketplace by searching for **Agent Tasks** or:

```
mthines.agent-tasks
```

Default scan paths are `.agent/` and `.gw/`. Configure via `agentTasks.directories`. See [`packages/vscode-agent-tasks/README.md`](./packages/vscode-agent-tasks/README.md) for full docs.

## Repository structure

```
skills/                   37 skills, each with SKILL.md (some with rules/, references/, templates/, scripts/)
agents/                   4 agents (reviewer, linear-ticket-investigator, bug-fix-verifier, feature-pr-verifier)
plugins/                  1 Claude Code plugin (agent-tasks-hooks)
packages/                 VS Code extension (vscode-agent-tasks)
.claude-plugin/           marketplace.json — plugin distribution manifest
scripts/                  Local symlink sync (scripts/sync-symlinks.sh)
```

Skills are installable with `npx skills add`. Agents live in `agents/` because they require their own model and tool configuration.

Each skill has a `SKILL.md` manifest with YAML frontmatter (name, description, metadata) and a Markdown body with instructions. Skills with `rules/` subdirectories contain focused guidance documents that load on demand.

## Local development

Hacking on these skills? Wire your tool's skill directory at this checkout via symlinks so edits to `skills/<name>/SKILL.md` are live on the next agent turn — no `npx skills add` reinstall.

The convention is a two-tier chain:

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<name>
~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and others — one chain serves every tool.

### Add a new skill

1. Create `skills/<name>/SKILL.md` in this repo.
2. Run `scripts/sync-symlinks.sh` to wire the two-tier chain for every new or missing skill/agent.
3. Add an entry to the inventory in [`CLAUDE.md`](./CLAUDE.md) and this README.

For agents, write `agents/<name>.md` and rerun the sync script. Use `--dry-run` (or `-n`) to preview without applying changes.

### Edit an existing skill

Edit `skills/<name>/SKILL.md` directly in this repo. Avoid writing through the symlinked path under `~/.claude/skills/` — writes propagate correctly, but it becomes ambiguous which checkout you touched if multiple worktrees exist.

### Verify the chain

```bash
readlink ~/.claude/skills/<name>      # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>      # → <repo>/skills/<name>
```

Both must resolve. If either is missing, the agent harness won't see the skill.

## Contributing

PRs welcome. Read [`CLAUDE.md`](./CLAUDE.md) for the prose conventions and [`skills/create-skill/SKILL.md`](./skills/create-skill/SKILL.md) for the skill-authoring rubric.

## License

[MIT](./LICENSE)
