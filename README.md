# Agent Skills

A personal collection of skills for AI coding assistants — covering autonomous feature development, code review, DX/UX analysis, TDD, holistic debugging, and developer productivity.

Skills and agents follow the open [Agent Skills](https://agentskills.io/) format and work with Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and more.

> **New:** The [`autonomous-workflow`](#autonomous-workflow) skill orchestrates end-to-end feature development through a phase-based pipeline with optional companion skills. See its [dedicated section](#autonomous-workflow) below.

## Install

> **Tip — keep it tidy.** Always pass `--agent <your-tool>` (e.g. `--agent claude-code`). Without it, `npx skills` symlinks every skill into ~24 different AI-tool directories at once (`.codebuddy/`, `.continue/`, `.crush/`, …). Scoping the install to the tool you actually use keeps your workspace clean and your `git status` short.

**Recommended — Claude Code only:**

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill confidence \
  --agent claude-code \
  --yes
```

To install all skills:

```bash
npx skills add https://github.com/mthines/agent-skills --all --agent claude-code
```

**Universal** (works with any [Agent Skills](https://agentskills.io)-compatible tool — only use this if you switch between many tools):

```bash
npx skills add https://github.com/mthines/agent-skills --all
```

<details>
<summary>Claude Code (plugin marketplace)</summary>

```bash
/plugin marketplace add mthines/agent-skills
/plugin install mthines-agent-skills@mthines
```

</details>

<details>
<summary>Gemini CLI</summary>

```bash
gemini extensions install https://github.com/mthines/agent-skills
```

</details>

<details>
<summary>Cursor</summary>

```bash
git clone https://github.com/mthines/agent-skills.git ~/.cursor/skills/mthines-agent-skills
```

</details>

<details>
<summary>GitHub Copilot</summary>

```bash
git clone https://github.com/mthines/agent-skills.git ~/.copilot/skills/mthines-agent-skills
```

</details>

<details>
<summary>OpenAI Codex</summary>

```bash
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

</details>

<details>
<summary>Manual (any tool)</summary>

Clone into the cross-client discovery directory:

```bash
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

Most tools auto-discover skills from `~/.agents/skills/`.

</details>

## What's Included

> **About skill loading.** Each skill below is either _agent-invokable_ or _slash-command-only_. The distinction matters for your token budget:
>
> - **Agent-invokable skills** sit in your model's available-skills list every session — only the short `description` field, not the body. The model can invoke them via `Skill()` when it detects a matching task, without you typing `/name`.
> - **Slash-command-only skills** (`disable-model-invocation: true` in their frontmatter) are **not in the model's invokable list at all**. They cost nothing in baseline context. They load only when you type `/name` or when another skill calls them via `Skill()` at runtime.
>
> In all cases, the skill **body** (`SKILL.md` content + `rules/`) is loaded only on invocation, never automatically.

### Orchestrators

Coordinate other skills to execute multi-step workflows. `autonomous-workflow` is agent-invokable; `batch-linear-tickets` is slash-only.

| Skill                                                                  | What it does                                                                                                                                                                                                                                                                                                                            | Use when...                                                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **[autonomous-workflow](./skills/autonomous-workflow/SKILL.md)**       | Phase-based orchestrator (0–7) that handles end-to-end feature development — from validation through tested PR delivery — using isolated Git worktrees. Optionally invokes companions for planning, TDD, UX, code quality, docs, and CI fixing. Diagnosable via `/create-skill diagnose autonomous-workflow` — phase model and failure taxonomy declared in [`rules/diagnostic-surface.md`](./skills/autonomous-workflow/rules/diagnostic-surface.md). See [dedicated section](#autonomous-workflow).                                          | "Implement X autonomously", "end-to-end", "in isolation", "in a worktree".                       |
| **[/batch-linear-tickets](./skills/batch-linear-tickets/SKILL.md)**    | Thin batching wrapper around [`/fix-bug`](#slash-commands). Fans out `/fix-bug --analyse-only` per ticket — each call invokes [`linear-ticket-investigator`](#linear-ticket-investigator) for evidence, [`holistic-analysis`](./skills/holistic-analysis/SKILL.md) for root cause, and [`confidence(bug-analysis)`](./skills/confidence/SKILL.md) for the gate. Correlates findings, gates user approval, then fans out `aw-planner` + `aw-executor` pairs (the [`aw-` namespace](#agent-namespace-aw-)) for approved tickets using the pre-computed analyses (no re-running of `/fix-bug`). Requires Linear MCP. | "Solve these tickets", "batch analyze SUP-123 SUP-456", "analyze tickets in this Linear filter". |

### Agent-invokable skills

The model can invoke these via `Skill()` when it detects a matching task — no slash command required. Their descriptions are in your context every session (~50–150 tokens each).

| Skill                                                        | What it does                                                                                                                                                                                                                                                                                                                                | Use when...                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[confidence](./skills/confidence/SKILL.md)**               | Rates confidence that work fully solves the stated requirement. Scores across weighted dimensions with auto-fix mode.                                                                                                                                                                                                                       | Validating a plan before execution, checking code before a PR, or assessing a bug analysis.                                                                                                 |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full execution-path analysis when incremental fixes aren't working. Traces entry-to-exit with structured hypothesis generation.                                                                                                                                                                                                    | A bug fix attempt has failed, you're going in circles, or you need to "step back and think."                                                                                                |
| **[tdd](./skills/tdd/SKILL.md)**                             | Enforces strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code to pass, then refactors.                                                                                                                                                                                                                        | Adding new features test-first, or retrofitting tests onto existing code.                                                                                                                   |
| **[test-provenance-guard](./skills/test-provenance-guard/SKILL.md)** | Detects tests that pass by construction — tests that re-declare the function under test instead of importing it — via a static import/shadow check and a one-shot mutation check, then self-heals by extracting the inline production logic to an exported function and rewriting the test to use it.                                              | A new test passed on first run, you suspect a test re-states production logic locally, or you want a guard inside `autonomous-workflow` Phase 4 to catch tests-by-construction before merge. |
| **[ux](./skills/ux/SKILL.md)**                               | Reviews web and React Native UI code for usability, accessibility (WCAG 2.2), and platform compliance (Apple HIG, Material Design 3).                                                                                                                                                                                                       | Building or reviewing UI components, checking accessibility, or improving UX copy.                                                                                                          |

### Workflow companions

Slash-command-only. Primarily called by `autonomous-workflow` via `Skill()` at runtime. Installable on their own if you want to reuse the artifact-generation logic in your own pipelines, but most users don't invoke them directly.

| Skill                                                                  | What it does                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[aw-create-plan](./skills/aw-create-plan/SKILL.md)**                 | Generates `.agent/{branch}/plan.md` — the single source of truth for autonomous execution. A new Claude session can resume from this plan alone.        |
| **[aw-create-walkthrough](./skills/aw-create-walkthrough/SKILL.md)**   | Generates `.agent/{branch}/walkthrough.md` — the final summary delivered with a PR, summarizing changes, decisions, and how to verify.                  |
| **[aw-review-quality-gate](./skills/aw-review-quality-gate/SKILL.md)** | Self-check quality gate for review findings before delivery — filters noise, dedupes, ranks severity. Called by the `reviewer` agent and review skills. |

### Slash commands

User-invoked only — the model can't auto-trigger these. **Zero baseline context cost** (not in the model's available-skills list); they load only when you type `/name` or when another skill calls them via `Skill()` at runtime.

| Command                                                             | What it does                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[/ai-engineering](./skills/ai-engineering/SKILL.md)**             | Reviews and guides LLM/AI application engineering across thirteen concerns: prompt writing, system-prompt design, token cost (caching, routing, batching), multimodal (vision/audio/PDFs), RAG, agent loops and tool design, resilience (rate limits, retries, fallbacks, idempotency), memory and long-running state, model migration and version pinning, evals with LLM-as-judge bias mitigations, testing (mocks, VCR, snapshots, CI cost discipline), safety and prompt-injection defence, and observability (delegates OTEL wiring/semconv to the dash0 companion skills). Synthesises 2025–2026 practices from primary provider docs (Anthropic, OpenAI, Google), OWASP LLM Top 10, and practitioners. |
| **[/charting](./skills/charting/SKILL.md)**                         | Selects the right chart type and visualization library for React/Next.js (web) and Expo/React Native (mobile) tasks. Maps intent (comparison, composition, distribution, relationship, evolution, flow, geographic, hierarchical) → chart → library based on platform, dataset size, and design system. Defers cross-cutting concerns (contrast, touch targets, typography, copy) to the `ux` skill rather than restating them. Links to canonical galleries (data-to-viz, shadcn charts, Tremor, Victory Native XL) instead of duplicating example code. |
| **[/ci-auto-fix](./skills/ci-auto-fix/SKILL.md)**                   | Diagnoses a failed CI check, applies a minimal fix, pushes, and iterates until CI passes. Provider-agnostic in scope; currently implements the GitHub Actions path. Refuses to disable, skip, or weaken checks.                                                          |
| **[/code-quality](./skills/code-quality/SKILL.md)**                 | Authors and reviews code for low cognitive complexity, readability, and maintainability. Applies guard clauses, early returns, single-responsibility, and pragmatic performance choices grounded in Clean Code, Cognitive Complexity, and Knuth's optimization guidance. |
| **[/create-pr](./skills/create-pr/SKILL.md)**                       | Generates a narrative PR description, pushes the branch, opens the PR, then watches CI and auto-fixes simple failures (lint, format, lockfiles). Escalates judgment-required failures via `/confidence` rather than guessing.                                            |
| **[/create-skill](./skills/create-skill/SKILL.md)**                 | Scaffolds new agent skills — or reviews, upgrades, or diagnoses existing ones — against best-practice frontmatter, progressive disclosure, token-aware structure, and this repo's symlink + inventory wiring. Modes: `scaffold` (default), `review`, `upgrade`, `diagnose`. **`diagnose <target-skill>`** is the retrospective self-improvement entry point for any diagnosable skill in the repo: classifies a failed run against the target's declared diagnostic surface, walks a phase-attribution matrix, runs `confidence(bug-analysis) ≥ 90 %` as a hard gate, and emits an applyable unified diff against the target skill's source (`--apply` to apply locally, `--pr` to share upstream). First consumer is `autonomous-workflow`. |
| **[/dx](./skills/dx/SKILL.md)**                                     | Reviews CLI tools, shell scripts, and developer tooling against established guidelines ([clig.dev](https://clig.dev), 12 Factor CLI, Heroku CLI Style Guide).                                                                                                            |
| **[/e2e-testing](./skills/e2e-testing/SKILL.md)**                   | Drives a spec-first E2E loop on top of Playwright Test Agents (Planner / Generator / Healer, v1.56) and `@playwright/mcp`. Halts Phase 0 to ask before installing Playwright. Enforces the role → label → `data-testid` locator ladder, proposes `data-testid` as a source diff, runs in snapshot mode, and caps the heal loop at 3 attempts. |
| **[/e2e-testing-mobile](./skills/e2e-testing-mobile/SKILL.md)**     | Mobile counterpart to `/e2e-testing`. Drives a spec-first Maestro YAML-flow loop for Expo / React Native, halts Phase 0 to ask before installing Maestro CLI / EAS or scaffolding `.maestro/`, enforces a `testID`-first locator ladder (with a hard rule that `accessibilityLabel` must NOT double as a test selector), proposes `testID` source diffs via a `setTestId` helper, runs on Maestro Cloud as an EAS Workflow `maestro-cloud` job, and caps the heal loop at 3 attempts. Composes with `/e2e-testing` for hybrid apps (Maestro for native chrome, Playwright for the WebView). |
| **[/fix-bug](./skills/fix-bug/SKILL.md)**                           | v2 ships a 9-phase pipeline (evidence → preflight → reproduction-lock → analyse → gate → handoff → independent-verify → telemetry-verify) plus a cross-cutting bug-notes ledger that survives compaction. Takes any starting evidence (Dash0 span / log / web event URL with UTC timezone compensation, raw stack trace, error message, code pointer `file:line`, Linear ticket URL via [`linear-ticket-investigator`](#linear-ticket-investigator), screen recording via [`/video-analyser`](./skills/video-analyser/SKILL.md), or free-text symptom). Phase 0 infers a `bugClass`; Phase 1.5 runs cheap pre-flight probes; Phase 2.5 locks a failing reproduction by **delegating to [`/tdd`](./skills/tdd/SKILL.md)**, [`/e2e-testing`](./skills/e2e-testing/SKILL.md), or [`/e2e-testing-mobile`](./skills/e2e-testing-mobile/SKILL.md); Phase 2c runs `git bisect run` for regressions; Phase 3 delegates to [`holistic-analysis`](./skills/holistic-analysis/SKILL.md); Phase 4 gates on `confidence(bug-analysis)`. At >= 90% Phase 6 dispatches `aw-planner` + `aw-executor` with a CEGIS refinement contract (3-round counterexample loop); Phase 7's `bug-fix-verifier` agent grades the PR in fresh context (FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity) and is the only one allowed to undraft. Phase 8 (telemetry inputs only) polls the originating Dash0 query post-deploy. Pass `--analyse-only` to stop at Phase 5 — the read-only primitive `/batch-linear-tickets` calls per ticket. Curated [research sources](./skills/fix-bug/references/research-sources.md) (Anthropic, SWE-bench, RepairAgent, CEGIS, bisection, telemetry verification, taxonomies). |
| **[/implement-suggestion](./skills/implement-suggestion/SKILL.md)** | Takes review comments or suggestions and implements the fixes — simple ones directly, complex ones with a plan for approval.                                                                                                                                             |
| **[/init-claude](./skills/init-claude/SKILL.md)**                   | Analyzes your project and scaffolds a tiered docs setup: `CLAUDE.md` + `.claude/rules/` for the agent hot path, plus a `docs/` tree (root + nested for monorepos) for narrative content humans also use. Routes each piece of content by kind — rules to the hot path, rationale and onboarding to `docs/`.   |
| **[/profile-optimizer](./skills/profile-optimizer/SKILL.md)**       | Analyses React DevTools Profiler exports or Chrome DevTools Performance traces. Auto-detects the format, frames the right metric (INP, TBT, LCP, commit duration), extracts ranked hotspots with measured cost, maps each to a file/component, and emits a ranked optimisation plan. Iterates via `confidence(bug-analysis)` — digs deeper if root-cause certainty is below 90%, instead of guessing. |
| **[/playwright-trace-analyzer](./skills/playwright-trace-analyzer/SKILL.md)** | Analyses Playwright `trace.zip` files (or downloads them straight from a GitHub Actions run URL via `gh run download`). Auto-detects the input, extracts the action timeline, network waterfall, and console errors, names the race behind a flake, and emits a ranked fix plan. Confidence-gated via `confidence(bug-analysis)`. |
| **[/resolve-conflicts](./skills/resolve-conflicts/SKILL.md)**       | Detects merge/rebase conflicts, shows both sides with context, proposes resolution strategies, and asks clarifying questions for ambiguous cases.                                                                                                                        |
| **[/review-changes](./skills/review-changes/SKILL.md)**             | Reviews branch changes or a PR for quality, correctness, tests, and commit hygiene. Dispatches to the reviewer skill.                                                                                                                                                    |
| **[/update-claude](./skills/update-claude/SKILL.md)**               | Diffs your branch against main and incrementally updates `CLAUDE.md`, `.claude/rules/`, **and `docs/`** to match code changes. Detects drift across all three tiers (dead `@imports`, stale narrative, hot-path leakage) and routes new content by kind.                |
| **[/video-analyser](./skills/video-analyser/SKILL.md)**             | Analyses a screen recording to extract bugs, errors, UI state, and reproduction steps. Resolves input from a Linear ticket URL, local file path, or direct URL. Extracts keyframes with `ffmpeg` (default: 8 frames at 768 px — Pareto-optimal for legibility vs. token cost). Runs optional Tesseract OCR and Whisper audio transcription. |

### Agents

Agents are specialized sub-processes with their own model and tool configuration. They are dispatched by other skills, not invoked directly.

| Agent                                                                    | What it does                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[reviewer](./agents/reviewer.md)**                                     | Constructive code reviewer with three modes: **fix** (default — auto-fixes simple issues), **report** (`--report` — findings only), and **comments** (`--comments` — proposes line-level GitHub PR review comments).                                                                                                                                                             |
| **[linear-ticket-investigator](./agents/linear-ticket-investigator.md)** | Linear-specific evidence collector. Reads a single ticket via Linear MCP, searches the codebase using domain context + label inference, and returns an Evidence Record matching `/fix-bug`'s Phase 2 schema — no analysis, no fix proposal, no confidence scoring (those live in [`/fix-bug`](./skills/fix-bug/SKILL.md) via [`holistic-analysis`](./skills/holistic-analysis/SKILL.md) and [`confidence`](./skills/confidence/SKILL.md)). Invoked transitively by `/fix-bug`'s Linear input route and by `/batch-linear-tickets`. See [Domain Context](#linear-ticket-investigator) below for plug-in customization. |
| **[bug-fix-verifier](./agents/bug-fix-verifier.md)**                     | Independent fresh-context verifier for bug-fix PRs produced by [`/fix-bug`](./skills/fix-bug/SKILL.md). Receives only the Evidence Record, the reproduction path/command, the bug-notes ledger (read-only), and the PR diff — explicitly NOT the planner's `plan.md` or the executor's reasoning. Runs four checks: `FAIL_TO_PASS` (repro now passes), `PASS_TO_PASS` (existing tests still pass), diff sanity (no catch-all exception swallows, no debug statements, no test deletions, no `.skip` / `.only`), and repro integrity (the repro itself was not weakened). Returns green / red. The only agent allowed to undraft a `/fix-bug` PR. Used by `/fix-bug` Phase 7. |

### Claude Code Plugins

Claude Code plugins live in `plugins/` and are distributed via the `.claude-plugin/marketplace.json` at the repo root.

| Plugin                                                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[agent-tasks-hooks](./plugins/agent-tasks-hooks/README.md)** | Emits privacy-safe NDJSON lifecycle events (`UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, `Notification`) for the Agent Tasks VS Code extension. Drives sub-second session-state transitions in the Sessions panel. Installed automatically by the extension (with consent) or manually via `claude plugin marketplace add mthines/agent-skills && claude plugin install agent-tasks-hooks@agent-skills-plugins`. |

## Autonomous Workflow

`autonomous-workflow` is the largest skill in this repo. It orchestrates a complete feature development cycle — from a one-line task description to a tested, draft pull request — using isolated Git worktrees and optional companion skills for each phase.

### Architecture: two agents, one workflow

The skill installs **two agents** that share the same workflow knowledge, connected by `plan.md`. Both use the [`aw-` namespace prefix](#agent-namespace-aw-):

| Agent         | Phases                                         | Terminal artifact                           | Exit gate                                            |
| ------------- | ---------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| `aw-planner`  | 0–2 (validation, planning, worktree + plan.md) | `.agent/{branch}/plan.md`                   | `confidence(plan) ≥ 90%` (or user-approved override) |
| `aw-executor` | 3–7 (implement, test, docs, PR, CI)            | `.agent/{branch}/walkthrough.md` + draft PR | Walkthrough shown inline, Phase 7 CI gate run        |

The split is along the Phase 2 → Phase 3 context boundary. High-confidence plans flow through automatically; borderline plans pause for user approval. The design rationale (with verbatim Anthropic citations on context-boundary splits, structured handoff artifacts, and pre-implementation contracts) is in [`skills/autonomous-workflow/references/anthropic-architecture-research.md`](./skills/autonomous-workflow/references/anthropic-architecture-research.md).

#### Agent namespace: `aw-`

Both agents share the **`aw-` prefix** — short for "**a**utonomous-**w**orkflow". It's a deliberate namespace, not an abbreviation chosen at random:

- **Grouping** — when you list `~/.claude/agents/`, `aw-planner.md` and `aw-executor.md` sort next to each other, immediately legible as a pair.
- **Disambiguation** — agents installed by other skills (e.g. `reviewer`, `linear-ticket-investigator`) live in the same directory. The prefix prevents naming collisions and signals at a glance which workflow an agent belongs to.
- **Predictability** — when this skill grows new agents, expect the same `aw-*` shape (e.g. a hypothetical `aw-rebaser`). If you see `aw-something`, it's part of this skill.

So the first time you encounter `aw-planner` in a routing rule, an agent listing, or an error message, read it as "the autonomous-workflow planner" — not a typo or an unrelated tool.

### What each phase does

| Phase | Name           | What happens                                                                                                                                                                                            | Companion skills (optional unless noted)                                                   |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0     | Validation     | Asks clarifying questions; never starts coding without explicit confirmation.                                                                                                                           | —                                                                                          |
| 1     | Planning       | Analyzes the codebase (parallel `Explore` sub-agents for complex tasks); designs technical approach.                                                                                                    | `holistic-analysis`, `code-quality` (plan), **`confidence` (plan, mandatory gate at 90%)** |
| 2     | Worktree Setup | Creates an isolated worktree (`gw add` or native `git worktree`), generates `plan.md` artifact in `.agent/{branch}/`.                                                                                   | `aw-create-plan` (Full Mode)                                                               |
| 3     | Implementation | Codes per the plan, one change at a time, with fast checks after each edit.                                                                                                                             | `tdd` (logic), `ux` (UI), `code-quality` (end-of-phase)                                    |
| 4     | Testing        | Iterates on failing tests with a mode-aware cap (3 Lite / 5 Full) per area. At the cap, runs `confidence(bug-analysis)` and auto-replans via `holistic-analysis` once before mandatory user escalation. | `confidence` (bug-analysis), `holistic-analysis`                                           |
| 5     | Documentation  | Updates README, CHANGELOG; keeps `CLAUDE.md` aligned with code changes.                                                                                                                                 | `update-claude` (always)                                                                   |
| 6     | PR Creation    | Reviews changes, generates `walkthrough.md`, opens draft PR with narrative description.                                                                                                                 | `review-changes`, `aw-create-walkthrough` (Full Mode), `create-pr`                         |
| 7     | CI Gate        | Watches CI; auto-fixes failed checks (parallel sub-agents, cap 2 per PR). Optional post-merge cleanup.                                                                                                  | `ci-auto-fix`                                                                              |

The single biggest cost-saver is the **mode-aware stuck-loop cap** at Phase 4 (3 Lite / 5 Full) — it prevents agents from burning tokens on hallucinated fixes when their root-cause analysis is wrong. At the cap, `confidence(bug-analysis)` runs; if confidence is below 90%, the workflow auto-invokes `holistic-analysis`, regenerates the affected `plan.md` section, and resumes once before escalating to the user.

### Install

The skill ships with [`install.sh`](./skills/autonomous-workflow/install.sh) which handles agent + routing-rule symlinks for you.

**Global** (personal use, all projects):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --global --yes
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

**Per-project** (team use, committable):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow aw-create-plan aw-create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --yes
bash .claude/skills/autonomous-workflow/install.sh
```

> The `--agent claude-code` flag scopes the install to `.claude/skills/` only.
> Without it the CLI symlinks the skills into every supported AI-tool's directory
> (`.codebuddy/`, `.continue/`, `.crush/`, …) — fine if you switch tools, noisy
> otherwise. Use `--agent '*'` to opt into the universal install explicitly.

Run `bash install.sh --help` for script options.

### Usage

After install, just say:

```
Implement dark mode toggle independently
Build the user settings screen end-to-end
Take care of issue #42 in a worktree
```

The agent picks up via the routing rule, runs Phase 0 validation (asks clarifying questions), and proceeds through the phases until it delivers a draft PR with a walkthrough.

### Customizing

Companion skills (`tdd`, `ux`, `code-quality`, `update-claude`, `ci-auto-fix`, etc.) **skip silently if not installed**. To run a leaner workflow, omit them from the `--skill` list at install time. The only non-removable companion is `confidence` at Phase 1 — it's the load-bearing safety gate.

For full customization (disabling individual companions, adjusting thresholds, modifying phase rules), see:

- [`skills/autonomous-workflow/README.md`](./skills/autonomous-workflow/README.md) — install / customize / migrate from v2
- [`skills/autonomous-workflow/CLAUDE.md`](./skills/autonomous-workflow/CLAUDE.md) — design intent and how to work on the skill
- [`skills/autonomous-workflow/rules/companion-skills.md`](./skills/autonomous-workflow/rules/companion-skills.md) — companion registry with disable links

### Prerequisites

The skill depends on two CLI tools (declared as runtime prerequisites, not bundled):

- [`gw`](https://github.com/mthines/gw-tools) — Git worktree manager (`brew install mthines/gw-tools/gw`)
- [`gh`](https://cli.github.com) — GitHub CLI

### VS Code Extension (optional)

Install [**Agent Tasks**](https://marketplace.visualstudio.com/items?itemName=mthines.agent-tasks) from the VS Code Marketplace to visualize `plan.md`, `task.md`, and `walkthrough.md` artifacts in your sidebar — phase progress, decisions, blockers, and completed checkboxes update live as the agent works. Defaults to scanning `.agent/`, with `.gw/` as fallback (configurable via `agentTasks.directories`). Source: [`packages/vscode-agent-tasks/`](./packages/vscode-agent-tasks/).

## linear-ticket-investigator

The [`linear-ticket-investigator`](./agents/linear-ticket-investigator.md) agent reads a single Linear ticket, searches the codebase, and returns an **Evidence Record** matching [`/fix-bug`](./skills/fix-bug/SKILL.md)'s Phase 2 schema — no root-cause analysis, no fix proposal, no confidence scoring (those live in `/fix-bug` via [`holistic-analysis`](./skills/holistic-analysis/SKILL.md) and [`confidence`](./skills/confidence/SKILL.md)).
It is invoked transitively by `/fix-bug`'s Linear input route, and by [`/batch-linear-tickets`](./skills/batch-linear-tickets/SKILL.md) (which fans out `/fix-bug --analyse-only` per ticket — each call goes through this agent).

### Prerequisites

| Dependency                                                                                                                           | Purpose                                    | Required?                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------- |
| Linear MCP (`mcp__claude_ai_Linear__*`)                                                                                              | Read tickets, post PR comments             | **Yes**                            |
| [`/fix-bug`](./skills/fix-bug/SKILL.md)                                                                                              | Per-ticket analysis + confidence + handoff | **Yes** for `batch-linear-tickets` |
| `aw-planner` + `aw-executor` (from [`autonomous-workflow`](#autonomous-workflow), under the [`aw-` namespace](#agent-namespace-aw-)) | Planning + execution after approval        | **Yes** for `batch-linear-tickets` |
| Project domain-navigator skill                                                                                                       | Ground evidence extraction in monorepos    | Optional but recommended           |

### Domain Context (per-project plug-in)

Investigation accuracy depends on grounding the agent in the project's structure.
The agent looks for context in this order:

1. Top-level `CLAUDE.md` / `AGENTS.md`
2. Component-specific `CLAUDE.md` / `AGENTS.md` in directories the ticket points at
3. A project-shipped **domain-navigator skill**, auto-discovered by name and invoked via `Skill()`
4. Top-level `README.md` (fallback)

Steps 1, 2, and 4 work out of the box.
Step 3 is the high-leverage customization for monorepos.

#### Naming convention (this is the connection)

The investigator does **not** know your project's name.
It discovers domain navigators by scanning its available-skills list at runtime for any skill whose name is:

- **exactly `domain-navigator`** — for projects that only need one, or
- **ending in `-domain-navigator`** — e.g., `dash0-domain-navigator`, `acme-domain-navigator`, `monorepo-domain-navigator`

Any skill matching that pattern is invoked automatically.
No agent code changes, no registration step.
If your skill is named anything else (e.g., `domain-context`, `project-map`), the agent will not find it — rename it to match.

#### Starter template

Create `~/.claude/skills/<project>-domain-navigator/SKILL.md` (for personal use) or commit it under `.claude/skills/<project>-domain-navigator/` in the project (for team use):

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
| ...   | ...                                   |

## Cross-component dependencies

- `ui` calls `api` via `packages/web/src/client/`
- `api` reads from `db-migrator` schemas in `packages/db/`
- ...

## Where the docs live

- Architecture overview: `docs/architecture.md`
- API contract: `packages/server/api/openapi.yaml`
- Runbooks: `docs/runbooks/`
```

That's the entire integration.
The next time `linear-ticket-investigator` runs in a project that has this skill installed, it will see the matching name in its skills list and invoke it during Step 2.

### Install

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill batch-linear-tickets autonomous-workflow aw-create-plan aw-create-walkthrough \
          confidence code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --yes
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

The agent ships with the skill — no separate install step.
Symlink it into your agents directory if your tool doesn't auto-discover the `agents/` folder.

### Usage

```
batch-linear-tickets SUP-123 SUP-456 ENG-789
```

```
solve these tickets: SUP-100, SUP-101, SUP-102
```

The orchestrator fans out investigators, gates on user approval, fans out planners, optionally pauses for plan review, fans out executors, and posts PR links back to each Linear ticket.

## Usage Examples

Agent-invokable skills activate automatically. Just describe what you need:

```
Implement this feature autonomously / end-to-end / in a worktree
```

```
Check the accessibility of this component
```

```
I've tried fixing this bug three times — step back and analyze holistically
```

```
Add this feature using TDD
```

```
Rate your confidence in this implementation
```

Everything else is invoked with a slash:

```
/batch-linear-tickets SUP-123 SUP-456
/fix-bug https://app.dash0.com/.../trace?spanId=...
/dx review my CLI tool
/profile-optimizer ./trace.json
/video-analyser ./bug-recording.mp4
/init-claude
/update-claude
/resolve-conflicts
/review-changes --comments 42
/implement-suggestion <paste review comment>
/create-pr
/ci-auto-fix <run-id|pr-url>
```

## VSCode Extension

The [`vscode-agent-tasks`](./packages/vscode-agent-tasks/) package is a standalone VS Code extension that visualizes the artifacts produced by `autonomous-workflow` — `plan.md`, `task.md`, and `walkthrough.md` — directly in the VS Code sidebar.

**Install from the Marketplace:**

```
mthines.agent-tasks
```

Or search for **Agent Tasks** in the VS Code Extensions panel.

**What it shows:**

- All in-flight and completed agent tasks, grouped by branch
- Task progress with phase indicators, in-progress markers, and sub-tasks
- Plan summaries with files-to-create/modify and complexity estimate
- Walkthrough auto-open when a `walkthrough.md` is created

**Configurable directories** (default: `.agent/` and `.gw/`):

```jsonc
// .vscode/settings.json
{
  "agentTasks.directories": [".agent", ".gw"],
}
```

See [`packages/vscode-agent-tasks/README.md`](./packages/vscode-agent-tasks/README.md) for full documentation and [`packages/vscode-agent-tasks/DEVELOPMENT.md`](./packages/vscode-agent-tasks/DEVELOPMENT.md) for build/release notes.

## Repository Structure

```
packages/
  vscode-agent-tasks/    VS Code extension for artifact visualization     (Marketplace: mthines.agent-tasks)
skills/
  autonomous-workflow/   SKILL.md + README.md + CLAUDE.md +
                         rules/ + templates/ + references/ +
                         install.sh                          (orchestrator, agent-invokable)
  batch-linear-tickets/  SKILL.md + rules/                   (orchestrator, slash command)
  confidence/            SKILL.md                            (agent-invokable)
  e2e-testing/           SKILL.md + rules/ + references/ +
                         templates/                          (slash command)
  e2e-testing-mobile/    SKILL.md + rules/ + references/ +
                         templates/                          (slash command)
  fix-bug/               SKILL.md + rules/ + templates/ +
                         references/                         (slash command)
  holistic-analysis/     SKILL.md                            (agent-invokable)
  tdd/                   SKILL.md + rules/                   (agent-invokable)
  test-provenance-guard/ SKILL.md + rules/ + references/     (agent-invokable, applied)
  ux/                    SKILL.md + rules/ + templates/      (agent-invokable)
  aw-create-plan/        SKILL.md                            (workflow companion, slash-only)
  aw-create-walkthrough/ SKILL.md                            (workflow companion, slash-only)
  aw-review-quality-gate/ SKILL.md                           (workflow companion, slash-only)
  ai-engineering/        SKILL.md + rules/ + references/ +
                         templates/                          (slash command)
  charting/              SKILL.md + rules/ + references/     (slash command)
  ci-auto-fix/           SKILL.md                            (slash command)
  code-quality/          SKILL.md + rules/                   (slash command)
  create-pr/             SKILL.md                            (slash command)
  create-skill/          SKILL.md + rules/ + references/ +
                         templates/                          (slash command)
  dx/                    SKILL.md + rules/ + templates/      (slash command)
  implement-suggestion/  SKILL.md                            (slash command)
  init-claude/           SKILL.md                            (slash command)
  profile-optimizer/     SKILL.md + rules/ + references/ +
                         templates/                          (slash command)
  playwright-trace-analyzer/ SKILL.md + rules/ + references/ +
                         scripts/ + templates/               (slash command)
  resolve-conflicts/     SKILL.md                            (slash command)
  review-changes/        SKILL.md                            (slash command)
  update-claude/         SKILL.md                            (slash command)
  video-analyser/        SKILL.md                            (slash command)
agents/
  reviewer.md                                                (agent)
  linear-ticket-investigator.md                              (agent)
  bug-fix-verifier.md                                        (agent)
```

Skills live in `skills/` as standard SKILL.md files, making them installable with `npx skills add`. Agents live in `agents/` since they require their own model and tool configuration.

Each skill has a `SKILL.md` manifest with YAML frontmatter (name, description, metadata) and a Markdown body with instructions. Skills with `rules/` subdirectories contain focused guidance documents that are loaded on demand based on what the code contains. The `autonomous-workflow` skill additionally has `references/` (worked examples), `templates/` (agent + routing-rule definitions), and `install.sh` (one-command setup).

## Local Development

If you're hacking on these skills (rather than just installing them), point your tool's skill directories at this checkout via symlinks. Edits to `skills/<name>/SKILL.md` are then live on the next agent turn — no `npx skills add` reinstall required.

The convention used by this repo is a two-tier symlink chain:

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<name>
~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills–compatible clients, so the same chain serves every tool you use.

### Add a new skill

```bash
SKILL=my-skill
REPO="$HOME/Workspace/mthines/agent-skills.git/main"   # adjust to your checkout

mkdir -p "$REPO/skills/$SKILL"
$EDITOR "$REPO/skills/$SKILL/SKILL.md"

ln -s "$REPO/skills/$SKILL" "$HOME/.agents/skills/$SKILL"
ln -s "$HOME/.agents/skills/$SKILL" "$HOME/.claude/skills/$SKILL"
```

Agents are simpler — one symlink, no Claude-side mirror:

```bash
ln -s "$REPO/agents/<name>.md" "$HOME/.agents/agents/<name>.md"
```

### Edit an existing skill

Edit `skills/<name>/SKILL.md` directly in this repo. Avoid editing through the symlinked path under `~/.claude/skills/` — writes propagate correctly, but it becomes ambiguous which checkout you touched if you have multiple worktrees.

### Verify the chain

```bash
readlink ~/.claude/skills/<name>      # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>      # → <repo>/skills/<name>
```

Both must resolve. If either is missing, the agent harness won't see the skill.

## License

MIT
