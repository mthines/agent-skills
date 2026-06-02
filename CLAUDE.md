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

- `animations` — CSS-first web-animation skill. Three modes: Brainstorm (interaction-feedback framework), Perceived-Performance (async-wait ladder + cheat-the-eye toolkit), and technical workflow (CSS → WAAPI → Motion → R3F). See [`skills/design/animations/SKILL.md`](./skills/design/animations/SKILL.md).
- `autonomous-workflow` — Phase-based orchestrator (0–7) for end-to-end feature development; installs `aw-planner` + `aw-executor` agents. See [`skills/workflow/autonomous-workflow/SKILL.md`](./skills/workflow/autonomous-workflow/SKILL.md) and [`skills/workflow/autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md) for design intent
- `charting` — Selects the right chart type and visualization library for React/Next.js (web) and Expo/React Native (mobile) tasks. Maps intent (comparison, composition, distribution, relationship, evolution, flow, geographic, hierarchical) → chart → library based on platform, dataset size, and design system. Defers cross-cutting visual-design and microcopy concerns to the `ux` skill instead of restating them
- `code-quality` — Code-quality review for readability, complexity, and maintainability
- `confidence` — Confidence assessment for plans, code, and analyses (root-cause, refactor rationale, `/create-skill diagnose` proposal). **Plan mode is multi-signal** (LLM dimensional scoring + deterministic rule checks; a failed rule caps the gate at 89% regardless of LLM score). `bug-analysis` is accepted as a deprecated alias for `analysis`
- `critical` — Adversarial pre-mortem reviewer with mandatory steelman alternative. Three modes: `plan` (default), `code`, `analysis`. See [`skills/quality/critical/SKILL.md`](./skills/quality/critical/SKILL.md).
- `documentation` — Authors, audits, and maintains `CLAUDE.md`, `AGENTS.md`, `README.md`, and Diátaxis `docs/` trees. Modes: `init`, `update` (default), `readme`, `audit`. Sub-modes `nested <dir>` and `pattern <glob>`. See [`skills/authoring/documentation/SKILL.md`](./skills/authoring/documentation/SKILL.md).
- `holistic-analysis` — Full execution path analysis for stuck bugs/refactors
- `rum-tracking` — Guides product analytics and RUM (Real User Monitoring) event tracking in web (React/Next.js) and mobile (React Native/Expo) apps. Decides what user interactions are valuable to capture, what's noise, what's PII to avoid, and how to implement, audit, update, and remove tracking code cleanly. Covers event naming, property schemas, tracking plans, GDPR/CCPA/DPDPA compliance, OpenTelemetry semantic conventions for browser and mobile RUM, and platforms (PostHog, Segment, Mixpanel, Amplitude, Datadog RUM, Sentry, OTel, Dash0). Modes: `guide` (default), `implement`, `audit`, `remove`, `plan`. See [`skills/analysis/rum-tracking/SKILL.md`](./skills/analysis/rum-tracking/SKILL.md).
- `storybook` — Scaffolds and tests Storybook stories for React (web) and React Native / Expo. Emits visual regression + Playground + interaction-test artefacts. Opt-in OS-keychain auth profiles. See [`skills/design/storybook/SKILL.md`](./skills/design/storybook/SKILL.md).
- `tdd` — Test-Driven Development with strict RED-GREEN-REFACTOR cycles
- `test-provenance-guard` — Detects tests that pass by construction (private copy of the SUT instead of an import) via static + mutation checks; self-heals by extracting inline logic, rewiring callers, and rewriting the test. Runs autonomously inside `autonomous-workflow` Phase 4
- `ux` — UX, accessibility, microcopy, and dark-pattern review for web and React Native apps (WCAG 2.2, Apple HIG, Material Design 3). Never recommends a dark pattern. See [`skills/design/ux/SKILL.md`](./skills/design/ux/SKILL.md).
- `video-analyser` — Analyse a screen recording for bugs: resolves input from a Linear ticket URL, local path, or direct URL; extracts keyframes with ffmpeg; runs optional Tesseract OCR and Whisper transcription; returns structured findings (errors, UI state, repro steps). See [`skills/analysis/video-analyser/SKILL.md`](./skills/analysis/video-analyser/SKILL.md).
- `visual-design` — Guides and reviews the visual design and brand identity of UI components for web and React Native — named style directions (minimal, swiss, editorial, brutalist, neo-brutalist, glass, soft-UI, terminal, playful, retro), color systems, typography pairing, visual hierarchy, signature details. Owns the generative, brand-aware side; defers WCAG contrast math, size minimums, and dark-mode mechanics back to `/ux`. Modes: `guide` (default), `review`, `direction`. See [`skills/design/visual-design/SKILL.md`](./skills/design/visual-design/SKILL.md).

### Workflow companions (`disable-model-invocation: true`, called by orchestrators via `Skill()`)

- `aw-create-plan` — Generates `.agent/{branch}/plan.md` for autonomous-workflow Full Mode
- `aw-create-walkthrough` — Generates `.agent/{branch}/walkthrough.md` for autonomous-workflow PR delivery
- `aw-review-quality-gate` — Self-check quality gate for review findings before delivery

### Slash commands (`disable-model-invocation: true`)

- `ai-engineering` — Reviews and guides LLM/AI application engineering across 13 concerns (prompts, caching, RAG, agents, resilience, memory, evals, safety, observability). Modes: `guide` (default), `review`, `design`. See [`skills/quality/ai-engineering/SKILL.md`](./skills/quality/ai-engineering/SKILL.md).
- `batch-linear-tickets` — Thin batching wrapper around `/fix-bug`. Fans out `/fix-bug --analyse-only` per ticket (each call invokes `linear-ticket-investigator` for evidence + `holistic-analysis` for root cause + `confidence(analysis)` for the gate), correlates findings across tickets, gates user approval, then fans out `aw-planner` + `aw-executor` for approved tickets using the pre-computed analyses (no re-running `/fix-bug`). Posts PR links back to each Linear ticket. Requires Linear MCP
- `changelog` — Generates a personal markdown changelog of merged or closed pull requests authored by the current user and Linear tickets they closed or worked on, over a configurable window (default 7 days), grouped by feature area. Sources from `gh search prs --author=@me` (cross-repo) and the Linear MCP. Output renders against an editable template at [`skills/delivery/changelog/templates/changelog.md`](./skills/delivery/changelog/templates/changelog.md). Slash-only
- `ci-auto-fix` — Diagnose and fix a failed CI check, iteratively pushing fixes until CI is green (currently GitHub Actions via `gh`)
- `create-pr` — Generates narrative PR descriptions, watches CI, auto-fixes simple failures. Flags: `--split` (multi-PR breakdown), `--review` (Claude GitHub App + auto-implement loop). See [`skills/delivery/create-pr/SKILL.md`](./skills/delivery/create-pr/SKILL.md).
- `create-skill` — Scaffold, review, upgrade, or diagnose agent skills. Modes: `scaffold` (default), `review`, `upgrade`, `diagnose <target>` (retrospective self-improvement entry point). See [`skills/authoring/create-skill/SKILL.md`](./skills/authoring/create-skill/SKILL.md).
- `dx` — Developer Experience review for CLI tools and shell scripts
- `e2e-testing` — Spec-first E2E loop on top of Playwright Test Agents (Planner / Generator / Healer, v1.56) and `@playwright/mcp`. Phase 0 preflight halts and asks before installing Playwright or running `init-agents`. Enforces the locator ladder (role → label → `data-testid`), proposes `data-testid` as a source diff (never a brittle CSS selector), runs in snapshot mode by default, and caps the heal loop at three attempts before escalating via `confidence(analysis)`
- `e2e-testing-mobile` — Mobile counterpart to `e2e-testing`. Drives a spec-first Maestro YAML-flow loop for Expo / React Native apps, halts Phase 0 to ask before installing Maestro CLI / EAS or scaffolding `.maestro/`, enforces a `testID`-first locator ladder (with a hard rule that `accessibilityLabel` must NOT double as a test selector), proposes `testID` source diffs via the `setTestId` helper, runs on Maestro Cloud as an EAS Workflow `maestro-cloud` job, and caps the heal loop at three attempts. Composes with `e2e-testing` for hybrid apps (Maestro for native chrome, Playwright for the WebView)
- `github-actions-author` — Authors and reviews fast, cheap, maintainable GitHub Actions workflows (2026 best practices). Modes: `scaffold` (default), `review`. See [`skills/delivery/github-actions-author/SKILL.md`](./skills/delivery/github-actions-author/SKILL.md).
- `fix-bug` — Single-bug pipeline (Phase 0–8): intake → triage → evidence → preflight → repro-lock → analyse → gate → lane-split handoff → verify → telemetry. Flags: `--analyse-only`, `--force-holistic`. See [`skills/workflow/fix-bug/SKILL.md`](./skills/workflow/fix-bug/SKILL.md).
- `implement-suggestion` — Implements reviewer suggestions across one or more PRs with fast-lane / standard-lane handoff and per-comment `/critical` + `/confidence` validation. Free-text mode also supported. See [`skills/workflow/implement-suggestion/SKILL.md`](./skills/workflow/implement-suggestion/SKILL.md).
- `optimize-claude-md` — Audits `CLAUDE.md` (root, nested, `.claude/rules/*.md`) for context bloat. Two levers: (1) `audit` / `trim` / `extract` modes shrink the file; (2) flags rarely-used agent-invokable skills that should become slash-only to drop their description from the always-on available-skills list. Refuses < 10k chars, never edits canonical `SKILL.md` frontmatter, shows before/after metrics. See [`skills/authoring/optimize-claude-md/SKILL.md`](./skills/authoring/optimize-claude-md/SKILL.md)
- `optimize-mock-data` — Optimizes JSON/JSONL fixture directories via shared-schema inference, drift detection, and safe shrink/normalize. Modes: `analyze` (default, read-only), `normalize`, `shrink`. See [`skills/testing/optimize-mock-data/SKILL.md`](./skills/testing/optimize-mock-data/SKILL.md).
- `persistent-memory` — Persists context across conversations as plain markdown, scoped per topic. Operations: `write`, `read`, `consolidate`, `forget`. Tiered storage (home / project-local / project-shared). See [`skills/authoring/persistent-memory/SKILL.md`](./skills/authoring/persistent-memory/SKILL.md).
- `profile-optimizer` — Analyse React DevTools Profiler exports or Chrome Performance traces; auto-detects the format, extracts hotspots, maps them to source, and emits a ranked optimisation plan. Confidence-gated via `confidence(analysis)` — iterates if root-cause certainty is below 90%
- `playwright-trace-analyzer` — Analyse Playwright `trace.zip` files; accepts a GitHub Actions run URL and uses `gh run download` to fetch artifacts, then extracts the action timeline, network waterfall, and console errors. Names the race behind a flake and emits a ranked fix plan. Confidence-gated via `confidence(analysis)`
- `resolve-conflicts` — Analyze and resolve Git merge/rebase conflicts
- `review-changes` — Review branch changes or PR (dispatches to reviewer)
- `screen-recorder` — Records short cropped videos of UI sections via Playwright + ffmpeg to validate multi-frame interactions. Called by `animations`, `ux`, `reviewer`. See [`skills/analysis/screen-recorder/SKILL.md`](./skills/analysis/screen-recorder/SKILL.md).

### Agents

- `reviewer` — Constructive code reviewer with auto-fix, report, and PR comment modes. Orthogonal `--with <skill>` flag loads up to 3 additional review lenses (`ai-engineering`, `animations`, `charting`, `dx`, `holistic-analysis`, `ux`). See [`agents/reviewer.md`](./agents/reviewer.md).
- `linear-ticket-investigator` — Linear-specific evidence collector. Reads a single ticket via Linear MCP, searches the codebase, returns an Evidence Record matching `/fix-bug` Phase 2 schema. No analysis / no fix proposal / no confidence (those live in `/fix-bug` via `holistic-analysis` + `confidence`). Invoked transitively by `/fix-bug`'s Linear input route and by `/batch-linear-tickets`
- `bug-fix-verifier` — Independent fresh-context verifier for bug-fix PRs produced by `/fix-bug`. Receives only the Evidence Record, repro path/command, bug-notes ledger (read-only), and the PR diff — explicitly NOT the planner's `plan.md` or executor reasoning. Runs FAIL_TO_PASS (repro now passes), PASS_TO_PASS (existing tests still pass), diff sanity (no catch-all exception swallows, no debug statements, no test deletions or `.skip` / `.only`), and repro integrity (the repro itself wasn't weakened). Returns green / red. Only the verifier undrafts the PR. Used by `/fix-bug` Phase 7
- `feature-pr-verifier` — Independent fresh-context verifier for feature PRs from `/autonomous-workflow` Full Mode. Runs acceptance-criteria match, pass-to-pass, diff sanity, walkthrough integrity. See [`agents/feature-pr-verifier.md`](./agents/feature-pr-verifier.md).

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

The author's machine has this repo wired into Claude Code via a two-tier symlink chain so every edit to `skills/<name>/SKILL.md` is picked up live on the next turn — no `npx skills add` reinstall.

```
~/.claude/skills/<name>     →  ~/.agents/skills/<name>     →  <this repo>/skills/<name>
~/.claude/agents/<name>.md  →  ~/.agents/agents/<name>.md  →  <this repo>/agents/<name>.md
```

The middle layer (`~/.agents/skills/`) is the cross-tool discovery directory used by Codex, Cursor, OpenCode, and other Agent Skills-compatible clients, so a single chain serves every tool.

### Add a new skill

1. Create `skills/<name>/SKILL.md` in this repo.
2. Run `scripts/sync-symlinks.sh` to wire up the two-tier chain for every new or missing skill/agent in one pass.
3. Add an entry to the inventory in `CLAUDE.md` and `README.md`.

For agents, write `agents/<name>.md` in this repo and rerun `scripts/sync-symlinks.sh`.

The sync script is idempotent: it skips entries that are already linked correctly, repairs broken or wrong-target symlinks, and refuses to overwrite real files or directories. Run with `--dry-run` (or `-n`) to preview without applying changes. Manual one-shot equivalents if you prefer:

```bash
ln -s "$REPO/skills/<name>" "$HOME/.agents/skills/<name>"
ln -s "$HOME/.agents/skills/<name>" "$HOME/.claude/skills/<name>"
ln -s "$REPO/agents/<name>.md" "$HOME/.agents/agents/<name>.md"
ln -s "$HOME/.agents/agents/<name>.md" "$HOME/.claude/agents/<name>.md"
```

### Edit an existing skill

Edit the file at `skills/<name>/SKILL.md` in this repo directly — never through the `~/.claude` or `~/.agents` symlinked path. Writes through symlinks resolve correctly but make it ambiguous which checkout the change lands in, which matters when multiple worktrees exist.

### Verify a skill is wired up

```bash
readlink ~/.claude/skills/<name>     # → ~/.agents/skills/<name>
readlink ~/.agents/skills/<name>     # → <repo>/skills/<name>
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
