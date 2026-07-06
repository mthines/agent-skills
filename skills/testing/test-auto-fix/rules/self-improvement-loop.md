---
title: Self-Improvement Loop — test-auto-fix Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - test-auto-fix
  - verdicts
  - regression-detection
  - promotion
  - meta
---

# Self-Improvement Loop (test-auto-fix)

`/test-auto-fix` improves across runs through the same **two-tier loop** as
`autonomous-workflow` and `fix-bug`. This file is the test-auto-fix-specific
contract: which scope, which read / write points, and the promotion gate. The
**shared** lesson-record schema and the entrenchment guards are canonical in
[`../../../workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

## Contents

- [Lessons vs. the surface file](#lessons-vs-the-surface-file)
- [Scope](#scope)
- [Read lessons (Phase 2)](#read-lessons-phase-2)
- [Write lessons (Phase 6 / 7)](#write-lessons-phase-6--7)
- [Lesson promotion](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)

---

## Lessons vs. the surface file

test-auto-fix already persists per-project state: the **surface file**
(`surfaces/<project-key>.md`, keyed by normalized git remote per
[`project-keying.md`](./project-keying.md)). **Lessons do not duplicate it —
they complement it:**

| Surface file (config) | Lessons (learned judgment) |
| --------------------- | -------------------------- |
| *How to run tests here* — stack, detect command, single-test command, failure-parser regex | *What this project's test failures usually mean* — which verdict and fix sub-class a recurring failure shape resolves to |
| Written once at bootstrap, edited only on drift | Accrued across runs, recurrence-counted, expiring |

The surface tells the skill how to execute; lessons bias the **Phase 2 verdict**
and **Phase 3 fix-strategy** so recurring misclassifications stop repeating.

**Honest scope note (MEDIUM fit).** test-auto-fix's feedback is *binary and
local* (a test goes green on re-run or it does not) — there is no distributed
post-deploy signal like fix-bug's Phase 8 telemetry, and the verdict space is
only three buckets (`test-bug` / `prod-bug` / `unsure`). The strongest value is
therefore **within a project** (catching a recurring verdict misclassification
or a chronically mis-scored fix class), with weaker cross-project leverage. The
loop is worth running, but calibrate expectations accordingly.

---

## Scope

- **Scope:** `test-auto-fix-lessons`
- **Tiers (two, used together):**
  - **`home`** — per-user at `~/.agent-memory/test-auto-fix-lessons/`. Default for
    **universal** lessons (a stack + failure-shape → verdict/fix pattern that
    holds for any project on that stack, e.g. "vitest + `Cannot find module` is
    usually import-drift, not type-drift").
  - **`project-shared`** — committed at `<repo>/memory/test-auto-fix-lessons/`.
    Opt-in (only when `INDEX.md` exists in cwd). Default for **project-bound**
    lessons (this repo's recurring failure shapes) — where most of the value is.
- **trigger-context key:** `<stack> : <failure-pattern> : <verdict-sub-class>`
  where `stack` comes from the surface file, `failure-pattern` is the normalized
  first ~3 lines of the error (via the surface's `failure-parser`), and
  `verdict-sub-class` is the fix sub-type from [`verdicts.md`](./verdicts.md)
  (snapshot-drift, selector-drift, type-drift, timing, import-drift,
  mock-stub-mismatch).

Lesson record schema is the shared one (procedural memory; the four mandatory
fields *What failed / Why / What to do next time / Promotion target*). Set
`phase:` to `2` (verdict), `3.5` (confidence calibration), or `6` (regression).

---

## Read lessons (Phase 2)

**Anchor:** `lessons-read`

At the **start of Phase 2 (Classify each failure)** — after failures are
detected and parsed (Phase 1) but before a verdict is emitted — load lessons.
The surface is already resolved (Phase 0), so the `stack` key is known.

```
Skill("persistent-memory", "read test-auto-fix-lessons --tier home")     # skips silently if not installed
if [ -f memory/test-auto-fix-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read test-auto-fix-lessons --tier project-shared")
fi
```

1. Union both INDEXes. Match each lesson's `<stack>:<failure-pattern>` against
   the parsed failures. Load full entries only for matches. Project-shared wins
   on conflict (closer scope).
2. Apply matches as **inputs**: a verdict lesson biases the Phase 2 classification
   for that failure shape; a fix-sub-class lesson biases the Phase 3 draft toward
   the strategy that worked before; a calibration lesson is a hint to Phase 3.5's
   `/confidence` call. None overrides the evidence — the verdict rubric in
   [`verdicts.md`](./verdicts.md) still governs, and the conservative default
   toward `unsure`/`prod-bug` (escalate) is never relaxed by a lesson.
3. Lessons are **advisory** — they never lower the confidence gate, never let a
   fix touch production code that the verdict said not to, and never override a
   hard refusal in [`anti-patterns.md`](./anti-patterns.md).
4. Record applied lessons in the plan artifact
   (`.agent/{branch}/test-auto-fix-plan.md`) under a `Lessons applied` note.
5. **Maintenance check.** If a loaded `INDEX.md` is near its 200-line cap, surface
   a one-line `/persistent-memory consolidate test-auto-fix-lessons` suggestion at
   the Phase 7 write point.

Log:

```markdown
- [TIMESTAMP] Phase 2: persistent-memory(read test-auto-fix-lessons --tier project-shared) — N lessons matched (stack=vitest), applied
- [TIMESTAMP] Phase 2: persistent-memory(read test-auto-fix-lessons) — not available, continuing
```

---

## Write lessons (Phase 6 / 7)

**Anchor:** `lessons-write`

| Write point | When | Lesson captures |
| ----------- | ---- | --------------- |
| **Phase 6 — same failure recurs** | The outer-loop re-run shows the same failure after a fix | The verdict/fix was wrong for this shape — the strongest negative signal |
| **Phase 6 — regression (new failure)** | A fix introduced a new failure and was reverted | The fix sub-class was too broad for this shape |
| **Phase 4 — provenance revert** | `test-provenance-guard` flagged tests-by-construction and the fix was reverted | The "green" was fake — capture so the next run distrusts that shape |
| **Phase 7 — end-of-run** | Green, or escalated (retrospective) | An UPDATE to any lesson read at Phase 2 that led to a clean green (accrues `seen_count`), or a durable new pattern from the run |

Classify each candidate as **universal** (a stack + failure-shape pattern) or
**project-bound** (this repo's recurring shape). Then dispatch:

```
# Universal candidate — home.
Skill("persistent-memory", "write test-auto-fix-lessons --tier home --auto")

# Project-bound candidate — opt-in gated (most value lives here).
if [ -f memory/test-auto-fix-lessons/INDEX.md ]; then
  Skill("persistent-memory", "write test-auto-fix-lessons --tier project-shared --auto")
else
  Skill("persistent-memory", "write test-auto-fix-lessons --tier home --auto")
  log "Project-bound lesson fell back to home. Opt in once: Skill(\"persistent-memory\", \"write test-auto-fix-lessons --tier project-shared\")"
fi
```

- `--auto` skips consent, **not** the privacy pre-flight (a test-failure lesson
  never needs product data; the bar is stricter for `project-shared` writes).
- **Applied-lesson UPDATE contract.** An UPDATE to an entry that carries a
  `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.
- **Never** write a lesson that encodes a test-weakening action (delete a test,
  `.skip`/`.only`, loosened matcher, mocked SUT) — those are hard-refused in
  [`anti-patterns.md`](./anti-patterns.md).

Log (include tier + verdict shape + outcome):

```markdown
- [TIMESTAMP] Phase 7: persistent-memory(write test-auto-fix-lessons --tier project-shared) — 1 lesson (UPDATE, seen_count→3) — green
- [TIMESTAMP] Phase 6: persistent-memory(write test-auto-fix-lessons --tier home) — 1 lesson (ADD) — regression reverted
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface the tier-appropriate suggestion — never act silently:

- `home` → `/create-skill diagnose test-auto-fix --symptom "<title>"`
- `project-shared` → `Skill("docs", "update --add-rule '<title>' --source memory/test-auto-fix-lessons/entries/<id>.md")`

`test-auto-fix` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose test-auto-fix` reads the SKILL.md H2 sections (phases,
verdicts, anti-patterns) as its fallback surface plus `test-auto-fix-lessons` as
evidence, and emits one confidence-gated diff — applied only at
`confidence(analysis) ≥ 90 %` with explicit user confirmation. On success, set
the lesson `status: promoted`. A recurring **universal** lesson may instead be
better promoted into the surface template or the verdict rubric — diagnose will
propose the best target.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied.** The only path from a lesson to a
   changed verdict rule or default fix strategy is a confidence-gated,
   user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by `--auto`.

A test-auto-fix lesson must **never** relax a hard refusal: it can bias the
verdict toward a fix sub-class, but it can never delete or weaken a test, mock
the SUT, lower the confidence gate, or turn a `prod-bug`/`unsure` escalation into
a silent test edit. The verdict rubric and the confidence gate are the ground
truth; a lesson is only a starting hypothesis they still have to confirm.
