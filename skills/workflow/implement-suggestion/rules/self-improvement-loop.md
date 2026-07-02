---
title: Self-Improvement Loop — implement-suggestion Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - implement-suggestion
  - promotion
  - meta
---

# Self-Improvement Loop (implement-suggestion)

`/implement-suggestion` improves across runs through the same **two-tier loop**
as `autonomous-workflow` and `fix-bug`. This file is the
implement-suggestion-specific contract: which scope, which read / write points,
and the promotion gate. The **shared** lesson-record schema and the
entrenchment guards are canonical in
[`../../autonomous-workflow/rules/self-improvement-loop.md`](../../autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

## Contents

- [What this loop owns vs. what aw-lessons owns](#what-this-loop-owns-vs-what-aw-lessons-owns)
- [Scope](#scope)
- [Read lessons (Phase 3)](#read-lessons-phase-3)
- [Write lessons (Phase 7 + watch re-flag)](#write-lessons)
- [Lesson promotion to skill source](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)

---

## What this loop owns vs. what aw-lessons owns

`/implement-suggestion`'s **standard-lane** dispatches `aw-planner` (Phase 6),
which **already** reads / writes the `aw-lessons` scope for the *planning* of an
architectural change. **Do not duplicate that here.** The **fast-lane** worker
is a `general-purpose` subagent that inherits no lesson scope at all — so
`implement-suggestion-lessons` is the primary learning surface for this skill, and the
*only* one for the dominant fast-lane path.

This loop owns lessons about implement-suggestion's **own** decision phases —
the ones neither `aw-planner` nor the worker ever see:

| Owned by `implement-suggestion-lessons` | Owned by `aw-lessons` (via standard-lane `aw-planner`) |
| --------------------------------------- | ------------------------------------------------------ |
| Comment classification misfires (Phase 3) — a bot "nit" that was actually actionable, or vice-versa | Plan authoring for architectural changes (aw-planner Phase 1) |
| Two-gate calibration (Phase 4) — a suggestion class `/confidence` over- or under-scored | Implementation / test patterns for the planned change |
| Lane-selection misfires (Phase 6) — fast-lane picked but the edit rippled | |
| Reviewer-source patterns — a specific bot's suggestion class that always/never applies cleanly | |
| Apply-outcome patterns — a suggestion class whose apply broke tests or got re-flagged | |

---

## Scope

- **Scope:** `implement-suggestion-lessons`
- **Tiers (two, used together):**
  - **`home`** — per-user, cross-project at `~/.agent-memory/implement-suggestion-lessons/`.
    Default for **universal** lessons (a reviewer-source or suggestion-class
    pattern any repo could hit). Always read; default write target.
  - **`project-shared`** — committed, team-scoped at
    `<repo>/memory/implement-suggestion-lessons/`. Opt-in: only read / written when
    `memory/implement-suggestion-lessons/INDEX.md` already exists in cwd (a team opts in
    once via
    `Skill("persistent-memory", "write implement-suggestion-lessons --tier project-shared")`).
    Default for **project-bound** lessons (a suggestion pattern only this
    codebase produces).
- Lessons are keyed by **reviewer source** (bot handle such as `claude[bot]` /
  `coderabbitai[bot]`, or `human`) plus **comment topic / type** in their
  `trigger-context`, so the Phase 3 read can match them mechanically against the
  comments in the current ledger. Tier is determined at write time by whether
  the topic cites a repo-specific symbol, path, or domain term.

Lesson record schema is identical to the shared one (procedural memory; the four
mandatory fields *What failed / Why / What to do next time / Promotion target*).
Set the `phase:` field to the implement-suggestion phase the lesson applies to
(`3`, `4`, or `6`).

---

## Read lessons (Phase 3)

**Anchor:** `lessons-read`

At the **start of Phase 3 (Classify)** — after the per-PR ledger is built
(Phase 2) but before any comment is tagged — load lessons. Reading here biases
both classification (Phase 3) and the two gates (Phase 4).

Two-tier fan-out — universal lessons from `home`, project-shared from the cwd
repo when opted in:

```
Skill("persistent-memory", "read implement-suggestion-lessons --tier home")     # skips silently if not installed
if [ -f memory/implement-suggestion-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read implement-suggestion-lessons --tier project-shared")
fi
```

1. Union both INDEXes. Match each lesson's `trigger-context` against the
   reviewer source + topic of each comment in the ledger. Load full entries only
   for matches. Project-shared wins on conflict with home (closer scope).
2. Apply matches as **inputs** to the decision they target: a classification
   lesson biases the Phase 3 tag for that comment; a calibration lesson is
   passed to Phase 4 as a "previously this suggestion class was over-/under-scored"
   hint to `/confidence`; a lane lesson biases the Phase 6 fast-vs-standard call
   toward the safer lane.
3. Lessons are **advisory** — they never relax the two-gate requirement, the
   `/confidence` thresholds, the `/critical` Must-fix override, or any hard rule
   in [`../SKILL.md#hard-rules`](../SKILL.md#hard-rules). A lesson can bias a
   `nit` toward `actionable`, but it can never downgrade an `actionable` comment
   to `praise` to skip the gates.
4. Record applied lessons in the Phase 7 report under a `Lessons applied` note,
   marking the source tier in parentheses.
5. **Maintenance check.** If a loaded `INDEX.md` is at/near its 200-line cap
   (≥ ~180 lines), surface a one-line
   `/persistent-memory consolidate implement-suggestion-lessons` suggestion at the Phase 7
   write point — do not run it inline in a `--watch` loop.

Log:

```markdown
- [TIMESTAMP] Phase 3: persistent-memory(read implement-suggestion-lessons --tier home) — N lessons matched, applied
- [TIMESTAMP] Phase 3: persistent-memory(read implement-suggestion-lessons --tier project-shared) — not opted in, skipping
- [TIMESTAMP] Phase 3: persistent-memory(read implement-suggestion-lessons) — not available, continuing
```

---

## Write lessons

**Anchor:** `lessons-write`

Capture a lesson at the points where implement-suggestion's **own** process is
shown to have under-performed — these are the high-signal moments:

| Write point | When | Lesson captures |
| ----------- | ---- | --------------- |
| **Phase 7 end-of-run** | Every run (retrospective) | Any durable lesson from the run: a comment that Phase 3 misclassified, a suggestion class the Phase 4 gate mis-scored, a lane the Phase 6 split got wrong, an apply that broke a scoped check |
| **Watch re-flag** | (`--watch` only) a reviewer re-comments on a location / topic that a **prior iteration already applied** | The strongest signal: the earlier apply was wrong or incomplete — almost always a Phase 4 calibration or Phase 3 classification lesson for that reviewer source + topic |
| **User override** | The user, on reading Phase 7, overrides a `skip` / `surface` (or reverses an `apply`) | The gate was mis-calibrated for that suggestion class — capture what evidence would have changed the score |

Before writing, run the **retrospective prompt** (Phase 7): was there a
misclassified comment, a gate that scored a class wrong, a lane misfire, or an
apply that needed a scoped-check fix? Phrase each capture as an **observation**
("last run, `coderabbitai[bot]` import-order nits all applied cleanly at ≥ 90 %"),
never a rule. Write nothing when the retrospective surfaces nothing **and** no
lesson read at Phase 3 was applied — empty lessons are noise.

Classify each candidate as **universal** (a reviewer-source / suggestion-class
pattern any repo could hit) or **project-bound** (the topic cites a
repo-specific symbol, file path, or domain term). Then dispatch:

```
# Universal candidate — home.
Skill("persistent-memory", "write implement-suggestion-lessons --tier home --auto")

# Project-bound candidate — opt-in gated.
if [ -f memory/implement-suggestion-lessons/INDEX.md ]; then
  Skill("persistent-memory", "write implement-suggestion-lessons --tier project-shared --auto")
else
  Skill("persistent-memory", "write implement-suggestion-lessons --tier home --auto")
  log "Project-bound lesson fell back to home. Opt in once with: Skill(\"persistent-memory\", \"write implement-suggestion-lessons --tier project-shared\")"
fi
```

- `--auto` skips consent, **not** the privacy pre-flight (never store secrets /
  PII — and a suggestion-class lesson never needs product data; the bar is
  stricter for `project-shared` writes since the content lands in the repo).
- **Applied-lesson UPDATE contract.** If a lesson read at Phase 3 was applied and
  the miss it targets did not recur, write an UPDATE for it — successful
  application counts as recurrence evidence. An UPDATE to an entry that carries a
  `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`. This
  is how a *working* lesson still reaches the `seen_count >= 3` promotion gate.
- Recurring lessons resolve to **UPDATE**, bumping `seen_count`. At
  `seen_count >= 3`, surface the **tier-appropriate** promotion suggestion (see
  below).

Log (include the resolved tier in every line):

```markdown
- [TIMESTAMP] Phase 7: persistent-memory(write implement-suggestion-lessons --tier home) — 1 lesson (UPDATE, seen_count→3)
- [TIMESTAMP] Phase 7: persistent-memory(write implement-suggestion-lessons --tier project-shared) — 1 lesson (ADD) — project-bound, repo opted in
- [TIMESTAMP] Phase 7: persistent-memory(write implement-suggestion-lessons) — not available, continuing
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface a one-line suggestion — never act silently. The
target depends on the lesson's tier:

| Lesson tier | Promotion target | One-liner |
| ----------- | ---------------- | --------- |
| `home` (universal) | The skill's source — ships to every consumer | `Lesson "<title>" recurred N times. Promote to a permanent implement-suggestion guard?  Run:  /create-skill diagnose implement-suggestion --symptom "<title>"` |
| `project-shared` (project-bound) | The repo's own rules — ships to every teammate | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule?  Run:  Skill("docs", "update --add-rule '<title>' --source memory/implement-suggestion-lessons/entries/<id>.md")` |

`implement-suggestion` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose implement-suggestion` reads the SKILL.md H2 sections as
its fallback surface (phases, gates, hard rules) plus `implement-suggestion-lessons` as
evidence, and emits one confidence-gated diff against this skill's source —
applied only at `confidence(analysis) ≥ 90 %` with explicit user confirmation.
On success, set the lesson `status: promoted`.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied to behavior.** The only path from a
   lesson to a changed classification rule, gate threshold, or lane trigger is a
   confidence-gated, user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by `--auto`.

A suggestion lesson must **never** be allowed to relax a hard rule from
[`../SKILL.md#hard-rules`](../SKILL.md#hard-rules) — it can bias the Phase 6 lane
toward standard, but it can never skip the two-gate validation, override a
`/critical` Must-fix, weaken a test to make a suggestion fit, or let the worker
force-push.
