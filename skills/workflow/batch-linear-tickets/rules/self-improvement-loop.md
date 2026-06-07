---
title: Self-Improvement Loop — batch-linear-tickets Episodic Lessons
impact: MEDIUM
tags:
  - self-improvement
  - memory
  - lessons
  - batch-linear-tickets
  - promotion
  - meta
---

# Self-Improvement Loop (batch-linear-tickets)

`/batch-linear-tickets` improves across batches through the same **two-tier
loop** as `autonomous-workflow`. This file is the batch-specific contract. The
shared lesson schema and entrenchment guards are canonical in
[`../../autonomous-workflow/rules/self-improvement-loop.md`](../../autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

## Contents

- [What this loop owns (and what it inherits for free)](#what-this-loop-owns-and-what-it-inherits-for-free)
- [Scope](#scope)
- [Read lessons (Phase 1)](#read-lessons-phase-1)
- [Write lessons (Phase 5)](#write-lessons-phase-5)
- [Lesson promotion to skill source](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)

---

## What this loop owns (and what it inherits for free)

Phase 4 dispatches `aw-planner` + `aw-executor` per approved ticket. Those
agents **already** read / write the `aw-lessons` scope for the planning and
implementation phases. **The batch skill inherits that automatically** — no
wiring needed and no duplication here.

This loop owns only the lessons unique to **batch-level orchestration** — the
decisions `aw-planner` / `aw-executor` never make:

| Owned by `batch-lessons` | Inherited from `aw-lessons` (via fan-out) |
| ------------------------ | ----------------------------------------- |
| Ticket type misclassification — `bug` vs `feature` (Phase 1a) | Plan quality (aw-planner) |
| Cross-ticket correlation patterns — recurring shared-file conflicts, duplicate clusters (Phase 2) | Implementation / tests / CI (aw-executor) |
| Chronic `Needs Info` patterns — ticket shapes that always lack acceptance criteria (Phase 1d) | |

Because this surface is workspace-specific, batch lessons are often most useful
when promoted into the project's classification / correlation rules — see
[Lesson promotion](#lesson-promotion).

---

## Scope

- **Scope:** `batch-lessons`
- **Tier:** `project-shared` (committed) — `<repo>/memory/batch-lessons/`.
- `trigger-context` is keyed by **ticket label set** / **ticket-type** /
  **affected-area** so the Phase 1 read can match mechanically.

Lesson schema is the shared procedural-memory shape (four mandatory fields:
*What failed / Why / What to do next time / Promotion target*). Add a `phase:`
field naming the batch phase (`1a`, `1d`, `2`).

---

## Read lessons (Phase 1)

**Anchor:** `lessons-read`

At the **start of Phase 1**, before classifying ticket types, load lessons:

```
Skill("persistent-memory", "read batch-lessons --tier project-shared")     # skips silently if not installed
```

Apply matches as **advisory inputs**: a classification lesson biases the
`bug`/`feature` call for tickets with the matching label set; a correlation
lesson primes Phase 2 to look for a known recurring conflict pattern. Lessons
never override an explicit `--type` flag or auto-approve a `Needs Info` ticket.

**Maintenance check.** If the `INDEX.md` is at/near its 200-line cap
(≥ ~180 lines), surface a one-line `/persistent-memory consolidate batch-lessons`
suggestion — do not run it inside the loop.

---

## Write lessons (Phase 5)

**Anchor:** `lessons-write`

At **Phase 5 (Results)**, after execution outcomes are known, write a lesson
when the batch's own orchestration was shown to misfire:

| Trigger | Lesson captures |
| ------- | --------------- |
| A ticket's type was wrong (a `feature`-classified ticket needed bug root-cause analysis, or vice-versa, discovered during planning/execution) | The label set → correct type mapping for this workspace |
| A cross-ticket conflict surfaced in execution that Phase 2 correlation missed | The signal Phase 2 should have correlated on |
| A ticket shape was chronically `Needs Info` | What evidence the investigator needed up front |

```
Skill("persistent-memory", "write batch-lessons --tier project-shared --auto")     # skips silently if not installed
```

`--auto` skips consent, not the privacy pre-flight. Recurring lessons UPDATE and
bump `seen_count`; at `seen_count >= 3`, surface the promotion suggestion.

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `structural`) is promotion-eligible:

```
Lesson "<title>" has recurred N times (phase <p>). Promote it?  Run:
/create-skill diagnose batch-linear-tickets --symptom "<lesson title>"
```

Diagnose Mode reads `batch-lessons` as evidence, walks this skill's
[diagnostic surface](./diagnostic-surface.md), and emits a confidence-gated diff
against this skill's source (commonly into
[`ticket-type-classification.md`](./ticket-type-classification.md) or
[`cross-ticket-correlation.md`](./cross-ticket-correlation.md)) — applied only
at `confidence(analysis) ≥ 90 %` with explicit user confirmation. Workspace
label-convention lessons may instead belong in the project's own
classification-override config (see SKILL.md § Customization) rather than the
skill source — the diagnosis says which.

---

## Entrenchment guards

Identical to the canonical loop:

1. **Lessons are advisory, never auto-applied to behavior.** The only path to a
   behavior change is a confidence-gated, user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one batch, gates promotion.**
3. **Every lesson expires** (default 90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by `--auto`.

A batch lesson must never auto-approve a ticket, override an explicit `--type`
flag, or relax the Phase 3 approval gate — the user stays in control of every
batch.
