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

Type markers (by primary entry point — all three are technically model-invocable via the `Skill()` tool when `disable-model-invocation: false`): `auto` = description aggressively auto-triggers on natural language; `/` = primary entry is the slash command, description does not auto-trigger; `Skill()` = primary entry is being called by another skill / workflow.

### `workflow/` — end-to-end orchestrators

- `autonomous-workflow` (`auto`) — phase-based feature delivery 0–7. Opt-in `aw` dispatcher detects tier (Micro/Lite/Full) and routes single-pass vs the planner→executor split (Full only). Two-tier self-improvement hoisted to the dispatcher (universal): fast episodic-lessons tier (`persistent-memory` `aw-lessons`) promotes to the gated `diagnose` slow tier at `seen_count ≥ 3`. Loop: [`rules/self-improvement-loop.md`](./skills/workflow/autonomous-workflow/rules/self-improvement-loop.md). Design intent: [`workflow/autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md)
- `aw-create-plan`, `aw-create-walkthrough`, `aw-review-quality-gate` (`Skill()`) — autonomous-workflow companions
- `batch-linear-tickets` (`/`) — batch-analyze Linear tickets by dispatching `linear-ticket-investigator` (plus `holistic-analysis` for bug tickets) per ticket, then fan out fixes; requires Linear MCP. Self-improvement: `batch-lessons` fast tier (read Phase 1 / write Phase 5) for classification + correlation; inherits `aw-lessons` via the planner/executor fan-out; promotes to `diagnose`
- `fix-bug` (`/`) — single-bug pipeline phases 0–8. Flags: `--analyse-only`, `--force-holistic`. Self-improvement: `fix-bug-lessons` fast tier (read Phase 0.5 / write Phase 5·7·8) for its diagnostic phases; inherits `aw-lessons` via `aw-executor`; promotes to `diagnose`
- `implement-suggestion` (`/`) — apply reviewer suggestions across PRs; per-comment `/critical` + `/confidence` validation. `--watch` loops the apply on a single PR (wait for new bot/human comments → apply → push, max 5 iterations) — the loop `create-pr` dispatches post-push. Rule: [`watch-mode.md`](./skills/workflow/implement-suggestion/rules/watch-mode.md). Self-improvement: `implement-suggestion-lessons` fast tier (read Phase 3 / write Phase 7 + watch re-flag) for its own classification, gate-calibration, and lane-selection decisions; standard-lane inherits `aw-lessons` via `aw-planner`; promotes to `diagnose`

### `quality/` — code, tests, plans, AI apps

- `ai-engineering` (`/`) — LLM/AI app review across 13 concerns (prompts, caching, RAG, agents, evals, safety, observability)
- `code-quality` (`auto`) — readability, complexity, maintainability. Four modes: `plan` (validate a plan), authoring (default), `review` (findings only), `simplify` (review-then-apply for end-of-feature cleanup — auto-applies Class M refactor recipes behind `confidence(code) ≥ 90 %` + scoped fast-check, with revert-on-failure). Class M/J taxonomy lives in [`refactor-recipes.md`](./skills/quality/code-quality/rules/refactor-recipes.md#recipe-class--mechanical-vs-judgment) and is guarded by L1 G7
- `confidence` (`auto`) — multi-signal confidence gate for `plan` / `code` / `analysis`; deterministic rule caps LLM score at 89%
- `critical` (`auto`) — adversarial pre-mortem with mandatory steelman alternative. Never iterates
- `polish` (`/`) — re-runnable pre-PR branch quality gate; thin orchestrator that composes the `reviewer` agent (auto-fix simple, plan complex) and `code-quality` simplify (apply Class M refactors). Modes: bare → full (review then simplify), `review`, `simplify`, `quick` (light mechanical pass). Commits each pass separately (`--no-commit` to skip). `/create-pr` delegates its pre-push step here — full pass by default; `--no-review` → simplify only, `--no-simplify` → reviewer only, `--quick` → light pass, `--no-quality` skips
- `dx` (`/`) — CLI / shell-script DX review
- `review-changes` (`/`) — dispatches to `reviewer` agent
- `tdd` (`auto`) — strict RED-GREEN-REFACTOR
- `test-provenance-guard` (`auto`) — detects tests-by-construction (static + mutation checks); self-heals by extracting inline logic

### `delivery/` — Git, PR, CI

- `changelog` (`/`) — personal PR + Linear ticket digest. Template: [`delivery/changelog/templates/changelog.md`](./skills/delivery/changelog/templates/changelog.md)
- `ci-auto-fix` (`/`) — verdict-gated, confidence-gated CI diagnosis and fix; `flaky`/`unsure` escalate, `*-bug` verdicts continue to a ≥90/80–89/<80 gate; regressing pushes auto-revert. Self-improvement: `ci-auto-fix-lessons` fast tier (read Phase 3 / write Phase 8·9) for verdict + regression calibration — **more conservative** than the other loops (verdict lessons default to `project-shared`, `seen_count ≥ 5` promotion bar; regression lessons `volatile` + 30-day expiry); a lesson can never authorize a check-weakening or soft-refusal; promotes to `diagnose`
- `create-pr` (`/`) — narrative PR description; watch CI. Pre-push quality delegated to `polish`, **full (review + simplify) by default**; scale down with `--no-review` (simplify only), `--no-simplify` (reviewer only), `--quick` (light mechanical pass), or `--no-quality` (skip). Post-push reviewer-feedback loop is **default-on**: backgrounds `/implement-suggestion <pr> --watch` until bots go quiet (`--no-feedback` to skip). Other flags: `--split`. Legacy `--review` / `--simplify` still accepted as single-pass scoping aliases
- `github-actions-author` (`/`) — author / review GHA workflows (2026 best practices)
- `resolve-conflicts` (`/`) — analyze and resolve merge / rebase conflicts

### `testing/` — E2E and fixture tooling

- `e2e-testing` (`/`) — spec-first Playwright Test Agents loop; locator ladder; `data-testid` source diffs; 3-attempt heal cap
- `e2e-testing-mobile` (`/`) — Maestro YAML flows for Expo / React Native; `testID`-first locator ladder; runs on Maestro Cloud via EAS
- `e2e-pr-stabilizer` (`/`) — local-first stabilizer for Playwright E2E on one PR; Dash0 MCP spans (`git.pull_request_link`) as historical baseline, then iterates locally with `--trace=on` and the same OTel exporter. Validation is empirical, not predictive: every new locator must resolve against source (static grep) or the live app (`locator.count() ≥ 1`) before commit, and the fixed test must pass 3 consecutive local runs before the single push. CI watch ratifies. Refuses `.skip` / `.fixme` / `waitForTimeout`. Two modes: `stabilize` (default) and `optimize` (report-only, ranks slow-action wins by measured ms saved, no commits). Self-improvement: `e2e-pr-stabilizer-lessons` fast tier (read Phase 4 / write Phase 7, `stabilize` only) — `home` holds universal P1–P6 race-shape→fix mappings, `project-shared` holds app-specific locator robustness; **writes are gated on the Phase 7 telemetry ratification, not the local 3-pass streak**; promotes to `diagnose`
- `optimize-mock-data` (`/`) — JSON/JSONL fixture analyze / normalize / shrink
- `test-auto-fix` (`/`) — stack-agnostic test healer: bootstrap surface on first run, classify test-bug vs prod-bug, confidence-gate every fix, regression-detect after each batch; supports Vitest, Jest, Deno, Playwright, Pytest, Maestro, Storybook. Self-improvement: `test-auto-fix-lessons` fast tier (read Phase 2 / write Phase 6·7) keyed by `stack : failure-pattern : verdict-sub-class` — **complements** the per-repo surface file (config) rather than duplicating it; most value is within-project (binary/local feedback); promotes to `diagnose`

### `design/` — UI, visual, interaction

- `animations` (`auto`) — CSS-first animations; perceived performance; interaction-feedback brainstorming
- `charting` (`auto`) — pick chart type + library for web (React/Next.js) and mobile (Expo/RN)
- `storybook` (`auto`) — visual regression + Playground + interaction-test stories; opt-in OS-keychain auth profiles
- `ux` (`auto`) — UX, a11y, microcopy, dark-pattern review (WCAG 2.2, Apple HIG, Material Design 3). Hard rule: never recommends a dark pattern
- `visual-design` (`auto`) — brand-aware visual direction; style-direction taxonomy; defers WCAG math to `/ux`

### `analysis/` — investigate data, diagnose issues

- `holistic-analysis` (`auto`) — full entry-to-exit execution-path trace when incremental fixes aren't working. `review` mode validates a PR diff (intent-match + system-fit) for the reviewer agents; an optional `focus` input runs a **focused single-target deep trace** of one changed export's call graph (the per-finding escalation in [`holistic-review.md`](./agents/shared/rules/holistic-review.md))
- `playwright-trace-analyzer` (`/`) — analyze `trace.zip`; names the race behind a flake; confidence-gated
- `profile-optimizer` (`/`) — React DevTools / Chrome Performance trace analysis; ranked optimisation plan
- `rum-tracking` (`auto`) — product analytics and RUM event tracking; what to capture, what's PII, OTel semantic conventions
- `screen-recorder` (`Skill()`) — record short cropped UI videos via Playwright + ffmpeg; called by `animations`, `ux`, `storybook`, and the `pr-reviewer` agent on motion-heavy diffs
- `video-analyser` (`auto`) — analyze screen recordings for bugs; optional OCR + Whisper transcription

### `authoring/` — skills about Claude Code itself

- `create-skill` (`/`) — scaffold, review, upgrade, diagnose skills
- `docs` (`auto`) — author / audit `CLAUDE.md`, `AGENTS.md`, `README.md`, Diátaxis `docs/` trees
- `optimize-claude-md` (`/`) — audit `CLAUDE.md` for context bloat; refuses below 10k chars
- `persistent-memory` (`/`) — cross-conversation markdown memory store; tiered (home / project-local / project-shared). Also backs the fast-tier self-improvement loops for `autonomous-workflow`, `fix-bug`, `batch-linear-tickets`, `implement-suggestion`, `ci-auto-fix`, `e2e-pr-stabilizer`, `test-auto-fix`, and `reviewer`. Each loop uses **two tiers together**: `home` at `~/.agent-memory/<scope>/` for universal lessons that follow the user across every repo, plus opt-in `project-shared` at `<cwd-repo>/memory/<scope>/` (committed, team-scoped) for repo-bound lessons — the workflow classifies each candidate at write time and project-shared writes are gated on the team having created the directory once. Scopes: `aw-lessons`, `aw-tester-lessons`, `fix-bug-lessons`, `batch-lessons`, `reviewer-lessons`, `implement-suggestion-lessons`, `ci-auto-fix-lessons`, `e2e-pr-stabilizer-lessons`, `test-auto-fix-lessons`.

### Agents

The `aw` dispatcher and its two specialist agents are the flagship of this repo (see [`autonomous-workflow`](#workflow--end-to-end-orchestrators)).
They are **generated from templates**, not stored as `agents/*.md`, so searching `agents/` for them returns nothing — search `skills/workflow/autonomous-workflow/templates/` instead (each template's filename matches its installed agent name):

- `aw` — opt-in dispatcher: reads `aw-lessons`, detects tier (Micro/Lite/Full), routes single-pass vs the planner→executor split. Source: [`templates/aw.agent.md`](./skills/workflow/autonomous-workflow/templates/aw.agent.md), installed by `install.sh` as `~/.claude/agents/aw.md`
- `aw-planner` — Full tier, phases 0–2 (validate, plan, worktree + `plan.md`), gated on `confidence(plan) ≥ 90%`. Source: [`templates/aw-planner.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-planner.agent.md), installed as `aw-planner.md`
- `aw-executor` — Full tier, phases 3–7 (implement, test, docs, PR, CI). Source: [`templates/aw-executor.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md), installed as `aw-executor.md`

The agents below live as `agents/*.md` files and are dispatched by skills:

- `reviewer` — own-work code reviewer (own branch or own PR). Three sub-modes: Fix (auto-fix simple + plan complex), Report (`--report`, propose only), Self-Review (own PR, auto-fix + inline terminal report). Never writes to GitHub — redirects to `pr-reviewer` on a cross-author PR. Imports shared rules under `agents/shared/rules/` including four new gap-closing rules: `verification-receipt.md` (Step 2.6b — executed proof for behavioral claims; null = DROP), `outcome-learning.md` (resolution-rate feedback loop measuring 👎 reactions, author replies, and commit-based resolution), `review-config.md` (`.review.yaml` profile / filters / path-instructions; hierarchical discovery; absent → `profile: balanced` = today's defaults), and `prior-comment-awareness.md` (Self-Review: dedup against prior bot comments + anti-flip-flop on resolved suggestions)
- `pr-reviewer` — cross-review reviewer for someone else's PR. Authors short, grounded, confidence-gated inline comments and (with `--publish` or an explicit authorization phrase) posts them as a PENDING review invisible to the author until you submit from the GitHub UI. Refuses on your own PR (points to `reviewer`). Imports shared rules under `agents/shared/rules/`; owns auth gate + posting mechanics + line validity under `agents/pr-reviewer/rules/`. Two-tier holistic review: a broad whole-PR pass (Step 2.4) plus default-on **targeted escalation** (Step 2.4b) that fans out parallel, single-target holistic traces on context-dependent findings (changed exports whose correctness depends on caller context); cap 10, `--no-escalate` to skip. Also imports the four new shared rules above: `verification-receipt.md` (2.6b), `outcome-learning.md` (post-merge via `/review-outcomes`), `review-config.md` (1.7 config load), and `prior-comment-awareness.md` (default-on prior-comment dedup + anti-flip-flop)
- `linear-ticket-investigator` — reads a Linear ticket, returns Evidence Record for `/fix-bug` Phase 2. No analysis / fix / confidence (those live in `/fix-bug`)
- `rca-investigator` — context-isolated root-cause analysis. Wraps `holistic-analysis` (`fix`) + `confidence` (`analysis`) in a fresh sub-agent context and returns only a distilled Root-Cause Record (cause, causal chain, evidence, ruled-out alternatives, confidence, fix direction) — the verbose 8-phase walkthrough never reaches the caller. Read-only; single source of truth for the RCA protocol stays in `holistic-analysis`. Dispatch via `Task()` from `/fix-bug` Phase 3 (isolation alternative to the in-context `Skill("holistic-analysis","fix")`) or `/batch-linear-tickets` fan-out
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

Skill-local installers: if a skill ships `skills/<category>/<name>/install.sh`, `sync-symlinks.sh` discovers it and runs `bash <path> --development --quiet` after the main symlink pass. The installer must accept both flags, be idempotent, and write errors to stderr. See `skills/workflow/autonomous-workflow/install.sh` for the reference implementation.

Naming files a skill installs by symlink: when a skill's `install.sh` symlinks a file *verbatim* into `~/.claude/agents/` or `~/.claude/rules/` (as `autonomous-workflow` does from its `templates/` directory), name the source after what it *is* — `<agent-name>.agent.md` for an agent (e.g. `aw.agent.md` → installed as `aw.md`) and `<name>.rule.md` for a rule (e.g. `routing.rule.md`) — not `*.template.md`. These are definitions, not fill-in templates (no substitution happens), and the `<name>.agent.md` form lets a repo search for the agent name land directly on the file. Reserve `*.template.md` / plain `templates/*.md` for boilerplate a skill *emits or fills in* at runtime (e.g. `aw-create-plan`'s `plan.md`).

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

## Evals

Regression evals for the skills live in [`scripts/eval/`](./scripts/eval/README.md), in two layers:

- **L1 — deterministic contract checks** (`node scripts/eval/l1.mjs`): no LLM, no cost, gated in CI ([`.github/workflows/evals-l1.yml`](./.github/workflows/evals-l1.yml)) on every PR. Asserts link/anchor integrity (baseline-ratcheted), the `aw` tier table ≡ `SKILL.md` Step 1, the `plan.md` Core-section contract (runs the actual `confidence` rule #2/#3 idioms — incl. the #31 regression), `diagnose` skill resolvability, lesson-scope storage, frontmatter sanity, and cross-file contract guards (the `seen_count` UPDATE sentence shared verbatim across its three owners, fast-lane plan ⊇ Core-8 sections, `/critical`'s Must-fix bucket in `implement-suggestion`, the real `confidence(code)` contract in the per-comment gate, and a forbidden-phrase list for audited contradictions).
- **L2 — behavioral evals** (`ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs`): data-driven runner, one suite per labelled decision — `tier-routing`, `bug-class`, `complexity-triage`, `aw-should-trigger` (golden sets in `scripts/eval/golden/`). Each reads the skill's live rubric section and exact-matches the model's choice. In CI via [`.github/workflows/evals-l2.yml`](./.github/workflows/evals-l2.yml) — runs on rubric/golden changes + manual dispatch, needs an `ANTHROPIC_API_KEY` repo secret, soft-gates per suite at a 70% catastrophic floor (golden sets < 50 ⇒ report-only-ish per `evals.md`). Skips cleanly without a key. Add a suite: golden JSONL + a `SUITES` entry in `l2.mjs`.

When a lesson is promoted via `diagnose`, add a golden case so the fix is locked. Methodology: [`ai-engineering/rules/evals.md`](./skills/quality/ai-engineering/rules/evals.md).

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
