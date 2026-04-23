# Agent Skills

A personal collection of skills for AI coding assistants — covering code review, DX/UX analysis, TDD, holistic debugging, and developer productivity.

Skills and agents follow the open [Agent Skills](https://agentskills.io/) format and work with Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf, OpenCode, and more.

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

### Auto-activated skills

These activate automatically when your AI agent detects a matching task.

| Skill | What it does | Use when... |
|---|---|---|
| **[confidence](./skills/confidence/SKILL.md)** | Rates confidence that work fully solves the stated requirement. Scores across weighted dimensions with auto-fix mode. | Validating a plan before execution, checking code before a PR, or assessing a bug analysis. |
| **[dx](./skills/dx/SKILL.md)** | Reviews CLI tools, shell scripts, and developer tooling against established guidelines ([clig.dev](https://clig.dev), 12 Factor CLI, Heroku CLI Style Guide). | Building or reviewing a CLI, shell script, Makefile, or any developer-facing tool. |
| **[ux](./skills/ux/SKILL.md)** | Reviews web and React Native UI code for usability, accessibility (WCAG 2.2), and platform compliance (Apple HIG, Material Design 3). | Building or reviewing UI components, checking accessibility, or improving UX copy. |
| **[holistic-analysis](./skills/holistic-analysis/SKILL.md)** | Forces a full execution-path analysis when incremental fixes aren't working. Traces entry-to-exit with structured hypothesis generation. | A bug fix attempt has failed, you're going in circles, or you need to "step back and think." |
| **[tdd](./skills/tdd/SKILL.md)** | Enforces strict RED-GREEN-REFACTOR cycles. Writes one failing test, implements minimal code to pass, then refactors. | Adding new features test-first, or retrofitting tests onto existing code. |

### Slash commands

These are user-invoked only (`disable-model-invocation: true`) — the agent won't load them automatically, you trigger them with `/name`.

| Command | What it does |
|---|---|
| **[/init-claude](./skills/init-claude/SKILL.md)** | Analyzes your project and generates a tailored `CLAUDE.md` + `.claude/rules/` setup. Detects tech stack, project size, and conventions automatically. |
| **[/update-claude](./skills/update-claude/SKILL.md)** | Diffs your branch against main and incrementally updates Claude docs to match code changes. Finds stale references, dead paths, and drift. |
| **[/resolve-conflicts](./skills/resolve-conflicts/SKILL.md)** | Detects merge/rebase conflicts, shows both sides with context, proposes resolution strategies, and asks clarifying questions for ambiguous cases. |
| **[/review-changes](./skills/review-changes/SKILL.md)** | Reviews branch changes or a PR for quality, correctness, tests, and commit hygiene. Dispatches to the reviewer skill. |
| **[/implement-suggestion](./skills/implement-suggestion/SKILL.md)** | Takes review comments or suggestions and implements the fixes — simple ones directly, complex ones with a plan for approval. |

### Agents

Agents are specialized sub-processes with their own model and tool configuration. They are dispatched by other skills, not invoked directly.

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
  confidence/           SKILL.md                        (auto-activated)
  dx/                   SKILL.md + rules/ + templates/  (auto-activated)
  ux/                   SKILL.md + rules/ + templates/   (auto-activated)
  holistic-analysis/    SKILL.md                        (auto-activated)
  tdd/                  SKILL.md + rules/               (auto-activated)
  init-claude/          SKILL.md                        (slash command)
  update-claude/        SKILL.md                        (slash command)
  resolve-conflicts/    SKILL.md                        (slash command)
  review-changes/       SKILL.md                        (slash command)
  implement-suggestion/ SKILL.md                        (slash command)
agents/
  reviewer.md                                           (agent)
```

Skills live in `skills/` as standard SKILL.md files, making them installable with `npx skills add`. Agents live in `agents/` since they require their own model and tool configuration.

Each skill has a `SKILL.md` manifest with YAML frontmatter (name, description, metadata) and a Markdown body with instructions. Skills with `rules/` subdirectories contain focused guidance documents that are loaded on demand based on what the code contains.

## License

MIT
