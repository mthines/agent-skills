# Agent Skills

## Audience

Agentic frameworks (AI coding agents, copilots, autonomous developer tools) consume these skills and agents operationally, so every line must be actionable without human interpretation:

- Be prescriptive: tell the agent what to do, not what a concept means.
- Make decisions enumerable: numbered steps, lookup tables, or explicit criteria.
- Give every actionable rule a code example showing the correct and the incorrect pattern.
- State concrete, testable criteria, never subjective ones.
- Keep each file self-contained.

## Where knowledge goes (mandatory on every change)

This file loads into every session, so it holds only what an agent needs on every task.
Classify what you learned and write it only where the table says:

| What you learned | Write it to | Never write it to |
| --- | --- | --- |
| A new or changed skill / agent | a one-line hook (≤ 300 chars) in the inventory below, plus the skill's own `SKILL.md` | a paragraph here |
| A rule the agent must follow | the owning skill's `rules/<topic>.md` (cross-cutting: `agents/shared/rules/<topic>.md`) — the rule only, plus at most a one-line `**Why:**` | this file, `docs/inventory.md` |
| Why the rule or design exists, the alternative it beat, the failure it prevents | the owning skill's `references/<topic>.md` (cross-cutting: `agents/shared/references/<topic>.md`), stated as current fact, linked from the rule | `rules/`, this file |
| What changed, in which version or PR, measured run numbers | the commit message and PR description only | any file in the repo |
| An eval result | the PR description; `scripts/eval/README.md` only when it changes a standing decision, recorded as the decision, not the run log | this file, `docs/evals.md` |
| Narrative about how the repo is wired (symlinks, plugins, packages) | [`docs/development.md`](./docs/development.md) or the package's own `CLAUDE.md` | this file |

- Keep a sentence only if deleting it would change how an agent acts; narrative ("this used to…"), release-version tags, and incident retellings fail that test.
- [`docs/inventory.md`](./docs/inventory.md) and [`docs/evals.md`](./docs/evals.md) are frozen archives: read them, never append to them.
- An inventory hook names the capability, never its history: `` - `review-loop` (`Skill()`) — bounded PR convergence loop; `--merge` squash-merges on a clean convergence ``, not `` … **`--merge` (vN.N):** … a real run on #214 showed … ``.
- L1 `G86` enforces the mechanical half: this file stays under 40,000 chars, inventory hooks stay ≤ 300 chars, no version tags, and the two archives do not grow.

## Repository structure

Skills live in `skills/<category>/<name>/SKILL.md` (7 categories); agents live in `agents/` because they need their own model and tool configuration.
A skill's `SKILL.md` is its operational authority; its rules live in `rules/`, their rationale in `references/`.
Type markers name the primary entry point: `auto` = the description auto-triggers on natural language; `/` = slash command, no auto-trigger; `Skill()` = called by another skill or workflow.
All three stay model-invocable via `Skill()` when `disable-model-invocation: false`.

### `workflow/` — end-to-end orchestrators

- `autonomous-workflow` (`/`) — phase machinery behind `aw`; `plan.md` is a six-heading brief gated on `run-checks.mjs` printing `CHECKS M/M PASS`, ending in a paste-ready `/goal`. `aw` (`auto`) is the sole entry and owns tiers. Design: [`CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md)
- `aw-create-plan` (`Skill()`) — writes the `plan.md` brief (Task, Requirements, Guardrails, Definition of Done, Turn Cap, File Changes) + sealed `checks.yaml`. `aw-create-walkthrough` (`Skill()`) — writes `walkthrough.md`, led by a one-page review summary
- `fix-bug` (`/`) — single-bug pipeline, phases 0–8
- `implement-suggestion` (`/`) — apply reviewer suggestions across PRs; `--watch` loops one PR, `--resolve-all` closes non-fix threads. Never fixes CI

### `quality/` — code, tests, plans, AI apps

- `ai-engineering` (`/`) — LLM/AI app review across 13 concerns
- `confidence` (`auto`) — multi-signal confidence gate for `plan` / `code` / `analysis`; deterministic rule caps the LLM score at 89%
- `critical` (`auto`) — adversarial pre-mortem with mandatory steelman alternative. Never iterates; `deep` runs 3–5 parallel persona lenses (found via `ideate`) and merges them
- `measurable` (`auto`) — every delivery ships telemetry that proves impact and surfaces regressions; modes `guide` / `implement` / `audit` / `setup`
- `observe-run` (`Skill() + /`) — runs a command and grades the telemetry that run emitted against behavioral assertions only
- `polish` (`/`) — re-runnable pre-PR branch quality gate: review, then simplify the diff and prune restating or ticket comments, each change behind a test check
- `review-loop` (`Skill()`) — bounded PR convergence loop: `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`, cap 5; `--ui` runs `ui-verify` in a parallel lane and resolves its findings. Run at the top level of a session that holds a dispatch tool
- `review-branch` (`/`) — PR-less sibling of `review-loop`; findings bus `.agent/{branch}/findings.jsonl`, zero GitHub calls
- `pr-review` (`/`) — one read-only `pr-reviewer` dispatch at one PR; `/pr-review remember <fact>` writes a maintainer relevance rule
- `tdd` (`auto`) — strict RED-GREEN-REFACTOR
- `test-provenance-guard` (`auto`) — detects tests-by-construction (static + mutation checks)
- `verify-behavior` (`Skill()`) — cheapest-first three-tier verification ladder; emits an evidence receipt, never a score
- `jev-assert` (`Skill()` + `/`) — semantic UI assertion via TypeSafe Jev; backs the `THEN semantic:` spec form

### `delivery/` — Git, PR, CI

- `attach-media` (`Skill()` + `/`) — uploads screenshots and recordings to a PR or issue via `gh --attach`, with a curl fallback; owns the `<!-- attach-media:v1 -->` body region. Never writes placeholders
- `ci-auto-fix` (`/`) — evidence-gated CI diagnosis and fix; never weakens checks
- `create-pr` (`/`) — narrative PR description; pre-push `review-branch`, draft PR, post-draft `review-loop`, CI watch
- `github-actions-author` (`/`) — author / review GHA workflows
- `resolve-conflicts` (`/`) — analyze and resolve merge / rebase conflicts

### `testing/` — E2E and fixture tooling

- `e2e-testing` (`/`) — spec-first Playwright Test Agents loop
- `e2e-testing-mobile` (`/`) — Maestro YAML flows for Expo / React Native
- `e2e-pr-stabilizer` (`/`) — local-first Playwright E2E stabilizer for one PR; modes `stabilize` / `optimize`
- `ui-verify` (`Skill()` + `/`) — Markdown intent spec in the PR body (`<!-- ui-verify:v2 -->`); `author` adds out-of-bounds specs from a PR-scoped brainstorm; the runner adapts the route but checks every outcome with evidence, then tries to break it, records it, and checks its Dash0 web events
- `local-verify` (`/`) — verifies a PR on a local stack: reuses `/aw`'s brief and intent `specs.md`, runs them plus edge probes via `ui-verify run --url`, reads telemetry, fixes each finding as one commit; `setup` stores all repo values

### `design/` — UI, visual, interaction

- `animations` (`auto`) — CSS-first web animations and perceived performance
- `animations-native` (`auto`) — React Native / Expo animations (Reanimated, gesture-handler)
- `behavioral-design` (`auto`) — behavior-change diagnosis (COM-B, B=MAP), ethical interventions (EAST, defaults, System 1 / System 2), and team-adoption workshops. Never recommends a dark pattern or sludge
- `charting` (`auto`) — chart type + library for web and mobile
- `storybook` (`auto`) — visual regression, Playground, and interaction-test stories
- `ux` (`auto`) — UX, a11y, microcopy, dark-pattern review. Never recommends a dark pattern
- `visual-design` (`auto`) — brand-aware visual direction

### `analysis/` — investigate data, diagnose issues

- `ideate` (`auto`) — research-grounded brainstorming; divergence runs lessons-blind
- `interview` (`auto`) — pre-plan scope-alignment interview; emits `.agent/{branch}/brief.md`
- `playwright-trace-analyzer` (`/`) — analyze `trace.zip`; names the race behind a flake
- `profile-optimizer` (`/`) — React DevTools / Chrome Performance trace analysis
- `rum-tracking` (`auto`) — product analytics and RUM event tracking
- `screen-recorder` (`Skill()`) — short cropped UI videos via Playwright + ffmpeg
- `video-analyser` (`auto`) — analyze screen recordings for bugs
- `youtube-transcript` (`auto`) — stdlib-only YouTube transcript fetch that works from cloud IPs where `youtube-transcript-api` and `yt-dlp` are bot-blocked

### `authoring/` — skills about Claude Code itself

- `create-skill` (`/`) — scaffold, review, upgrade, diagnose skills
- `docs` (`auto`) — author / audit `CLAUDE.md`, `AGENTS.md`, `README.md`, Diátaxis `docs/` trees
- `optimize-claude-md` (`/`) — audit `CLAUDE.md` for context bloat
- `persistent-memory` (`/`) — cross-conversation markdown memory store. Self-improvement loops run on LoreKit instead; bucket taxonomy: [`memory-buckets.md`](./agents/shared/rules/memory-buckets.md)
- `handoff` (`/`) — copy-pasteable session handoff for a fresh agent

### Agents

**`aw` is a skill, not an agent** — [`aw/SKILL.md`](./skills/workflow/autonomous-workflow/aw/SKILL.md), invoked `/aw`.
The agents it hands off to are **generated from templates** in `skills/workflow/autonomous-workflow/templates/`, not stored in `agents/`:

- `aw-executor` — Full tier, executes the brief `aw` writes, phases 3–7. Source: [`aw-executor.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md)
- `aw-tester` — Phase 4 spec-driven UI verification. Source: [`aw-tester.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-tester.agent.md)

The agents below live as `agents/*.md` files and are dispatched by skills:

- `pr-reviewer` — PR reviewer for self and cross relations; read-only; one sticky report comment plus append-only inline findings
- `branch-reviewer` — PR-less reviewer for `/review-branch`; writes `.agent/{branch}/findings.jsonl`, zero GitHub calls
- `feature-pr-verifier` — independent verifier for `/autonomous-workflow` Full Mode PRs

## Commands and gotchas

Read [`docs/development.md`](./docs/development.md) when adding, wiring, or debugging a skill, agent, plugin, or package.

```bash
bash scripts/sync-symlinks.sh            # wire every new skill/agent into ~/.claude via ~/.agents
bash scripts/sync-symlinks.sh --dry-run  # preview
node skills/authoring/create-skill/scripts/validate-skill.mjs skills/<category>/<name>  # frontmatter + body lint
pnpm install                             # from repo root, for packages/
```

- Run `sync-symlinks.sh` with `bash`, never `sh` (it uses bash arrays and process substitution).
- Edit skills in this checkout, never through the `~/.claude` or `~/.agents` symlinks; the symlinked path hides which worktree the edit lands in.
- A new skill needs `SKILL.md`, a `sync-symlinks.sh` run, an inventory hook above, and a `README.md` entry.
- A skill-local `install.sh` must accept `--development --quiet`, be idempotent, and write errors to stderr.
- Name a file an installer symlinks verbatim `<agent-name>.agent.md` or `<name>.rule.md`; reserve `*.template.md` for boilerplate a skill fills in at runtime.
- Plugins live in `plugins/<name>/` (no build step), listed in `.claude-plugin/marketplace.json`; validate with `claude plugin validate plugins/<name>`.
- Packages live in `packages/` (Nx); never add one without updating `tsconfig.json` references and the `nx.json` release config. VS Code extension commands and internals: [`packages/vscode-agent-tasks/CLAUDE.md`](./packages/vscode-agent-tasks/CLAUDE.md).

## Evals

Harness docs: [`scripts/eval/README.md`](./scripts/eval/README.md).
- **plugin-eval** (`pnpm plugin-eval --tag ablation`): [`evals/`](./evals/README.md) runs each key skill with and without the plugin loaded; a skill whose `Δ` stays ≤ 0 is a slimming candidate. Opt-in, never in CI; L1 `G110` keeps every case loadable.

- **L1** (`node scripts/eval/l1.mjs`): deterministic integrity checks, free, CI-gated on every PR. A new check must pass the [L1 admission rule](./scripts/eval/README.md#l1-admission-rule); prose, wording, and sync checks are never admitted.
- **L2** (`ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs [--suite a,b]`): one suite per labelled decision; goldens in `scripts/eval/golden/`, suites in `scripts/eval/suites.mjs`. Opt-in in CI via the `run-evals` PR label (aggregator check `evals · L2 (behavioral) / l2`).
- **L2-detection** (`ANTHROPIC_API_KEY=… node scripts/eval/l2-detection.mjs`, `--self-test` offline): finder → verifier over `golden/bug-detection.jsonl`, hard-gated on `recall ≥ 0.7` and `fp ≤ 0.2`. Never lower a gate or loosen the parse to pass.

### Keeping the evals honest (mandatory on every change)

A change that alters a decision the evals measure updates the evals in the same commit.
These triggers are exhaustive:

| You changed… | You must… |
| --- | --- |
| the body of a section a suite reads (`SUITES[].rubric.file` + `section`) | run that suite (`node scripts/eval/l2.mjs --suite <name>`) and report the accuracy; re-label or add goldens if the boundary moved, otherwise say no label changed |
| a section heading a suite reads | update `rubric.section` (or its `rubric.sections` entry) in `suites.mjs`; `extractSection` throws and L1 `G21g` fails |
| the file a suite reads (moved, renamed, deleted) | repoint `rubric.file`, or delete the suite entry and its `golden/*.jsonl` together; never leave a suite whose extraction throws |
| a harness file (`HARNESS_FILES`: `l2.mjs`, `lib.mjs`, `suites.mjs`, `select-suites.mjs`) | run every suite plus `bug-detection`; `telemetry.mjs` is not a harness file |
| a `choices` list (tier, bug class, severity, verdict) | add a golden case per new choice and re-label renamed ones; L1 `G21j` enforces both directions |
| added a new enumerable decision (routing table, tier ladder, taxonomy) | add `golden/<name>.jsonl` plus a `SUITES` entry; selection is derived, no CI wiring |
| deleted a skill, agent, or rule file | grep `suites.mjs` for its path first; a suite reading a deleted file fails L1 |
| added, moved, or removed a relative link inside `skills/` | a link may not climb out of its own skill folder; L1 `G71` ratchets `scripts/eval/escaping-links.baseline.json` — lower it with `node scripts/eval/escaping-links.mjs --write` when the count drops |
| a runtime contract code or a parser reads (link, manifest entry, payload key, marker, executed shell block) | add an `s.check` only if it passes the [L1 admission rule](./scripts/eval/README.md#l1-admission-rule), name the failure it prevents, and prove it bites; a behaviour claim goes to a plugin-eval case in `evals/` or an L2 golden case, never L1 |
| the harness telemetry (`telemetry.mjs`, `eval.*` / `gen_ai.*` attributes) | extend its `--self-test` (run by L1 `G114`); keep it off by default, a miss is not a span error, absent attributes are omitted, the flush precedes the gate exit; flag an attribute rename as dashboard-breaking in the PR |
| a finder or verifier rule (`finders.md`, `finding-verifier.md`) | add a `golden/bug-detection.jsonl` record, plus a decoy when raising recall; label the PR `run-evals` or run `l2-detection.mjs` and report recall and fp |
| promoted a lesson via `diagnose` (`seen_count ≥ 3`) | add the golden case |

- Suites do not run unasked in CI: after any first-row change, label the PR `run-evals` or run the suites locally, and put the accuracy in the PR description.
- `node scripts/eval/select-suites.mjs` on your changed files lists the suites the first row covers.
- Done means the diff touches the eval surfaces above, or the PR description says in one line why none applied.

## Prose rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with a language identifier.
- End sentences with full stops.
- Use the Oxford comma.
