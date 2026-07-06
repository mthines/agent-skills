---
title: Self-Improvement Loop — e2e-pr-stabilizer Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - e2e-pr-stabilizer
  - flake-patterns
  - promotion
  - meta
---

# Self-Improvement Loop (e2e-pr-stabilizer)

`/e2e-pr-stabilizer` gets better across runs through the same **two-tier loop**
as `autonomous-workflow` and `fix-bug`. This file is the stabilizer-specific
contract: which scope, which read / write points, and the promotion gate. The
**shared** lesson-record schema and the entrenchment guards are canonical in
[`../../../workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

The loop runs in **`stabilize` mode only**. `optimize` mode is report-only (no
fix, no ratification signal), so it neither reads nor writes lessons.

## Contents

- [Why the fit is strong here](#why-the-fit-is-strong-here)
- [Scope and the two-tier split](#scope-and-the-two-tier-split)
- [Read lessons (Phase 4)](#read-lessons-phase-4)
- [Write lessons (Phase 7 ratification)](#write-lessons-phase-7-ratification)
- [Lesson promotion](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)

---

## Why the fit is strong here

Two properties make this skill an unusually good memory host:

1. **A bounded, named decision space.** Root-cause synthesis (Phase 4) maps
   trace + span evidence to one of six named flake patterns (P1–P6) in
   [`root-cause-and-fix.md`](./root-cause-and-fix.md); Phase 5 then picks a
   locator strategy for that pattern. Both are recurring classification calls
   that can be wrong and repeat across runs.
2. **A deterministic, dual feedback signal.** Phase 6 requires **3 consecutive
   local passes** before commit, and Phase 7 **ratifies against telemetry**
   (post-push `failure_rate` vs the Phase 1 baseline). A fix is only *proven*
   when the failure rate drops to 0 — which is exactly the evidence a lesson
   needs to avoid self-reinforcing error.

The skill currently re-derives the pattern classification from scratch every
run and keeps **no learned store** (the Dash0 spans it queries are live,
per-PR historical baselines — not memory). This loop fills that gap.

---

## Scope and the two-tier split

- **Scope:** `e2e-pr-stabilizer-lessons`
- The two tiers map cleanly onto the two kinds of lesson this skill produces:

| Tier | Home = **universal** | Project-shared = **project-bound** |
| ---- | -------------------- | ---------------------------------- |
| What it holds | Race-shape → fix-shape mappings that hold for any Playwright app (a P1 post-render race is fixed by awaiting `toBeVisible`, not `waitForTimeout`) | App-specific locator-strategy robustness — which selector family survives (a `getByTestId` recovers a P1 faster than `getByRole` in a testid-heavy app), and per-file flake clustering |
| Path | `~/.agent-memory/e2e-pr-stabilizer-lessons/` (always read) | `<repo>/memory/e2e-pr-stabilizer-lessons/` (opt-in: only when `INDEX.md` exists in cwd) |

- **trigger-context keys:**
  - Universal lessons key on **pattern** only (`P1`…`P6`) — the race shape is
    app-agnostic.
  - Project-bound lessons key on **`<repo>:<test.file>:<pattern>:<locator-strategy>`**
    (e.g. `dash0/console:tests/e2e/orgs.spec.ts:P1:getByTestId`) — locator
    robustness and flake clustering are file- and app-specific.

Lesson record schema is the shared one (procedural memory; the four mandatory
fields *What failed / Why / What to do next time / Promotion target*). Set
`phase:` to `4` (classification) or `5` (locator strategy).

---

## Read lessons (Phase 4)

**Anchor:** `lessons-read`

At the **start of Phase 4 (Root-cause synthesis)** — after the span signature +
trace hotspot are in hand (Phase 3) but before the P1–P6 pattern is assigned —
load lessons. Reading here biases both the pattern classification (Phase 4) and
the locator strategy it drives (Phase 5).

```
Skill("persistent-memory", "read e2e-pr-stabilizer-lessons --tier home")     # skips silently if not installed
if [ -f memory/e2e-pr-stabilizer-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read e2e-pr-stabilizer-lessons --tier project-shared")
fi
```

1. Union both INDEXes. Match universal lessons on the candidate pattern shape;
   match project-bound lessons on `<repo>:<file>`. Load full entries only for
   matches. Project-shared wins on conflict (closer scope).
2. Apply matches as **inputs**: a pattern lesson biases which of P1–P6 the
   evidence most likely fits (it never overrides contradicting trace evidence);
   a locator lesson biases the Phase 5 selector-family choice toward the one
   that recovered fastest before.
3. Lessons are **advisory** — they never relax the empirical gates. The Phase 5
   selector-existence check, the Phase 6 3-consecutive-pass requirement, and the
   guard-rails refusals ([`guard-rails.md`](./guard-rails.md)) still run in full.
   A lesson can suggest "try P1 first"; it can never let a fix skip the 3-pass
   gate or ship an unverified locator.
4. Record applied lessons in the Phase 8 report under a `Lessons applied` note,
   marking the source tier.
5. **Maintenance check.** If a loaded `INDEX.md` is at/near its 200-line cap
   (≥ ~180 lines), surface a one-line
   `/persistent-memory consolidate e2e-pr-stabilizer-lessons` suggestion at the
   Phase 7 write point.

Log:

```markdown
- [TIMESTAMP] Phase 4: persistent-memory(read e2e-pr-stabilizer-lessons --tier home) — N lessons matched (pattern hints), applied
- [TIMESTAMP] Phase 4: persistent-memory(read e2e-pr-stabilizer-lessons) — not available, continuing
```

---

## Write lessons (Phase 7 ratification)

**Anchor:** `lessons-write`

The write is gated on the **ratification signal**, not the local pre-signal —
this is what keeps the loop honest.

| Write point | When | Lesson captures |
| ----------- | ---- | --------------- |
| **Phase 7 — CI ratified `fixed`** | Post-push `failure_rate` dropped to 0 vs baseline | The pattern classification + locator strategy that **worked** — write an UPDATE so it accrues `seen_count` (a working lesson still needs recurrence to promote) |
| **Phase 7 — CI `unchanged` / `regressed`** | The fix did not clear the flake, or CI disagreed with the 3/3 local streak | The strongest negative lesson: the Phase 4 pattern was mis-assigned, or the locator strategy was wrong for this app — capture what the trace actually showed |
| **Phase 6 escalation** | A test hit the 10-attempt cap without a 3/3 streak | A pattern this skill cannot yet fix mechanically for this file — capture the evidence so the next run escalates faster |

Do **not** write a lesson from a Phase 6 3/3 local pass alone — a local streak
is necessary but not sufficient (Core Principle 6). Wait for the Phase 7
telemetry verdict; a fix that passed 3× locally but stayed flaky on CI is
exactly the false-positive a premature write would entrench.

Classify each candidate as **universal** (a P1–P6 race-shape → fix-shape
mapping) or **project-bound** (locator robustness / flake clustering for a
specific repo + file). Then dispatch:

```
# Universal candidate — home.
Skill("persistent-memory", "write e2e-pr-stabilizer-lessons --tier home --auto")

# Project-bound candidate — opt-in gated.
if [ -f memory/e2e-pr-stabilizer-lessons/INDEX.md ]; then
  Skill("persistent-memory", "write e2e-pr-stabilizer-lessons --tier project-shared --auto")
else
  Skill("persistent-memory", "write e2e-pr-stabilizer-lessons --tier home --auto")
  log "Project-bound lesson fell back to home. Opt in once with: Skill(\"persistent-memory\", \"write e2e-pr-stabilizer-lessons --tier project-shared\")"
fi
```

- `--auto` skips consent, **not** the privacy pre-flight (a flake lesson never
  needs product data; the bar is stricter for `project-shared` writes since the
  content lands in the repo).
- **Applied-lesson UPDATE contract.** If a lesson read at Phase 4 was applied and
  Phase 7 ratified `fixed`, write an UPDATE for it. An UPDATE to an entry that
  carries a `seen_count` field MUST increment `seen_count` by 1 and refresh
  `expires`. This is how a *working* lesson reaches the `seen_count >= 3`
  promotion gate.

Log (include the resolved tier and the ratification verdict):

```markdown
- [TIMESTAMP] Phase 7: persistent-memory(write e2e-pr-stabilizer-lessons --tier home) — 1 lesson (UPDATE, seen_count→3) — ratified fixed
- [TIMESTAMP] Phase 7: persistent-memory(write e2e-pr-stabilizer-lessons --tier project-shared) — 1 lesson (ADD) — ratified regressed, project-bound
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface a one-line suggestion — never act silently:

| Lesson tier | Promotion target | One-liner |
| ----------- | ---------------- | --------- |
| `home` (universal) | The skill's source — a new / refined P1–P6 pattern entry in [`root-cause-and-fix.md`](./root-cause-and-fix.md) | `Lesson "<title>" recurred N times. Promote to a permanent pattern rule?  Run:  /create-skill diagnose e2e-pr-stabilizer --symptom "<title>"` |
| `project-shared` (project-bound) | The repo's own rules — locator conventions for this app | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule?  Run:  Skill("docs", "update --add-rule '<title>' --source memory/e2e-pr-stabilizer-lessons/entries/<id>.md")` |

`e2e-pr-stabilizer` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose e2e-pr-stabilizer` reads the SKILL.md H2 sections
(phases, core principles, guard-rails) as its fallback surface plus
`e2e-pr-stabilizer-lessons` as evidence, and emits one confidence-gated diff —
applied only at `confidence(analysis) ≥ 90 %` with explicit user confirmation.
On success, set the lesson `status: promoted`.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied.** The only path from a lesson to a
   changed pattern rule or default locator strategy is a confidence-gated,
   user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days); `consolidate` prunes stale ones.
4. **Contradictions are flagged, not silently overwritten.**
5. **Privacy pre-flight is never bypassed** by `--auto`.

A stabilizer lesson must **never** relax a guard-rail: it can bias pattern
choice, but it can never introduce `.skip` / `.fixme` / `waitForTimeout`, ship
an unverified locator, or shortcut the 3-consecutive-pass gate. The empirical
gates are the ground truth; a lesson is only ever a starting hypothesis the
gates still have to confirm.
