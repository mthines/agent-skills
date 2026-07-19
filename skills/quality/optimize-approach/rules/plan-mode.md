---
title: Plan Mode — approach review at plan time
impact: HIGH
tags:
  - optimize-approach
  - plan
  - aw-planner
  - shift-left
---

# Plan Mode

Review a **drafted plan's chosen approach** before any code exists — the cheapest possible moment to change it.
Plan mode is invoked by `aw-planner` at Phase 1, after the technical design (including the Existing Code Survey) and before the `confidence(plan)` gate.
There is no diff and nothing to edit: the input is `plan.md`'s approach, and the "apply" is a **plan revision**, not a code change.

This mirrors `code-quality`, `confidence`, and `critical`, which all have a plan-time mode for the same reason.

## Contents

- [Inputs](#inputs)
- [Anti-overlap at plan time](#anti-overlap-at-plan-time)
- [Flow](#flow)
- [Proposal record](#proposal-record)
- [Adoption and the re-plan loop](#adoption-and-the-re-plan-loop)
- [What plan mode does not do](#what-plan-mode-does-not-do)

## Inputs

The calling planner passes:

- `intent_summary` — the task intent / requirements from Phase 0–1.
- `approach` — the plan's chosen approach: the Technical Approach, Decisions, Implementation Order, and File Changes sections of the in-conversation plan draft (or `plan.md` if already written).
- `survey` — the Existing Code Survey verdicts (`EXTEND` / `WRAP` / `BUILD NEW`) already produced at Phase 1, so plan mode does not re-run codebase-fit reuse analysis the survey owns.
- `caller` — `aw-planner`.

## Anti-overlap at plan time

Plan time already has three approach-adjacent gates. Plan mode must **not** re-surface their output — its net-new value is the approach-level simplicity / performance / robustness judgment plus a materially-better-approach steelman:

| Existing plan-time gate | Axis it owns → plan mode defers |
| --- | --- |
| **Existing Code Survey** (`confidence` rule #10) | **codebase-fit** reuse. Plan mode consumes the `survey` verdicts; it only raises a codebase-fit proposal for a *pattern/shape* mismatch the survey's per-`create` reuse search does not cover. |
| **`critical` (plan)** | failure modes + a steelman-to-challenge. Plan mode does not re-list failure modes; the robustness axis fires only when a *different approach* structurally avoids a failure class. |
| **`confidence(plan)`** | completeness / feasibility / ambiguity. Plan mode never re-scores those — it assumes the plan is complete and asks whether a better-shaped plan exists. |

The four anti-overlap guards in [`optimality-rubric.md`](./optimality-rubric.md) apply unchanged; this table is their plan-time specialization.

## Flow

Reuse the O0–O5 skeleton from [`SKILL.md`](../SKILL.md), scoped to the plan:

1. **O1 intent** — from `intent_summary`.
2. **O2 judgment** — score each approach unit in `approach` against the four-axis rubric; consume `survey` so codebase-fit reuse is not re-derived.
3. **O3 quiet early-exit** — every unit `optimal` → return empty; the planner proceeds straight to the confidence gate.
4. **O4 deep understanding** — for a `suboptimal` unit, grep the relevant code and invoke `Skill("holistic-analysis", "refactor")` to confirm the alternative is genuinely better and feasible in this codebase; gate on `confidence(analysis)`. Below 90 %, downgrade to a note (the planner may weigh it) rather than a proposal.
5. **O5 deliver** — return plan-level proposals (below). No `confidence(code)` gate — nothing is coded.

## Proposal record

```yaml
- verdict: suboptimal
  axis: codebase-fit | simplicity | performance | robustness
  unit: <the approach unit — which sub-goal / component of the plan>
  current_approach: <one sentence — the plan's chosen approach>
  better_approach: <one to two sentences — the better-shaped approach>
  why_better: <one sentence tied to the axis>
  evidence: <existing util / pattern / complexity fact / caller shape that proves it>
  plan_delta: <which plan.md sections would change — Technical Approach, File Changes, Implementation Order>
  analysis_confidence: <confidence(analysis) score from O4>
```

Every unit `optimal` → empty list + `verdict: optimal — planned approach is sound`.

## Adoption and the re-plan loop

The planner owns adoption — plan mode proposes, it does not rewrite the plan itself.

1. The planner weighs each proposal against the user's stated intent and constraints (a proposal never overrides intent).
2. **If adopted**, the planner regenerates `plan.md` via `aw-create-plan` (a new `plan.vN.md` version), then re-runs the `confidence(plan)` gate on the revised plan. This reuses the existing plan-versioning + gate machinery — no new loop.
3. **Bounded:** plan mode runs **once per Phase-1 planning cycle**. A re-plan triggered by an adopted proposal does **not** re-invoke plan mode on the revised plan — the revision already incorporates the better approach. This is the load-bearing guard against a propose→re-plan→propose loop.

## What plan mode does not do

- **It does not edit code or `plan.md`.** It returns proposals; the planner revises the plan.
- **It does not gate.** `confidence(plan)` remains the only mandatory Phase 1 gate; plan mode is advisory, like `critical`.
- **It does not re-run the Existing Code Survey, `critical`, or `confidence`.** See the anti-overlap table.
- **It does not loop.** One pass per planning cycle.
