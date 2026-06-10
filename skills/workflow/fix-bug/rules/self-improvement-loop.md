---
title: Self-Improvement Loop — fix-bug Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - fix-bug
  - promotion
  - meta
---

# Self-Improvement Loop (fix-bug)

`/fix-bug` improves across bugs through the same **two-tier loop** as
`autonomous-workflow`. This file is the fix-bug-specific contract: which scope,
which read / write points, and the promotion gate. The **shared** lesson schema
and the entrenchment guards are canonical in
[`../../autonomous-workflow/rules/self-improvement-loop.md`](../../autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

## Contents

- [What this loop owns vs. what aw-lessons owns](#what-this-loop-owns-vs-what-aw-lessons-owns)
- [Scope](#scope)
- [Read lessons (Phase 0.5)](#read-lessons-phase-05)
- [Write lessons (Phase 5 / 7 / 8 + triage events)](#write-lessons)
- [Lesson promotion to skill source](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)
- [Not the bug-notes ledger](#not-the-bug-notes-ledger)

---

## What this loop owns vs. what aw-lessons owns

`/fix-bug` dispatches `aw-executor` for implementation (Phase 6), and the
executor **already** reads / writes the `aw-lessons` scope for the
implementation phases (code, tests, CI). **Do not duplicate that here.**

This loop owns lessons about fix-bug's **own diagnostic phases** — the ones
`aw-executor` never sees:

| Owned by `fix-bug-lessons` | Owned by `aw-lessons` (via aw-executor) |
| -------------------------- | --------------------------------------- |
| Intake / `bugClass` misclassification (Phase 0) | Implementation patterns (Phase 3) |
| Complexity triage `simple`/`complex` misfires (Phase 0.5) | Test authoring / flakiness (Phase 4) |
| Reproduction-layer selection, false-green repro (Phase 2.5) | Doc / PR / CI lessons (Phase 5–7) |
| Root-cause analysis blamed wrong file/line (Phase 3) | |
| Confidence-gate / branch-decision lessons (Phase 4–5) | |
| Telemetry-verification mode mis-classification (Phase 8) | |

---

## Scope

- **Scope:** `fix-bug-lessons`
- **Tier:** `project-shared` (committed) — `<repo>/memory/fix-bug-lessons/`.
- Lessons are keyed by **`bugClass`** and **input shape** (the Phase 0
  classification) in their `trigger-context`, so the Phase 0.5 read can match
  them mechanically against the current bug.

Lesson record schema is identical to the shared one (procedural memory; the four
mandatory fields *What failed / Why / What to do next time / Promotion target*).
Add a `phase:` field naming the fix-bug phase (`0`, `0.5`, `2.5`, `3`, `5`, `8`).

---

## Read lessons (Phase 0.5)

**Anchor:** `lessons-read`

At the start of **Complexity Triage (Phase 0.5)**, after `bugClass` is inferred
(Phase 0c) but before the triage decision commits, load lessons:

```
Skill("persistent-memory", "read fix-bug-lessons --tier project-shared")     # skips silently if not installed
```

1. Match each lesson's `trigger-context` against the current `bugClass` + input
   shape. Load full entries only for matches.
2. Apply matches as **inputs** to the decision they target: a triage lesson
   biases the `simple`/`complex` call (it never overrides the conservative
   default toward `complex`); a reproduction-layer lesson biases Phase 2.5's
   layer routing; an analysis lesson is passed to `holistic-analysis` (or the
   lightweight analysis) as a "previously this bugClass was misattributed to X"
   hint.
3. Lessons are **advisory** — they never relax a confidence gate, the Phase 5
   thresholds, the reproduction gate, or any hard invariant.
4. Record applied lessons in the bug-notes ledger under `Lessons applied`.
5. **Maintenance check.** If the `INDEX.md` is at/near its 200-line cap
   (≥ ~180 lines), surface a one-line `/persistent-memory consolidate fix-bug-lessons`
   suggestion — do not run it inside the autonomous loop.

Log to the ledger:

```markdown
- [TIMESTAMP] Phase 0.5: persistent-memory(read fix-bug-lessons --tier project-shared) — N lessons matched (bugClass=<x>), applied
- [TIMESTAMP] Phase 0.5: persistent-memory(read fix-bug-lessons --tier project-shared) — not available, continuing
```

---

## Write lessons

**Anchor:** `lessons-write`

Capture a lesson at the points where `/fix-bug`'s **own** process is shown to
have under-performed — these are the high-signal moments:

| Write point | When | Lesson captures |
| ----------- | ---- | --------------- |
| **Phase 7 verifier RED** | `bug-fix-verifier` left the PR draft | The fix was wrong despite the gates — which earlier phase under-caught it (triage too `simple`? repro false-green? analysis wrong file?) |
| **Phase 8 telemetry still firing** | Post-deploy signal did not decay / recurred | The "fix" did not fix the production symptom — strongest signal; almost always a Phase 3 analysis or Phase 2.5 repro-fidelity lesson |
| **Triage upgrade** | `simple → complex` upgrade, or fast-lane → standard-lane CEGIS round-3 fallback | A `simple`/fast-lane misclassification for this `bugClass` / input shape |
| **Phase 5 stop** | `< 92 %` stop, or below-70 % hand-back | An evidence / analysis gap pattern for this `bugClass` (what evidence would have raised the score) |

```
Skill("persistent-memory", "write fix-bug-lessons --tier project-shared --auto")     # skips silently if not installed
```

- `--auto` skips consent, **not** the privacy pre-flight (never store secrets /
  PII — and a `bugClass` lesson never needs product data).
- Recurring lessons resolve to **UPDATE**, bumping `seen_count`. At
  `seen_count >= 3`, surface the promotion suggestion.

Log to the ledger's `Phase log`.

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface — never act silently:

```
Lesson "<title>" has recurred N times (phase <p>). Promote it to a permanent
fix-bug guard?  Run:  /create-skill diagnose fix-bug --symptom "<lesson title>"
```

Diagnose Mode reads `fix-bug-lessons` as evidence, walks fix-bug's
[diagnostic surface](./diagnostic-surface.md), and emits one confidence-gated
diff against fix-bug's source — applied only at `confidence(analysis) ≥ 90 %`
with explicit user confirmation. On success, set the lesson `status: promoted`.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied to behavior.** The only path from
   a lesson to a changed fix-bug gate / threshold / invariant is a
   confidence-gated, user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by `--auto`.

A fix-bug lesson must **never** be allowed to relax a hard invariant from
[`diagnostic-surface.md`](./diagnostic-surface.md) — e.g. it can bias triage
toward `complex`, but it can never lower the fast-lane `≥ 92 %` bar, skip the
reproduction gate, or let the agent self-undraft.

---

## Not the bug-notes ledger

`fix-bug-lessons` is **cross-bug** procedural memory. The
[`bug-notes-ledger`](./bug-notes-ledger.md) is **within one bug** — a durable,
append-only record for a single run that survives compaction. They are
complementary and must not be conflated: the ledger is the recovery handle for
*this* bug; lessons are what the skill carries to the *next* bug.
