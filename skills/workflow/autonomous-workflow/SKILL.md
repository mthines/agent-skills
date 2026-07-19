---
name: autonomous-workflow
description: >
  Execute complete feature development cycles autonomously — from task intake
  through tested PR delivery — using isolated Git worktrees. Phase-based
  workflow (0–7) with optional companion skills for planning, quality gates,
  TDD, UX, code quality, docs, and CI verification. Companions skip silently
  if not installed. Triggers on "implement autonomously", "end-to-end", "in
  isolation", "in a worktree", or independent feature work. Invoke with
  /autonomous-workflow.
disable-model-invocation: false
argument-hint: '<task-description> [--no-confirm] [--critical]'
license: MIT
metadata:
  author: mthines
  version: '3.16.0'
  workflow_type: orchestrator
  tags:
    - autonomous
    - workflow
    - worktree
    - feature-development
    - pr
---

# Autonomous Workflow

Phase-based autonomous feature development. Each phase has a gate that must pass
before continuing. Phases optionally invoke companion skills based on the task —
companions skip silently if not installed.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures
> live in `rules/*.md` and load on demand. Companion-skill triggers and
> disable instructions live in [`rules/companion-skills.md`](./rules/companion-skills.md).

---

## Self-Improvement

The workflow improves across runs through a **two-tier loop** (full contract in
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)):

**Fast tier — episodic lessons (`persistent-memory`, optional companion).** The
workflow reads accumulated lessons before planning (Phase 1) and writes new ones
when it gets stuck (Phase 4) or finishes (Phase 7), in the committed
`aw-lessons` scope. Lessons are **advisory** — they bias the plan, never
silently change a gate. Skips silently if `persistent-memory` is not installed.
**When invoked through the `aw` dispatcher, the read/write is hoisted to the
dispatcher** (intake + exit) so **every tier** — Micro, Lite, and Full — both
benefits from and contributes lessons; the phase-level reads/writes are the
Full-tier specialization. This is how self-improvement stays universal without
forcing planning on simple tasks.

**Slow tier — retrospective diagnosis.** When a run shipped wrong code despite
all gates passing — or a post-merge bug traces back to a missed check, or a
lesson recurs `seen_count >= 3` — invoke
[`/create-skill diagnose autonomous-workflow`](../../authoring/create-skill/SKILL.md#diagnose-workflow)
**while the failing session is still in context**. The diagnoser reads this
skill's [diagnostic surface](./rules/diagnostic-surface.md) (phase model,
failure taxonomy, existing-guards table, hard invariants) — and the `aw-lessons`
history as evidence — then emits a confidence-gated unified-diff proposal
against this skill's source, applied only at `confidence(analysis) ≥ 90 %` with
explicit user confirmation.

The fast tier captures lessons cheaply and reversibly; recurrence promotes a
proven lesson into a permanent guard through the gated slow tier. The diagnose
engine is owned by `create-skill` so the same procedure works across every
skill in the repo (`fix-bug`, `batch-linear-tickets`, future ones) — they each
declare their own diagnostic surface.

---

## CRITICAL: Before Starting Any Work

### Step 1: Detect Workflow Mode (MANDATORY)

**Complexity is the primary signal. File count is the tie-breaker.** Walk these
questions in order — the first `yes` selects Full Mode:

| # | Question                                                                                  | If yes →     | If no →     |
| - | ----------------------------------------------------------------------------------------- | ------------ | ----------- |
| 1 | Is this task architectural / cross-cutting / does it require significant design decisions? | **Full**     | go to next  |
| 2 | Does the task involve unfamiliar code or domains the agent hasn't worked in before?       | **Full**     | go to next  |
| 3 | Is the change touching 4+ files OR 2+ packages?                                           | **Full**     | go to next  |
| 4 | Is the change 2–3 files, OR any non-trivial logic change?                                 | **Lite**     | **Micro**   |

| Tier      | Files / shape                                  | Artifacts | Planning            | Companions      |
| --------- | ---------------------------------------------- | --------- | ------------------- | --------------- |
| **Full**  | complex / 4+ files / unfamiliar                | Required  | planner → `plan.md` | all applicable  |
| **Lite**  | 2–3 files, simple logic                        | None      | brief mental plan   | per signal      |
| **Micro** | 1 file, purely mechanical (typo, copy, bump)   | None      | none (skip planning)| none (docs if drift) |

**Micro** follows the same phase path as Lite but skips planning and all quality
companions — it is the "skip planning when it's trivial" tier. **Phase 0 and
Phase 2 stay mandatory in every tier**, including Micro.

The first two questions ground the decision in complexity rather than raw file
count (one large monolithic change can exceed four trivial edits in scope).
Question 3 is the file-count tie-breaker — only fires when complexity is low.

**When in doubt, choose Full.** Output mode selection in this exact format:

```
MODE SELECTION:
- Tier: [Micro | Lite | Full]
- Reasoning: [why]
- Estimated files: [number]
- Complexity: [trivial | simple | moderate | architectural]
- Lessons applied: [N matched, or none]
```

This block is canonical — the dispatcher template, the planner template, and
[`rules/phase-0-validation.md`](./rules/phase-0-validation.md) emit it
field-for-field identically.

### Step 2: Verify Prerequisites

| Tool | Status      | Check       | If missing                                                  |
| ---- | ----------- | ----------- | ----------------------------------------------------------- |
| `gh` | **REQUIRED**| `which gh`  | Stop, prompt user to install                                |
| `gw` | Recommended | `which gw`  | Continue with native `git worktree` fallback (warn user once)|

`gh` is hard-required for Phase 6 (PR creation) and Phase 7 (CI gate).
`gw` is recommended — it adds auto-copy of secrets, pre/post-checkout hooks,
and smart cleanup — but the workflow falls back to native `git worktree` if
it's not installed. See [`rules/prerequisites.md`](./rules/prerequisites.md)
for the full feature comparison and installation steps.

---

## Workflow Phases

| Phase | Name                       | Rule file                                                      | Gate                                          |
| ----- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 0     | Validation                 | [phase-0-validation.md](./rules/phase-0-validation.md)         | User confirmed understanding                  |
| 1     | Planning                   | [phase-1-planning.md](./rules/phase-1-planning.md)             | `confidence(plan)` ≥ 90% or user-approved     |
| 2     | Worktree Setup             | [phase-2-worktree.md](./rules/phase-2-worktree.md)             | Worktree created, `plan.md` written           |
| 3     | Implementation             | [phase-3-implementation.md](./rules/phase-3-implementation.md) | Code complete, fast checks pass               |
| 4     | Testing                    | [phase-4-testing.md](./rules/phase-4-testing.md)               | All tests pass OR user-approved stop          |
| 5     | Documentation              | [phase-5-documentation.md](./rules/phase-5-documentation.md)   | Docs reflect changes (incl. `CLAUDE.md`)      |
| 6     | PR Creation                | [phase-6-pr-creation.md](./rules/phase-6-pr-creation.md)       | Walkthrough shown, draft PR opened            |
| 7     | CI Gate + Optional Cleanup | [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md)               | CI green OR user-approved stop                |

**Phase 0 and Phase 2 are MANDATORY.** All others gate progression to the next.

**Phase 0 pre-authorization (`--no-confirm`).**
If the invocation contains an explicit autonomy grant — the phrase "proceed without confirmation" or the `--no-confirm` flag — Phase 0 still runs, but posts its understanding summary and proceeds immediately instead of waiting for the user's "proceed".
The grant never covers a `blocking` missing-information gap: a load-bearing unknown (Phase 0 Step 3c) halts and asks regardless.
Default behavior without the grant is unchanged.
See [phase-0-validation.md](./rules/phase-0-validation.md#step-5-get-explicit-confirmation).

---

## Companion Skills

Optional companions are invoked at specific phases based on task signals.
**All companions skip silently if not installed** — the workflow continues
without them. See [`rules/companion-skills.md`](./rules/companion-skills.md)
for the full registry, trigger conditions, and **how to disable any companion**.

| Phase | Companion              | Trigger                                                | Args             |
| ----- | ---------------------- | ------------------------------------------------------ | ---------------- |
| 1     | `persistent-memory`    | Always — read accumulated workflow lessons before design (fast-tier self-improvement) | `read aw-lessons --tier home` |
| 1     | `holistic-analysis`    | Complex / multi-domain / unfamiliar task               | —                |
| 1     | `code-quality`         | Always (informs design)                                | `plan`           |
| 1     | `critical`             | Opt-in only (user passed `--critical` to the workflow). Single adversarial pre-mortem pass between `code-quality(plan)` and `confidence(plan)`. Findings flow into `aw-create-plan` as plan defects (must-fix) and considered-alternatives notes (steelman). Advisory — does not gate. | `plan` |
| 1     | `optimize-approach`    | Default-on in Full Mode (quiet early-exit; skip on `--no-optimize`). "Is this the most optimal approach?" pass between the pre-mortem and `confidence(plan)`. Adopted proposals trigger a bounded re-plan via `aw-create-plan`. Advisory — does not gate. | `plan` |
| 1     | `confidence`           | Always (plan gate, MANDATORY)                          | `plan`           |
| 2     | `aw-create-plan`       | Full Mode only                                         | —                |
| 3     | `persistent-memory`    | Executor entry — read lessons when `plan.md` has no `## Lessons applied` (no-planner paths) | `read aw-lessons --tier home` |
| 3     | `tdd`                  | Pure logic / business rules / "test-driven"            | —                |
| 3     | `ux`                   | UI files touched (`*.tsx`, `*.jsx`, `*.vue`, RN)       | —                |
| 3     | `code-quality`         | Once at end of Phase 3 (not per-file)                  | `code`           |
| 4     | `test-provenance-guard` | After Step 5 — any new `*.test.*` / `*.unit.*` / `*.spec.*` file written | `--diff --base $(git merge-base HEAD main) --fix` *(autofix gated by `confidence(code) ≥ 90 %`)* |
| 4     | `confidence`           | At iteration cap (3 Lite / 5 Full) on same failing area | `analysis`   |
| 4     | `holistic-analysis`    | After confidence at Phase 4 if user asks for retry     | —                |
| 4     | `persistent-memory`    | At stuck-loop escalation — record failing area + resolution as a lesson | `write aw-lessons --tier home --auto` |
| 5     | `docs`                 | Always (self-improving doc loop — updates `CLAUDE.md`, `README.md`, `docs/`) | `update --auto`  |
| 6     | `reviewer` *(agent)*   | Always before push — dispatched directly via the Agent tool (Fix Mode on own branch; auto-fix all Simple findings across every severity) | `--critical` + auto-fix-all prompt |
| 6     | `aw-review-quality-gate` | After the `reviewer` agent returns findings — false-positive filter (advisory) | —                |
| 6     | `aw-create-walkthrough` | Full Mode only                                        | —                |
| 6     | `create-pr`            | Always                                                 | —                |
| 7     | `ci-auto-fix`          | CI run completes with status `failure`                 | `<run-id\|pr-url>` |
| 7     | `persistent-memory`    | End-of-run (CI green / user stop / post-merge bug) — record durable run lessons; check promotion | `write aw-lessons --tier home --auto` |
| 7     | `reviewer` *(agent)*   | After CI green — auto-dispatch in PR Mode (self-review sub-mode for self-authored PRs: inline report + auto-fix every Simple finding regardless of severity, incl. Nitpick / Nice-to-have; cross-author PR redirects to `pr-reviewer`) | `<pr-url> --critical` + auto-fix-all prompt |

---

## Core Principles

1. **Detect the tier FIRST** — Micro vs Lite vs Full before any other action.
2. **Phase 0 and Phase 2 are MANDATORY** — no skipping validation or worktree.
3. **`plan.md` is the single source of truth** in Full Mode — generated by `Skill("aw-create-plan")`.
4. **Verify after editing** — fast check before continuing.
5. **Stuck-loop has a mode-aware limit**: 3 iterations (Lite) / 5 iterations (Full) on the same failing area triggers `Skill("confidence", "analysis")` and auto-replan or escalation.
6. **Companions are optional** — never block on a missing companion.
7. **Stop and ask when blocked** — don't guess on ambiguity. A `blocking` missing-information gap (Phase 0 Step 3c) halts even under `--no-confirm`.
8. **No AI co-author tags** — never add `Co-Authored-By` lines to commits or PRs.
9. **Acceptance criteria are traceable and executable** in Full Mode — `AC-{n}` IDs cover every user-stated requirement (rule #9), planned `create`s carry an Existing Code Survey verdict (rule #10), and `checks.yaml` (rule #11) is Phase 4's mechanical termination condition. Check definitions are executor-immutable; all-green is necessary, never sufficient.

---

## Artifact System (Full Mode)

Three artifacts in `.agent/{branch-name}/`, each generated by a dedicated skill:

| File(s)                                | Generated by                     | When                                              |
| -------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `plan.md` + `plan.v{N}.md` snapshots   | `Skill("aw-create-plan")`        | After Phase 2 — and on every plan iteration       |
| `checks.yaml`                          | `Skill("aw-create-plan")` (Step 2b) | With the plan — one executable check per `AC-{n}`; Phase 4's termination condition |
| `walkthrough.md`                       | `Skill("aw-create-walkthrough")` | Phase 6                                           |

`plan.md` always points at the latest version. Each call to `aw-create-plan`
also writes an immutable `plan.v{N}.md` snapshot (`plan.v1.md` on the first
run, `plan.v2.md` on the next, …) so iteration history is preserved. See
[`rules/artifacts-overview.md#plan-versioning`](./rules/artifacts-overview.md#plan-versioning).

Add `.agent/` to `.gitignore`. Files are grouped by branch for easy browsing.

> The directory is named `.agent/` (singular) to align with the `~/.agents/skills/`
> cross-tool discovery convention used by Codex, Cursor, OpenCode, and other
> Agent Skills–compatible clients. The agent identity is implicit in artifact
> frontmatter; the directory itself is a per-project agent workspace.

---

## Parallelization

Three phases benefit from sub-agent fan-out:

- **Phase 1 (Planning)** — when the task is complex/multi-domain, spawn parallel `Explore` sub-agents during research (one per package, one for past PRs, one for related docs). See [phase-1-planning.md](./rules/phase-1-planning.md#parallel-research).
- **Phase 3 (Implementation)** — when the task decomposes into file-disjoint slices, fan out up to **3 concurrent sub-agents** (hard cap, RAM-bounded). Each sub-agent MUST embed the Sub-Agent Resource Discipline line — scoped commands only, no whole-project `tsc`/`lint`/`test`/`build`. See [parallel-coordination.md#sub-agent-resource-discipline](./rules/parallel-coordination.md#sub-agent-resource-discipline).
- **Phase 7 (CI Gate)** — when multiple CI checks fail, spawn one `ci-auto-fix` sub-agent per independent failure. Cap: 2 handoffs per PR. See [phase-7-ci-gate.md](./rules/phase-7-ci-gate.md#parallel-ci-fixes).

---

## Quick Reference

### Full Mode

| Phase | Action                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------- |
| Setup | MODE SELECTION + prerequisite check                                                             |
| 0     | Restate-and-diff the requirements, run the missing-information gate (`blocking` halts even under `--no-confirm`), ask clarifying questions, get explicit "proceed" |
| 1     | Analyze codebase (dependency-graph localization first; parallel `Explore` if complex), Existing Code Survey per planned `create`, traceable EARS-shaped ACs, design with `code-quality(plan)`, `optimize-approach(plan)` approach check, `confidence(plan)` gate |
| 2     | `gw add`, `gw cd`, install deps, `Skill("aw-create-plan")` inside worktree (writes `plan.md` + `checks.yaml`)   |
| 3     | Code per `plan.md` → companions per task type (`tdd`, `ux`) → fast-check after each edit; `code-quality(code)` once at end |
| 4 (UI)| **First:** `aw-tester` cold pass at Phase 4 entry (full sub-agent, structured verdict); subsequent iterations run the persisted `last-run.spec.ts` directly via Bash (hot loop, no sub-agent) until `green`/`inconclusive`; promote `critical-path` specs via `e2e-testing` Generator |
| 4     | Run tests → iterate (cap: 5 same area in Full Mode) → run `checks.yaml` checks (all must pass; definitions immutable; `unsatisfiable` escalates) → `confidence(analysis)` at cap → one-shot auto-replan or escalate to user |
| 5     | `Skill("docs", "update --auto")` always — refreshes `CLAUDE.md`, `.claude/rules/`, `README.md`, `docs/`, `CHANGELOG.md` |
| 6     | Dispatch `reviewer` agent (`--critical`, auto-fix every Simple finding across all severities) → `Skill("aw-create-walkthrough")` → `Skill("create-pr")` |
| 7     | Watch CI → `Skill("ci-auto-fix")` per failure (parallel) → after CI green dispatch `reviewer` agent (`<pr-url> --critical`, PR Mode self-review sub-mode: auto-fix every Simple finding incl. Nitpick / Nice-to-have, emit inline report; optional, skips if not installed) → `gw remove` after merge (optional) |

### Lite Mode

Skip artifacts and most companions. Phase 0, Phase 2, Phase 5 (`docs update`), and Phase 6 (`create-pr`) still required.

| Phase | Action                                          |
| ----- | ----------------------------------------------- |
| Setup | MODE SELECTION                                  |
| 0     | Quick clarification                             |
| 1     | Brief mental plan (no `plan.md`)                |
| 2     | `gw add fix/bug-name`                           |
| 3     | Code, commit                                    |
| 4     | Test, fix failures (3-iteration limit applies)  |
| 5     | `Skill("docs", "update --auto")`       |
| 6     | `Skill("create-pr")`                            |
| 7     | Watch CI, `ci-auto-fix` if needed, then auto-dispatch `reviewer` agent with `--critical` + auto-fix-all-Simple-severities prompt (skips if not installed) |

---

## Customization

Disable companions by editing [`rules/companion-skills.md`](./rules/companion-skills.md)
(single source of truth for which skills run when) or by removing the
invocation block from the relevant phase rule. See [`README.md`](./README.md#disabling-companions)
for the full how-to.

---

## Templates

The skill installs **four agents** under the **`aw-` namespace prefix** (short
for "autonomous-workflow") so they group together in `.claude/agents/` and are
unmistakable when listed alongside unrelated agents:

| Agent          | Role | Terminal artifact                              | Exit gate                                          |
| -------------- | ---- | ---------------------------------------------- | -------------------------------------------------- |
| `aw`           | **Opt-in dispatcher.** Reads lessons, detects tier (Micro/Lite/Full), routes single-pass vs the split, owns the self-improvement loop for every tier. | — (delegates) | Task routed + exit lesson written |
| `aw-planner`   | Full-tier, phases 0–2 | `.agent/{branch}/plan.md` + `checks.yaml` + `specs.md` (UI tasks) | `confidence(plan) ≥ 90%` (or user-approved) |
| `aw-executor`  | Full-tier, phases 3–7 | `.agent/{branch}/walkthrough.md` + draft PR    | Walkthrough shown inline, Phase 7 CI gate run      |
| `aw-tester`    | Phase 4 (UI) spec verification — **cold pass only** (Phase 4 entry, escalation, Phase 7 rehearsal). Iteration uses the persisted `last-run.spec.ts` directly via Bash, not a sub-agent. | Verdict block (~200 tokens) with `hot_loop:` paths for direct re-run | `green` or `inconclusive` before lint/type/test |

**`aw` is the single entry point developers opt into** (a trigger phrase or
`@aw`). It is adaptive, not always-heavy: Micro/Lite run single-pass in `aw`'s
own context; **Full** hands off to the planner→executor split. The split is
along the Phase 2 → Phase 3 context boundary, mediated by `plan.md`, and is
reserved for Full because its context-isolation + resumable-artifact benefits
only pay for complex/long tasks (always-planning wastes compute and degrades
long-horizon performance — see `references/anthropic-architecture-research.md`). The handoff is gated: high-confidence plans flow through
automatically; borderline plans pause for user approval. The design rationale
(with verbatim Anthropic citations) lives in
[`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md);
the full handoff contract is in
[`rules/planner-executor-handoff.md`](./rules/planner-executor-handoff.md).

**UI verification prerequisite:** run `/aw-setup` once per project before the
first autonomous UI task. This scaffolds `.claude/aw-targets/local.yml` and
validates it with a smoke spec. The planner halts and prompts if no aw-target
exists — do not auto-scaffold.

| Template                                                         | Purpose                                  |
| ---------------------------------------------------------------- | ---------------------------------------- |
| [aw.agent.md](./templates/aw.agent.md)                           | `aw` dispatcher agent (tier routing + loop) |
| [aw-planner.agent.md](./templates/aw-planner.agent.md)           | Planner agent definition (phases 0-2) — emits specs.md for UI tasks |
| [aw-executor.agent.md](./templates/aw-executor.agent.md)         | Executor agent definition (phases 3-7)   |
| [aw-tester.agent.md](./templates/aw-tester.agent.md)             | Spec-driven UI verification (Phase 4) — dispatched by executor |
| [routing.rule.md](./templates/routing.rule.md)                   | Auto-trigger rule for `.claude/rules/`   |
| [aw-target.yml.template](./templates/aw-target.yml.template)     | Aw-Target schema (base URL, auth, fixtures) |
| [specs.md.template](./templates/specs.md.template)               | Specs file schema with example blocks    |

---

## Auto-Trigger Setup (Recommended)

Install the skill, its companions, and the `aw-*` agents in one step:

```bash
git clone https://github.com/mthines/agent-skills.git
cd agent-skills
bash scripts/sync-symlinks.sh --aw
```

`--aw` symlinks the autonomous-workflow skill and its 12 companion skills
into `~/.claude/skills/`, plus the `aw` / `aw-planner` / `aw-executor` agents
into `~/.claude/agents/`. The `reviewer` agent (optional Phase 6/7 review) is
also linked; remove its symlink and Phase 7 logs `reviewer — not available,
continuing` and proceeds. Edits to the cloned repo are picked up live on the
next agent turn.

The routing rule dispatches `aw`, which detects the tier and routes —
Micro/Lite single-pass, or planner→executor for Full. After install, Claude
auto-triggers on phrases like *"implement X independently"*, *"in isolation"*,
*"end-to-end"*.

To install the full repo (not just the AW bundle) drop the `--aw` flag. For
the per-project install, the no-clone `npx skills add` alternative, or
per-companion disabling, see the [README](./README.md#installation) and
[`rules/companion-skills.md`](./rules/companion-skills.md).

---

## Related Skills

- [`confidence`](../../quality/confidence/SKILL.md) — quality gate (plan, code, analysis)
- [`aw-create-plan`](../aw-create-plan/SKILL.md) — `plan.md` artifact generator
- [`aw-create-walkthrough`](../aw-create-walkthrough/SKILL.md) — `walkthrough.md` artifact generator
- [`aw-setup`](./aw-setup/SKILL.md) — **one-time UI aw-target scaffolding** (prerequisite for `aw-tester`; run `/aw-setup` once per project before the first autonomous UI task)
- [`code-quality`](../../quality/code-quality/SKILL.md) — readability and complexity review
- [`tdd`](../../quality/tdd/SKILL.md) — RED-GREEN-REFACTOR enforcement
- [`ux`](../../design/ux/SKILL.md) — UI / accessibility review
- [`holistic-analysis`](../../analysis/holistic-analysis/SKILL.md) — execution-path analysis for complex tasks
- [`docs`](../../authoring/docs/SKILL.md) — keeps `CLAUDE.md`, `.claude/rules/`, `README.md`, and `docs/` in sync with code changes
- [`review-changes`](../../quality/review-changes/SKILL.md) — pre-PR review
- [`create-pr`](../../delivery/create-pr/SKILL.md) — narrative PR description + push + watch
- [`ci-auto-fix`](../../delivery/ci-auto-fix/SKILL.md) — diagnose and fix failed CI checks
- [`persistent-memory`](../../authoring/persistent-memory/SKILL.md) — backs the `aw-lessons` and `aw-tester-lessons` fast-tier self-improvement loops
- [`e2e-testing`](../../testing/e2e-testing/SKILL.md) — Generator for promoting `critical-path` specs to saved `*.spec.ts` at end of Phase 4

### Related Agents

- [`aw-tester`](./templates/aw-tester.agent.md) — spec-driven UI verification agent. Dispatched by the executor in Phase 4 (before lint/type/test) and optionally in Phase 7 (spec rehearsal against preview). Requires an aw-target at `.claude/aw-targets/` — run `/aw-setup` first.
- [`reviewer`](../../../agents/reviewer.md) — optional Phase 6 pre-push review AND Phase 7 post-CI auto-review. Both passes are dispatched with `--critical` (forces the adversarial pre-mortem via `Skill("critical", "code")`) and an auto-fix-everything prompt — every Simple finding is applied to the working tree regardless of severity (Critical / High / Medium / Low / Nitpick / Nice-to-have), per `agents/reviewer/rules/auto-fix-policy.md`. Phase 6 lands in Fix Mode (own branch); Phase 7 lands in PR (self-review) sub-mode (self-authored PR — inline terminal report, no GitHub posts). On someone else's PR the reviewer redirects to the `pr-reviewer` agent. Install the agent alongside the skill and the workflow will dispatch it automatically.

---

## Research Sources

- [Addy Osmani's LLM Workflow](https://addyosmani.com/blog/ai-coding-workflow/) — fast feedback loops
- [Claude Code Worktree Support](https://code.claude.com/docs/en/common-workflows) — worktree practices
- Full Anthropic architecture citations: [`references/anthropic-architecture-research.md`](./references/anthropic-architecture-research.md)
