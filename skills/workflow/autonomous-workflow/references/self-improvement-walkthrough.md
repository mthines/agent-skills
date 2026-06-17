---
title: Worked Example — A Lesson's Full Lifecycle
impact: LOW
tags:
  - self-improvement
  - lessons
  - worked-example
  - reference
---

# Worked Example: A Lesson's Full Lifecycle

A concrete trace of one lesson moving through the two-tier
[self-improvement loop](../rules/self-improvement-loop.md): captured cheaply in
the fast tier, proven by recurrence, then promoted into the skill's source
through the gated slow tier. Load this to see how the pieces fit; the
authoritative contract is the loop file.

## Contents

- [The recurring failure](#the-recurring-failure)
- [Run 1 — first capture (ADD)](#run-1--first-capture-add)
- [Run 2 — recurrence (UPDATE)](#run-2--recurrence-update)
- [Run 3 — promotion-eligible](#run-3--promotion-eligible)
- [Promotion — the slow tier](#promotion--the-slow-tier)
- [After promotion](#after-promotion)
- [What each guard prevented](#what-each-guard-prevented)

---

## The recurring failure

The `ux` companion (Phase 3) is triggered by the glob `*.tsx`, `*.jsx`,
`*.vue`, `*.svelte`. A React Native project keeps screens at
`src/screens/**/Foo.screen.tsx`. The glob matches `.tsx`, but on three separate
features the agent edited files under a nested `components/` dir whose names did
not surface in the trigger's path check, so `ux` never ran and an a11y
regression shipped each time.

---

## Run 1 — first capture (ADD)

Phase 4 escalates (a UX bug surfaced late). The executor writes a lesson:

```
Skill("persistent-memory", "write aw-lessons --tier home --auto")
```

Resolves to **ADD**. New entry `entries/2026-06-07-ux-trigger-missed-nested-tsx.md`:

```markdown
---
id: 2026-06-07-ux-trigger-missed-nested-tsx
type: procedural
scope: aw-lessons
phase: 3
trigger-context: "RN / nested *.tsx under components/ or screens/"
seen_count: 1
confidence: medium
status: active
expires: 2026-09-05T00:00:00Z
source: system
---

# ux companion skipped for nested .tsx screens

**What failed:** The Phase 3 `ux` trigger didn't fire on `src/screens/.../X.tsx`;
an a11y regression shipped.
**Why:** trigger path-check matched flat globs only; nested RN screens slipped.
**What to do next time:** when the diff touches any `*.tsx`/`*.jsx` at any depth, run `ux`.
**Promotion target:** phase-3-implementation.md#ux-trigger (widen the glob)
```

Log: `Phase 4: persistent-memory(write aw-lessons) — 1 lesson (ADD, seen_count=1)`.

---

## Run 2 — recurrence (UPDATE)

A different RN feature, weeks later. At **Phase 1** the planner reads
`aw-lessons`; the lesson's `trigger-context` ("nested `*.tsx`") matches the
task, so it is applied as a plan constraint ("run `ux` for the nested screens").
The agent runs `ux` this time — good, the fast tier already helped.

This write is mandated by the applied-lesson UPDATE contract
([`self-improvement-loop.md`](../rules/self-improvement-loop.md#fast-tier--write-lessons)):
if a lesson read at the start of the run was applied and the failure it
targets did not recur, write an UPDATE for that lesson — successful
application counts as recurrence evidence, and the UPDATE MUST increment
`seen_count` by 1 and refresh `expires`. The same root cause (the narrow
trigger) is still in the skill, so at end-of-run the executor records the
recurrence:

```
Skill("persistent-memory", "write aw-lessons --tier home --auto")
```

The candidate matches the existing entry → resolves to **UPDATE**, not a
duplicate: `seen_count → 2`, `expires` refreshed.

Log: `Phase 7: persistent-memory(write aw-lessons) — 1 lesson (UPDATE, seen_count=2)`.

---

## Run 3 — promotion-eligible

Third RN project, same shape. On the Phase 1 read the lesson matches again;
end-of-run UPDATE bumps `seen_count → 3`. The read/write step now sees
`seen_count >= 3` and surfaces the **promotion suggestion** (it does not act):

```
Lesson "ux companion skipped for nested .tsx screens" has recurred 3 times
(phase 3). Promote it to a permanent guard?  Run:
/create-skill diagnose autonomous-workflow --symptom "ux trigger misses nested .tsx"
```

---

## Promotion — the slow tier

The user runs the suggested command. Diagnose Mode:

1. **Step 1** resolves the source root `skills/workflow/autonomous-workflow/`
   (via the `skills/*/<name>/` glob).
2. **Step 2** reads `aw-lessons` as evidence and finds the promotion-eligible
   lesson — `seen_count=3` is strong evidence this is a real recurring class,
   and the lesson already names the fix and target file.
3. **Step 4** attributes the failure to Phase 3 (`ux-trigger`).
4. **Step 5** proposes one diff: widen the `ux` trigger to match `*.tsx`/`*.jsx`
   at any depth.
5. **Step 6** runs `confidence(analysis)` → 93 % (the recurrence evidence and a
   concrete, mechanical change clear the gate).
6. With the user's explicit confirmation, `--apply` runs `git apply`.

The change is now a permanent, always-on guard — no future run depends on the
lesson being read.

---

## After promotion

The lesson's `status` is set to `promoted` (an UPDATE) so it stops
re-suggesting, and the body records the commit that hardened the skill. It
remains as an audit trail of *why* the widened glob exists. Eventually it
expires and `consolidate` archives it — the knowledge now lives in the source,
not the memory.

---

## What each guard prevented

- **Advisory-only:** runs 1–3 never silently changed the trigger; they only
  biased planning. The behavior change waited for human-approved promotion.
- **Recurrence gate (`seen_count >= 3`):** a single noisy run could not rewrite
  the skill — promotion waited for three independent confirmations.
- **Confidence gate (93 %):** a speculative or wrong proposal would have been
  refused at `< 90 %`, leaving the report as a discussion artifact.
- **Expiry + consolidate:** had the trigger been fixed another way, the stale
  lesson would have decayed instead of entrenching a now-false belief.
