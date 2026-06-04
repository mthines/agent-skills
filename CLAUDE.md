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

Skills live in `skills/<category>/<name>/SKILL.md` across 7 categories.
Agents live in `agents/` since they need their own model and tool configuration.

Type markers: `auto` = model-invokable via `Skill()`; `/` = slash command only; `Skill()` = called by other skills, no model invocation.

### `workflow/` — end-to-end orchestrators

- `autonomous-workflow` (`auto`) — phase-based feature delivery 0–7. Design intent: [`workflow/autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md)
- `aw-create-plan`, `aw-create-walkthrough`, `aw-review-quality-gate` (`Skill()`) — autonomous-workflow companions
- `batch-linear-tickets` (`/`) — fan out `/fix-bug` across Linear tickets; requires Linear MCP
- `fix-bug` (`/`) — single-bug pipeline phases 0–8. Flags: `--analyse-only`, `--force-holistic`
- `implement-suggestion` (`/`) — apply reviewer suggestions across PRs; per-comment `/critical` + `/confidence` validation

### `quality/` — code, tests, plans, AI apps

- `ai-engineering` (`/`) — LLM/AI app review across 13 concerns (prompts, caching, RAG, agents, evals, safety, observability)
- `code-quality` (`auto`) — readability, complexity, maintainability
- `confidence` (`auto`) — multi-signal confidence gate for `plan` / `code` / `analysis`; deterministic rule caps LLM score at 89%
- `critical` (`auto`) — adversarial pre-mortem with mandatory steelman alternative. Never iterates
- `dx` (`/`) — CLI / shell-script DX review
- `review-changes` (`/`) — dispatches to `reviewer` agent
- `tdd` (`auto`) — strict RED-GREEN-REFACTOR
- `test-provenance-guard` (`auto`) — detects tests-by-construction (static + mutation checks); self-heals by extracting inline logic

### `delivery/` — Git, PR, CI

- `changelog` (`/`) — personal PR + Linear ticket digest. Template: [`delivery/changelog/templates/changelog.md`](./skills/delivery/changelog/templates/changelog.md)
- `ci-auto-fix` (`/`) — diagnose and fix failed GitHub Actions checks until green
- `create-pr` (`/`) — narrative PR description; watch CI. Flags: `--split`, `--review`
- `github-actions-author` (`/`) — author / review GHA workflows (2026 best practices)
- `resolve-conflicts` (`/`) — analyze and resolve merge / rebase conflicts

### `testing/` — E2E and fixture tooling

- `e2e-testing` (`/`) — spec-first Playwright Test Agents loop; locator ladder; `data-testid` source diffs; 3-attempt heal cap
- `e2e-testing-mobile` (`/`) — Maestro YAML flows for Expo / React Native; `testID`-first locator ladder; runs on Maestro Cloud via EAS
- `e2e-pr-stabilizer` (`/`) — local-first stabilizer for Playwright E2E on one PR; Dash0 MCP spans (`git.pull_request_link`) as historical baseline, then iterates locally with `--trace=on` and the same OTel exporter. Validation is empirical, not predictive: every new locator must resolve against source (static grep) or the live app (`locator.count() ≥ 1`) before commit, and the fixed test must pass 3 consecutive local runs before the single push. CI watch ratifies. Refuses `.skip` / `.fixme` / `waitForTimeout`. Two modes: `stabilize` (default) and `optimize` (report-only, ranks slow-action wins by measured ms saved, no commits)
- `optimize-mock-data` (`/`) — JSON/JSONL fixture analyze / normalize / shrink

### `design/` — UI, visual, interaction

- `animations` (`auto`) — CSS-first animations; perceived performance; interaction-feedback brainstorming
- `charting` (`auto`) — pick chart type + library for web (React/Next.js) and mobile (Expo/RN)
- `storybook` (`auto`) — visual regression + Playground + interaction-test stories; opt-in OS-keychain auth profiles
- `ux` (`auto`) — UX, a11y, microcopy, dark-pattern review (WCAG 2.2, Apple HIG, Material Design 3). Hard rule: never recommends a dark pattern
- `visual-design` (`auto`) — brand-aware visual direction; style-direction taxonomy; defers WCAG math to `/ux`

### `analysis/` — investigate data, diagnose issues

- `holistic-analysis` (`auto`) — full entry-to-exit execution-path trace when incremental fixes aren't working
- `playwright-trace-analyzer` (`/`) — analyze `trace.zip`; names the race behind a flake; confidence-gated
- `profile-optimizer` (`/`) — React DevTools / Chrome Performance trace analysis; ranked optimisation plan
- `rum-tracking` (`auto`) — product analytics and RUM event tracking; what to capture, what's PII, OTel semantic conventions
- `screen-recorder` (`/`) — record short cropped UI videos via Playwright + ffmpeg
- `video-analyser` (`auto`) — analyze screen recordings for bugs; optional OCR + Whisper transcription

### `authoring/` — skills about Claude Code itself

- `create-skill` (`/`) — scaffold, review, upgrade, diagnose skills
- `documentation` (`auto`) — author / audit `CLAUDE.md`, `AGENTS.md`, `README.md`, Diátaxis `docs/` trees
- `optimize-claude-md` (`/`) — audit `CLAUDE.md` for context bloat; refuses below 10k chars
- `persistent-memory` (`/`) — cross-conversation markdown memory store; tiered (home / project-local / project-shared)

### Agents

- `reviewer` — code reviewer with auto-fix / report / PR-comment modes. `--with <skill>` adds review lenses (`ai-engineering`, `animations`, `charting`, `dx`, `holistic-analysis`, `ux`)
- `linear-ticket-investigator` — reads a Linear ticket, returns Evidence Record for `/fix-bug` Phase 2. No analysis / fix / confidence (those live in `/fix-bug`)
- `bug-fix-verifier` — independent verifier for `/fix-bug` PRs. FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity. Only agent allowed to undraft
- `feature-pr-verifier` — feature-PR counterpart for `/autonomous-workflow` Full Mode. Acceptance criteria, pass-to-pass, diff sanity, walkthrough integrity

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

- `src/extension.ts` — activation entry point; wires `HookEventWatcher`, `PluginInstaller`, adaptive tick, `PrStatusCache`, `PrPoller`
- `src/providers/sessions-provider.ts` — `SessionsProvider`; `computeStatus` has a 5-tier override: terminal-open → hook override → unread TTL → terminal-closed → `deriveRunState`
- `src/watchers/hook-event-watcher.ts` — watches `~/.claude/plugins/data/agent-tasks-hooks-agent-skills-plugins/events/*.ndjson` for new events; validates `schemaVersion`
- `src/lib/hook-event-types.ts` — shared `HookEvent` / `HookEventName` types (includes optional `schemaVersion`)
- `src/lib/plugin-data-path.ts` — `getPluginDataDir()`, `getSentinelPath()`, `getHookEventsDir()` path helpers
- `src/lib/plugin-installer.ts` — `PluginInstaller`; first-run consent modal, version check, CLI install, sentinel write
- `src/lib/emit-event.test.ts` — vitest unit tests for `plugins/agent-tasks-hooks/bin/emit-event.js`
- `src/lib/gh-executor.ts` — `GhExecutor` interface + `SystemGhExecutor` default implementation (injectable for tests)
- `src/lib/pr-status-cache.ts` — `PrStatusCache`; fetches PR enrichment via `gh pr view`, caches per branch with 60s rate limit, no-flip guarantee
- `src/lib/pr-status-reducer.ts` — `resolveDisplayStatus()` pure function; combines `SessionStatus` + `PrEnrichment` → `DisplayStatus`
- `src/lib/pr-poller.ts` — `PrPoller`; polls PR status at 90s cadence, capped at 20 most-recent branches
- `src/parsers/session-jsonl-parser.ts` — pure JSONL parser; `SessionStatus` union includes `unread`; exports `UNREAD_TTL_MS = 24h`

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
Each emitted event includes `schemaVersion: 1` (added in v0.2.0).
The extension rejects events with a known `schemaVersion` that is not `1`; missing `schemaVersion` is accepted for backwards compatibility.
Sentinel file at `${CLAUDE_PLUGIN_DATA}/sentinel` controls activation.
Validate with `claude plugin validate plugins/agent-tasks-hooks`.

### Sessions panel — status model

The Sessions panel uses a four-tier status computation:

1. Terminal open in this window → `running` (definite signal).
2. Hook override within 5-minute TTL → hook-driven status.
3. Unread TTL (24h): if hook override is `unread` and `session.mtime > 24h`, downgrade to `idle`.
4. We closed the terminal post-mtime → `idle` (we ended it).
5. Fallback → `deriveRunState(turnEnded, mtime)` from JSONL.

Status values: `running` | `needs-input` | `unread` | `stalled` | `idle`.
Plus PR-derived display-only statuses: `pr-open` | `pr-ci-failing` | `pr-merged` | `pr-closed`.

`unread` is set when a `Stop` hook fires and the session's terminal is NOT open.
`needs-input` is set when a `Stop` hook fires and the terminal IS open.
`unread` clears when the user opens the session (`clearUnread` is called in `openSession`).

**Duplicate-Stop guard**: `clearUnread` records a timestamp; subsequent `Stop` events with an older `ts` are discarded so a duplicate hook call cannot re-set the `unread` badge after the user dismissed it.

**Sessions from deleted worktrees**: silently vanish from the panel on the next refresh.
`~/.claude/projects/` entries for deleted worktrees are not garbage-collected by this extension — Claude Code manages its own project dirs.

### PR linkage

PR status is fetched via `gh pr view --head <branch>` at a 90-second cadence by `PrPoller`.
Requires the `gh` CLI.
Controlled by `agentTasks.sessions.prLinkage` (boolean, default `true`).
When `prLinkage = false`, no `gh` subprocess calls are made.
When `gh` is not installed, a one-time info notification fires and all sessions show JSONL-derived status.
`PrStatusCache` implements the no-flip guarantee: a `pr-merged` cache entry is never overwritten by a transient `gh` error.
PR polling is capped at 20 most-recently-active branches (by mtime) to stay well within GitHub's 5000 req/hour limit.

## Local Development

The author's machine wires this repo into Claude Code via a two-tier symlink chain so every edit to `skills/<category>/<name>/SKILL.md` is picked up live on the next turn — no `npx skills add` reinstall.

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<category>/<name>
~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The installed-side paths stay flat (`~/.claude/skills/<name>`, `~/.agents/skills/<name>`) because that's how every Agent-Skills-compatible tool reads them. Only the repo target is nested — the sync script walks `skills/` recursively to find every directory with a `SKILL.md`.

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills-compatible clients, so a single chain serves every tool.

### Add a new skill

1. Pick a category (`workflow/`, `quality/`, `delivery/`, `testing/`, `design/`, `analysis/`, `authoring/`) and create `skills/<category>/<name>/SKILL.md`.
2. Run `bash scripts/sync-symlinks.sh` to wire up the two-tier chain for every new or missing skill/agent in one pass.
3. Add an entry to the inventory in `CLAUDE.md` and `README.md`.

For agents, write `agents/<name>.md` in this repo and rerun `bash scripts/sync-symlinks.sh`.

Invoke the script with `bash` (or `./scripts/sync-symlinks.sh`), **not** `sh` — the script uses bash arrays and process substitution, which POSIX sh doesn't support.

The script is idempotent: it skips entries that are already linked correctly, repairs broken or wrong-target symlinks, and refuses to overwrite real files or directories. Pass `--dry-run` (or `-n`) to preview without applying.

### Edit an existing skill

Edit the file at `skills/<category>/<name>/SKILL.md` in this repo directly — never through the `~/.claude` or `~/.agents` symlinked path. Writes through symlinks resolve correctly but make it ambiguous which checkout the change lands in, which matters when multiple worktrees exist.

### Verify a skill is wired up

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<category>/<name>
readlink ~/.claude/agents/<name>.md  # → ~/.agents/agents/<name>.md   (agents only)
readlink ~/.agents/agents/<name>.md  # → <repo>/agents/<name>.md      (agents only)
```

All applicable hops must resolve. If any is missing, the harness will not see the skill or agent.

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
