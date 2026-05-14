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
The contract spec lives at [`skills/create-skill/rules/diagnostic-surface.md`](../../create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/autonomous-workflow/`

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
| 0     | Mode detection; user confirms understanding                                                                      | Mode set to Lite for a task that should have been Full → fewer downstream gates                               |
| 1     | `code-quality(plan)`; `confidence(plan)` ≥ 90 % gate (LLM + deterministic rule checks)                           | Plan missed a hidden constraint; rule checks didn't cover the failure shape                                   |
| 2     | Worktree isolation; `aw-create-plan` writes `plan.md`                                                            | `plan.md` missing a section that downstream phases rely on                                                    |
| 3     | `tdd` (RED-GREEN-REFACTOR + mutation); `ux`; `code-quality(code)` at end; Sub-Agent Resource Discipline (resource-discipline language embedded in each fan-out dispatch prompt) | Companion not triggered because trigger condition was too narrow; mutation step skipped in non-TDD path; fan-out dispatch block missing the discipline language (F2) |
| 4     | Stuck-loop cap (3 Lite / 5 Full); `confidence(analysis)`; auto-replan via `holistic-analysis`                | Tests passed first try → no RED phase → no mutation check; cap miscounted                                     |
| 5     | `documentation update`                                                                                           | Skip condition matched wrongly; `CLAUDE.md` / `README.md` / `docs/` drift                                     |
| 6     | `review-changes`; `aw-create-walkthrough`; `create-pr`                                                           | Reviewer didn't compare diff against `plan.md`; walkthrough hid the issue                                     |
| 7     | CI watcher; `ci-auto-fix`; optional `reviewer` agent (PR Mode)                                                   | CI passed because tests were narrow; `reviewer` not installed                                                 |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                  | Symptom                                                                                       | Primary phase | Primary companion / gate                                          |
| ------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F1      | Test-by-construction   | New test imports a private copy of the SUT or duplicates its body — passes regardless of prod | 4             | `test-provenance-guard` (static + mutation) — should have run     |
| F2      | Sub-agent resource contention | Phase 3 fan-out dispatches sub-agents with whole-project `tsc`/`lint`/`test`/`build` commands; N concurrent processes saturate developer host RAM (OOM). Root cause: sub-agent prompt inherits whole-project validation commands without scoping. | 3 | Sub-Agent Resource Discipline rule — the discipline language should have been embedded in the dispatch prompt |
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

---

## Artifacts

| File pattern                                  | Produced by                       | When                                |
| --------------------------------------------- | --------------------------------- | ----------------------------------- |
| `.agent/{branch}/plan.md`                     | `aw-create-plan`                  | After Phase 2 (Full Mode)           |
| `.agent/{branch}/plan.v{N}.md`                | `aw-create-plan`                  | Every plan iteration (audit trail)  |
| `.agent/{branch}/walkthrough.md`              | `aw-create-walkthrough`           | Phase 6 (Full Mode)                 |
| Progress Log inside `plan.md`                 | Workflow itself                   | Per companion invocation            |
| Draft PR + commit history                     | `create-pr`                       | Phase 6                             |

Lite Mode runs produce no `plan.md` / `walkthrough.md` — diagnoses against Lite runs have a thinner evidence trail and the report should call that out as a contributing factor.

---

## Validators

- `claude plugin validate skills/autonomous-workflow` — frontmatter + structure check.
- Manual end-to-end pattern in [`CLAUDE.md`](../CLAUDE.md#testing-changes-end-to-end): symlink locally, run a small Lite Mode task, run a larger Full Mode task. There is no automated test suite for this skill.
