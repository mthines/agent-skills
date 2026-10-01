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

## Where knowledge goes (mandatory on every change)

Every line in this file is loaded into every session, so this file holds only what an agent needs on every task.
Before writing anything about a change, classify it and write it only where the table says:

| What you learned | Write it to | Never write it to |
| --- | --- | --- |
| A new or changed skill / agent | a one-line hook (≤ 300 chars) in the inventory below, plus the skill's own `SKILL.md` | a paragraph here |
| A rule the agent must follow | the owning skill's `rules/<topic>.md` (cross-cutting: `agents/shared/rules/<topic>.md`) — the rule only, plus at most a one-line `**Why:**` | this file, `docs/inventory.md` |
| Why the rule or design exists, the alternative it beat, the failure it prevents | the owning skill's `references/<topic>.md` (cross-cutting: `agents/shared/references/<topic>.md`), stated as current fact, linked from the rule | `rules/`, this file |
| What changed, in which version or PR, measured run numbers | the commit message and PR description only | any file in the repo |
| An eval result | the PR description; `scripts/eval/README.md` only when it changes a standing decision, recorded as the decision, not the run log | this file, `docs/evals.md` |

`rules/` is what an agent loads to act, so it carries the rule and nothing else; `references/` is read only on demand, so rationale costs nothing until someone needs it.
Keep only what changes how an agent acts next time.
Drop a sentence when deleting it would not change any agent's behaviour: narrative ("this used to…", "the first version…"), release-version tags, and incident retellings fail that test.
[`docs/inventory.md`](./docs/inventory.md) and [`docs/evals.md`](./docs/evals.md) are **frozen archives** from before this rule — read them, never append to them; they are snapshots and are not kept current.

```markdown
<!-- ✗ Wrong — history in the root inventory -->
- `review-loop` (`Skill()`) — convergence loop … **`--merge` (vN.N):** merges the PR … a real run on #214 showed …

<!-- ✓ Right — a hook here; the rule in skills/quality/review-loop/rules/merge.md;
     why it exists in skills/quality/review-loop/references/merge-rationale.md -->
- `review-loop` (`Skill()`) — bounded PR convergence loop; `--merge` squash-merges on a clean convergence
```

L1 `G86` enforces the mechanical half: this file stays under 40,000 chars, its inventory hooks stay ≤ 300 chars, it carries no version tags, and the two archives do not grow.

## Repository Structure

Skills live in `skills/<category>/<name>/SKILL.md` across 7 categories.
Agents live in `agents/` since they need their own model and tool configuration.
Each skill's own `SKILL.md` is the operational authority; its rules live in `rules/`, their rationale in `references/`.
The archived annotated inventory (design history per entry, frozen) is [`docs/inventory.md`](./docs/inventory.md).

Type markers (by primary entry point — all three are technically model-invocable via the `Skill()` tool when `disable-model-invocation: false`): `auto` = description aggressively auto-triggers on natural language; `/` = primary entry is the slash command, description does not auto-trigger; `Skill()` = primary entry is being called by another skill / workflow.

### `workflow/` — end-to-end orchestrators

- `autonomous-workflow` (`/`) — phase machinery 0–7 behind the `aw` dispatcher; `aw` (`auto`) is the only natural-language entry point and owns tier detection (Micro/Lite/Full). Design intent: [`autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md)
- `aw-create-plan` (`Skill()`) — writes `plan.md` + `checks.yaml`. `aw-create-walkthrough` (`Skill()`) — writes `walkthrough.md`
- `fix-bug` (`/`) — single-bug pipeline, phases 0–8
- `implement-suggestion` (`/`) — apply reviewer suggestions across PRs; `--watch` loops one PR, `--resolve-all` closes non-fix threads. Never fixes CI

### `quality/` — code, tests, plans, AI apps

- `ai-engineering` (`/`) — LLM/AI app review across 13 concerns
- `code-quality` (`auto`) — readability, complexity, maintainability; modes `plan` / authoring / `review` / `simplify`
- `confidence` (`auto`) — multi-signal confidence gate for `plan` / `code` / `analysis`; deterministic rule caps the LLM score at 89%
- `eval-iterate` (`/`) — drives a failing AI/LLM eval to a confirmed green (two consecutive passes, 5-iteration cap)
- `severity` (`auto`) — severity/blast-radius tier (`critical`/`high`/`medium`/`low`) for a finding or bug; policy-free
- `critical` (`auto`) — adversarial pre-mortem with mandatory steelman alternative. Never iterates
- `measurable` (`auto`) — every delivery ships telemetry that proves impact and surfaces regressions; modes `guide` / `implement` / `audit` / `setup`
- `observe-run` (`Skill() + /`) — runs a command and grades the telemetry that run emitted against behavioral assertions only
- `optimize-approach` (`Skill()`) — approach-level optimality lens; modes `report` / `apply` / `plan`. Never blocks
- `polish` (`/`) — re-runnable pre-PR branch quality gate (review + simplify)
- `review-loop` (`Skill()`) — bounded PR convergence loop: `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, cap 5. Run at the top level of a session that holds a dispatch tool
- `dx` (`/`) — CLI / shell-script DX review
- `review-branch` (`/`) — PR-less sibling of `review-loop`; findings bus `.agent/{branch}/findings.jsonl`, zero GitHub calls
- `pr-review` (`/`) — one read-only `pr-reviewer` dispatch at one PR; `/pr-review remember <fact>` writes a maintainer relevance rule
- `tdd` (`auto`) — strict RED-GREEN-REFACTOR
- `test-provenance-guard` (`auto`) — detects tests-by-construction (static + mutation checks)
- `verify-behavior` (`Skill()`) — cheapest-first three-tier verification ladder; emits an evidence receipt, never a score
- `jev-assert` (`Skill()` + `/`) — semantic UI assertion via TypeSafe Jev; backs the `THEN semantic:` spec form

### `delivery/` — Git, PR, CI

- `changelog` (`/`) — personal PR + Linear ticket digest
- `ci-auto-fix` (`/`) — evidence-gated CI diagnosis and fix; never weakens checks
- `create-pr` (`/`) — narrative PR description; pre-push `review-branch`, draft PR, post-draft `review-loop`, CI watch
- `github-actions-author` (`/`) — author / review GHA workflows
- `resolve-conflicts` (`/`) — analyze and resolve merge / rebase conflicts

### `testing/` — E2E and fixture tooling

- `e2e-testing` (`/`) — spec-first Playwright Test Agents loop
- `e2e-testing-mobile` (`/`) — Maestro YAML flows for Expo / React Native
- `e2e-pr-stabilizer` (`/`) — local-first Playwright E2E stabilizer for one PR; modes `stabilize` / `optimize`
- `ui-verify` (`Skill()` + `/`) — UI verification spec embedded in the PR body (`<!-- ui-verify:v1 -->`); operations `author` / `run` / `verify` / `setup`; `run` then tries to break each passing spec (adversarial pass, screenshot evidence, never changes the verdict)

### `design/` — UI, visual, interaction

- `animations` (`auto`) — CSS-first web animations and perceived performance
- `animations-native` (`auto`) — React Native / Expo animations (Reanimated, gesture-handler)
- `charting` (`auto`) — chart type + library for web and mobile
- `storybook` (`auto`) — visual regression, Playground, and interaction-test stories
- `ux` (`auto`) — UX, a11y, microcopy, dark-pattern review. Never recommends a dark pattern
- `visual-design` (`auto`) — brand-aware visual direction

### `analysis/` — investigate data, diagnose issues

- `holistic-analysis` (`auto`) — full entry-to-exit execution-path trace; `review` mode feeds `pr-reviewer`
- `ideate` (`auto`) — research-grounded brainstorming; divergence runs lessons-blind
- `interview` (`auto`) — pre-plan scope-alignment interview; emits `.agent/{branch}/brief.md`
- `playwright-trace-analyzer` (`/`) — analyze `trace.zip`; names the race behind a flake
- `profile-optimizer` (`/`) — React DevTools / Chrome Performance trace analysis
- `rum-tracking` (`auto`) — product analytics and RUM event tracking
- `screen-recorder` (`Skill()`) — short cropped UI videos via Playwright + ffmpeg
- `video-analyser` (`auto`) — analyze screen recordings for bugs

### `authoring/` — skills about Claude Code itself

- `create-skill` (`/`) — scaffold, review, upgrade, diagnose skills
- `docs` (`auto`) — author / audit `CLAUDE.md`, `AGENTS.md`, `README.md`, Diátaxis `docs/` trees
- `optimize-claude-md` (`/`) — audit `CLAUDE.md` for context bloat
- `persistent-memory` (`/`) — cross-conversation markdown memory store. Self-improvement loops run on LoreKit instead; bucket taxonomy: [`memory-buckets.md`](./agents/shared/rules/memory-buckets.md)
- `handoff` (`/`) — copy-pasteable session handoff for a fresh agent

### Agents

**`aw` is a skill, not an agent** — [`aw/SKILL.md`](./skills/workflow/autonomous-workflow/aw/SKILL.md), invoked `/aw`.
The agents it hands off to are **generated from templates** in `skills/workflow/autonomous-workflow/templates/`, not stored in `agents/`:

- `aw-planner` — Full tier, phases 0–2, gated on `confidence(plan) ≥ 90%`. Source: [`aw-planner.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-planner.agent.md)
- `aw-executor` — Full tier, phases 3–7. Source: [`aw-executor.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md)
- `aw-tester` — Phase 4 spec-driven UI verification. Source: [`aw-tester.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-tester.agent.md)

The agents below live as `agents/*.md` files and are dispatched by skills:

- `pr-reviewer` — PR reviewer for self and cross relations; read-only; one sticky report comment plus append-only inline findings
- `branch-reviewer` — PR-less reviewer for `/review-branch`; writes `.agent/{branch}/findings.jsonl`, zero GitHub calls
- `linear-ticket-investigator` — Linear ticket → Evidence Record for `/fix-bug` Phase 2
- `rca-investigator` — context-isolated root-cause analysis; returns a distilled Root-Cause Record
- `bug-fix-verifier` — independent verifier for `/fix-bug` PRs. Only agent allowed to undraft
- `feature-pr-verifier` — independent verifier for `/autonomous-workflow` Full Mode PRs

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
Each emitted event includes `schemaVersion: 1`.
The extension rejects events with a known `schemaVersion` that is not `1`; missing `schemaVersion` is accepted for backwards compatibility.
Sentinel file at `${CLAUDE_PLUGIN_DATA}/sentinel` controls activation.
Validate with `claude plugin validate plugins/agent-tasks-hooks`.

### Plugin: pr-reviewer-shape-guard

`plugins/pr-reviewer-shape-guard/` — reusable GitHub Actions workflow that validates a **posted** `pr-reviewer` body against the report shape contract, from outside the agent.
Logic: `scripts/validate-report-shape.mjs`.
Guarded by L1 `G26`.
Details: [`docs/inventory.md`](./docs/inventory.md#plugin-pr-reviewer-shape-guard).

### Plugin: pr-relevance-memory

`plugins/pr-relevance-memory/` — caller template that wires PR comment-resolution signals into the `reviewer-comment-relevance` LoreKit bucket via `.github/workflows/reviewer-comment-relevance.yml`.
Requires the `LOREKIT_API_KEY` secret.
See [`plugins/pr-relevance-memory/README.md`](./plugins/pr-relevance-memory/README.md).

### VS Code extension internals

Key source files, workspace files, the click-open model, the Sessions status model, and PR linkage: [`packages/vscode-agent-tasks/CLAUDE.md`](./packages/vscode-agent-tasks/CLAUDE.md).

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
3. Add a one-line hook (≤ 300 chars) to the inventory in `CLAUDE.md` and an entry to `README.md`.
   Rules go in the skill's `rules/`, their rationale in its `references/` — see [Where knowledge goes](#where-knowledge-goes-mandatory-on-every-change).

For agents, write `agents/<name>.md` in this repo and rerun `bash scripts/sync-symlinks.sh`.

Skill-local installers: if a skill ships `skills/<category>/<name>/install.sh`, `sync-symlinks.sh` discovers it and runs `bash <path> --development --quiet` after the main symlink pass. The installer must accept both flags, be idempotent, and write errors to stderr. See `skills/workflow/autonomous-workflow/install.sh` for the reference implementation.

Naming files a skill installs by symlink: when a skill's `install.sh` symlinks a file *verbatim* into `~/.claude/agents/` or `~/.claude/rules/` (as `autonomous-workflow` does from its `templates/` directory), name the source after what it *is* — `<agent-name>.agent.md` for an agent (e.g. `aw-planner.agent.md` → installed as `aw-planner.md`) and `<name>.rule.md` for a rule (e.g. `routing.rule.md`) — not `*.template.md`. These are definitions, not fill-in templates (no substitution happens), and the `<name>.agent.md` form lets a repo search for the agent name land directly on the file. Reserve `*.template.md` / plain `templates/*.md` for boilerplate a skill *emits or fills in* at runtime (e.g. `aw-create-plan`'s `plan.md`).

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

Regression evals for the skills live in [`scripts/eval/`](./scripts/eval/README.md), in three layers.
The full annotated description, including the recorded run history, is [`docs/evals.md`](./docs/evals.md).

- **L1 — deterministic contract checks** (`node scripts/eval/l1.mjs`): no LLM, no cost, gated in CI on every PR.
  Add or extend an `s.check` for any mechanical contract, and prove it bites by breaking what it guards.
- **L2 — behavioral evals** (`ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs [--suite a,b]`): one suite per labelled decision, golden sets in `scripts/eval/golden/`, suites declared in `scripts/eval/suites.mjs`.
  Opt-in in CI via the `run-evals` PR label; require the aggregator check `evals · L2 (behavioral) / l2`.
- **L2-detection** (`ANTHROPIC_API_KEY=… node scripts/eval/l2-detection.mjs`, `--self-test` offline): replays finder → verifier over `golden/bug-detection.jsonl`; hard-gated on `recall ≥ 0.7` and `fp ≤ 0.2`.
  Never lower a gate or loosen the parse to meet the current core.


### Keeping the evals honest (mandatory on every change)

**A change that alters a decision the evals measure MUST update the evals in the SAME commit.**
An eval is not follow-up work: a rubric edited without its suite re-run is an unverified behavioural change, and a suite left pointing at a deleted rubric is a red gate on the next author's PR.

"Big change" is not the trigger — these are, and they are exhaustive.
Look up what you touched:

| You changed… | You MUST… |
| --- | --- |
| the body of a section a suite reads (any `SUITES[].rubric.file` + `section`) | run that suite (`node scripts/eval/l2.mjs --suite <name>`) and report the accuracy. Re-label or add golden cases if the decision boundary moved; a rubric edit that changes no label is the normal case, and saying so is the deliverable |
| a section HEADING a suite reads (renamed, re-levelled, moved) | update `rubric.section` — or the matching entry in `rubric.sections` — in `suites.mjs`; `extractSection` throws on a missing anchor and L1 `G21g` fails |
| the FILE a suite reads (moved, renamed, deleted) | repoint `rubric.file`, or delete the suite entry **and** its `golden/*.jsonl` together. Never leave a suite whose extraction throws |
| a HARNESS file (`HARNESS_FILES` in `suites.mjs` — `l2.mjs`, `lib.mjs`, `suites.mjs`, `select-suites.mjs`) | run **every** suite, plus `bug-detection`. That is the selector's own rule 1 and it is fail-open by design: one of these can alter any suite's answer, so the widening direction costs tokens while the narrowing direction costs coverage and reports green either way. `telemetry.mjs` is deliberately NOT one — it observes the run and cannot move a label |
| a `choices` list — a new tier, bug class, severity, verdict | add at least one golden case labelled with each new choice, and re-label the existing ones if you renamed a choice. L1 `G21j` enforces both directions |
| added a new enumerable decision an agent makes (a routing table, a tier ladder, a class taxonomy) | add a suite: `golden/<name>.jsonl` + a `SUITES` entry. Two steps, no CI wiring — selection is derived |
| deleted a skill, agent, or rule file | grep `suites.mjs` for its path first; a suite reading a deleted file fails L1, not L2 |
| added, moved, or removed a relative link inside `skills/` | a link may not climb out of its own skill folder (hosts like Dash0 Agent0 install each skill alone). L1 `G71` ratchets the per-skill count in `scripts/eval/escaping-links.baseline.json`; when you remove escaping links, lower it with `node scripts/eval/escaping-links.mjs --write` in the same commit |
| a MECHANICAL contract (a `plan.md` section list, a renderer payload key, a gate glyph, a shared verbatim sentence) | that is L1's job, not L2's — add or extend an `s.check` in `l1.mjs`, and **prove it bites** by breaking the thing it guards and watching it go red |
| the eval harness's own telemetry (`telemetry.mjs`, or the `eval.*` / `gen_ai.*` attributes `l2.mjs` stamps) | extend the module's `--self-test` (it is executed by L1 `G21k`, so the OTLP encoding cannot rot unobserved) and keep the four rules intact — off by default, a miss is not a span error, an absent attribute is omitted, the flush precedes the gate exit. Renaming an attribute is a **dashboard-breaking** change: say so in the PR description |
| a finder or verifier rule (`finders.md`, `finding-verifier.md`) | add a `golden/bug-detection.jsonl` record — including a **decoy** (the same diff with the defect removed) when the change is meant to raise recall, or the false-positive rate cannot tell discrimination from difficulty. Either of these files now selects the `bug-detection` CI job, which is **hard-gated** on `recall ≥ 0.7` / `fp ≤ 0.2`, so label the PR `run-evals` (or run `node scripts/eval/l2-detection.mjs` locally) and report both rates |
| promoted a lesson via `diagnose` (`seen_count ≥ 3`) | add the golden case, as above |

**Two obligations the opt-in CI created.**
Since suites no longer run unasked, nobody else will notice a rubric you did not verify: after any first-row change, either label the PR `run-evals` or run the affected suites locally, and put the accuracy in the PR description.
And `node scripts/eval/select-suites.mjs` on your own changed files tells you which suites the first row covers — read it rather than guessing.

**Definition of done:** the diff either touches the eval surfaces above, or the PR description says in one line why none applied.

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
