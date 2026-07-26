---
title: Self-Improvement Loop — Authoring Pattern for Orchestrator Skills
impact: MEDIUM
tags:
  - self-improvement
  - memory
  - lessons
  - pattern
  - meta
---

# Self-Improvement Loop Pattern

How to give an orchestrator skill a **two-tier self-improvement loop** so it
gets better across runs. This is the reusable recipe behind the loops in
`autonomous-workflow`, `fix-bug`, and `batch-linear-tickets` — follow it instead
of hand-copying one of those.

## Contents

- [When to add a loop (and when NOT to)](#when-to-add-a-loop-and-when-not-to)
- [The two tiers](#the-two-tiers)
- [Conventions](#conventions)
- [Wiring checklist](#wiring-checklist)
- [Entrenchment guards (non-negotiable)](#entrenchment-guards-non-negotiable)
- [Don't reinvent the contract](#dont-reinvent-the-contract)

---

## When to add a loop (and when NOT to)

Add a loop when **all** of these hold:

- The skill is an **orchestrator or multi-phase pipeline** that can fail in
  recurring, classifiable ways (wrong triage, missed trigger, false-green gate).
- It has a **diagnostic surface** (or can get one) — the loop's slow tier
  promotes lessons through `/create-skill diagnose`.
- Failures are **about the skill's own process**, not just the user's product.

Do **NOT** add a loop to:

- **One-shot utilities** (`changelog`, `resolve-conflicts`, `ci-auto-fix`) — no
  durable cross-run subject; the cost outweighs the value.
- **Adversarial / audit skills** (`critical`, reviewers) — they must not be
  biased by prior conversations; that is the whole point of a fresh adversarial
  pass.
- **Skills that operate on secrets / credentials** — routing them through
  lesson extraction is a leak risk.
- A skill whose phases are **already covered by a composed skill's loop**. A
  composer that dispatches `aw-executor` inherits `aw-lessons` for free — only
  add a scope for the phases the composer *itself* owns. (See how `fix-bug`
  owns `fix-bug-lessons` for triage/repro/analysis but inherits `aw-lessons`
  for implementation.)

If unsure, default to **no** — a loop can be added later; removing an
entrenched-bias loop is harder.

---

## The two tiers

| Tier | Mechanism | Storage | Changes behavior? | Gate |
| ---- | --------- | ------- | ----------------- | ---- |
| **Fast (episodic)** | LoreKit `memory.*` tools (via `lorekit-memory`), read at the start of work, written at failure/end points | LoreKit (managed) | **No** — advisory input only | none (privacy pre-flight only) |
| **Slow (procedural)** | `/create-skill diagnose <skill>` | the skill's own source | **Yes** — a rule / gate / trigger | `confidence(analysis) ≥ 90 %` + user approval |

The tiers connect via a **recurrence gate**: a lesson reaching `seen_count >= 3`
(or tagged `status: structural`) becomes promotion-eligible, and the skill
suggests running `diagnose` — which reads the lessons scope as evidence (see the
`Lessons scope` section in [`diagnostic-surface.md`](./diagnostic-surface.md)).

Research basis: CoALA episodic→procedural promotion; ExpeL trajectory-distilled
lessons; Agentic Context Engineering (incremental deltas, not rewrites);
Reflexion / SSGM self-reinforcing-error guards.

---

## Conventions

- **Bucket name:** `<skill>-lessons` (e.g. `fix-bug-lessons`). Lowercase kebab.
  On LoreKit it is a **tag** (`loop::<skill>-lessons`) plus a **key namespace**
  (`<skill>-lessons::<slug>`) — LoreKit's partition axis is repo/branch/global,
  not named buckets, so the tag + key is how one loop's lessons stay separate.
- **Two scopes, both used** (map cleanly onto LoreKit's scope model):
  - **`global`** — universal lessons that follow the user across every repo.
    Always read; default write target for universal lessons. The slow-tier
    promotion (`/create-skill diagnose`) ships a recurring `global` lesson to
    every consumer.
  - **`repo::{owner}/{repo}`** — project-bound lessons specific to the cwd repo.
    Promotion of a recurring `repo::` lesson lands in the repo's own
    `CLAUDE.md` / `.claude/rules/` via the `docs` skill, not in this skill's
    source. LoreKit's mode (remote / local `.lorekit/`) — not a filesystem
    opt-in — decides whether a `repo::` lesson is private, synced, or committed.
  - The workflow classifies each candidate at write time (universal → `global`,
    project-bound → `repo::{owner}/{repo}`) and pins the `scope` **explicitly**
    in every `memory.write` — readable on the call site.
- **Lesson type:** `procedural` ("what to do better next time"), not a fact.
  Four mandatory body fields: *What failed / Why / What to do next time /
  Promotion target*. Plus the `meta:` fields `seen_count`, `status`, `expires`,
  `phase`, `trigger-context` (concrete: globs, task types, classes — so reads
  match mechanically) carried inside the LoreKit `value`.
- **Autonomous writes skip consent** (the loop can't pause) — but the privacy
  pre-flight still runs; never store secrets/PII.

---

## Wiring checklist

For a skill named `<skill>` in category `<cat>`:

- [ ] `skills/<cat>/<skill>/rules/self-improvement-loop.md` — the contract.
      Reference the canonical design in
      [`autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md)
      for the shared schema + guards; state only what differs (scope, read/write
      points, promotion target). Keep it self-contained enough to execute.
- [ ] Read invocation at the **start of work** — narrow-to-broad `memory.list`
      (`repo::{owner}/{repo}` then `global`, filtered by tag
      `loop::<skill>-lessons`; optional `memory.search` when the task names a
      subsystem). Apply matches as advisory constraints; skip expired lessons.
      No consolidation pass — LoreKit owns storage and dedups on write.
- [ ] Write invocation(s) at the **failure / end-of-run points** the skill
      already detects (escalation, verifier-red, end-of-run) — no new
      reflection step. `memory.search` to dedup, then classify candidates:
      universal → `memory.write` scope `global`; project-bound → scope
      `repo::{owner}/{repo}`.
- [ ] Promotion suggestion when a read/written lesson hits `seen_count >= 3`,
      scope-appropriate: `global` → `/create-skill diagnose <skill>`;
      `repo::` → `Skill("docs", "update --add-rule …")`.
- [ ] `lorekit-memory` (LoreKit `memory.*` tools) added to the skill's companion
      registry / prerequisites as **optional** (loop skips silently if the
      `memory.*` tools are not connected).
- [ ] `## Lessons scope` section added to the skill's `rules/diagnostic-surface.md`
      (so `diagnose` Step 2 loads it as evidence).
- [ ] SKILL.md `## Self-Improvement` section + inventory entries in root
      `CLAUDE.md` / `README.md`. (No repo-side seed directory — LoreKit creates
      the scope lazily on first `memory.write`.)

---

## Entrenchment guards (non-negotiable)

Copy these into every loop — the dominant risk is **self-reinforcing error**
(an agent wrongly concludes X always fails, then avoids X forever):

1. **Lessons are advisory, never auto-applied to behavior.** The only path from
   a lesson to a behavior change is the confidence-gated, user-approved
   `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days, in the `meta:` block); the read
   step ignores expired lessons so stale beliefs decay.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by autonomous writes.

A lesson must never relax one of the skill's own hard invariants — that is what
the slow tier's confidence gate and the `diagnostic-surface.md` hard-invariants
list are for.

---

## Don't reinvent the contract

The lesson schema and the LoreKit read/write/dedup mechanics live in
[`persistent-memory`](../../persistent-memory/SKILL.md) (see its
[`scaling-tiers.md`](../../persistent-memory/rules/scaling-tiers.md#lorekit--the-self-improvement-loop-backend)
LoreKit section and [`write-pipeline.md`](../../persistent-memory/rules/write-pipeline.md#lesson-scope-entries)
lesson schema). The canonical loop contract lives in
[`autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md),
and the promotion engine in [`diagnose-mode.md`](./diagnose-mode.md). Your loop
file only declares **which bucket (tag), which read/write points, and the
promotion target** — it does not re-implement memory mechanics or diagnosis.
