---
title: aw Integration — Default-On-Adaptive Delegation Contract
impact: MEDIUM
tags:
  - autonomous-workflow
  - aw-planner
  - delegation
  - companion
---

# aw Integration

How the `aw` dispatcher and `aw-planner` delegate scope alignment to this skill.
The contract is **default-on-adaptive with opt-outs**: the interview runs by default for Full-tier tasks but only actually interrupts when the request is underspecified (the adaptive pass keeps crisp requests silent).
This wiring is **live** as of `autonomous-workflow` v3.20.0 — the surfaces it touches are listed at the end.

## Delegation point

`aw-planner` Phase 0 Step 3a delegates its restate-and-diff (Step 3b) and Missing-Information Gate (Step 3c) to this skill:

```text
aw-planner Phase 0 Step 3a:
  Skill("interview")            # produces .agent/{branch}/brief.md + readiness verdict
  → ready | ready-with-assumptions : lift restatement/deltas/assumptions into Step 4; skip inline 3b/3c
  → blocked                        : halt; report the blocking unknown (even under --no-confirm)
```

`interview` is the single source of truth for restate-and-diff + the missing-information gate; the inline Step 3b/3c procedure is the graceful-degradation fallback (see below).
Phase 1's `## Scope Brief` step then reads `brief.md` per [`brief-artifact.md`](./brief-artifact.md) (§ Downstream consumption) to seed Requirements, Acceptance Criteria, and the Existing Code Survey.

### Gate vocabulary (reconciled)

Both gates classify unknowns with the same two classes, and now use the same names — reconciled in v3.20.0:

| Class        | `interview` (this skill) | `aw-planner` phase-0-validation.md Step 3c |
| ------------ | ------------------------ | ------------------------------------------ |
| must-ask     | `blocking`               | `blocking`                                 |
| safe-default | `advisory`               | `advisory` (was `assume-and-proceed`)      |

`interview` is the SSOT, so the wiring renamed `aw-planner`'s incumbent `assume-and-proceed` → `advisory` across its surfaces (no eval or anchor referenced the old token).
One concept, one vocabulary.

## Opt-out levers

| Lever              | Effect                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| default (no flag)  | `aw` runs `interview` for Full-tier tasks; it passes silently when the request is crisp.             |
| `--no-interview`   | Skip the interview entirely. `aw-planner` falls back to its inline restate-and-diff + gate.          |
| `--interview`      | Force the interview even on a request that would otherwise pass, including on Micro/Lite tasks.      |

Tier behavior:

- **Full** — default-on, as above.
- **Lite / Micro** — off by default (the tasks are small and well-specified by construction); `--interview` still forces it.

## Graceful degradation

`interview` is an optional companion.
If it is not installed, `Skill("interview")` raises; `aw-planner` catches, logs one line, and runs its inline restate-and-diff + Missing-Information Gate.
The blocking-gap invariant is preserved either way: a `blocking` unknown halts even under `--no-confirm`.

## Coupled surfaces (kept in lockstep)

The wiring touched these `autonomous-workflow` surfaces; a future change to the delegation contract must update them together:

- `rules/phase-0-validation.md` — Step 3a delegation (anchor `scope-alignment`) + checklist + inline 3b/3c fallback pointers.
- `rules/companion-skills.md` — Phase 0 `interview` registry row + disable link.
- `rules/phase-1-planning.md` — `## Scope Brief` step (anchor `scope-brief`) reads `brief.md` + checklist item.
- `templates/aw-planner.agent.md` — Phase 0 companion row + Plan-Quality-Gates delegation note.
- `templates/aw.agent.md` — flag pass-through + Micro/Lite `--interview` force path.
- `rules/diagnostic-surface.md` — Phase 0 guard row + typical gaps.
- `SKILL.md`, `README.md`, `CLAUDE.md` — companion table, `argument-hint` flags, version, history.

This skill also remains fully usable standalone (`/interview`) and self-contained.
