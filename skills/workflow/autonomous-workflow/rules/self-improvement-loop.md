---
title: Self-Improvement Loop — Episodic Lessons + Promotion to Source
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - episodic
  - promotion
  - meta
---

# Self-Improvement Loop

The workflow gets better across runs through a **two-tier loop**. This file is
the single source of truth for the loop: the lesson schema, the read / write
triggers, the promotion gate, and the entrenchment guards. The phase rules
contain thin invocation blocks that reference the anchors here.

## Contents

- [Why two tiers](#why-two-tiers)
- [The lesson record](#the-lesson-record)
- [Fast tier — read lessons (Phase 1, Phase 3/4)](#fast-tier--read-lessons)
- [Fast tier — write lessons (Phase 4 stuck-loop, Phase 7 end-of-run)](#fast-tier--write-lessons)
- [Lesson promotion — slow tier](#lesson-promotion)
- [Entrenchment guards (load-bearing)](#entrenchment-guards-load-bearing)
- [Storage](#storage)
- [Disable](#disable)
- [Research basis](#research-basis)

---

## Why two tiers

A run that learns something — "the `ux` trigger didn't fire because the glob
missed `.tsx` in a nested dir" — needs somewhere to put that lesson so the
**next** run does better. There are two places it can go, and the loop uses
**both**, connected by a recurrence gate:

| Tier | Where | Cost | Reversible? | Changes behavior? |
| ---- | ----- | ---- | ----------- | ----------------- |
| **Fast (episodic)** | `persistent-memory` scope `aw-lessons` (committed markdown) | Cheap — one write per escalation / run | Yes — `forget` / expiry | **No** — advisory input to planning only |
| **Slow (procedural)** | The skill's own source, via `/create-skill diagnose` | Expensive — confidence-gated, user-approved diff | Yes — `git revert` | **Yes** — becomes an always-on rule / gate / trigger |

The fast tier captures lessons immediately and cheaply. A lesson only earns a
**permanent** change to the skill's source (the slow tier) once it has **proven
itself across runs** — recurrence is the cheap external-validation signal that
the lesson is real and not a one-off hallucination. This is the
episodic → procedural promotion path from the CoALA memory taxonomy, with the
confidence gate the literature insists on to prevent self-reinforcing error.

`persistent-memory` is an **optional companion** — if it is not installed the
whole fast tier skips silently (log one line, continue). The slow tier
(`/create-skill diagnose`) is unaffected and still works on demand.

---

## The lesson record

A lesson is a `persistent-memory` entry under the `aw-lessons` scope. It is
**procedural** memory — "how to do better next time" — not a fact about the
user. Schema:

```markdown
---
id: <yyyy-mm-dd>-<kebab-slug>
type: procedural
scope: aw-lessons
phase: <0 | 1 | 2 | 3 | 4 | 5 | 6 | 7>   # the workflow phase the lesson applies to
trigger-context: <concrete signal — file glob, task type, tech, e.g. "RN screens (*.tsx nested)">
seen_count: 1                            # bumped via UPDATE each time the lesson recurs
confidence: <high | medium | low>
status: active                           # active | promoted | retired
expires: <ISO 8601 — default created + 90 days; refreshed on each re-sighting>
source: system
---

# <one-line lesson title>

**What failed:** <concrete observable from the run>
**Why:** <root cause, if known; "unknown" is allowed>
**What to do next time:** <prescriptive, actionable, testable instruction>
**Promotion target:** <skill rule/phase this would harden if promoted, or "none">
```

The four bold fields are mandatory. `trigger-context` must be **concrete**
(globs, task types, tech names) — never "when it feels relevant" — so the read
step in Phase 1 can match it mechanically against the current task.

---

## Fast tier — read lessons

**Anchor:** `lessons-read`

Invoked at the **start of planning** (Phase 1) and again before
**implementation / testing** (Phase 3, Phase 4) so accumulated lessons bias the
work before mistakes repeat.

```
Skill("persistent-memory", "read aw-lessons --tier project-shared")     # skips silently if not installed
```

After the INDEX loads:

1. Match each lesson's `trigger-context` against the current task (file globs,
   task type, tech). Load the full entry only for matches — progressive
   disclosure; do not pull every entry.
2. Treat each **matching** lesson's *"What to do next time"* as a
   **consideration** on the plan / implementation — apply it unless it
   conflicts with the user's stated intent or task-specific constraints.
   Record applied lessons in `plan.md` under a `## Lessons applied` note (Full
   Mode).
3. Lessons are **advisory** — they bias the plan; they never silently change a
   gate, skip a phase, or override the user's intent. If a lesson conflicts
   with the user's stated intent, the user's intent wins and the conflict is
   surfaced.
4. **Maintenance check.** If the loaded `INDEX.md` is at or near its 200-line
   cap (≥ ~180 lines), invoke
   `Skill("persistent-memory", "consolidate aw-lessons --tier project-shared --auto")`
   at the next write point (Phase 4, Phase 7, or dispatcher exit-write).
   Autonomous consolidate prunes **expired** and **low-confidence** entries
   only; merges and contradictions are surfaced for review rather than
   resolved silently (preserves entrenchment guard #4). Without periodic
   consolidation the INDEX rots and recall degrades (persistent-memory's
   documented anti-pattern).

Log:

```markdown
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier project-shared) — N lessons matched, applied as constraints
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier project-shared) — not available, continuing
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier project-shared) — 0 lessons matched this task
```

---

## Fast tier — write lessons

**Anchor:** `lessons-write`

A lesson is captured at the two points below. The end-of-run write includes a
brief **retrospective prompt** so friction is captured even on clean runs —
the dominant failure mode of this loop is *no capture at all* (cold-start),
and recurrence + expiry filter noise downstream:

| Write point | When | What to capture |
| ----------- | ---- | --------------- |
| **Phase 4 stuck-loop escalation** | The iteration cap was hit (and/or auto-replan ran) on the same failing area | What the failing area was, every hypothesis tried, what finally worked (or that it didn't), and the phase that should have caught it earlier |
| **Phase 7 end-of-run** | CI green, or user-approved stop, or a post-merge bug surfaces in the same session | Any durable lesson from the run — a missed trigger, a plan gap, a recurring fix pattern |

```
Skill("persistent-memory", "write aw-lessons --tier project-shared --auto")   # skips silently if not installed
```

- `--auto` bypasses the consent preview (the autonomous loop cannot pause for
  approval on every write). The **privacy pre-flight is NOT bypassed** —
  `persistent-memory` still refuses to store secrets / PII on its never-store
  list, `--auto` or not. Lessons are about *workflow mechanics*, never product
  data — if a candidate lesson contains a credential, a customer name, or a
  token, it is dropped, not written.
- The write pipeline resolves each candidate as **ADD / UPDATE / DELETE /
  NOOP** against existing lessons (Mem0-style). A lesson that recurs resolves
  to **UPDATE**, which **bumps `seen_count`** and refreshes `expires` — it does
  not create a duplicate. This is what makes recurrence countable.
- **Applied-lesson UPDATE contract.** If a lesson read at the start of the run
  was applied and the failure it targets did not recur, write an UPDATE for
  that lesson — successful application counts as recurrence evidence. An UPDATE
  to an entry that carries a `seen_count` field MUST increment `seen_count` by
  1 and refresh `expires`. This is how a *working* lesson still reaches the
  `seen_count >= 3` promotion gate.
- **Retrospective prompt (Phase 7 / dispatcher exit-write).** Before writing,
  ask: was there friction, a surprise, a guess that paid off, a near-miss, or a
  companion that should have fired? Phrase each capture as an **observation**
  ("last run hit X") not a **rule** ("always do Y") — the read step applies
  observations as considerations, not constraints. Write nothing only when the
  retrospective surfaces nothing **and** no lesson was applied — empty lessons
  are noise. Phase 4 stuck-loop is failure-event-driven and does not need the
  retrospective.

Log:

```markdown
- [TIMESTAMP] Phase 4: persistent-memory(write aw-lessons) — 1 lesson (UPDATE, seen_count→3)
- [TIMESTAMP] Phase 7: persistent-memory(write aw-lessons) — 1 lesson (ADD), 1 NOOP
- [TIMESTAMP] Phase 7: persistent-memory(write aw-lessons) — not available, continuing
```

---

## Lesson promotion

**Anchor:** `lesson-promotion` (slow tier)

A lesson graduates from advisory note to permanent skill rule when it has
proven itself. Promotion is **suggested**, never automatic.

### Promotion trigger

After a `write` (Phase 4 or Phase 7), or after a `read` in Phase 1, check the
matched / written lessons. A lesson is **promotion-eligible** when **either**:

- `seen_count >= 3` — the same failure recurred across at least three runs, or
- the lesson's author tagged it `status: structural` because it reflects a
  design gap, not a one-off.

### What promotion does

For each eligible lesson, surface a one-line suggestion to the user — do **not**
act silently:

```
Lesson "<title>" has recurred N times (phase <p>). Promote it to a permanent
guard? Run:  /create-skill diagnose autonomous-workflow --symptom "<lesson title>"
```

When the user runs it, Diagnose Mode reads `aw-lessons` as **evidence** (the
full `seen_count` history and prior contexts make the diagnosis far more
accurate than a single-session reflection), produces one confidence-gated
unified-diff proposal against this skill's source, and applies it only at
`confidence(analysis) ≥ 90 %` **with explicit user confirmation**. The gate and
apply flow are unchanged — see
[`../../../authoring/create-skill/rules/diagnose-mode.md`](../../../authoring/create-skill/rules/diagnose-mode.md).

### After a successful promotion

Set the source lesson's `status: promoted` (via `persistent-memory write` with
an UPDATE) so it stops re-suggesting, and record the commit / PR that hardened
the skill in the lesson body. The lesson stays as an audit trail of *why* the
rule exists.

---

## Entrenchment guards (load-bearing)

The central, well-documented risk of any reflective-memory loop is
**self-reinforcing error**: an agent wrongly concludes "approach X always
fails," stores it, avoids X forever, and never gathers the evidence to overturn
the false belief. These guards are non-negotiable:

1. **Lessons are advisory, never auto-applied to behavior.** A lesson biases
   the plan; it can never silently disable a gate, skip a phase, or change a
   cap. The **only** path from a lesson to changed workflow behavior is through
   the confidence-gated, user-approved `diagnose` apply.
2. **Recurrence gates promotion, not a single run.** `seen_count >= 3` (or an
   explicit `structural` tag) is required before promotion is even suggested.
   One bad run cannot rewrite the skill.
3. **Every lesson expires.** Default `expires` is 90 days from last sighting.
   `consolidate` prunes expired and low-confidence lessons so stale beliefs
   decay instead of entrenching.
4. **Contradiction is flagged, not overwritten.** A new lesson that contradicts
   an existing one resolves through the write pipeline's compare step and is
   surfaced for review rather than silently winning.
5. **The privacy pre-flight is never bypassed.** `--auto` skips consent, not
   the never-store list.

---

## Storage

- **Scope:** `aw-lessons`
- **Tier:** `project-shared` (committed) — lives at `<repo>/memory/aw-lessons/`.
  Committed so the whole team's agents inherit the lessons and the history is
  version-controlled and reviewable. (Switch to `project-local` /
  gitignored or `home` / personal by changing the tier the `read` / `write`
  invocations resolve — see
  [`../../../authoring/persistent-memory/rules/storage-layout.md`](../../../authoring/persistent-memory/rules/storage-layout.md).)
- **Layout:** standard `persistent-memory` scope — `INDEX.md` (≤ 200 lines,
  always loaded), `entries/<date>-<slug>.md` (loaded on demand), `archive/`,
  `AUDIT.log`.

---

## Disable

The fast tier is fully optional and degrades silently:

- **Per-run:** uninstall `persistent-memory`, or omit it from the install set.
  Every `read` / `write` then logs `not available, continuing`.
- **Permanently:** remove the `Skill("persistent-memory", ...)` invocation
  blocks from [`phase-1-planning.md#lessons-read`](./phase-1-planning.md#lessons-read),
  [`phase-4-testing.md#lessons-write`](./phase-4-testing.md#lessons-write), and
  [`phase-7-ci-gate.md#lessons-write`](./phase-7-ci-gate.md#lessons-write), and
  delete the `persistent-memory` rows from
  [`companion-skills.md`](./companion-skills.md#registry).

The slow tier (`/create-skill diagnose`) is independent and unaffected by
disabling the fast tier.

---

## Research basis

- **CoALA** (Princeton, 2023) — the episodic → semantic → procedural memory
  taxonomy this loop promotes along.
- **ExpeL / EvolveR** — distilling success-vs-failure trajectories into
  reusable, editable lessons; recurrence-across-runs as the signal.
- **Agentic Context Engineering** (Zhang et al., 2025, arXiv 2510.04618) —
  improve via *context adaptation*, not weight updates; update knowledge with
  **incremental structured deltas** (append a lesson) rather than wholesale
  rewrites, to avoid context collapse / brevity bias.
- **Reflexion** (Shinn et al., 2023) and the **self-reinforcing-error** warning
  (SSGM governance work; "LLM Agents Are Not Always Faithful Self-Evolvers") —
  the basis for the entrenchment guards above.

See also [`../../../authoring/persistent-memory/references/research-sources.md`](../../../authoring/persistent-memory/references/research-sources.md).

**Worked example.** A full lesson lifecycle (capture → recur 3× → promote →
apply) is traced in
[`../references/self-improvement-walkthrough.md`](../references/self-improvement-walkthrough.md).
