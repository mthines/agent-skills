---
title: optimize-approach — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - optimize-approach
  - meta
---

# optimize-approach — Diagnostic Surface

This file declares the contract `/create-skill diagnose optimize-approach` reads to parameterize the generic Diagnose Mode procedure for this skill.

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Lessons scope](#lessons-scope)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

## Source root

`skills/quality/optimize-approach/`

`git apply` runs from the repo root against files under this directory.
The skill body is `SKILL.md`; rules live under `rules/`; the shared wiring rule the review agents import lives at `agents/shared/rules/optimality-review.md` (outside this source root — changes there are a coordinated edit, not part of a diagnose apply against this skill).

---

## Phase model

| Phase | Name | Rule / section | Gate |
| --- | --- | --- | --- |
| O0 | Read lessons | [self-improvement-loop.md](./self-improvement-loop.md) | Fast-tier read; skips silently if `persistent-memory` absent |
| O1 | Intent capture | [SKILL.md § O1](../SKILL.md) | 1–2 line intent per approach unit |
| O2 | Optimality judgment | [optimality-rubric.md](./optimality-rubric.md) | Verdict `optimal`/`suboptimal` per 4-axis rubric + anti-overlap guards + materiality bar |
| O3 | Quiet early-exit | [optimality-rubric.md](./optimality-rubric.md) | All units `optimal` → empty return |
| O4 | Deep understanding | [SKILL.md § O4](../SKILL.md), `Skill("holistic-analysis", "refactor")` | `confidence(analysis)` scored on the alternative |
| O5 (report) | Deliver proposal | [report-mode.md](./report-mode.md) | ≤ 2 proposals; each with grep-resolvable evidence |
| O5 (apply) | Apply rewrite | [apply-mode.md](./apply-mode.md) | `confidence(code) ≥ 90 %` + `apply_safe` + scoped check + revert-on-failure |
| O5 (plan) | Deliver plan proposal | [plan-mode.md](./plan-mode.md) | Plan-level proposals; planner revises via `aw-create-plan`; advisory, never gates; one pass per planning cycle |
| O5 (write) | Lesson write + promotion | [self-improvement-loop.md](./self-improvement-loop.md) | Fast-tier write; `seen_count >= 3` suggests promotion |

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| O0 | Two-tier fan-out; `trigger-context` match; project-shared opt-in gate | Lesson applied as hard override instead of advisory |
| O1 | Intent from caller or PR/branch; per-approach-unit split | Multi-file diff collapsed to one unit; per-unit judgment lost |
| O2 | 4 axes; 4 anti-overlap guards; 3-part materiality bar | Mechanical-tidy candidate escalated (guard 1 not run); lateral rewrite escalated |
| O3 | All-optimal → empty | Manufactured proposal on an optimal change |
| O4 | Holistic refactor trace; `confidence(analysis)` gate | Proposal emitted from a shallow read with no trace |
| O5 report | ≤ 2 cap; grep-resolvable evidence; non-blocking | Evidence field unfounded; proposal blocks the verdict |
| O5 apply | `confidence(code) ≥ 90 %`; `apply_safe`; forbidden targets; scoped check; revert | Apply widened beyond diff files; revert skipped on red check |
| O5 write | Classification; opt-in gate; privacy pre-flight | Project-bound lesson written to a silently-created committed scope |

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-manufactured-proposal` | False escalation | A proposal emitted on a change that clears the materiality bar (should have been `optimal`) | O2 |
| `F-overlap-with-lens` | Anti-overlap bypass | Proposal restates a `code-quality` / `critical` / `holistic-review` finding | O2 |
| `F-shallow-proposal` | Ungrounded proposal | "Better way" emitted without a holistic trace or with unfounded evidence | O4 / O5 report |
| `F-apply-widened` | Blast-radius escape | Apply touched files outside the diff, or a public API/type | O5 apply |
| `F-apply-not-reverted` | Broken tree | A failed scoped check did not revert the rewrite | O5 apply |
| `F-verdict-blocked` | Verdict escape | An optimality proposal drove a "Request changes" verdict in a calling agent | O5 report |
| `F-lesson-mis-scoped` | Scope leak | Project-bound lesson written to a silently-created committed scope | O5 write |
| `F-plan-overlap` | Anti-overlap bypass (plan mode) | Plan-mode proposal re-surfaces Existing Code Survey, `critical`, or `confidence(plan)` output | O5 plan |
| `F-plan-loop` | Unbounded re-plan | Plan mode re-invoked on a plan it already caused to be revised | O5 plan |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New classes are added after confidence-gated, user-approved diagnoses surface them.

---

## Hard invariants

- **Approach-level only.** The four anti-overlap guards in [optimality-rubric.md](./optimality-rubric.md) are non-skippable; a finding that another lens owns is never emitted here.
- **Silence is a valid, healthy outcome.** The O3 quiet early-exit must fire when all units are `optimal` — manufacturing a proposal to avoid an empty return is a guard failure (`F-manufactured-proposal`).
- **No proposal without O4.** Every `suboptimal` proposal carries a holistic trace and a `confidence(analysis)` score; a shallow proposal is a guard failure.
- **Evidence must ground.** Every proposal's `evidence` field grep-resolves to a real util/pattern/caller or states a measurable fact; unfounded evidence drops the proposal.
- **Apply is gated.** No rewrite below `confidence(code) ≥ 90 %`, none outside `apply_safe`, none touching a forbidden target, none widening blast radius, and every failed scoped check reverts. The gate is never skipped inside a calling agent's loop.
- **`pr-reviewer` never applies.** Cross-review is report-only.
- **Optimality never blocks the verdict.** Proposals are advisory (`suggestion` / `question`), like `scope-creep`.
- **Plan mode is advisory and never gates.** It proposes; the planner revises via `aw-create-plan` and `confidence(plan)` remains the only mandatory Phase 1 gate. Plan mode runs once per planning cycle — it must not re-run on a plan it caused to be revised (`F-plan-loop`), and must not re-surface Survey / `critical` / `confidence` output (`F-plan-overlap`).
- **Lessons are advisory.** The only path from a lesson to changed behavior is a confidence-gated, user-approved `diagnose` apply; promotion requires `seen_count >= 3` or an explicit `structural` tag. A lesson may never relax the apply gate, the forbidden-targets list, or the never-block rule.

---

## Lessons scope

`optimize-approach-lessons` — the fast-tier self-improvement scope declared in [self-improvement-loop.md](./self-improvement-loop.md).
Diagnose Mode reads this scope (both tiers) as **evidence** at Step 2: the `seen_count` history and prior `trigger-context` values make a diagnosis far more accurate than a single-session reflection.
Read points: O0. Write points: O5. Promotion target for `home` lessons: this skill's source, via this diagnose entry point.

---

## Artifacts

| File pattern | Produced by | When |
| --- | --- | --- |
| Terminal proposal card(s) + summary line | O5 report | Report runs with ≥ 1 proposal |
| `verdict: optimal` marker line | O3 | Quiet early-exit runs |
| Rewrite applied to local files (uncommitted) | O5 apply | Apply runs that clear the gate |
| Lesson entries under `~/.agent-memory/optimize-approach-lessons/` or `<repo>/memory/optimize-approach-lessons/` | O5 write | Runs that surface a durable lesson |

The skill produces no durable repo artifact of its own and never writes to GitHub.

---

## Validators

- `node scripts/eval/l1.mjs` — link/anchor integrity for this skill's files and the shared wiring rule.
- Manual: run report mode on a diff that reinvents an existing util; confirm one codebase-fit proposal with grep-resolvable evidence.
- Manual: run on a diff whose only "improvement" is a magic-number extraction; confirm anti-overlap guard 1 drops it (verdict `optimal`).
- Manual: run apply mode on a low-confidence rewrite; confirm it withholds and reports instead of applying.
- Manual: run apply mode where the scoped check fails; confirm the rewrite is reverted and downgraded to a proposal.
- Manual: invoke via `pr-reviewer`; confirm report-only (no edits).
