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
- `autonomous-workflow` — Phase-based orchestrator (0–7) for end-to-end feature development. **Installs two agents** under the `aw-` namespace (`aw-` = "autonomous-workflow"): `aw-planner` for phases 0–2, `aw-executor` for phases 3–7, connected by `plan.md`. Diagnosable via `/create-skill diagnose autonomous-workflow` — the retrospective self-improvement loop is owned by `create-skill` and reads this skill's [diagnostic surface](./skills/autonomous-workflow/rules/diagnostic-surface.md) (phase model, F1 + `F-novel` failure taxonomy, existing-guards-per-phase table, hard invariants) to emit a confidence-gated unified diff. See [`skills/autonomous-workflow/CLAUDE.md`](./skills/autonomous-workflow/CLAUDE.md) for design intent before editing
- `confidence` — Confidence assessment for plans, code, and bug analysis. **Plan mode is multi-signal** (LLM dimensional scoring + deterministic rule checks; a failed rule caps the gate at 89% regardless of LLM score)
- `critical` — Adversarial pre-mortem reviewer. Walks a fixed taxonomy (hidden assumptions, top-3 failure modes, blast radius, rollback, hidden coupling, maintainability, scope creep, test-assertion strength) and requires a mandatory **steelman alternative** for the proposed approach. Every finding must cite a file/line or a named assumption — vague findings are dropped. **Single-pass by design** (naïve self-refine amplifies bias per Pride and Prejudice, ACL 2024; SELF-[IN]CORRECT, AAAI). Does not score (delegates to `confidence`) and does not apply fixes. Three modes: `plan` (default — pre-execution gate), `code` (pre-PR, invoked by `reviewer --critical` on high-stakes diffs), `bug-analysis` (mid-investigation, before the gate)
- `holistic-analysis` — Full execution path analysis for stuck bugs/refactors
- `tdd` — Test-Driven Development with strict RED-GREEN-REFACTOR cycles
- `test-provenance-guard` — Detects tests that pass by construction (private copy of the SUT instead of an import) via static + mutation checks; self-heals by extracting inline logic, rewiring callers, and rewriting the test. Runs autonomously inside `autonomous-workflow` Phase 4
- `ux` — UX design review for web and React Native apps
- `screen-recorder` — Records short videos of specific page sections via Playwright's `recordVideo` API, plays scripted interactions (hover, click, focus, scroll, keypress, drag, multi-step), captures a bounding box via `locator.boundingBox()`, crops the result with `ffmpeg` to the target element (with a configurable 16 px padding), optionally transcodes to `.mp4` (for inline GitHub PR previews) or `.gif` (under strict 4 s / 400×400 budget), and writes the artifact to `.agent/recordings/`. Headless Chromium only — headed mode bleeds OS window chrome into the clip; WebKit and Firefox re-encode `transform` / `filter` differently and are non-portable as evidence. Phase 0 preflight halts and asks before installing Playwright, the Chromium driver, or `ffmpeg`. Hooks into three callers via `Skill("screen-recorder")`: the [`animations`](./skills/animations/SKILL.md) skill calls it twice per non-trivial animation (default + `prefers-reduced-motion`), the [`ux`](./skills/ux/SKILL.md) skill calls it for Critical / High findings about timing, motion, focus order, or hover-revealed information, and the [`reviewer`](./agents/reviewer.md) agent calls it in PR Mode when the diff matches a motion-relevant regex (`@keyframes`, `transition:`, `animation:`, `motion/react`, `startViewTransition`, `@starting-style`, `scroll-timeline`, `view-timeline`, Rive / Lottie imports) and the PR author has not already attached a recording. Rejects brittle structural selectors (`div > div:nth-child(3)`, raw `xpath=...`) up front — `data-testid` and role-based locators only. Never runs arbitrary user-supplied JS as the interaction; restricted to a fixed recipe catalog (`idle`, `hover`, `click`, `focus`, `tab-to`, `scroll-into-view`, `scroll-page`, `press`, `type`, `drag-to`, `navigate`, `multi`). All `multi` actions are allowlisted. Live-URL consent gate before recording anything that is not `localhost:*`

### Workflow companions (`disable-model-invocation: true`, called by orchestrators via `Skill()`)
- `aw-create-plan` — Generates `.agent/{branch}/plan.md` for autonomous-workflow Full Mode
- `aw-create-walkthrough` — Generates `.agent/{branch}/walkthrough.md` for autonomous-workflow PR delivery
- `aw-review-quality-gate` — Self-check quality gate for review findings before delivery

### Slash commands (`disable-model-invocation: true`)
- `animations` — CSS-first web-animation slash command. Decision flow CSS → WAAPI → Motion → R3F. Covers GPU-safe properties (`transform`, `opacity`, `filter`), `will-change` discipline, CSS variable / `@property` interactive effects (cursor spotlight, magnetic buttons), modern entry / exit primitives (`@starting-style`, `transition-behavior: allow-discrete`, `interpolate-size`), View Transitions, scroll-driven timelines, state-choreography morphs (list ↔ stacked cards, full ↔ icon-only nav, grid ↔ detail) with a **mandatory pre-code planning checklist** and a dedicated accessibility section, React state patterns for driving them (`useMotionValue`, `AnimatePresence`, Server Components), advanced effects (Apple Liquid Glass, animated glow via pseudo-element + opacity, hover-to-expand, aurora gradient mesh, 3D pointer tilt), external engines (Lottie / dotLottie and Rive — when designer-authored playback or interactive assets beat code), React Three Fiber + Drei for 3D / WebGL scenes, and `prefers-reduced-motion` compliance throughout. Deliberately drops GSAP and `framer-motion` from its decision flow — both are superseded by **Motion** ([motion.dev](https://motion.dev), npm `motion`, import path `motion/react`, hybrid WAAPI + JS engine)
- `ai-engineering` — Reviews and guides LLM/AI application engineering across thirteen concerns: prompt writing, system-prompt design, prompt caching and token cost, multimodal inputs (vision/audio/PDFs), RAG (chunking, hybrid search, reranking), agent loops and tool design, resilience (rate limits, retries with jitter, circuit breakers, fallback chains, idempotency), memory and long-running state (summarisation, structured/vector memory, compaction survival), model migration and version pinning (snapshot vs alias, A/B rollout, deprecation, rollback), evals (golden sets, LLM-as-judge bias mitigations), testing (mocks, VCR, snapshots, CI cost discipline), safety and prompt-injection defence (OWASP LLM01:2025), and observability/prompt-versioning. The observability rule **invokes the dash0 `/otel-instrumentation` and `/otel-semantic-conventions` skills via `Skill()`** for OTEL wiring and `gen_ai.*` semconv validation. Three modes: `guide` (default), `review` (audit existing AI code), `design` (scaffold prompts/system prompts/tool descriptions/eval rubrics/golden sets). Sources: Anthropic, OpenAI, Google docs; OWASP; Hamel Husain, Eugene Yan, Chip Huyen
- `batch-linear-tickets` — Thin batching wrapper around `/fix-bug`. Fans out `/fix-bug --analyse-only` per ticket (each call invokes `linear-ticket-investigator` for evidence + `holistic-analysis` for root cause + `confidence(bug-analysis)` for the gate), correlates findings across tickets, gates user approval, then fans out `aw-planner` + `aw-executor` for approved tickets using the pre-computed analyses (no re-running `/fix-bug`). Posts PR links back to each Linear ticket. Requires Linear MCP
- `charting` — Selects the right chart type and visualization library for React/Next.js (web) and Expo/React Native (mobile) tasks. Maps intent (comparison, composition, distribution, relationship, evolution, flow, geographic, hierarchical) → chart → library based on platform, dataset size, and design system. Defers cross-cutting visual-design and microcopy concerns to the `ux` skill instead of restating them
- `changelog` — Generates a personal markdown changelog of merged or closed pull requests authored by the current user and Linear tickets they closed or worked on, over a configurable window (default 7 days), grouped by feature area. Sources from `gh search prs --author=@me` (cross-repo) and the Linear MCP. Output renders against an editable template at [`skills/changelog/templates/changelog.md`](./skills/changelog/templates/changelog.md). Slash-only
- `ci-auto-fix` — Diagnose and fix a failed CI check, iteratively pushing fixes until CI is green (currently GitHub Actions via `gh`)
- `code-quality` — Code-quality review for readability, complexity, and maintainability
- `create-pr` — Generate a narrative PR description, push, then watch CI and auto-fix simple failures (lint, format, lockfiles); escalates judgment-required failures via `/confidence`
- `create-skill` — Scaffold, review, upgrade, or diagnose agent skills (SKILL.md + rules/ + references/ + templates/) against best-practice frontmatter, progressive disclosure, token-aware structure, and the agent-skills.git symlink + inventory wiring. Modes: `scaffold` (default), `review`, `upgrade`, `diagnose`. **`diagnose <target-skill>` is the retrospective self-improvement entry point for any skill** in the repo: classifies a failed run against the target's declared diagnostic surface (phase model, failure taxonomy, existing-guards table, hard invariants — declared by each consumer in its own `rules/diagnostic-surface.md`), walks the phase-attribution matrix, runs `confidence(bug-analysis) ≥ 90 %` as a hard gate, and emits an applyable unified diff against the target skill's source (`--apply` to apply locally, `--pr` to share upstream). Consumers today: `autonomous-workflow` and `fix-bug` (each declares its own `rules/diagnostic-surface.md`); the contract is reusable for `batch-linear-tickets` and any future skill that declares a surface
- `dx` — Developer Experience review for CLI tools and shell scripts
- `e2e-testing` — Spec-first E2E loop on top of Playwright Test Agents (Planner / Generator / Healer, v1.56) and `@playwright/mcp`. Phase 0 preflight halts and asks before installing Playwright or running `init-agents`. Enforces the locator ladder (role → label → `data-testid`), proposes `data-testid` as a source diff (never a brittle CSS selector), runs in snapshot mode by default, and caps the heal loop at three attempts before escalating via `confidence(bug-analysis)`
- `e2e-testing-mobile` — Mobile counterpart to `e2e-testing`. Drives a spec-first Maestro YAML-flow loop for Expo / React Native apps, halts Phase 0 to ask before installing Maestro CLI / EAS or scaffolding `.maestro/`, enforces a `testID`-first locator ladder (with a hard rule that `accessibilityLabel` must NOT double as a test selector), proposes `testID` source diffs via the `setTestId` helper, runs on Maestro Cloud as an EAS Workflow `maestro-cloud` job, and caps the heal loop at three attempts. Composes with `e2e-testing` for hybrid apps (Maestro for native chrome, Playwright for the WebView)
- `github-actions-author` — Authors fast, cheap, maintainable GitHub Actions workflows applying 2026 best practices: `hashFiles`+`restore-keys` caching, parallel jobs and matrices with build-once-fan-out artifacts, composite actions for shared steps and reusable workflows (`workflow_call`) for shared jobs, SHA-pinned third-party actions with least-privilege `GITHUB_TOKEN`, scoped triggers + `concurrency` (PR cancel-in-progress, deploy not), and trackable errors (named steps, GitHub-format annotations, `$GITHUB_STEP_SUMMARY`). Two modes: `scaffold` (default) generates workflow YAML; `review` audits an existing `.github/workflows/*.yml` with PASS/WARN/FAIL evidence and a top-3 fixes list. Complements `/ci-auto-fix` (which fixes failing runs) by authoring sound workflows up front
- `fix-bug` — Single-bug counterpart to `batch-linear-tickets`. v2.1 ships an intake → **complexity triage** → evidence → preflight → reproduction-lock → analyse → gate → **lane-split handoff** → independent-verify → telemetry-verify pipeline (10 phases, one cross-cutting bug-notes ledger). Takes any starting evidence (Dash0 span / log / web event URL with UTC timezone compensation, raw stack trace, error message, code pointer `file:line`, Linear ticket URL via `linear-ticket-investigator`, screen recording via `/video-analyser`, free-text symptom). Phase 0 infers a `bugClass` (null-deref, race, off-by-one, contract-mismatch, perf, config, regression, logic). **Phase 0.5 runs complexity triage on a 14-row signal table** to pick `simple` (lightweight in-skill analysis + fast handoff lane) or `complex` (canonical holistic-analysis + standard lane). Conservative default is `complex` — when in doubt, run the slower lane. Phase 1.5 runs cheap pre-flight probes (recent commits, lockfile/env diff, last-known-green deploy SHA) which may upgrade triage `complex` → `simple` if the single-commit short-circuit fires. Phase 2.5 locks a failing reproduction by **delegating to `/tdd`** (unit/component/hook/integration), `/e2e-testing` (web flow), or `/e2e-testing-mobile` (Expo / React Native flow) — picks the lowest layer that captures the bug. Best-effort repros block the fast-lane. Phase 2c runs `git bisect run` if pre-flight identified a regression window. Phase 3 delegates root-cause to `holistic-analysis` (complex path) or runs a lightweight in-skill analysis (simple path); both emit a falsifiable root-cause paragraph. Phase 4 gates on `confidence(bug-analysis)`. **At ≥ 92 % Phase 6 dispatches without human confirmation**: fast-lane (simple + ≥ 92 % + non-best-effort repro) routes `/fix-bug` → `Skill("aw-create-plan", ...)` → `aw-executor` and bypasses aw-planner; standard-lane (complex / downgrade / force-proceed) routes `aw-planner` → `aw-executor`. Both carry the CEGIS refinement contract (run repro → on failure capture counterexample → refine, cap 3 rounds); fast-lane round-3 failure falls back to standard-lane via aw-planner with the captured counterexamples — single-shot safety net for "triage classified simple but the bug wasn't." Phase 7 spawns `bug-fix-verifier` in fresh context to grade the PR (FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity); identical for both lanes; only the verifier may undraft. Phase 8 (telemetry inputs only) polls the originating Dash0 query post-deploy filtered by release tag. Pass `--analyse-only` to stop after Phase 5 regardless of confidence (the primitive `/batch-linear-tickets` calls per ticket); `--force-holistic` skips the fast lane and always treats the bug as `complex`. Diagnosable via `/create-skill diagnose fix-bug` — phase model (now Phase 0–8 plus Phase 0.5 triage and Phase 6 lane split), F-novel-seeded failure taxonomy, existing-guards table, and hard invariants (only the verifier may undraft; verifier runs in fresh context; bug-notes ledger is append-only; three independent confidence gates **on both lanes**; fast-lane requires ≥ 92 % + non-best-effort repro; fast-lane round-3 fallback is single-shot; no force-proceed under 70 %; CEGIS capped at 3 rounds; telemetry bugs not done until Phase 8 closes the signal) declared in [`skills/fix-bug/rules/diagnostic-surface.md`](./skills/fix-bug/rules/diagnostic-surface.md). All sources at [`skills/fix-bug/references/research-sources.md`](./skills/fix-bug/references/research-sources.md)
- `implement-suggestion` — Implement fixes from review comments
- `init-claude` — Initialize Claude Code configuration for a project. Routes content by tier: hard rules and decision tables to `CLAUDE.md` (auto-loaded hot path) and `.claude/rules/` (path-scoped); narrative, rationale, and onboarding to a `docs/` tree (root + nested for monorepos) that humans also benefit from. CLAUDE.md `@imports` give the agent a fallback path into `docs/`
- `profile-optimizer` — Analyse React DevTools Profiler exports or Chrome Performance traces; auto-detects the format, extracts hotspots, maps them to source, and emits a ranked optimisation plan. Confidence-gated via `confidence(bug-analysis)` — iterates if root-cause certainty is below 90%
- `playwright-trace-analyzer` — Analyse Playwright `trace.zip` files; accepts a GitHub Actions run URL and uses `gh run download` to fetch artifacts, then extracts the action timeline, network waterfall, and console errors. Names the race behind a flake and emits a ranked fix plan. Confidence-gated via `confidence(bug-analysis)`
- `resolve-conflicts` — Analyze and resolve Git merge/rebase conflicts
- `review-changes` — Review branch changes or PR (dispatches to reviewer)
- `storybook` — Scaffolds and tests Storybook stories for React (web) and React Native / Expo. Per invocation, emits three artefacts: a visual regression `*.stories.tsx` with all variants grouped into a single render tree (one snapshot per file under Chromatic / Loki), a `Playground` story whose `args` / `argTypes` mirror the component's prop types, and an interaction test `*.test.stories.tsx` under a `/Tests` namespace with `tags: ["test"]`, `chromatic.disableSnapshot`, awaited `userEvent` / `expect`, and the locator ladder `getByRole` → `getByLabelText` → `getByText` → `getByTestId`. Phase 0 preflight detects platform (`@storybook/react-vite`, `@storybook/nextjs(-vite)`, `@storybook/react-native(-web)`) and halts and asks if Storybook is not installed. Opt-in **auth flow** with multiple per-pathname profiles (URL globs → profile selection) — config schema lives in `.agent/storybook/auth.config.json` (safe to commit; selectors + account + keychain service name only), secrets live in the **OS keychain** (macOS `security`, Linux `secret-tool`, Windows Credential Manager) keyed by `agent-skills.storybook.<repo-slug>.<profile>`, and `storageState.json` is cached under gitignored `.agent/storybook/.auth/` for fast reuse. Sub-commands `auth list / add / remove / test`. Iteration loop runs the **Playwright CLI** directly against the running Storybook URL (`/iframe.html?id=...`) capped at five rounds before escalation via `confidence(bug-analysis)`. Visual evidence is delegated — not duplicated — to the [`reviewer`](./agents/reviewer.md) agent (PR Mode screenshots) and the [`screen-recorder`](./skills/screen-recorder/SKILL.md) skill (multi-frame interactions). Refuses brittle anti-patterns (interaction tests in `.interactions.stories.tsx`, `accessibilityLabel` doubled as a native selector, credentials in `.env`, headed Playwright in CI)
- `update-claude` — Update `CLAUDE.md`, `.claude/rules/`, **and `docs/`** based on code changes. Detects drift across all three tiers (dead `@imports`, stale narrative, hot-path leakage), and routes new updates by content kind — rules to the hot path, rationale and narrative to `docs/`
- `video-analyser` — Analyse a screen recording for bugs: resolves input from a Linear ticket URL, local path, or direct URL; extracts keyframes with ffmpeg; runs optional Tesseract OCR and Whisper transcription; returns structured findings (errors, UI state, repro steps)

### Agents
- `reviewer` — Constructive code reviewer with auto-fix, report, and PR comment modes
- `linear-ticket-investigator` — Linear-specific evidence collector. Reads a single ticket via Linear MCP, searches the codebase, returns an Evidence Record matching `/fix-bug` Phase 2 schema. No analysis / no fix proposal / no confidence (those live in `/fix-bug` via `holistic-analysis` + `confidence`). Invoked transitively by `/fix-bug`'s Linear input route and by `/batch-linear-tickets`
- `bug-fix-verifier` — Independent fresh-context verifier for bug-fix PRs produced by `/fix-bug`. Receives only the Evidence Record, repro path/command, bug-notes ledger (read-only), and the PR diff — explicitly NOT the planner's `plan.md` or executor reasoning. Runs FAIL_TO_PASS (repro now passes), PASS_TO_PASS (existing tests still pass), diff sanity (no catch-all exception swallows, no debug statements, no test deletions or `.skip` / `.only`), and repro integrity (the repro itself wasn't weakened). Returns green / red. Only the verifier undrafts the PR. Used by `/fix-bug` Phase 7
- `feature-pr-verifier` — Feature-PR counterpart to `bug-fix-verifier`. Independent fresh-context verifier for feature PRs produced by `/autonomous-workflow` Full Mode. Receives only `plan.md` (Acceptance Criteria, Requirements, File Changes), `walkthrough.md`, the PR diff, and the project test command — explicitly NOT the planner's or executor's reasoning. Runs ACCEPTANCE_CRITERIA_MATCH (every criterion is verifiable from the diff or a passing test), PASS_TO_PASS (existing tests still pass), diff sanity (same anti-pattern set as bug-fix-verifier plus a file-list-mismatch check against `plan.md` `## File Changes`), and walkthrough integrity (the walkthrough describes what the diff actually does, with no claims about features absent from the diff and no hunks missing from the walkthrough). Returns green / red advisory verdict; the user undrafts the PR. Used by `/autonomous-workflow` Phase 7 Auto Verify (Full Mode only — Lite Mode has no `plan.md` to verify against)

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
