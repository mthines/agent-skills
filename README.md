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

> **About skill loading.** Each skill below is either *agent-invokable* or *slash-command-only*. The distinction matters for your token budget:
> - **Agent-invokable skills** sit in your model's available-skills list every session — only the short `description` field, not the body. The model can invoke them via `Skill()` when it detects a matching task, without you typing `/name`.
> - **Slash-command-only skills** (`disable-model-invocation: true` in their frontmatter) are **not in the model's invokable list at all**. They cost nothing in baseline context. They load only when you type `/name` or when another skill calls them via `Skill()` at runtime.
>
> In all cases, the skill **body** (`SKILL.md` content + `rules/`) is loaded only on invocation, never automatically.

### Orchestrators

Coordinate other skills to execute multi-step workflows. Agent-invokable.

| Skill | What it does | Use when... |
|---|---|---|
| **[autonomous-workflow](./skills/autonomous-workflow/SKILL.md)** | Phase-based orchestrator (0–7) that handles end-to-end feature development — from validation through tested PR delivery — using isolated Git worktrees. Optionally invokes companions for planning, TDD, UX, code quality, docs, and CI fixing. See [dedicated section](#autonomous-workflow). | "Implement X autonomously", "end-to-end", "in isolation", "in a worktree". |

### Agent-invokable skills

The model can invoke these via `Skill()` when it detects a matching task — no slash command required. Their descriptions are in your context every session (~50–150 tokens each).

| Skill | What it does | Use when... |
|---|---|---|
| **[confidence](./skills/confidence/SKILL.md)** | Rates confidence that work fully solves the stated requirement. Scores across weighted dimensions with auto-fix mode. | Validating a plan before execution, checking code before a PR, or assessing a bug analysis. |
| **[dx](./skills/dx/SKILL.md)** | Reviews CLI tools, shell scripts, and developer tooling against established guidelines ([clig.dev](https://clig.dev), 12 Factor CLI, Heroku CLI Style Guide). | Building or reviewing a CLI, shell script, Makefile, or any developer-facing tool. |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full execution-path analysis when incremental fixes aren't working. Traces entry-to-exit with structured hypothesis generation. | A bug fix attempt has failed, you're going in circles, or you need to "step back and think." |
| **[tdd](./skills/tdd/SKILL.md)** | Enforces strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code to pass, then refactors. | Adding new features test-first, or retrofitting tests onto existing code. |
| **[ux](./skills/ux/SKILL.md)** | Reviews web and React Native UI code for usability, accessibility (WCAG 2.2), and platform compliance (Apple HIG, Material Design 3). | Building or reviewing UI components, checking accessibility, or improving UX copy. |

### Workflow companions

Slash-command-only. Primarily called by `autonomous-workflow` via `Skill()` at runtime. Installable on their own if you want to reuse the artifact-generation logic in your own pipelines, but most users don't invoke them directly.

| Skill | What it does |
|---|---|
| **[create-plan](./skills/create-plan/SKILL.md)** | Generates `.agent/{branch}/plan.md` — the single source of truth for autonomous execution. A new Claude session can resume from this plan alone. |
| **[create-walkthrough](./skills/create-walkthrough/SKILL.md)** | Generates `.agent/{branch}/walkthrough.md` — the final summary delivered with a PR, summarizing changes, decisions, and how to verify. |
| **[review-quality-gate](./skills/review-quality-gate/SKILL.md)** | Self-check quality gate for review findings before delivery — filters noise, dedupes, ranks severity. Called by the `reviewer` agent and review skills. |

### Slash commands

User-invoked only — the model can't auto-trigger these. **Zero baseline context cost** (not in the model's available-skills list); they load only when you type `/name` or when another skill calls them via `Skill()` at runtime.

| Command | What it does |
|---|---|
| **[/ci-auto-fix](./skills/ci-auto-fix/SKILL.md)** | Diagnoses a failed CI check, applies a minimal fix, pushes, and iterates until CI passes. Provider-agnostic in scope; currently implements the GitHub Actions path. Refuses to disable, skip, or weaken checks. |
| **[/code-quality](./skills/code-quality/SKILL.md)** | Authors and reviews code for low cognitive complexity, readability, and maintainability. Applies guard clauses, early returns, single-responsibility, and pragmatic performance choices grounded in Clean Code, Cognitive Complexity, and Knuth's optimization guidance. |
| **[/create-pr](./skills/create-pr/SKILL.md)** | Generates a narrative PR description, pushes the branch, opens the PR, then watches CI and auto-fixes simple failures (lint, format, lockfiles). Escalates judgment-required failures via `/confidence` rather than guessing. |
| **[/implement-suggestion](./skills/implement-suggestion/SKILL.md)** | Takes review comments or suggestions and implements the fixes — simple ones directly, complex ones with a plan for approval. |
| **[/init-claude](./skills/init-claude/SKILL.md)** | Analyzes your project and generates a tailored `CLAUDE.md` + `.claude/rules/` setup. Detects tech stack, project size, and conventions automatically. |
| **[/resolve-conflicts](./skills/resolve-conflicts/SKILL.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolution strategies, and asks clarifying questions for ambiguous cases. |
| **[/review-changes](./skills/review-changes/SKILL.md)** | Reviews branch changes or a PR for quality, correctness, tests, and commit hygiene. Dispatches to the reviewer skill. |
| **[/update-claude](./skills/update-claude/SKILL.md)** | Diffs your branch against main and incrementally updates Claude docs to match code changes. Finds stale references, dead paths, and drift. |

### Agents

Agents are specialized sub-processes with their own model and tool configuration. They are dispatched by other skills, not invoked directly.

| Agent | What it does |
|---|---|
| **[reviewer](./agents/reviewer.md)** | Constructive code reviewer with three modes: **fix** (default — auto-fixes simple issues), **report** (`--report` — findings only), and **comments** (`--comments` — proposes line-level GitHub PR review comments). |

## Autonomous Workflow

`autonomous-workflow` is the largest skill in this repo. It orchestrates a complete feature development cycle — from a one-line task description to a tested, draft pull request — using isolated Git worktrees and optional companion skills for each phase.

### Architecture: two agents, one workflow

The skill installs **two agents** that share the same workflow knowledge, connected by `plan.md`:

| Agent | Phases | Terminal artifact | Exit gate |
|---|---|---|---|
| `autonomous-planner` | 0–2 (validation, planning, worktree + plan.md) | `.agent/{branch}/plan.md` | `confidence(plan) ≥ 90%` (or user-approved override) |
| `autonomous-executor` | 3–7 (implement, test, docs, PR, CI) | `.agent/{branch}/walkthrough.md` + draft PR | Walkthrough shown inline, Phase 7 CI gate run |

The split is along the Phase 2 → Phase 3 context boundary. High-confidence plans flow through automatically; borderline plans pause for user approval. The design rationale (with verbatim Anthropic citations on context-boundary splits, structured handoff artifacts, and pre-implementation contracts) is in [`skills/autonomous-workflow/references/anthropic-architecture-research.md`](./skills/autonomous-workflow/references/anthropic-architecture-research.md).

### What each phase does

| Phase | Name | What happens | Companion skills (optional unless noted) |
|---|---|---|---|
| 0 | Validation | Asks clarifying questions; never starts coding without explicit confirmation. | — |
| 1 | Planning | Analyzes the codebase (parallel `Explore` sub-agents for complex tasks); designs technical approach. | `holistic-analysis`, `code-quality` (plan), **`confidence` (plan, mandatory gate at 90%)** |
| 2 | Worktree Setup | Creates an isolated worktree (`gw add` or native `git worktree`), generates `plan.md` artifact in `.agent/{branch}/`. | `create-plan` (Full Mode) |
| 3 | Implementation | Codes per the plan, one change at a time, with fast checks after each edit. | `tdd` (logic), `ux` (UI), `code-quality` (end-of-phase) |
| 4 | Testing | Iterates on failing tests with a mode-aware cap (3 Lite / 5 Full) per area. At the cap, runs `confidence(bug-analysis)` and auto-replans via `holistic-analysis` once before mandatory user escalation. | `confidence` (bug-analysis), `holistic-analysis` |
| 5 | Documentation | Updates README, CHANGELOG; keeps `CLAUDE.md` aligned with code changes. | `update-claude` (always) |
| 6 | PR Creation | Reviews changes, generates `walkthrough.md`, opens draft PR with narrative description. | `review-changes`, `create-walkthrough` (Full Mode), `create-pr` |
| 7 | CI Gate | Watches CI; auto-fixes failed checks (parallel sub-agents, cap 2 per PR). Optional post-merge cleanup. | `ci-auto-fix` |

The single biggest cost-saver is the **mode-aware stuck-loop cap** at Phase 4 (3 Lite / 5 Full) — it prevents agents from burning tokens on hallucinated fixes when their root-cause analysis is wrong. At the cap, `confidence(bug-analysis)` runs; if confidence is below 90%, the workflow auto-invokes `holistic-analysis`, regenerates the affected `plan.md` section, and resumes once before escalating to the user.

### Install

The skill ships with [`install.sh`](./skills/autonomous-workflow/install.sh) which handles agent + routing-rule symlinks for you.

**Global** (personal use, all projects):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow create-plan create-walkthrough confidence \
          code-quality holistic-analysis tdd ux update-claude \
          review-changes create-pr ci-auto-fix \
  --agent claude-code \
  --global --yes
bash ~/.claude/skills/autonomous-workflow/install.sh --global
```

**Per-project** (team use, committable):

```bash
npx skills add https://github.com/mthines/agent-skills \
  --skill autonomous-workflow create-plan create-walkthrough confidence \
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

## Usage Examples

Skills activate automatically. Just describe what you need:

```
Implement this feature autonomously / end-to-end / in a worktree
```
```
Review the DX of my CLI tool
```
```
Check the accessibility of this component
```
```
Refactor this for readability / reduce cognitive complexity
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

Commands are invoked with a slash:

```
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
  "agentTasks.directories": [".agent", ".gw"]
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
  confidence/            SKILL.md                            (agent-invokable)
  dx/                    SKILL.md + rules/ + templates/      (agent-invokable)
  holistic-analysis/     SKILL.md                            (agent-invokable)
  tdd/                   SKILL.md + rules/                   (agent-invokable)
  ux/                    SKILL.md + rules/ + templates/      (agent-invokable)
  create-plan/           SKILL.md                            (workflow companion, slash-only)
  create-walkthrough/    SKILL.md                            (workflow companion, slash-only)
  review-quality-gate/   SKILL.md                            (workflow companion, slash-only)
  ci-auto-fix/           SKILL.md                            (slash command)
  code-quality/          SKILL.md + rules/                   (slash command)
  create-pr/             SKILL.md                            (slash command)
  implement-suggestion/  SKILL.md                            (slash command)
  init-claude/           SKILL.md                            (slash command)
  resolve-conflicts/     SKILL.md                            (slash command)
  review-changes/        SKILL.md                            (slash command)
  update-claude/         SKILL.md                            (slash command)
agents/
  reviewer.md                                                (agent)
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
