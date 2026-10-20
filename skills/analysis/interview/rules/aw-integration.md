---
title: aw Integration — On-Demand Delegation Contract
impact: MEDIUM
tags:
  - autonomous-workflow
  - aw
  - delegation
  - companion
---

# aw Integration

How the `aw` dispatcher delegates scope alignment to this skill.
The contract is **on demand**: on a Full-tier task `aw` runs the interview only with `--interview` or when two or more `blocking` questions remain after its short Phase 0 (`autonomous-workflow` `aw/rules/full-tier.md` step 1); otherwise its inline restate-and-diff is enough.
The surfaces this wiring touches are listed at the end.

## Delegation point

`aw` Phase 0 Step 3a delegates its restate-and-diff (Step 3b) and Missing-Information Gate (Step 3c) to this skill:

```text
aw Phase 0 Step 3a (when triggered):
  Skill("interview")            # produces .agent/{branch}/brief.md + readiness verdict
  → ready | ready-with-assumptions : lift restatement/deltas/assumptions into Step 4; skip inline 3b/3c
  → blocked                        : halt; report the blocking unknown (even under --no-confirm)
```

`interview` is the single source of truth for restate-and-diff + the missing-information gate; the inline Step 3b/3c procedure is the graceful-degradation fallback (see below).
Phase 1's `## Scope Brief` step then reads `brief.md` per [`brief-artifact.md`](./brief-artifact.md) (§ Downstream consumption) to seed Requirements, Acceptance Criteria, and the Existing Code Survey.

### Gate vocabulary (reconciled)

Both gates classify unknowns with the same two classes and the same names:

| Class        | `interview` (this skill) | `aw` phase-0-validation.md Step 3c         |
| ------------ | ------------------------ | ------------------------------------------ |
| must-ask     | `blocking`               | `blocking`                                 |
| safe-default | `advisory`               | `advisory`                                 |

`interview` is the SSOT: one concept, one vocabulary.

## Opt-out levers

| Lever              | Effect                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| default (no flag)  | Full: `aw` runs `interview` only when two or more `blocking` questions remain; otherwise inline.    |
| `--no-interview`   | Skip the interview entirely. `aw` uses its inline restate-and-diff + gate.                          |
| `--interview`      | Force the interview even on a request that would otherwise pass, including on Micro/Lite tasks.      |

Tier behavior:

- **Full** — on demand, as above.
- **Lite / Micro** — off by default (the tasks are small and well-specified by construction); `--interview` still forces it.

## Graceful degradation

`interview` is an optional companion.
If it is not installed, `Skill("interview")` raises; `aw` catches, logs one line, and runs its inline restate-and-diff + Missing-Information Gate.
The blocking-gap invariant is preserved either way: a `blocking` unknown halts even under `--no-confirm`.

## Coupled surfaces (kept in lockstep)

The wiring touched these `autonomous-workflow` surfaces; a future change to the delegation contract must update them together:

- `rules/phase-0-validation.md` — Step 3a delegation (anchor `scope-alignment`) + checklist + inline 3b/3c fallback pointers.
- `rules/companion-skills.md` — Phase 0 `interview` registry row + disable link.
- `rules/phase-1-planning.md` — `## Scope Brief` step (anchor `scope-brief`) reads `brief.md` + checklist item.
- `aw/SKILL.md` and `aw/rules/full-tier.md` — flag pass-through, the Full-tier trigger, and the Micro/Lite `--interview` force path.
- `rules/diagnostic-surface.md` — Phase 0 guard row + typical gaps.
- `SKILL.md`, `README.md`, `CLAUDE.md` — companion table, `argument-hint` flags, version, history.

This skill also remains fully usable standalone (`/interview`) and self-contained.
