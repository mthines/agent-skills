---
title: autonomous-workflow — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - autonomous-workflow
  - meta
---

# autonomous-workflow — Diagnostic Surface

This file declares the contract `/create-skill diagnose autonomous-workflow` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/workflow/autonomous-workflow/`

---

## Phase model

| Phase | Name                       | Rule file                                                      | Gate                                          |
| ----- | -------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| 0     | Validation                 | [phase-0-validation.md](./phase-0-validation.md)               | User confirmed understanding                  |
| 1     | Planning                   | [phase-1-planning.md](./phase-1-planning.md)                   | `confidence(plan)` ≥ 90 % or user-approved    |
| 2     | Worktree Setup             | [phase-2-worktree.md](./phase-2-worktree.md)                   | Worktree created, `plan.md` written           |
| 3     | Implementation             | [phase-3-implementation.md](./phase-3-implementation.md)       | Code complete, fast checks pass               |
| 4     | Testing                    | [phase-4-testing.md](./phase-4-testing.md)                     | All tests pass OR user-approved stop          |
| 5     | Documentation              | [phase-5-documentation.md](./phase-5-documentation.md)         | Docs reflect changes (incl. `CLAUDE.md`)      |
| 6     | PR Creation                | [phase-6-pr-creation.md](./phase-6-pr-creation.md)             | Walkthrough shown, draft PR opened            |
| 7     | CI Gate + Optional Cleanup | [phase-7-ci-gate.md](./phase-7-ci-gate.md)                     | CI green OR user-approved stop                |

---

## Existing guards per phase

| Phase | Existing guards                                                                                                  | Typical gaps                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 0     | Tier detection (Micro/Lite/Full) via the `aw` dispatcher; user confirms understanding; restate-and-diff of requirements; missing-information gate (`blocking` halts even under `--no-confirm`) | Tier under-selected (a Full task routed as Micro/Lite) → planner `confidence(plan)` gate + quality companions skipped; Micro chosen for a change that carried hidden logic; a load-bearing unknown classified `assume-and-proceed` instead of `blocking` (hallucinated requirement) |
| 1     | `persistent-memory(read aw-lessons --tier home)` (fast-tier lessons applied as constraints); dependency-graph-first localization; Existing Code Survey per planned `create` (rule #10); AC traceability `AC-{n}` + `(covers: R{m})` (rule #9); `code-quality(plan)`; `optimize-approach(plan)` (default-on approach-optimality pass, advisory, bounded re-plan); `confidence(plan)` ≥ 90 % gate (LLM + deterministic rule checks) | Plan missed a hidden constraint; rule checks didn't cover the failure shape; a recorded lesson existed but its `trigger-context` didn't match the task so it wasn't applied; reuse search ran by name not responsibility so a semantic duplicate shipped anyway; `optimize-approach(plan)` re-surfaced Survey/`critical` output as noise, or its adopted re-plan looped |
| 2     | Worktree isolation; `aw-create-plan` writes `plan.md` (Core sections always; Extended sections per `Include when` trigger) + `checks.yaml` (one check per `AC-{n}`, rule #11 sync) | `plan.md` missing a Core section the executor / gate rely on, OR an Extended section omitted when its trigger actually applied; `checks.yaml` drifted from the plan's ACs |
| 3     | `tdd` (RED-GREEN-REFACTOR + mutation); `ux`; `code-quality(code)` at end; Sub-Agent Resource Discipline (resource-discipline language embedded in each fan-out dispatch prompt) | Companion not triggered because trigger condition was too narrow; mutation step skipped in non-TDD path; fan-out dispatch block missing the discipline language (F2) |
| 4     | Stuck-loop cap (3 Lite / 5 Full); `confidence(analysis)`; auto-replan via `holistic-analysis`; Executable Checks Loop (checks.yaml as termination condition; definitions executor-immutable; abort affordance); `persistent-memory(write aw-lessons)` at escalation | Tests passed first try → no RED phase → no mutation check; cap miscounted; lesson not written so the same stuck-loop recurs next run; a check greened by gaming (special-cased inputs) instead of a real fix |
| 5     | `docs update`                                                                                                    | Skip condition matched wrongly; `CLAUDE.md` / `README.md` / `docs/` drift                                     |
| 6     | `review-changes`; `aw-create-walkthrough`; `create-pr`                                                           | Reviewer didn't compare diff against `plan.md`; walkthrough hid the issue                                     |
| 7     | CI watcher; `ci-auto-fix`; optional `reviewer` agent (PR Mode); `persistent-memory(write aw-lessons)` end-of-run + promotion check | CI passed because tests were narrow; `reviewer` not installed; recurring lesson (`seen_count >= 3`) not promoted to a permanent guard |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                  | Symptom                                                                                       | Primary phase | Primary companion / gate                                          |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F1      | Test-by-construction   | New test imports a private copy of the SUT or duplicates its body — passes regardless of prod | 4             | `test-provenance-guard` (static + mutation) — should have run     |
| F2      | Sub-agent resource contention | Phase 3 fan-out dispatches sub-agents with whole-project `tsc`/`lint`/`test`/`build` commands; N concurrent processes saturate developer host RAM (OOM). Root cause: sub-agent prompt inherits whole-project validation commands without scoping. | 3 | Sub-Agent Resource Discipline rule — the discipline language should have been embedded in the dispatch prompt |
| F3      | Plan artifact lacks human-review surface | `plan.md` has no fast-read TL;DR optimized for direction agreement; the user cannot evaluate the planner's direction in under 60 seconds, so the handoff "review" path requires reading the full plan | 2 | `aw-create-plan` template — TL;DR section + validation checklist |
| F4      | Planner edit-driven iteration gap | After `plan.md` is written and the handoff message is emitted, the user has no way to edit `plan.md` directly and have the planner consume those edits as new constraints. Today the only options are accept-as-is, `refine` (planner-driven only), or abandon. Compounded by `plan.md` lacking a `version:` frontmatter field that would survive iterations. | 2 → 3 handoff | `rules/planner-executor-handoff.md` — Edit-driven iteration loop + `iterate` reply option in both handoff messages; `skills/workflow/aw-create-plan/SKILL.md` — `version:` frontmatter field |
| F5      | PR-delivery polish/review collapse | Phase 6 opens the draft PR without create-pr's default sequential polish (reviewer auto-fix + code-quality simplify) and/or the Phase 6 critical self-review actually running or running observably — often an over-correction that misapplies a repo's parallel/cascading-verify (lint/tsc/test execution) prohibition to the *allowed* sequential quality pass. Tell-tales: missing `walkthrough.md` in Full Mode; create-pr report carries the CI block but no polish summary and no reviewer-feedback block. | 6 | `rules/phase-6-pr-creation.md` — Phase 6 Delivery Receipt gate (bare-create-pr requirement + deterministic `walkthrough.md` check + per-sub-step receipt) |
| F-novel | Novel mode             | Does not match any existing row                                                               | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** — every novel failure mode adds a new row, the row is justified by a diagnosis that cleared `confidence(analysis) ≥ 90 %` AND was user-approved at apply time.
Speculative categories were intentionally not pre-populated — they push the diagnoser toward forcing a match where none exists.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Phase 0 and Phase 2 are mandatory.** Validation and worktree isolation are not optional.
- **`confidence` at Phase 1 is non-removable.** It is the only companion that must always run.
- **Companions degrade silently.** Never make the workflow block on a missing companion (except `confidence` above).
- **No AI co-author tags.** Never add `Co-Authored-By` lines to commits or PRs generated by this workflow.
- **Artifact paths are `.agent/{branch}/`, never `.gw/{branch}/`.**
- **`gh` is hard-required; `gw` is optional with a native fallback.**
- **The system-prompt for the agent template stays lean.** It references `SKILL.md` rather than duplicating procedures.
- **Stuck-loop caps (3 Lite / 5 Full) are load-bearing.** Changing them requires updating every coupled surface listed in [`CLAUDE.md`](../CLAUDE.md#the-mode-aware-stuck-loop-cap-3--5-and-auto-replan).
- **Sub-Agent Resource Discipline is non-relaxable.** Sub-agents MUST run scoped/path-narrowed validation commands only. Whole-project `tsc`, `lint`, `build`, and `test` commands are reserved for the orchestrator at Phase 4 Step 6 and Phase 6 pre-PR. A diagnoser must never propose removing this constraint or widening it to allow whole-project commands in sub-agents.
- **Episodic lessons are advisory-only.** A `persistent-memory` `aw-lessons` lesson biases the plan; it must never silently change a gate, skip a phase, or alter a cap. The only path from a lesson to changed workflow behavior is a confidence-gated, user-approved `diagnose` apply. A diagnoser must never propose auto-applying lessons to behavior or promoting them on fewer than `seen_count >= 3` (without an explicit `structural` tag). See [`self-improvement-loop.md`](./self-improvement-loop.md#entrenchment-guards-load-bearing).
- **`checks.yaml` definitions are executor-immutable and check-gaming is forbidden.** The executor flips `status:` (and amends `run:`/`setup:` only with a logged `check-run-amended` entry); `id:`/`requirement:`/`ears:`/`expect:` are never executor-edited, and the four gaming strategies (modify checks/tests, overload comparisons, record/replay state, special-case inputs) are never a valid path to green. A diagnoser must never propose relaxing these or removing the `unsatisfiable` abort affordance. See [`phase-4-testing.md#executable-checks-loop`](./phase-4-testing.md#executable-checks-loop).
- **All-green checks are necessary, not sufficient.** `checks.yaml` never replaces or weakens the test suite, `confidence` gates, `reviewer` dispatch, or Phase 7 verification. A diagnoser must never propose gating any of those on "checks already passed".
- **A `blocking` missing-information gap halts even under `--no-confirm`.** The pre-authorization grant waives the Phase 0 confirmation wait, never the missing-information gate. A diagnoser must never propose letting the grant cover `blocking` gaps. See [`phase-0-validation.md#step-3c-missing-information-gate`](./phase-0-validation.md#step-3c-missing-information-gate).

---

## Artifacts

| File pattern                                  | Produced by                       | When                                |
| --------------------------------------------- | --------------------------------- | ----------------------------------- |
| `.agent/{branch}/plan.md`                     | `aw-create-plan`                  | After Phase 2 (Full Mode)           |
| `.agent/{branch}/plan.v{N}.md`                | `aw-create-plan`                  | Every plan iteration (audit trail)  |
| `.agent/{branch}/checks.yaml`                 | `aw-create-plan` (Step 2b)        | With the plan; statuses updated by the executor in Phase 4 |
| `.agent/{branch}/walkthrough.md`              | `aw-create-walkthrough`           | Phase 6 (Full Mode)                 |
| Progress Log inside `plan.md`                 | Workflow itself                   | Per companion invocation            |
| Draft PR + commit history                     | `create-pr`                       | Phase 6                             |

Lite Mode runs produce no `plan.md` / `walkthrough.md` — diagnoses against Lite runs have a thinner evidence trail and the report should call that out as a contributing factor.

---

## Lessons scope

- Scope: `aw-lessons`
- Tier: `home` (`~/.agent-memory/aw-lessons/`)
- Read for evidence with: `Skill("persistent-memory", "read aw-lessons --tier home")`

Diagnose Step 2 loads promotion-eligible lessons (`seen_count >= 3` or `status: structural`) as evidence — they are the strongest signal that a failure recurs. See [`self-improvement-loop.md`](./self-improvement-loop.md).

---

## Validators

- `claude plugin validate skills/workflow/autonomous-workflow` — frontmatter + structure check.
- Manual end-to-end pattern in [`CLAUDE.md`](../CLAUDE.md#testing-changes-end-to-end): symlink locally, run a small Lite Mode task, run a larger Full Mode task. There is no automated test suite for this skill.
