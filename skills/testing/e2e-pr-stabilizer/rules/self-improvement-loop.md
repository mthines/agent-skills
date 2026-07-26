---
title: Self-Improvement Loop — e2e-pr-stabilizer Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - lorekit
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

The fast tier runs through **LoreKit's `memory.*` MCP tools** (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier is a silent no-op (log one line, continue).

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

LoreKit's partition axis is **scope**, not named buckets. This loop keeps its
lessons separate from other loops' with a **tag** and a **key namespace**, and
maps its two tiers onto scope:

- **Bucket = tag + key namespace.** Every lesson carries the tag
  `loop::e2e-pr-stabilizer-lessons`; every key lives in the
  `e2e-pr-stabilizer-lessons::` namespace. Reads filter by the tag; writes always
  include it. Same `scope` + `key` overwrites in place — that is what makes
  recurrence countable.
- **Scopes (two, used together), mapping cleanly onto the two kinds of lesson
  this skill produces:**

| Scope | `global` = **universal** | `repo::{owner}/{repo}` = **project-bound** |
| ----- | ------------------------ | ------------------------------------------ |
| What it holds | Race-shape → fix-shape mappings that hold for any Playwright app (a P1 post-render race is fixed by awaiting `toBeVisible`, not `waitForTimeout`) | App-specific locator-strategy robustness — which selector family survives (a `getByTestId` recovers a P1 faster than `getByRole` in a testid-heavy app), and per-file flake clustering |
| Always read? | Yes — follows the user across every repo | Read when a git remote resolves; derive `{owner}/{repo}` from `origin`, lowercased, `.git` stripped |

  LoreKit's mode (remote / local `.lorekit/`) decides whether a `repo::` lesson
  is private, dashboard-synced, or committed — the loop only selects the scope,
  never manages storage.

- **trigger-context keys:**
  - Universal lessons key on **pattern** only (`P1`…`P6`) — the race shape is
    app-agnostic.
  - Project-bound lessons key on **`<repo>:<test.file>:<pattern>:<locator-strategy>`**
    (e.g. `dash0/console:tests/e2e/orgs.spec.ts:P1:getByTestId`) — locator
    robustness and flake clustering are file- and app-specific.

Lesson record schema is the shared one (procedural memory; the four mandatory
fields *What failed / Why / What to do next time / Promotion target*, plus the
`meta:` comment carrying `phase`, `seen_count`, `status`, `expires`,
`trigger-context`). Set `phase:` to `4` (classification) or `5` (locator
strategy).

---

## Read lessons (Phase 4)

**Anchor:** `lessons-read`

At the **start of Phase 4 (Root-cause synthesis)** — after the span signature +
trace hotspot are in hand (Phase 3) but before the P1–P6 pattern is assigned —
load lessons. Reading here biases both the pattern classification (Phase 4) and
the locator strategy it drives (Phase 5).

The read is **narrow-to-broad** — project-bound lessons from `repo::` first,
then universal lessons from `global`:

```text
# (1) Project-bound lessons for this repo (silent no-op if memory.* not connected).
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::e2e-pr-stabilizer-lessons"], limit: 50 }

# (2) Universal race-shape lessons that follow the user across every repo.
memory.list { scope: "global", tags: ["loop::e2e-pr-stabilizer-lessons"], limit: 50 }

# (3) Optional — narrow by the candidate pattern or the failing file:
memory.search { q: "<P1..P6> <test.file>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

1. Union the matches. Match universal lessons on the candidate pattern shape;
   match project-bound lessons on `<repo>:<file>`. Load full entries only for
   matches. `repo::` wins over `global` on key collision (closer scope). **Skip
   any lesson whose `expires` is in the past** — treat it as stale.
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
   marking the source scope.

There is no local INDEX to maintain: LoreKit owns storage server-side and
deduplicates on write, so the loop does not run a consolidation pass. Stale
beliefs decay through `expires`, not a line-count sweep.

Log:

```markdown
- [TIMESTAMP] Phase 4: lorekit(memory.list global loop::e2e-pr-stabilizer-lessons) — N lessons matched (pattern hints), applied
- [TIMESTAMP] Phase 4: lorekit — memory.* not connected, continuing
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

**Scope classification (load-bearing).** Classify each candidate as **universal**
(a P1–P6 race-shape → fix-shape mapping) or **project-bound** (locator robustness
/ flake clustering for a specific repo + file). Then **deduplicate first** so a
recurrence UPDATES in place:

```text
# 1. Dedup search across the scopes that could hold it.
memory.search { q: "<pattern> <locator-strategy> <test.file>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal candidate — always lands in global.
memory.write { scope: "global", key: "e2e-pr-stabilizer-lessons::<slug>", value: "<body>", tags: ["loop::e2e-pr-stabilizer-lessons", "source::<trigger>"], source_agent: "e2e-pr-stabilizer", trigger: "<trigger>" }

# 2b. Project-bound candidate — lands in this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "e2e-pr-stabilizer-lessons::<slug>", value: "<body>", tags: ["loop::e2e-pr-stabilizer-lessons", "source::<trigger>"], source_agent: "e2e-pr-stabilizer", trigger: "<trigger>" }
```

- **No filesystem opt-in ceremony.** The loop just picks the scope; LoreKit's
  mode decides whether a `repo::` lesson is private, dashboard-synced, or
  committed to `.lorekit/`. The loop never creates directories or commits lesson
  files.
- **The privacy pre-flight is NOT optional.** A flake lesson never needs product
  data — drop any candidate carrying a credential, a customer name, a token, or
  PII rather than writing it. The bar is **stricter** for `repo::` writes since a
  repo scope is team-visible.
- **Applied-lesson UPDATE contract.** If a lesson read at Phase 4 was applied and
  Phase 7 ratified `fixed`, write an UPDATE for it. An UPDATE to an entry that
  carries a `seen_count` field MUST increment `seen_count` by 1 and refresh
  `expires`. This is how a *working* lesson reaches the `seen_count >= 3`
  promotion gate. Same `scope` + `key` overwrites in place, so a recurrence
  updates rather than duplicating.

Log (include the resolved scope and the ratification verdict):

```markdown
- [TIMESTAMP] Phase 7: lorekit(memory.write global e2e-pr-stabilizer-lessons::<slug>) — UPDATE, seen_count→3 — ratified fixed
- [TIMESTAMP] Phase 7: lorekit(memory.write repo::{owner}/{repo} e2e-pr-stabilizer-lessons::<slug>) — ADD — ratified regressed, project-bound
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface a one-line suggestion — never act silently:

| Lesson scope | Promotion target | One-liner |
| ------------ | ---------------- | --------- |
| `global` (universal) | The skill's source — a new / refined P1–P6 pattern entry in [`root-cause-and-fix.md`](./root-cause-and-fix.md) | `Lesson "<title>" recurred N times. Promote to a permanent pattern rule?  Run:  /create-skill diagnose e2e-pr-stabilizer --symptom "<title>"` |
| `repo::{owner}/{repo}` (project-bound) | The repo's own rules — locator conventions for this app | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule?  Run:  Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/e2e-pr-stabilizer-lessons::<slug>")` |

`e2e-pr-stabilizer` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose e2e-pr-stabilizer` reads the SKILL.md H2 sections
(phases, core principles, guard-rails) as its fallback surface plus the
`loop::e2e-pr-stabilizer-lessons` lessons as evidence, and emits one
confidence-gated diff — applied only at `confidence(analysis) ≥ 90 %` with
explicit user confirmation. On success, `memory.write` an UPDATE setting the
lesson `status: promoted`.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied.** The only path from a lesson to a
   changed pattern rule or default locator strategy is a confidence-gated,
   user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days). The read step ignores expired
   lessons, so stale beliefs decay instead of entrenching — LoreKit owns storage
   and dedups on write, so there is no consolidation pass.
4. **Contradictions are flagged, not silently overwritten** (the dedup search
   finds the prior entry).
5. **Privacy pre-flight is never bypassed** — secrets / PII are dropped, not
   written.

A stabilizer lesson must **never** relax a guard-rail: it can bias pattern
choice, but it can never introduce `.skip` / `.fixme` / `waitForTimeout`, ship
an unverified locator, or shortcut the 3-consecutive-pass gate. The empirical
gates are the ground truth; a lesson is only ever a starting hypothesis the
gates still have to confirm.
