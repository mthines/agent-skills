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

- `autonomous-workflow` (`auto`) — phase-based feature delivery 0–7. Opt-in `aw` dispatcher detects tier (Micro/Lite/Full) and routes single-pass vs the planner→executor split (Full only). Two-tier self-improvement hoisted to the dispatcher (universal): fast episodic-lessons tier (LoreKit `loop::aw-lessons`) promotes to the gated `diagnose` slow tier at `seen_count ≥ 3`. Loop: [`rules/self-improvement-loop.md`](./skills/workflow/autonomous-workflow/rules/self-improvement-loop.md). Plan-quality gates (v3.15): Phase 0 restate-and-diff + missing-information gate (`blocking` halts even under `--no-confirm`), Phase 1 Existing Code Survey per planned `create` (anti-reinvention, `confidence` rule #10) + `AC-{n}`/`(covers: R{m})` requirement traceability (rule #9), and an executable `checks.yaml` acceptance artifact (rule #11) the executor's Phase 4 loop gates on mechanically — definitions executor-immutable, check-gaming forbidden, `unsatisfiable` abort affordance. Artifact lightening (v3.18): `checks.yaml` is the primary living contract and `plan.md` a lean handoff document the executor writes drift back into (Phase 3); `plan.v{N}.md` snapshots are opt-in (`aw-create-plan`'s `snapshot` arg), not default; the "No AI co-author tags" rule was removed. Research basis: [`references/planning-quality-research.md`](./skills/workflow/autonomous-workflow/references/planning-quality-research.md). Design intent: [`workflow/autonomous-workflow/CLAUDE.md`](./skills/workflow/autonomous-workflow/CLAUDE.md)
- `aw-create-plan` (`Skill()`) — writes `plan.md` + `checks.yaml`; immutable `plan.v{N}.md` snapshots are opt-in (`snapshot` arg). `aw-create-walkthrough`, `aw-review-quality-gate` (`Skill()`) — autonomous-workflow companions
- `batch-linear-tickets` (`/`) — batch-analyze Linear tickets by dispatching `linear-ticket-investigator` (plus `holistic-analysis` for bug tickets) per ticket, then fan out fixes; requires Linear MCP. Self-improvement: `batch-lessons` fast tier (read Phase 1 / write Phase 5) for classification + correlation; inherits `aw-lessons` via the planner/executor fan-out; promotes to `diagnose`
- `fix-bug` (`/`) — single-bug pipeline phases 0–8. Flags: `--analyse-only`, `--force-holistic`. Self-improvement: `fix-bug-lessons` fast tier (read Phase 0.5 / write Phase 5·7·8) for its diagnostic phases; inherits `aw-lessons` via `aw-executor`; promotes to `diagnose`
- `implement-suggestion` (`/`) — apply reviewer suggestions across PRs; per-comment `/critical` + `/confidence` validation. `--watch` loops the apply on a single PR (wait for new bot/human comments → apply → push, max 5 iterations) — the loop `create-pr` dispatches post-push. Rule: [`watch-mode.md`](./skills/workflow/implement-suggestion/rules/watch-mode.md). `--resolve-all` (opt-in, passed by `review-loop`) adds a worker pass that replies-to-and-resolves the non-fix threads it can honestly close (answers `question`, records the agent's take on `discussion`, gives a decline rationale for gated-out changes) so the PR converges to zero open threads — only genuine human-judgment flags stay open (never green-washes a live finding; same invariant as `thread-resolution.md`). Self-improvement: `implement-suggestion-lessons` fast tier (read Phase 3 / write Phase 7 + watch re-flag) for its own classification, gate-calibration, and lane-selection decisions; standard-lane inherits `aw-lessons` via `aw-planner`; promotes to `diagnose`. **Dual outcome producer:** at Phase 7 and per-iteration inside `--watch`, emits (1) fingerprinted outcome records to the `review-outcomes` candidate/outcome bus (see `agents/shared/rules/review-outcomes.md`) — feed `outcome-learning.md`'s promotion decisions; and (2) per-comment relevance signals to the `reviewer-comment-relevance` LoreKit bucket (tag `loop::reviewer-comment-relevance`, see `agents/shared/rules/comment-relevance-memory.md`) — read on every `pr-reviewer` run to suppress recurring noise and reinforce reliably-resolved patterns, making the pipeline continuously more accurate per repository. **CI boundary:** never fixes CI. The worker's Phase 6 pre-push gate now runs a *full, unscoped* fast-check pass over the whole repo before the single push (step 3.5) — per-comment checks are scoped to touched files and cannot see a consumer the edit broke elsewhere — and hard-STOPs with the batch local-only on failure. Under `--watch`, post-push check state is read only as a **stop reason** (`ci red — <checks>`); no `ci-auto-fix` dispatch, no budget spent. Composing apply-and-get-green is `review-loop`'s job.

### `quality/` — code, tests, plans, AI apps

- `ai-engineering` (`/`) — LLM/AI app review across 13 concerns (prompts, caching, RAG, agents, evals, safety, observability)
- `code-quality` (`auto`) — readability, complexity, maintainability. Four modes: `plan` (validate a plan), authoring (default), `review` (findings only), `simplify` (review-then-apply for end-of-feature cleanup — auto-applies Class M refactor recipes behind `confidence(code) ≥ 90 %` + scoped fast-check, with revert-on-failure). Class M/J taxonomy lives in [`refactor-recipes.md`](./skills/quality/code-quality/rules/refactor-recipes.md#recipe-class--mechanical-vs-judgment) and is guarded by L1 G7
- `confidence` (`auto`) — multi-signal confidence gate for `plan` / `code` / `analysis`; deterministic rule caps LLM score at 89%
- `eval-iterate` (`/`) — drives a failing AI/LLM eval (an L2 behavioral suite, a golden-set/LLM-as-judge eval, or any eval gating a PR) to a real green. Classifies each failure as `code-bug` / `eval-bug` / `flaky` / `unsure` (composes `ai-engineering`'s evals concern), fixes the minimal cause, then requires two consecutive passing re-runs before calling it `confirmed-green` — a single lucky pass never counts. Hard-capped at 5 iterations, never raised. Any edit to the eval itself (assertion, threshold, golden-set item, judge prompt) is gated on `confidence(analysis) >= 90%` plus a logged rationale and never a silent fix-to-pass — the same executor-immutable / check-gaming-forbidden spirit as `checks.yaml`, adapted for evals rather than copied verbatim. Composes `ai-engineering`, `confidence`, and `verify-behavior`'s `change` mode rather than reimplementing diagnosis, scoring, or execution
- `severity` (`auto`) — severity/blast-radius gate for `finding` / `bug`; the orthogonal axis to `confidence` (how bad if real, vs is-it-real). Emits a lowercase `critical`/`high`/`medium`/`low` tier from a fixed axis rubric (impact, blast radius, likelihood, reversibility, capped by reachability), then one **executable** path floor (auth/billing/migration/infra/secrets globs) plus **heuristic** escalators (data-loss, security, concurrency shapes) — both skipped on test/fixture/generated/reverse-migration paths so they never inflate non-production code (only the path floor is deterministic; the escalators are LLM-judged, and the skill says so). Policy-free: it emits the tier and a `(blocking)` crosswalk (`critical`/`high` ⇒ blocking) but owns no threshold numbers — the consumer (`review-config.md`, `rubric-composition.md § Severity mapping`) does. Consumers: `pr-reviewer` severity-aware inline bar, `fix-bug`/`batch-linear-tickets` triage order, `ci-auto-fix` escalation. In `pr-reviewer` the severity-aware bar is **on by default** (medium anchors the profile's historical 80; high/critical lower, low higher), is shown inline as a `<prefix> (<tier>):` label (e.g. `issue (high):`) and a per-severity glyph breakdown in the report, and the emitted tier is recorded per outcome (read from the label) → the `reviewer-comment-relevance` record's `severity` field. Regression-tested by the `severity-tiering` L2 suite
- `critical` (`auto`) — adversarial pre-mortem with mandatory steelman alternative. Never iterates
- `measurable` (`auto`) — ensures a delivery is measurable and its regressions are visible. Classifies each changed path (`web`/`mobile`/`api`/`worker`/`infra`/`shared-lib`, reading a committed Observability Profile when one exists) and requires the matching signal: a RUM/analytics event for user-facing web/mobile changes (delegates event design to `rum-tracking`), an OTel span + RED metric + structured error log for API/backend changes (delegates to `otel-instrumentation`/`otel-semantic-conventions` when installed), and — for every signal, either category — a named regression detector (existing dashboard/check rule, or an explicit propose-via-Dash0-chat note); never creates dashboards/alerts itself. Four modes: `guide` (default, advisory), `implement` (writes/delegates instrumentation), `audit` (read-only coverage report; **advisory by default** — `--strict` escalates `missing` findings on user-facing/API paths to blocking, `unlinked` findings never block), `setup` (first-time interview recording the telemetry stack and, for monorepos, a path-glob → package-kind → stack map, persisted via `persistent-memory`'s `project-shared` tier as a committed Observability Profile — see [`templates/observability-profile.template.md`](./skills/quality/measurable/templates/observability-profile.template.md)). Wired into `autonomous-workflow` at three points: Phase 3 [Observability Trigger](./skills/workflow/autonomous-workflow/rules/phase-3-implementation.md#observability-trigger) authors coverage while implementing; Phase 4 [Observability Gate](./skills/workflow/autonomous-workflow/rules/phase-4-testing.md#observability-gate) audits it, advisory by default, opt into hard-blocking via `--observability-strict` (mirrors how `critical`/`optimize-approach` shipped opt-in/quiet rather than hard-blocking on introduction); Phase 7 [Observability Recheck](./skills/workflow/autonomous-workflow/rules/phase-7-ci-gate.md#observability-recheck) re-audits the current head after `ci-auto-fix` and the post-CI `review-loop` pass settle — both mutate code after Phase 4 already ran and can silently strip coverage it confirmed — fixing and re-checking once under `--observability-strict` before escalating, never a second stuck-loop
- `optimize-approach` (`Skill()`) — the fourth review lens: "is this the most optimal approach for its intent, and if not what is?" Judges four axes (codebase-fit, simplicity, performance, robustness) at the **approach level** with anti-overlap guards (defers line-level to `code-quality`, failure modes to `critical`, intent/system-fit to `holistic-review`) + a materiality bar; quiet early-exit stays silent when optimal. Three modes: `report` (proposal), `apply` (gated approach rewrite behind `confidence(code) ≥ 90 %` + scoped check + revert-on-failure; own-work only), and `plan` (approach review at plan time — consumes the Existing Code Survey, returns plan-level proposals, no code). Default-on lens in `pr-reviewer` (report-only — never applies in any relation), `polish` (apply), and `aw-planner` Phase 1 (`plan`, default-on Full Mode, bounded re-plan) via [`agents/shared/rules/optimality-review.md`](./agents/shared/rules/optimality-review.md) (Step 2.4c) and [`skills/quality/optimize-approach/rules/plan-mode.md`](./skills/quality/optimize-approach/rules/plan-mode.md); `--no-optimize` opts out. Never blocks the verdict/gate. Self-improvement: `optimize-approach-lessons` fast tier (read O0 / write O5) calibrating the optimal/suboptimal bar + apply-safety + plan-time judgment; promotes to `diagnose`
- `polish` (`/`) — re-runnable pre-PR branch quality gate; thin orchestrator that composes the `review-loop` skill (calls `pr-reviewer` in self mode — read-only, findings surfaced) and `code-quality` simplify (apply Class M refactors). Modes: bare → full (review then simplify), `review`, `simplify`, `optimize` (standalone approach-rewrite pass), `quick` (light mechanical pass). Commits each pass separately (`--no-commit` to skip). `/create-pr` delegates its post-draft quality loop to `review-loop` — full pass by default; `--no-review` → simplify only, `--no-simplify` → review only, `--quick` → light pass, `--no-quality` skips, `--no-optimize` skips the optimality lens
- `review-loop` (`Skill()`) — thin convergence orchestrator: calls `pr-reviewer` (self mode, read-only) → `implement-suggestion --resolve-all` (apply findings **and** reply-to-and-resolve non-fix threads) → `Skill("polish", "simplify")`; repeats up to N=5 iterations, converging until every review thread is resolved via fix OR reply (answered question / recorded rationale) — only genuine human-judgment flags stay open (the no-green-wash safety valve). On convergence it refreshes the PR description via the shared [`description-contract.md`](./skills/delivery/create-pr/rules/description-contract.md) (single source of truth with `create-pr`) and, best-effort, notes the linked Linear ticket (`--no-refresh` opts out). Anti-circularity: never calls `Skill("polish")` or `Skill("polish", "review")` — only `simplify`. Used by `polish`, `create-pr` (post-draft), and the autonomous-workflow Phases 6–7. **CI convergence (v1.3.0):** sub-step D reads check state after each iteration's push (stateless `gh pr checks`, never a watch) and delegates a red mechanical failure to `ci-auto-fix`, capped at 2 handoffs per run — so convergence means zero open threads **and** CI not red; `--no-ci` opts out and is passed by `create-pr` Step 6.5 and `autonomous-workflow` Phase 7, which own the per-PR CI budget themselves (each counts its own handoffs inside its own invocation, with no state carried between them; phase-7's new Step 2.5 re-checks CI after the loop pushes). **`--external-review` (v1.3.0):** sub-step A waits on the shared [`review-activity-poll.md`](./agents/shared/rules/review-activity-poll.md) for an out-of-process reviewer (another agent / review bot) instead of dispatching `pr-reviewer` — `POLL_ERROR` aborts and is never read as "reviewer quiet"; also the graceful-degradation path where the `Task` tool is disabled. `--interval S` (clamped 540) sets the poll bound. **Caller contract (v1.4.0):** the loop is an orchestrator whose first sub-step is a delegation, so it must be invoked at the **top level** of a session that still holds `Task` — dispatching it into a sub-agent (which cannot delegate further) spends the delegation budget one level too high and the loop can only skip at iteration 0. A caller limited to one dispatch passes `--external-review` **deliberately**; the loop never invents it. The nested-dispatch skip has its own stop-reason token, distinct from the disabled-`Task` one and never reported as `report-only`, and one missing-`Task` return is conclusive (no retry).
- `dx` (`/`) — CLI / shell-script DX review
- `review-changes` (`/`) — dispatches to `pr-reviewer` agent (self or cross per relation)
- `tdd` (`auto`) — strict RED-GREEN-REFACTOR
- `test-provenance-guard` (`auto`) — detects tests-by-construction (static + mutation checks); self-heals by extracting inline logic
- `verify-behavior` (`Skill()`) — cheapest-first three-tier verification ladder: Tier 1 syntactic (`grep`/`ast-grep`/`Read`), Tier 2 semantic-no-execution (`tsc`/`go vet`/`cargo check`/`pyright`), Tier 3 execution (covering test or a minimal synthesized repro, in a throwaway worktree). Reports an evidence receipt (`confirms`/`contradicts`/`ambiguous`/`null`, null never counted as confirmation) — it never scores; `confidence(code)` owns the number. Two consumer shapes: claim-verification (read-only, feeds `confidence(code)`) and change-verification (post-apply green/red gate). Tier 3 is relation-keyed: default-on for the caller's own code, opt-in behind a sandbox for cross/untrusted callers. Wired as a thin adapter into `agents/shared/rules/verification-receipt.md` (pr-reviewer Tier 2/3, 2.6b), `bug-fix-verifier`, `feature-pr-verifier`, and the `aw-executor` Phase 4 checks loop — each keeps its own grading semantics; none is deleted

### `delivery/` — Git, PR, CI

- `changelog` (`/`) — personal PR + Linear ticket digest. Template: [`delivery/changelog/templates/changelog.md`](./skills/delivery/changelog/templates/changelog.md)
- `ci-auto-fix` (`/`) — verdict-gated, confidence-gated CI diagnosis and fix; `flaky`/`unsure` escalate, `*-bug` verdicts continue to a ≥90/80–89/<80 gate; regressing pushes auto-revert. Self-improvement: `ci-auto-fix-lessons` fast tier (read Phase 3 / write Phase 8·9) for verdict + regression calibration — **more conservative** than the other loops (verdict lessons default to `repo::` scope, `seen_count ≥ 5` promotion bar; regression lessons `volatile` + 30-day expiry); a lesson can never authorize a check-weakening or soft-refusal; promotes to `diagnose`
- `create-pr` (`/`) — narrative PR description; PR-first flow: push → open draft PR → `review-loop` (post-draft quality) → finalize; watch CI. Post-draft review-loop is **default-on**; scale down with `--no-review` (simplify only), `--no-simplify` (review-loop skip simplify), `--quick` (light pass), or `--no-quality` (skip). External-bot feedback loop (`--no-feedback` to skip) backgrounds `/implement-suggestion <pr> --watch` for external-bot comments only. Other flags: `--split`. Legacy `--review` / `--simplify` still accepted as single-pass scoping aliases
- `github-actions-author` (`/`) — author / review GHA workflows (2026 best practices)
- `resolve-conflicts` (`/`) — analyze and resolve merge / rebase conflicts

### `testing/` — E2E and fixture tooling

- `e2e-testing` (`/`) — spec-first Playwright Test Agents loop; locator ladder; `data-testid` source diffs; 3-attempt heal cap
- `e2e-testing-mobile` (`/`) — Maestro YAML flows for Expo / React Native; `testID`-first locator ladder; runs on Maestro Cloud via EAS
- `e2e-pr-stabilizer` (`/`) — local-first stabilizer for Playwright E2E on one PR; Dash0 MCP spans (`git.pull_request_link`) as historical baseline, then iterates locally with `--trace=on` and the same OTel exporter. Validation is empirical, not predictive: every new locator must resolve against source (static grep) or the live app (`locator.count() ≥ 1`) before commit, and the fixed test must pass 3 consecutive local runs before the single push. CI watch ratifies. Refuses `.skip` / `.fixme` / `waitForTimeout`. Two modes: `stabilize` (default) and `optimize` (report-only, ranks slow-action wins by measured ms saved, no commits). Self-improvement: `e2e-pr-stabilizer-lessons` fast tier (read Phase 4 / write Phase 7, `stabilize` only) — `global` scope holds universal P1–P6 race-shape→fix mappings, `repo::` scope holds app-specific locator robustness; **writes are gated on the Phase 7 telemetry ratification, not the local 3-pass streak**; promotes to `diagnose`
- `preview-spec` (`Skill()` + `/`) — makes a UI PR autonomously verifiable. Two operations. `author` generates a step-by-step UI verification spec for the diff and injects it into the PR body as a collapsed, machine-findable `<!-- preview-spec:v1 -->` block (delegated to by `create-pr` Step 6.4 on a UI diff; `--no-preview-spec` opts out); `run` extracts the block, resolves the PR's live preview deployment URL via the **GitHub deployments API** (`environment_url` → `target_url` of the newest `success` status on a non-production deployment), materializes an ephemeral `specs.md` + `aw-target.yml` overlay (`base_url` = resolved URL, auth/fixtures from a committed `.claude/aw-targets/preview.yml`), and dispatches **`aw-tester`** (`--all`) to run it via Playwright, reporting its compact verdict. Owns the PR-embedding (marker + collapsed block, ceiling exemption + review-loop preservation — shared with the [description contract](./skills/delivery/create-pr/rules/description-contract.md)), the URL resolution, and the authoring loop; **reuses `aw-tester`'s spec grammar verbatim** (never forks it) and its Playwright runner. Web only. **Two-way self-improvement:** the runner writes navigation / spec-quality friction to the new `preview-spec-lessons` bucket (a required precondition, a route query param, a preview-auth step) — never a locator miss, which stays `aw-tester`'s `aw-tester-lessons`; the author reads **both** buckets so runner-discovered quirks make the next spec correct from the start; promotes to `diagnose`
- `optimize-mock-data` (`/`) — JSON/JSONL fixture analyze / normalize / shrink
- `test-auto-fix` (`/`) — stack-agnostic test healer: bootstrap surface on first run, classify test-bug vs prod-bug, confidence-gate every fix, regression-detect after each batch; supports Vitest, Jest, Deno, Playwright, Pytest, Maestro, Storybook. Self-improvement: `test-auto-fix-lessons` fast tier (read Phase 2 / write Phase 6·7) keyed by `stack : failure-pattern : verdict-sub-class` — **complements** the per-repo surface file (config) rather than duplicating it; most value is within-project (binary/local feedback); promotes to `diagnose`

### `design/` — UI, visual, interaction

- `animations` (`auto`) — CSS-first **web** animations; perceived performance; interaction-feedback brainstorming. Redirects React Native work to `animations-native`
- `animations-native` (`auto`) — **React Native / Expo** animations with Reanimated (worklets, shared values, layout animations) and gestures with react-native-gesture-handler (builder + v3 hook API), running motion on the UI thread. Covers the CSS-vs-worklet API split, Moti/Lottie/Rive selection, Reduce Motion + haptics, and UI-thread-vs-JS-thread FPS profiling. Reuses the `animations` skill's platform-agnostic verb→motion brainstorm rather than duplicating it
- `charting` (`auto`) — pick chart type + library for web (React/Next.js) and mobile (Expo/RN)
- `storybook` (`auto`) — visual regression + Playground + interaction-test stories; opt-in OS-keychain auth profiles
- `ux` (`auto`) — UX, a11y, microcopy, dark-pattern review (WCAG 2.2, Apple HIG, Material Design 3). Hard rule: never recommends a dark pattern
- `visual-design` (`auto`) — brand-aware visual direction; style-direction taxonomy; defers WCAG math to `/ux`

### `analysis/` — investigate data, diagnose issues

- `holistic-analysis` (`auto`) — full entry-to-exit execution-path trace when incremental fixes aren't working. `review` mode validates a PR diff (intent-match + system-fit) for the `pr-reviewer` agent; an optional `focus` input runs a **focused single-target deep trace** of one changed export's call graph (the per-finding escalation in [`holistic-review.md`](./agents/shared/rules/holistic-review.md)). Optional accelerator: [`rules/call-graph-map.md`](./skills/analysis/holistic-analysis/rules/call-graph-map.md) seeds the execution map mechanically when a call-graph CLI (e.g. `codexray`) is on `PATH`, with a graceful fallback to the manual Explore + grep trace
- `ideate` (`auto`) — research-grounded brainstorming: nominal-group divergence (parallel persona generators), independent judges scoring novelty/feasibility/impact/fit on separate axes with a protected high-novelty wildcard, bounded (≤ 3 round) recombination evolution, `confidence(analysis)` gate on finalists. Auto-triages `quick` vs `deep`. Self-improvement: `ideate-lessons` fast tier (read Phase 0 / write Phase 7, user verdicts as judge calibration) — **mechanics only; divergence runs lessons-blind** (idea content/user taste never stored, to prevent homogenization); promotes to `diagnose`. Research basis: [`references/ideation-research.md`](./skills/analysis/ideate/references/ideation-research.md)
- `interview` (`auto`) — requirements-elicitation / scope-alignment interview run **before** any plan or implementation. Restate-and-diff the request (`[user-stated]` vs `[inferred]` deltas), research the codebase so questions are specific, enumerate unknowns and classify `blocking` vs `advisory`, then run a **batched** clarifying-question round (`AskUserQuestion`, ≤ 2 rounds) only when research can't resolve the ambiguity — **adaptive**: stays silent on a crisp request. Consultative completeness pass (non-goals, edge cases, success criteria, constraints) supplies the "is it thought-through" half. Emits `.agent/{branch}/brief.md` (re-runnable, updated in place) + a readiness verdict (`ready` / `ready-with-assumptions` / `blocked`) that planning consumes. Convergent + pre-plan by design — hands divergence to [`ideate`](./skills/analysis/ideate/SKILL.md), adversarial plan-review to [`critical`](./skills/quality/critical/SKILL.md), and scoring to [`confidence`](./skills/quality/confidence/SKILL.md). **Single source of truth** for `aw-planner` Phase 0's restate-and-diff + Missing-Information Gate via default-on-adaptive delegation (wired in `autonomous-workflow` v3.20.0 — Phase 0 Step 3a `scope-alignment`, Phase 1 `scope-brief`, `--interview` / `--no-interview`; inline gate is the graceful-degradation fallback; see [`rules/aw-integration.md`](./skills/analysis/interview/rules/aw-integration.md)). The gate vocabulary was reconciled repo-wide: `assume-and-proceed` → `advisory`. Also usable standalone (`/interview`)
- `playwright-trace-analyzer` (`/`) — analyze `trace.zip`; names the race behind a flake; confidence-gated
- `profile-optimizer` (`/`) — React DevTools / Chrome Performance trace analysis; ranked optimisation plan
- `rum-tracking` (`auto`) — product analytics and RUM event tracking; what to capture, what's PII, OTel semantic conventions
- `screen-recorder` (`Skill()`) — record short cropped UI videos via Playwright + ffmpeg; called by `animations`, `ux`, `storybook`, and the `pr-reviewer` agent on motion-heavy diffs
- `video-analyser` (`auto`) — analyze screen recordings for bugs; optional OCR + Whisper transcription

### `authoring/` — skills about Claude Code itself

- `create-skill` (`/`) — scaffold, review, upgrade, diagnose skills
- `docs` (`auto`) — author / audit `CLAUDE.md`, `AGENTS.md`, `README.md`, Diátaxis `docs/` trees
- `optimize-claude-md` (`/`) — audit `CLAUDE.md` for context bloat; refuses below 10k chars
- `persistent-memory` (`/`) — cross-conversation markdown memory store; tiered (home / project-local / project-shared) for personal, topic-scoped memory. Its [`rules/scaling-tiers.md`](./skills/authoring/persistent-memory/rules/scaling-tiers.md#lorekit--the-self-improvement-loop-backend) now documents the **LoreKit** backend that the fast-tier self-improvement loops migrated to (the loops no longer use persistent-memory's markdown store), and [`rules/write-pipeline.md`](./skills/authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries) remains the authority for the shared lesson schema. The loops (`autonomous-workflow`, `fix-bug`, `batch-linear-tickets`, `implement-suggestion`, `ci-auto-fix`, `e2e-pr-stabilizer`, `test-auto-fix`, `ideate`, `optimize-approach`, and the `pr-reviewer` agent) now run on LoreKit via the external `lorekit-memory` skill (`npx @lorekit/cli install`): each bucket `<x>-lessons` is a LoreKit tag `loop::<x>-lessons` + key `<x>-lessons::<slug>`, written to `global` (universal) or `repo::{owner}/{repo}` (project-bound), classified at write time. The full bucket taxonomy — all 15 grouped by the three kinds (**Lessons** / **Bus** / **Signal**), each with host, scope, lifetime, producer, consumer, and read cadence, plus the first-class LoreKit `kind` + `host` properties (shipped in lorekit #372 / migration `00056`) that make them queryable and usage-trackable — is [`agents/shared/rules/memory-buckets.md`](./agents/shared/rules/memory-buckets.md). Buckets: `aw-lessons`, `aw-tester-lessons`, `preview-spec-lessons`, `fix-bug-lessons`, `batch-lessons`, `reviewer-lessons`, `implement-suggestion-lessons`, `ci-auto-fix-lessons`, `e2e-pr-stabilizer-lessons`, `test-auto-fix-lessons`, `ideate-lessons`, `optimize-approach-lessons`, `review-outcomes` (volatile 30-day candidate/outcome bus — produced by `implement-suggestion`, consumed by `outcome-learning.md` at promotion time; never read per-review), `reviewer-comment-relevance` (durable 60-day per-repo relevance signal — three write paths: (1) **GitHub Actions reusable workflow** `.github/workflows/reviewer-comment-relevance.yml` — **designed but not yet committed** (this repo's `.github/workflows/` holds only `evals-l1.yml` and `evals-l2.yml`, so a caller's `uses:` reference will not resolve until it lands; see the availability note in [`memory-buckets.md`](./agents/shared/rules/memory-buckets.md)) — any repo adds the caller template from `plugins/pr-relevance-memory/templates/pr-relevance-caller.yml` and calls this workflow via `uses: mthines/agent-skills/.github/workflows/reviewer-comment-relevance.yml@main`; fires on `pull_request_review_thread.resolved` and `pull_request.closed` (merged); calls `scripts/record-comment-relevance.mjs` for real-time classification without any agent in the loop; (2) `implement-suggestion` Phase 7 / `--watch`; (3) `outcome-learning.md` gh-api fallback; consumed by `pr-reviewer` on every review run at Step 0.7 / Step 1.0; requires `LOREKIT_API_KEY` secret; see `agents/shared/rules/comment-relevance-memory.md` and `plugins/pr-relevance-memory/README.md`).

### Agents

The `aw` dispatcher and its two specialist agents are the flagship of this repo (see [`autonomous-workflow`](#workflow--end-to-end-orchestrators)).
They are **generated from templates**, not stored as `agents/*.md`, so searching `agents/` for them returns nothing — search `skills/workflow/autonomous-workflow/templates/` instead (each template's filename matches its installed agent name):

- `aw` — opt-in dispatcher: reads `aw-lessons`, detects tier (Micro/Lite/Full), routes single-pass vs the planner→executor split. Source: [`templates/aw.agent.md`](./skills/workflow/autonomous-workflow/templates/aw.agent.md), installed by `install.sh` as `~/.claude/agents/aw.md`
- `aw-planner` — Full tier, phases 0–2 (validate, plan, worktree + `plan.md`), gated on `confidence(plan) ≥ 90%`. Source: [`templates/aw-planner.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-planner.agent.md), installed as `aw-planner.md`
- `aw-executor` — Full tier, phases 3–7 (implement, test, docs, PR, CI). Source: [`templates/aw-executor.agent.md`](./skills/workflow/autonomous-workflow/templates/aw-executor.agent.md), installed as `aw-executor.md`

The agents below live as `agents/*.md` files and are dispatched by skills:

- `pr-reviewer` — unified PR reviewer — handles both own-work (self relation) and cross-review (cross relation) via `REVIEW_RELATION` set at Step 0.5. The pipeline is identical in both relations — same findings, same gates, same verdict — and only the framing differs: self mode drops the context-asymmetry hedging for direct phrasing, cross mode keeps it. Read-only in both: it never auto-fixes (auto-fix lives in `implement-suggestion` and `code-quality simplify`). **One report comment + inline findings (Step 4):** the report body lives in one PR issue comment per PR, rewritten in place every run and carrying **nothing machine-private**; inline findings stay **append-only** on a visible `COMMENT` review, posted at Step 4b under **exactly one condition — the run has new inline findings**. A review object exists only to carry comments at the code, so a converging `review-loop` leaves one edited report and no timeline noise. The three retired conditions (first run, verdict worsened `PASS<WARN<FAIL`, new blocking fingerprint) were notification devices that posted a review with an empty `comments` array; the accepted cost of dropping them is stated in Step 4b — a verdict that worsens with zero inline findings now updates the report silently, and re-adding it is one condition plus one renderer form. **Run state is a LoreKit state record, not a comment block (Step 0.7 + 4c):** one record per PR — tag `ci::pr-review-state`, key `ci-state::pr-review-<n>`, scope `branch::{owner}/{repo}::{head}`, `kind: bus`, `host: reviewer`, 7-day TTL refreshed on every write — holding the delta baseline, the run-mode history the deep-lens refresh counts, the open-thread set, and the deferred + anchorless findings a re-review carries forward, all **structured**. It replaced a `<!-- PR_REVIEWER_LEDGER -->` block in the report body plus a Markdown re-parse of the agent's own accordion, which coupled the reviewer's memory to its own presentation (a heading rename cost a re-review its carried findings) and forced a whole degraded-ledger sub-system — a truncated copy smuggled onto an append-only review body through a three-rung reduction ladder against a 1500-char budget — because state had to ride on the object that had just failed to write. Now the three writes fail independently: a run that cannot patch the sticky still records its state, so nothing is lost. On a miss or an unreadable record, **one** GitHub rung recovers the delta baseline from the sticky's footer SHA (marker-keyed, never login-keyed) and announces that carry-forward is empty; the retired legacy-report and pointer-ledger fetch ladders are gone. `branch::` scope keeps per-PR state out of the `repo::` scope an agent's SessionStart injection reads, and the record self-cleans on TTL — a LoreKit-side GitHub-integration purge on `pull_request: closed (merged)` is the intended accelerant and is **not yet shipped**. The agent cannot delete a memory: `mcp__lorekit__memory_delete` is deliberately absent from its `tools:` grant. The report body is **not hand-written**: layout lives in one template (`agents/pr-reviewer/templates/report-body.md`) and is filled by one script (`agents/pr-reviewer/scripts/render-report.mjs`) from a **structured** JSON payload the run supplies — counts are derived from array length, links are built by the renderer from `{path, line, url}`, and the footer/`Run mode` lines are derived from a `RUN` object, so a count cannot disagree with its list, a link cannot arrive caged in a code span, and a sha cannot appear at two lengths in one report, so the markup is deterministic and the renderer fails closed (unknown key, missing slot, invalid gate glyph, smuggled `**Verdict**` line ⇒ non-zero exit, nothing on stdout). Committed snapshots in `scripts/eval/fixtures/report-body/*.expected.md` are the reference rendering and are diffed by L1 (G25). This replaced three ~85%-identical embedded templates that five production runs averaged into a remembered shape, dropping the marker and the accordion. The whole report — gate table, run mode, memories, quality, and the open-threads list — lives inside one **collapsed `Review details` `<details>` accordion** (never `<details open>`, never flattened to the top level), so the visible report is a headline plus at most one notice line. Gate 3's open threads render across two slots: `OPEN_THREADS_SUFFIX` appends the open count (plus the blocking subset on ❌) to the accordion's own `<summary>` — visible while collapsed, and the control the reader clicks, so the gate is never silent at zero extra vertical cost — and `OPEN_THREADS_LIST` holds the per-thread bullets inside the accordion right below the gate table. The standalone notice line and the `(<N> memories used)` summary tag are both retired as restatements; memory state renders inside via `MEMORIES_SECTION`. The report is written **only** to the sticky: prior-run detection matches it by marker (never by bot login, which is unresolvable on access paths where `/user` 401s), and an access path that cannot patch an issue comment — or a caller whose own guardrails forbid the write outright, a distinct and equally-covered branch (`STICKY_WRITE_FORBIDDEN`) since an earlier version had no rule for it and improvised ad-hoc report prose instead (`mthines/lorekit#514`-`#518`) — posts a compact pointer carrying just the headline and the reason (no ledger — the state record already has the history), never a second copy of the report; a degraded run with no inline findings posts nothing and reports through the terminal instead. That pointer is itself renderer-owned, not hand-written: both forms (`pointer` / `degraded`) are built from a small JSON payload by `agents/pr-reviewer/scripts/render-pointer.mjs`, fail-closed the same way `render-report.mjs` is, and diffed against `scripts/eval/fixtures/report-pointer/*.expected.md` by L1 (G29). The retired `no_prior` and `escalation` forms served the notification-only reviews and are now *rejected* by name rather than left as unreachable branches, as is any `LEDGER` key or smuggled ledger block. `POST /issues/{n}/comments` is permitted for the sticky and nothing else; inline comments are never edited or deleted. A PR whose only report predates the sticky is treated as a first run — one full review, after which it has a record and a sticky like any other. There is no `--publish` token and no pending/draft workflow. Default-on **optimality lens** (Step 2.4c) via `optimize-approach` — report-only in both relations, applied only by the separate `polish optimize` pass (`--no-optimize` opts out), routed through `agents/shared/rules/optimality-review.md`. Default-on **standards-conformance lens** (Step 2.4d) via `agents/shared/rules/standards-conformance.md` — enforces the repo's own governing docs (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`, review-config `standards:` — default `.github/review.yaml`, legacy root `.review.yaml` still honoured) as real `issue:`/`suggestion:` findings; every finding cites the governing-doc `path:line` as grounding; skip with `--no-standards`. Two-tier holistic review: broad whole-PR pass (Step 2.4) plus default-on **targeted escalation** (Step 2.4b) that fans out parallel, single-target holistic traces on context-dependent findings (cap 10, `--no-escalate` to skip). **Shape-aware depth routing (Step 1.2 / 1.2b):** a deterministic classifier (`agents/pr-reviewer/scripts/classify-shape.mjs`, self-tested by L1 `G33`) types every diff — auth / payments / schema-migration / concurrency / api-contract / infra / secrets / propagation / dependency-bump / test-only / docs-only — and owns the high-stakes path list (repo-extensible via review-config `high_stakes_paths:`); a high-stakes path or a propagation shape (governing doc + restatements) upgrades to `full`, a risky *content* shape in a small delta keeps incremental pricing but runs 2.4b at cap 3 plus Persona 1 shape checklists, and 2.6b Tier-2 receipts are mandatory for behavioral `issue:` findings on those shapes. Delta triage never trusts `compare/<prior>...<head>` blind: a divergence pre-check (summary fields first) routes rebased / force-pushed / merge-commit heads to a blob-SHA authored delta, and a zero authored delta downgrades cost but never predicts a clean pass. Imports shared rules: `verification-receipt.md` (2.6b), `outcome-learning.md` (promotion loop; never per-review), `review-outcomes.md` (shared bus), `review-config.md` (review-config profile / filters / `standards:` schema; default `.github/review.yaml`, legacy root `.review.yaml` honoured), `prior-comment-awareness.md` (dedup + anti-flip-flop when PR exists), `standards-conformance.md` (default-on governing-docs enforcement, Step 1.7b discovery + Step 2.4d lens, `--no-standards`), and `comment-relevance-memory.md` (per-repo LoreKit relevance signal; reads at Step 0.7 / Step 1.0). Memory read is apply-aware: `reviewer-lessons` are matched by `trigger-context` at Step 0.7 / Step 1.0; a diff-keyed `memory.search` (Step 1.2c) augments the top-50 `memory.list` on large repos. The write model is **outcome-driven** — no lessons written in-run; all `reviewer-lessons` writes flow through `outcome-learning.md` post-merge. On a re-review (second+ pass) it runs `thread-resolution.md` at **Step 2.9c — before the verdict and before posting** (moved from the old post-posting Step 4.5): auto-resolves its own addressed/declined threads, removes the successfully-resolved ones from `OPEN_BOT_COMMENTS[]`, re-evaluates Gate 3 against the updated set, and writes to `reviewer-comment-relevance`. Running it after posting published an unblock checklist naming threads the same run closed seconds later. The checklist itself renders as plain bullets (never `- [ ]` task-list checkboxes, which are human-clickable and would contradict the `isResolved` authority) with resolved entries **removed** rather than ticked, plus a `<R> resolved since <sha>` progress counter. **Gate 2 (CI) warns, it never fails** — red or pending CI renders ⚠️, is counted in `WARN_GATE_COUNT` and reported in `CI_NOTE`, and contributes no token to `SEVERITY_TALLY` and no phrase to `FAIL_REASONS`. The agent did not diagnose the failure and cannot separate a real regression from a flaky job, an infrastructure quota, a check that does not run on this base branch, or a draft with no workflow wired up, and GitHub already blocks the merge on a required check; `mthines/lorekit#490` led with `CI failing, 1 error, 2 warnings … Blocking: CI checks failing`, reporting the reviewer as having found something blocking when it had not. A red check the diff demonstrably causes is a Gate 6 finding instead, on this reviewer's own evidence (`F-ci-failed-the-verdict`, guarded by L1 `G27`). **Gate 3 (`Prior review feedback`) is tri-state**, on the same blocking bar as Gate 6, and tracks every open review thread — bot **or** human — labelling each in the report by author type (`(bot · \`login\`)` / `(human · \`login\`)`) rather than calling them all "bot threads": ❌ only when an open thread's ask carries the authoring bot's own blocking decoration (`(blocking)` / `issue:` / an explicit severity label — never re-adjudicated by re-reading the code) **and** `answered == false` (no reply on the thread); otherwise ⚠️, which never flips the verdict. That is what stops a `nitpick:` nobody clicked Resolve on, a suggestion declined on-thread with a rationale, or a finding already fixed in a later commit from failing a PR that has nothing left to fix — the same principle as the existing *an unknown thread never fails it* rule. Both non-passing states render the full `OPEN_THREADS_LIST` (only the summary suffix differs — ` (<K> blocking)` is appended on ❌ and dropped entirely on ⚠️, never `(0 blocking)`), so softening the verdict never shrinks the worklist. **Thoroughness levers (so a weak PR gets everything it deserves, not a trickle across re-reviews):** (1) **deep-lens refresh** — an incremental re-review is promoted back to `full` when cumulative churn since the last full pass exceeds `FULL_REFRESH_DELTA` (150 lines), when `INCR_RUNS_SINCE_FULL` reaches `FULL_REFRESH_RUNS` (3), or when no prior full review is recorded — which includes every run on the fallback rung, since it recovers a baseline but no history — so the holistic passes (2.4/2.4b) never stay skipped forever (Step 0.7 reads `LAST_FULL_SHA` off the record; Step 1.2b upgrades); (2) **confidence defer, not drop** — a near-miss `issue`/`suggestion` (Final in `[max(threshold−15, 50), threshold)`) is deferred to a `Low-confidence findings` advisory body section (`CADV`) instead of being silently dropped — advisory-only, never inline, never auto-applied (`reviewer-report-ingest.md`), never in the `cleared − deferred = posted` identity; (3) **blocking findings are cap-exempt** — a `(blocking)` finding always posts inline and is never deferred, so the per-file/20-total caps govern non-blocking overflow only (`rubric-composition.md § Placement`); (4) **optimality inline pointer** — a proposal with `analysis_confidence ≥ 95` and a resolvable anchor also leaves one short inline `suggestion:` pointer to its body card (`optimality-review.md § Inline pointer`).
- `linear-ticket-investigator` — reads a Linear ticket, returns Evidence Record for `/fix-bug` Phase 2. No analysis / fix / confidence (those live in `/fix-bug`)
- `rca-investigator` — context-isolated root-cause analysis. Wraps `holistic-analysis` (`fix`) + `confidence` (`analysis`) in a fresh sub-agent context and returns only a distilled Root-Cause Record (cause, causal chain, evidence, ruled-out alternatives, confidence, fix direction) — the verbose 8-phase walkthrough never reaches the caller. Read-only; single source of truth for the RCA protocol stays in `holistic-analysis`. Dispatch via `Task()` from `/fix-bug` Phase 3 (isolation alternative to the in-context `Skill("holistic-analysis","fix")`) or `/batch-linear-tickets` fan-out
- `bug-fix-verifier` — independent verifier for `/fix-bug` PRs. FAIL_TO_PASS, PASS_TO_PASS, diff sanity, repro integrity. Only agent allowed to undraft
- `feature-pr-verifier` — feature-PR counterpart for `/autonomous-workflow` Full Mode. Acceptance criteria, pass-to-pass, diff sanity, walkthrough integrity; when `checks.yaml` is present it re-runs every check itself and verifies check integrity (no `ears`/`expect` drift, no unlogged `run` amendments, no special-cased inputs)

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

- `src/extension.ts` — activation entry point; wires `HookEventWatcher`, `PluginInstaller`, adaptive tick, `PrStatusCache`, `PrPoller`, markdown click debounce
- `src/providers/sessions-provider.ts` — `SessionsProvider`; `computeStatus` has a 5-tier override: terminal-open → hook override → unread TTL → terminal-closed → `deriveRunState`
- `src/watchers/hook-event-watcher.ts` — watches `~/.claude/plugins/data/agent-tasks-hooks-agent-skills-plugins/events/*.ndjson` for new events; validates `schemaVersion`
- `src/lib/hook-event-types.ts` — shared `HookEvent` / `HookEventName` types (includes optional `schemaVersion`)
- `src/lib/plugin-data-path.ts` — `getPluginDataDir()`, `getSentinelPath()`, `getHookEventsDir()` path helpers
- `src/lib/plugin-installer.ts` — `PluginInstaller`; first-run consent modal, version check, CLI install, sentinel write
- `src/lib/emit-event.test.ts` — vitest unit tests for `plugins/agent-tasks-hooks/bin/emit-event.js`
- `src/lib/gh-executor.ts` — `GhExecutor` interface + `SystemGhExecutor` default implementation (injectable for tests)
- `src/lib/markdown-click-handler.ts` — pure single-vs-double-click debounce helper; no `vscode` import; `DOUBLE_CLICK_MS = 300`
- `src/lib/pr-status-cache.ts` — `PrStatusCache`; fetches PR enrichment via `gh pr view`, caches per branch with 60s rate limit, no-flip guarantee
- `src/lib/pr-status-reducer.ts` — `resolveDisplayStatus()` pure function; combines `SessionStatus` + `PrEnrichment` → `DisplayStatus`
- `src/lib/pr-poller.ts` — `PrPoller`; polls PR status at 90s cadence, capped at 20 most-recent branches
- `src/parsers/session-jsonl-parser.ts` — pure JSONL parser; `SessionStatus` union includes `unread`; exports `UNREAD_TTL_MS = 24h`
- `src/parsers/checks-parser.ts` — pure tolerant parser for `.agent/{branch}/checks.yaml` (the aw-planner's executable acceptance-check ledger); exports `parseChecksYaml`, `summarizeChecks`, `formatChecksRollup` (`✓ pass/total` rollup on branch + running-session rows), `diffNewUnsatisfiable` (transition detection behind `ArtifactWatcher.onUnsatisfiableCheck` → warning notification, gated by `agentTasks.notifyUnsatisfiableCheck`). Read-only surface — check definitions are executor-immutable; excluded from standalone delete

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

### Plugin: pr-reviewer-shape-guard

`plugins/pr-reviewer-shape-guard/` — GitHub Actions reusable workflow that validates a **posted**
`pr-reviewer` body against the report shape contract, from outside the agent.
Logic lives in `scripts/validate-report-shape.mjs`; the reusable workflow is
`.github/workflows/reviewer-report-shape.yml`, and this repo consumes it via
`.github/workflows/reviewer-report-shape-self.yml` (local `uses:`, which always resolves from the default
branch — `pull_request_review` and `issue_comment` workflows never run a PR's copy, so a change to the
reusable workflow is exercised here only after merge; pre-merge coverage comes from L1 `G26`).
Any repo adds the caller from `templates/report-shape-caller.yml` — no secrets.
Fires on `pull_request_review` and `issue_comment`, posts one sticky notice per PR on a violation,
and never edits or deletes the report itself.
**Why it is the only guard that matters for drift:** L1, the renderer's fail-closed behaviour, the
Step 4a pre-write assertions and the ingest round-trip all run inside the agent's control flow or
against fixtures, so a run that hand-writes the body is invisible to every one of them — observed on
`mthines/lorekit#503`, where one definition produced the correct shape three times and a flat,
marker-less body on the fourth run 24 minutes later. Guarded by L1 `G26`, which executes the
validator against real posted bodies kept in `scripts/eval/fixtures/posted-bodies/`.

### Plugin: pr-relevance-memory

`plugins/pr-relevance-memory/` — GitHub Actions reusable workflow distribution plugin.
Provides the caller template (`templates/pr-relevance-caller.yml`) that any repository
copies once to wire up real-time PR comment resolution signals to LoreKit.
The logic lives in `.github/workflows/reviewer-comment-relevance.yml` (a reusable workflow);
the caller references it via `uses: mthines/agent-skills/.github/workflows/reviewer-comment-relevance.yml@main`.
Fires on `pull_request_review_thread: resolved` (per-thread) and `pull_request: closed` (merged sweep).
Calls `scripts/record-comment-relevance.mjs` for classification; writes to the
`reviewer-comment-relevance` LoreKit bucket scoped to the caller's repository.
Requires `LOREKIT_API_KEY` secret in the caller repo's Actions secrets.
See `plugins/pr-relevance-memory/README.md` for the two-step installation guide.

### Markdown artifact click-open model

All markdown artifact rows in both trees (Agent Tasks `agentTasksExplorer` and Sessions `agentSessionsExplorer`) use a single-vs-double-click debounce routed through the shared `agentTasks.openMarkdown` command:

- **Single click** → opens the rendered markdown preview (`markdown.showPreview`).
  The action fires after a 300 ms window with no second click, so a double click never flashes the preview.
- **Double click** → opens a persistent, editable editor tab (`vscode.window.showTextDocument` with `{ preview: false }`).
  Triggered when a second click on the same path arrives within 300 ms of the first.

This applies to plan, task, walkthrough, diagnose, and other-markdown rows.
The 300 ms double-click window is `DOUBLE_CLICK_MS` in `src/lib/markdown-click-handler.ts`.

The `ArtifactWatcher.openArtifact` programmatic auto-open path (triggered when a new artifact is generated by an agent) always opens an editable editor directly — it does not route through the click debounce.

The deprecated `agentTasks.openMarkdownInPreview` setting remains a no-op; the click model above supersedes it.

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

- **L1 — deterministic contract checks** (`node scripts/eval/l1.mjs`): no LLM, no cost, gated in CI ([`.github/workflows/evals-l1.yml`](./.github/workflows/evals-l1.yml)) on every PR. Asserts link/anchor integrity (baseline-ratcheted), the `aw` tier table ≡ `SKILL.md` Step 1, the `plan.md` Core-section contract (runs the actual `confidence` rule #2/#3 idioms — incl. the #31 regression — plus the v3.15 rule #9 requirement-coverage, rule #10 create-⇒-survey, and rule #11 checks.yaml ID-sync idioms), `diagnose` skill resolvability, lesson-scope storage, frontmatter sanity, and cross-file contract guards (the `seen_count` UPDATE sentence shared verbatim across its three owners, fast-lane plan ⊇ Core-8 sections, `/critical`'s Must-fix bucket in `implement-suggestion`, the real `confidence(code)` contract in the per-comment gate, and a forbidden-phrase list for audited contradictions).
- **L2 — behavioral evals** (`ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs`): data-driven runner, one suite per labelled decision — `tier-routing`, `bug-class`, `complexity-triage`, `aw-should-trigger`, `reviewer-agreement-bump`, `optimize-approach-optimality`, `severity-tiering`, `shape-depth-routing` (pr-reviewer Step 1.2b: full vs. escalate-in-incremental vs. cheap, against the live 1.2b rules), `code-review-retrieval-relevance` (golden sets in `scripts/eval/golden/`). Each reads the skill's live rubric section and exact-matches the model's choice. In CI via [`.github/workflows/evals-l2.yml`](./.github/workflows/evals-l2.yml) — runs on rubric/golden changes + manual dispatch, needs an `ANTHROPIC_API_KEY` repo secret, soft-gates per suite at a 70% catastrophic floor (golden sets < 50 ⇒ report-only-ish per `evals.md`). Skips cleanly without a key. Add a suite: golden JSONL + a `SUITES` entry in `l2.mjs`. The `code-review-retrieval-relevance` suite (PR B2) measures whether `pr-reviewer`'s documented Step 1.0 + 1.2c read surfaces the right lessons for a given diff; ground truth is the outcome signal (`loop::reviewer-lessons` / `loop::reviewer-comment-relevance` + `seen_count >= 3`), with a BOOTSTRAP SEED golden set (not a real baseline — real corpus is hosted-only).

When a lesson is promoted via `diagnose`, add a golden case so the fix is locked. Methodology: [`ai-engineering/rules/evals.md`](./skills/quality/ai-engineering/rules/evals.md).

## Prose Rules

- One sentence per line (semantic line breaks).
- Use inline Markdown links.
- Fence code with language identifier.
- End sentences with full stops.
- Use the Oxford comma.
