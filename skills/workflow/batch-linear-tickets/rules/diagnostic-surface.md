---
title: batch-linear-tickets — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - batch-linear-tickets
  - meta
---

# batch-linear-tickets — Diagnostic Surface

This file declares the contract `/create-skill diagnose batch-linear-tickets` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Lessons scope](#lessons-scope)
- [Validators](#validators)

---

## Source root

`skills/workflow/batch-linear-tickets/`

---

## Phase model

`batch-linear-tickets` is a 5-phase batch orchestrator. It composes per-ticket sub-skills/agents (`linear-ticket-investigator`, `holistic-analysis`, `confidence`, `aw-planner`, `aw-executor`) — failures **inside** those belong to *their* diagnostic surfaces, not this one. This surface covers batch-level orchestration only.

| Phase | Name                       | Rule                                                                   | Gate                                                                              |
| ----- | -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1     | Per-ticket analysis (fan-out) | [ticket-type-classification.md](./ticket-type-classification.md) + [SKILL.md § Phase 1](../SKILL.md#phase-1-per-ticket-analysis-fan-out) | Each ticket classified (`bug`/`feature`/`unknown`), investigated, scored via `confidence`; status assigned |
| 2     | Cross-ticket correlation   | [cross-ticket-correlation.md](./cross-ticket-correlation.md)           | Shared root causes / shared files / duplicates / dependencies detected and grouped |
| 3     | Approval gate              | [batch-approval-ux.md](./batch-approval-ux.md)                         | User explicitly approves the ticket set; `Needs Info` tickets cannot be approved   |
| 4     | Parallel execution (fan-out) | [SKILL.md § Phase 4](../SKILL.md#phase-4-parallel-execution-fan-out)  | `aw-planner` + `aw-executor` dispatched per approved ticket / group; per-planner `confidence(plan)` ≥ 90 % |
| 5     | Results & Linear updates   | [SKILL.md § Phase 5](../SKILL.md#phase-5-results--linear-updates)       | Status table presented; PR links posted to each Linear ticket                      |

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                          | Typical gaps                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1     | Label-based type classification; `--type` override; `unknown` → `Needs Info` (blocks approval); per-ticket `confidence` gate (`analysis` for bugs, `plan` for features); `persistent-memory(read batch-lessons --tier home)` applies prior classification/correlation lessons | Ticket misclassified `feature` when it needed bug root-cause analysis (or vice-versa); `confidence` gate scored a thin Evidence Record high |
| 2     | Cross-type correlation of shared root causes / files / duplicates / dependencies                                                          | A real cross-ticket conflict not correlated → two PRs collide on the same file                              |
| 3     | Single explicit user approval gate; `Needs Info` tickets non-approvable                                                                  | User approved a `Needs Review` (70–89 %) ticket that should have collected more evidence                    |
| 4     | Per-planner `confidence(plan)` ≥ 90 % gate inside `aw-planner`; worktree isolation; correlated tickets share one plan; `aw-lessons` loop inherited from the dispatched planner/executor | Below-gate plan force-proceeded; correlated group's single PR missed one ticket's acceptance criteria        |
| 5     | Status table; per-ticket Linear writeback; `persistent-memory(write batch-lessons)` captures classification/correlation misfires        | PR link not posted back; ticket state left stale; a recurring misclassification never written as a lesson    |

Cross-cutting guards:

- **Self-improvement loop (`batch-lessons`)** — read at Phase 1, written at Phase 5. Advisory only (never auto-approves or overrides `--type`); a recurring lesson (`seen_count >= 3`) is promotion-eligible into the classification / correlation rules via `diagnose`. Planning/implementation lessons are inherited from `aw-lessons` via the Phase 4 fan-out, not owned here. See [`self-improvement-loop.md`](./self-improvement-loop.md).
- **User-in-control invariant** — every batch requires explicit Phase 3 approval; no autonomous batch shipping.

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class       | Symptom                              | Primary phase | Primary gate / companion                                          |
| ------- | ----------- | ------------------------------------ | ------------- | ----------------------------------------------------------------- |
| F-novel | Novel mode  | Does not match any existing row      | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real classes (e.g. "type misclassification", "missed cross-ticket conflict", "stale Linear writeback") are added as confidence-gated, user-approved diagnoses produce them — and the `batch-lessons` history is the evidence that justifies the first such row.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **User stays in control — Phase 3 approval is mandatory.** No batch ships without an explicit user approval; `Needs Info` tickets are never auto-approved.
- **Analyse once, execute once.** Phase 1 is the only place per-ticket analysis runs; Phase 4 dispatches `aw-planner` using that analysis — no silent re-investigation.
- **Per-ticket `confidence(plan)` ≥ 90 % inside `aw-planner` is not bypassed by batch.** The batch skill does not lower or merge the planner's gate.
- **Type classification is conservative and overridable.** `unknown` → `Needs Info` (blocks approval); an explicit `--type` flag always wins over inferred type and over any lesson.
- **`batch-lessons` are advisory-only.** A lesson biases classification / correlation but never auto-approves a ticket, overrides `--type`, or relaxes the approval gate. The only path to a behavior change is a confidence-gated, user-approved `diagnose` apply; promotion requires `seen_count >= 3` (or an explicit `structural` tag). See [`self-improvement-loop.md`](./self-improvement-loop.md#entrenchment-guards).
- **Failures inside composed sub-skills are diagnosed against their own surfaces.** A wrong fix from `aw-executor` is an `autonomous-workflow` / `aw-lessons` concern; a wrong root cause is a `holistic-analysis` concern. This surface only covers batch-level orchestration (classification, correlation, approval, fan-out, writeback).

---

## Artifacts

| Artifact                                  | Produced by            | When                              |
| ----------------------------------------- | ---------------------- | --------------------------------- |
| Per-ticket Evidence Record                | `linear-ticket-investigator` | Phase 1                     |
| Per-ticket confidence score + status      | `confidence`           | Phase 1d                          |
| Correlation grouping                      | Phase 2 (main context) | Phase 2                           |
| Approval summary table                    | Phase 3                | Phase 3                           |
| `.agent/{branch}/plan.md` (per ticket)    | `aw-planner`           | Phase 4                           |
| Draft PR(s) + Linear comments             | `aw-executor` / Phase 5 | Phase 4–5                        |

This skill produces no durable per-run ledger of its own (unlike `fix-bug`'s bug-notes); the per-ticket artifacts above plus the Linear writeback are the trail. Diagnoses rely on the session transcript + `batch-lessons` history.

---

## Lessons scope

- Scope: `batch-lessons` (batch-orchestration lessons only; planning/impl lessons live in `aw-lessons` via the fan-out)
- Tier: `home` (`~/.agent-memory/batch-lessons/`)
- Read for evidence with: `Skill("persistent-memory", "read batch-lessons --tier home")`

Diagnose Step 2 loads promotion-eligible lessons (`seen_count >= 3` or `status: structural`) as evidence — keyed by label set / ticket-type / affected-area. See [`self-improvement-loop.md`](./self-improvement-loop.md).

---

## Validators

- `claude plugin validate skills/workflow/batch-linear-tickets` — frontmatter + structure check.
- Re-run the batch on the same ticket set after applying a diagnosis diff — confirm the misclassification / missed-correlation no longer occurs.
