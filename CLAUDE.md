# Agent Skills

## Audience

The skills and agents in this repository are consumed operationally by agentic frameworks (AI coding agents, copilots, and autonomous developer tools).
Every piece of guidance must be written so that an agent can act on it without human interpretation.

When writing or editing content, follow these principles:
- **Be prescriptive, not descriptive.**
  Tell the agent what to do, not explain concepts.
- **Make decisions enumerable.**
  Provide numbered decision processes, lookup tables, or explicit criteria.
- **Include code examples for every actionable rule.**
  Show both correct and incorrect patterns.
- **Avoid subjective conditions.**
  State concrete, testable criteria.
- **Keep rules self-contained.**
  Each file must make sense on its own.

## Repository Structure

Skills live in `skills/` as standard SKILL.md files.
Agents live in `agents/` since they require their own model and tool configuration.

### Agent-invokable skills (model can `Skill()`-invoke without a slash command)
- `autonomous-workflow` — Phase-based orchestrator (0–7) for end-to-end feature development. **Installs two agents** under the `aw-` namespace (`aw-` = "autonomous-workflow"): `aw-planner` for phases 0–2, `aw-executor` for phases 3–7, connected by `plan.md`. See [`skills/autonomous-workflow/CLAUDE.md`](./skills/autonomous-workflow/CLAUDE.md) for design intent before editing
- `batch-linear-tickets` — Batch orchestrator for Linear tickets. Fans out `linear-ticket-investigator` per ticket, correlates findings, gates user approval, then fans out `aw-planner` + `aw-executor` pairs (autonomous-workflow namespace) in worktrees. Requires Linear MCP
- `confidence` — Confidence assessment for plans, code, and bug analysis. **Plan mode is multi-signal** (LLM dimensional scoring + deterministic rule checks; a failed rule caps the gate at 89% regardless of LLM score)
- `dx` — Developer Experience review for CLI tools and shell scripts
- `holistic-analysis` — Full execution path analysis for stuck bugs/refactors
- `tdd` — Test-Driven Development with strict RED-GREEN-REFACTOR cycles
- `ux` — UX design review for web and React Native apps

### Workflow companions (`disable-model-invocation: true`, called by orchestrators via `Skill()`)
- `aw-create-plan` — Generates `.agent/{branch}/plan.md` for autonomous-workflow Full Mode
- `aw-create-walkthrough` — Generates `.agent/{branch}/walkthrough.md` for autonomous-workflow PR delivery
- `aw-review-quality-gate` — Self-check quality gate for review findings before delivery

### Slash commands (`disable-model-invocation: true`)
- `ci-auto-fix` — Diagnose and fix a failed CI check, iteratively pushing fixes until CI is green (currently GitHub Actions via `gh`)
- `code-quality` — Code-quality review for readability, complexity, and maintainability
- `create-pr` — Generate a narrative PR description, push, then watch CI and auto-fix simple failures (lint, format, lockfiles); escalates judgment-required failures via `/confidence`
- `implement-suggestion` — Implement fixes from review comments
- `init-claude` — Initialize Claude Code configuration for a project
- `resolve-conflicts` — Analyze and resolve Git merge/rebase conflicts
- `review-changes` — Review branch changes or PR (dispatches to reviewer)
- `update-claude` — Update CLAUDE.md and rules based on code changes

### Agents
- `reviewer` — Constructive code reviewer with auto-fix, report, and PR comment modes
- `linear-ticket-investigator` — Linear-specific ticket investigator. Reads a single ticket via Linear MCP, searches the codebase, returns structured findings with certainty markers and confidence score. Used by `batch-linear-tickets`

## Nx Workspace (VSCode Extension)

The `packages/vscode-agent-tasks/` package uses Nx 22.4 + pnpm 10.13 for build/test/lint/package.
All Nx versions follow `gw-tools.git` for cross-repo familiarity.

### Key commands

```bash
# Install dependencies (from repo root)
pnpm install

# Build
nx build vscode-agent-tasks

# Test (vitest — parser unit tests only)
nx test vscode-agent-tasks

# Lint
nx lint vscode-agent-tasks

# Package (.vsix)
nx package vscode-agent-tasks

# Development watch mode
nx dev vscode-agent-tasks

# Release dry-run
nx release vscode-agent-tasks --configuration=dry-run
```

### Key source files (vscode-agent-tasks)

- `src/extension.ts` — activation entry point; wires `HookEventWatcher`, `PluginInstaller`, adaptive tick
- `src/providers/sessions-provider.ts` — `SessionsProvider`; `computeStatus` has a 4-tier override: terminal-open → hook override → terminal-closed → `deriveRunState`
- `src/watchers/hook-event-watcher.ts` — watches `~/.claude/plugins/data/agent-tasks-hooks-agent-skills-plugins/events/*.ndjson` for new events
- `src/lib/hook-event-types.ts` — shared `HookEvent` / `HookEventName` types
- `src/lib/plugin-data-path.ts` — `getPluginDataDir()`, `getSentinelPath()`, `getHookEventsDir()` path helpers
- `src/lib/plugin-installer.ts` — `PluginInstaller`; first-run consent modal, version check, CLI install, sentinel write
- `src/lib/emit-event.test.ts` — vitest unit tests for `plugins/agent-tasks-hooks/bin/emit-event.js` (AC4/AC5)

### Workspace files

- `nx.json` — Nx config (plugins: `@nx/js/typescript`, `@nx/eslint/plugin`, `@nx/vitest`; release: `projects: ["*"]`)
- `tsconfig.base.json` — Strict TS 5.9 base (no `paths`, no `customConditions`)
- `pnpm-workspace.yaml` — `packages: ["packages/*"]`
- `packages/vscode-agent-tasks/project.json` — Nx targets for the extension

### Adding plugins vs. adding skills vs. adding packages

Plugins (Claude Code hook scripts + manifest) go in `plugins/<name>/` and require no build step.
Plugins are distributed via `.claude-plugin/marketplace.json` at the repo root.
The marketplace name is `agent-skills-plugins`; install via `claude plugin marketplace add mthines/agent-skills`.

Skills (markdown-only) go in `skills/` and require no build step.
Packages (buildable code) go in `packages/` and follow the Nx pattern.
Do NOT add a package without updating `tsconfig.json` references and `nx.json` release config.

### Plugin: agent-tasks-hooks

`plugins/agent-tasks-hooks/` — Claude Code lifecycle hook plugin for the Agent Tasks VS Code extension.
Registers `UserPromptSubmit`, `Stop`, `SessionStart`, `SessionEnd`, `Notification` hooks.
Emits NDJSON events to `${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson`.
Hook script is `bin/emit-event.js` (Node.js, always exits 0, 40ms hard cap).
Sentinel file at `${CLAUDE_PLUGIN_DATA}/sentinel` controls activation.
Validate with `claude plugin validate plugins/agent-tasks-hooks`.

## Local Development

The author's machine has this repo wired into Claude Code via a two-tier symlink chain so every edit to `skills/<name>/SKILL.md` is picked up live on the next turn — no `npx skills add` reinstall.

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<name>
~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills-compatible clients, so a single chain serves every tool.

### Add a new skill

1. Create `skills/<name>/SKILL.md` in this repo.
2. Symlink it into the cross-tool dir: `ln -s "$REPO/skills/<name>" "$HOME/.agents/skills/<name>"`.
3. Symlink that into Claude's dir: `ln -s "$HOME/.agents/skills/<name>" "$HOME/.claude/skills/<name>"`.
4. Add an entry to the inventory in `CLAUDE.md` and `README.md`.

For agents, write `agents/<name>.md` in this repo and create one symlink: `ln -s "$REPO/agents/<name>.md" "$HOME/.agents/agents/<name>.md"`.

### Edit an existing skill

Edit the file at `skills/<name>/SKILL.md` in this repo directly — never through the `~/.claude` or `~/.agents` symlinked path. Writes through symlinks resolve correctly but make it ambiguous which checkout the change lands in, which matters when multiple worktrees exist.

### Verify a skill is wired up

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<name>
```

Both must resolve. If either is missing, the harness will not see the skill.

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
