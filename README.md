# Agent Skills

A collection of skills, commands, and agents for AI coding assistants — covering code review, DX/UX analysis, TDD, holistic debugging, and developer productivity.

Skills follow the open [Agent Skills](https://agentskills.io/) format and work with Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and more.

## Install

This repo contains three types of content: **skills**, **commands**, and **agents**. The install method determines which you get.

### Claude Code (full install — skills + commands + agents)

The Claude Code plugin system installs everything:

```bash
/plugin marketplace add mthines/agent-skills
/plugin install mthines-agent-skills@mthines
```

The plugin manifest (`.claude-plugin/plugin.json`) declares paths for `skills/`, `commands/`, and `agents/`, so all three are available after install.

### Skills only (any tool)

The `npx skills` CLI installs skills from the `skills/` directory. Commands and agents are not included.

```bash
npx skills add https://github.com/mthines/agent-skills --all
```

To install a single skill:

```bash
npx skills add https://github.com/mthines/agent-skills --skill confidence
```

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

### Manual (full install — any tool)

Clone into the cross-client discovery directory to get everything:

```bash
git clone https://github.com/mthines/agent-skills.git ~/.agents/skills/mthines-agent-skills
```

Most tools auto-discover skills from `~/.agents/skills/`. For commands and agents, symlink or copy them into your tool's config directory:

```bash
# Claude Code — commands and agents
ln -sf ~/.agents/skills/mthines-agent-skills/commands/* ~/.claude/commands/
ln -sf ~/.agents/skills/mthines-agent-skills/agents/* ~/.claude/agents/

# Or copy directly
cp -r ~/.agents/skills/mthines-agent-skills/commands/* ~/.claude/commands/
cp -r ~/.agents/skills/mthines-agent-skills/agents/* ~/.claude/agents/
```

### What installs where

| Method | Skills | Commands | Agents |
|---|---|---|---|
| Claude Code plugin | Yes | Yes | Yes |
| `npx skills add` | Yes | No | No |
| `git clone` + symlinks | Yes | Yes | Yes |
| Gemini / Cursor / Copilot / Codex | Yes | No | No |

## What's Included

### Skills

Skills are advisory workflows with detailed rules. They activate automatically when your AI agent detects a matching task.

| Skill | What it does | Use when... |
|---|---|---|
| **[confidence](./skills/confidence/SKILL.md)** | Rates confidence that work fully solves the stated requirement. Scores across weighted dimensions with auto-fix mode. | Validating a plan before execution, checking code before a PR, or assessing a bug analysis. |
| **[dx](./skills/dx/SKILL.md)** | Reviews CLI tools, shell scripts, and developer tooling against established guidelines ([clig.dev](https://clig.dev), 12 Factor CLI, Heroku CLI Style Guide). | Building or reviewing a CLI, shell script, Makefile, or any developer-facing tool. |
| **[ux](./skills/ux/SKILL.md)** | Reviews web and React Native UI code for usability, accessibility (WCAG 2.2), and platform compliance (Apple HIG, Material Design 3). | Building or reviewing UI components, checking accessibility, or improving UX copy. |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full execution-path analysis when incremental fixes aren't working. Traces entry-to-exit with structured hypothesis generation. | A bug fix attempt has failed, you're going in circles, or you need to "step back and think." |
| **[tdd](./skills/tdd/SKILL.md)** | Enforces strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code to pass, then refactors. | Adding new features test-first, or retrofitting tests onto existing code. |

### Commands

Commands are slash commands you invoke directly (e.g., `/init-claude`).

| Command | What it does |
|---|---|
| **[init-claude](./commands/init-claude.md)** | Analyzes your project and generates a tailored `CLAUDE.md` + `.claude/rules/` setup. Detects tech stack, project size, and conventions automatically. |
| **[update-claude](./commands/update-claude.md)** | Diffs your branch against main and incrementally updates Claude docs to match code changes. Finds stale references, dead paths, and drift. |
| **[resolve-conflicts](./commands/resolve-conflicts.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolution strategies, and asks clarifying questions for ambiguous cases. |
| **[review-changes](./commands/review-changes.md)** | Reviews branch changes or a PR for quality, correctness, tests, and commit hygiene. Dispatches to the reviewer agent. |
| **[implement-suggestion](./commands/implement-suggestion.md)** | Takes review comments or suggestions and implements the fixes — simple ones directly, complex ones with a plan for approval. |

### Agents

Agents are specialized sub-processes that handle complex multi-step tasks.

| Agent | What it does |
|---|---|
| **[reviewer](./agents/reviewer.md)** | Constructive code reviewer with three modes: **fix** (default — auto-fixes simple issues), **report** (`--report` — findings only), and **comments** (`--comments` — proposes line-level GitHub PR review comments). |

## Usage Examples

Skills activate automatically. Just describe what you need:

```
Review the DX of my CLI tool
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

Commands are invoked with a slash:

```
/init-claude
/update-claude
/resolve-conflicts
/review-changes --comments 42
/implement-suggestion <paste review comment>
```

## Repository Structure

```
skills/
  confidence/        SKILL.md
  dx/                SKILL.md + rules/ + templates/
  ux/                SKILL.md + rules/ + templates/
  holistic-analysis/ SKILL.md
  tdd/               SKILL.md + rules/
commands/
  init-claude.md
  update-claude.md
  resolve-conflicts.md
  review-changes.md
  implement-suggestion.md
agents/
  reviewer.md
```

Each skill has a `SKILL.md` manifest with YAML frontmatter (name, description, metadata) and a Markdown body with instructions. Skills with `rules/` subdirectories contain focused guidance documents that are loaded on demand based on what the code contains.

## License

MIT
