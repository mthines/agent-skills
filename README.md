# Agent Skills

A personal collection of skills for AI coding assistants — covering autonomous feature development, code review, DX/UX analysis, TDD, holistic debugging, and developer productivity.

Skills and agents follow the open [Agent Skills](https://agentskills.io/) format and work with Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and more.

> **New:** The [`autonomous-workflow`](#autonomous-workflow) skill orchestrates end-to-end feature development through a phase-based pipeline with optional companion skills. See its [dedicated section](#autonomous-workflow) below.

## Install

**Universal** (works with any [Agent Skills](https://agentskills.io)-compatible tool):

```bash
npx skills add https://github.com/mthines/agent-skills --all
```

To install a single skill:

```bash
npx skills add https://github.com/mthines/agent-skills --skill confidence
```

<details>
<summary>Claude Code</summary>

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

### Orchestrators

Coordinate other skills to execute multi-step workflows.

| Skill | What it does | Use when... |
|---|---|---|
| **[autonomous-workflow](./skills/autonomous-workflow/SKILL.md)** | Phase-based orchestrator (0–7) that handles end-to-end feature development — from validation through tested PR delivery — using isolated Git worktrees. Optionally invokes companions for planning, TDD, UX, code quality, docs, and CI fixing. See [dedicated section](#autonomous-workflow). | "Implement X autonomously", "end-to-end", "in isolation", "in a worktree". |

### Auto-activated skills

These activate automatically when your AI agent detects a matching task.

| Skill | What it does | Use when... |
|---|---|---|
| **[code-quality](./skills/code-quality/SKILL.md)** | Authors and reviews code for low cognitive complexity, readability, and maintainability. Applies guard clauses, early returns, single-responsibility, and pragmatic performance choices grounded in Clean Code, Cognitive Complexity, and Knuth's optimization guidance. | Writing, refactoring, or reviewing code — especially during TDD GREEN/REFACTOR or before merging. |
| **[confidence](./skills/confidence/SKILL.md)** | Rates confidence that work fully solves the stated requirement. Scores across weighted dimensions with auto-fix mode. | Validating a plan before execution, checking code before a PR, or assessing a bug analysis. |
| **[dx](./skills/dx/SKILL.md)** | Reviews CLI tools, shell scripts, and developer tooling against established guidelines ([clig.dev](https://clig.dev), 12 Factor CLI, Heroku CLI Style Guide). | Building or reviewing a CLI, shell script, Makefile, or any developer-facing tool. |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full execution-path analysis when incremental fixes aren't working. Traces entry-to-exit with structured hypothesis generation. | A bug fix attempt has failed, you're going in circles, or you need to "step back and think." |
| **[review-quality-gate](./skills/review-quality-gate/SKILL.md)** | Self-check quality gate for review findings before delivery — filters noise, dedupes, ranks severity. | After running a code review, before posting findings to a PR or chat. |
| **[tdd](./skills/tdd/SKILL.md)** | Enforces strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code to pass, then refactors. | Adding new features test-first, or retrofitting tests onto existing code. |
| **[ux](./skills/ux/SKILL.md)** | Reviews web and React Native UI code for usability, accessibility (WCAG 2.2), and platform compliance (Apple HIG, Material Design 3). | Building or reviewing UI components, checking accessibility, or improving UX copy. |

### Workflow companions

Internal skills invoked by orchestrators (typically `autonomous-workflow`). Most users won't call these directly, but they're installable on their own if you want to reuse the artifact-generation logic in your own pipelines.

| Skill | What it does |
|---|---|
| **[create-plan](./skills/create-plan/SKILL.md)** | Generates `.agent/{branch}/plan.md` — the single source of truth for autonomous execution. A new Claude session can resume from this plan alone. |
| **[create-walkthrough](./skills/create-walkthrough/SKILL.md)** | Generates `.agent/{branch}/walkthrough.md` — the final summary delivered with a PR, summarizing changes, decisions, and how to verify. |

### Slash commands

These are user-invoked only (`disable-model-invocation: true`) — the agent won't load them automatically, you trigger them with `/name`.

| Command | What it does |
|---|---|
| **[/init-claude](./skills/init-claude/SKILL.md)** | Analyzes your project and generates a tailored `CLAUDE.md` + `.claude/rules/` setup. Detects tech stack, project size, and conventions automatically. |
| **[/update-claude](./skills/update-claude/SKILL.md)** | Diffs your branch against main and incrementally updates Claude docs to match code changes. Finds stale references, dead paths, and drift. |
| **[/resolve-conflicts](./skills/resolve-conflicts/SKILL.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolution strategies, and asks clarifying questions for ambiguous cases. |
| **[/review-changes](./skills/review-changes/SKILL.md)** | Reviews branch changes or a PR for quality, correctness, tests, and commit hygiene. Dispatches to the reviewer skill. |
| **[/implement-suggestion](./skills/implement-suggestion/SKILL.md)** | Takes review comments or suggestions and implements the fixes — simple ones directly, complex ones with a plan for approval. |
| **[/create-pr](./skills/create-pr/SKILL.md)** | Generates a narrative PR description, pushes the branch, opens the PR, then watches CI and auto-fixes simple failures (lint, format, lockfiles). Escalates judgment-required failures via `/confidence` rather than guessing. |
| **[/ci-auto-fix](./skills/ci-auto-fix/SKILL.md)** | Diagnoses a failed CI check, applies a minimal fix, pushes, and iterates until CI passes. Provider-agnostic in scope; currently implements the GitHub Actions path. Refuses to disable, skip, or weaken checks. |

### Agents

Agents are specialized sub-processes with their own model and tool configuration. They are dispatched by other skills, not invoked directly.

| Agent | What it does |
|---|---|
| **[reviewer](./agents/reviewer.md)** | Constructive code reviewer with three modes: **fix** (default — auto-fixes simple issues), **report** (`--report` — findings only), and **comments** (`--comments` — proposes line-level GitHub PR review comments). |

## Autonomous Workflow

`autonomous-workflow` is the largest skill in this repo. It orchestrates a complete feature development cycle — from a one-line task description to a tested, draft pull request — using isolated Git worktrees and optional companion skills for each phase.

### What it does

| Phase | Name | What happens | Companion skills (optional unless noted) |
|---|---|---|---|
| 0 | Validation | Asks clarifying questions; never starts coding without explicit confirmation. | — |
| 1 | Planning | Analyzes the codebase (parallel `Explore` sub-agents for complex tasks); designs technical approach. | `holistic-analysis`, `code-quality` (plan), **`confidence` (plan, mandatory gate at 90%)** |
| 2 | Worktree Setup | Creates an isolated worktree (`gw add`), generates `plan.md` artifact in `.agent/{branch}/`. | `create-plan` (Full Mode) |
| 3 | Implementation | Codes per the plan, one change at a time, with fast checks after each edit. | `tdd` (logic), `ux` (UI), `code-quality` (end-of-phase) |
| 4 | Testing | Iterates on failing tests with a **3-iteration hard limit** per area. | `confidence` (bug-analysis), `holistic-analysis` |
| 5 | Documentation | Updates README, CHANGELOG; keeps `CLAUDE.md` aligned with code changes. | `update-claude` (always) |
| 6 | PR Creation | Reviews changes, generates `walkthrough.md`, opens draft PR with narrative description. | `review-changes`, `create-walkthrough` (Full Mode), `create-pr` |
| 7 | CI Gate | Watches CI; auto-fixes failed checks (parallel sub-agents, cap 2 per PR). Optional post-merge cleanup. | `ci-auto-fix` |

The single biggest cost-saver is the **3-iteration stuck-loop limit** at Phase 4 — it prevents agents from burning tokens on hallucinated fixes when their root-cause analysis is wrong. After 3 failed attempts on the same area, `confidence(bug-analysis)` runs and the agent escalates to the user.

### Install

The skill ships with [`install.sh`](./skills/autonomous-workflow/install.sh) which handles agent + routing-rule symlinks for you.

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

## Repository Structure

```
skills/
  autonomous-workflow/   SKILL.md + README.md + CLAUDE.md +
                         rules/ + templates/ + references/ +
                         install.sh                          (orchestrator)
  code-quality/          SKILL.md + rules/                   (auto-activated)
  confidence/            SKILL.md                            (auto-activated)
  create-plan/           SKILL.md                            (workflow companion)
  create-walkthrough/    SKILL.md                            (workflow companion)
  dx/                    SKILL.md + rules/ + templates/      (auto-activated)
  holistic-analysis/     SKILL.md                            (auto-activated)
  review-quality-gate/   SKILL.md                            (auto-activated)
  tdd/                   SKILL.md + rules/                   (auto-activated)
  ux/                    SKILL.md + rules/ + templates/      (auto-activated)
  ci-auto-fix/           SKILL.md                            (slash command)
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
