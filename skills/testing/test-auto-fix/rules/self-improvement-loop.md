---
title: Self-Improvement Loop — test-auto-fix Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - lorekit
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

The fast tier runs through **LoreKit's `memory.*` MCP tools** (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier is a silent no-op (log one line, continue).

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
or a chronically mis-scored fix class) — which is exactly the
`repo::{owner}/{repo}` scope below — with weaker cross-project leverage. The
loop is worth running, but calibrate expectations accordingly.

---

## Scope

LoreKit's partition axis is **scope**, not named buckets. This loop keeps its
lessons separate from other loops' with a **tag** and a **key namespace**, and
maps its two tiers onto scope:

- **Bucket = tag + key namespace.** Every lesson carries the tag
  `loop::test-auto-fix-lessons`; every key lives in the
  `test-auto-fix-lessons::` namespace (e.g.
  `test-auto-fix-lessons::vitest-cannot-find-module-import-drift`). Reads filter
  by the tag; writes always include it. Same `scope` + `key` overwrites in
  place — that is what makes recurrence countable.
- **Scopes (two, used together):**
  - **`global`** — universal, cross-repo. Default for **universal** lessons (a
    stack + failure-shape → verdict/fix pattern that holds for any project on
    that stack, e.g. "vitest + `Cannot find module` is usually import-drift, not
    type-drift"). Always read; always available for writes.
  - **`repo::{owner}/{repo}`** — this repository's lessons. Default for
    **project-bound** lessons (this repo's recurring failure shapes) — where
    most of the value is. LoreKit's mode (remote / local `.lorekit/`) decides
    whether these are private, dashboard-synced, or committed; the loop only
    selects the scope, never manages storage. Derive `{owner}/{repo}` from the
    `origin` remote, lowercased (strip a trailing `.git`). No git remote → use
    `global` only.

- **trigger-context key:** `<stack> : <failure-pattern> : <verdict-sub-class>`
  where `stack` comes from the surface file, `failure-pattern` is the normalized
  first ~3 lines of the error (via the surface's `failure-parser`), and
  `verdict-sub-class` is the fix sub-type from [`verdicts.md`](./verdicts.md)
  (snapshot-drift, selector-drift, type-drift, timing, import-drift,
  mock-stub-mismatch).

Lesson record schema is the shared one (procedural memory; the four mandatory
fields *What failed / Why / What to do next time / Promotion target*, plus the
`meta:` comment carrying `phase`, `seen_count`, `status`, `expires`,
`trigger-context`). Set `phase:` to `2` (verdict), `3.5` (confidence
calibration), or `6` (regression).

---

## Read lessons (Phase 2)

**Anchor:** `lessons-read`

At the **start of Phase 2 (Classify each failure)** — after failures are
detected and parsed (Phase 1) but before a verdict is emitted — load lessons.
The surface is already resolved (Phase 0), so the `stack` key is known.

The read is **narrow-to-broad** — project-bound lessons from `repo::` first,
then universal lessons from `global`:

```text
# (1) Project-bound lessons for this repo (silent no-op if memory.* not connected).
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::test-auto-fix-lessons"], limit: 50 }

# (2) Universal lessons that follow the user across every stack.
memory.list { scope: "global", tags: ["loop::test-auto-fix-lessons"], limit: 50 }

# (3) Optional — narrow by the parsed failure shape:
memory.search { q: "<stack> <failure-pattern keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

1. Union the matches. Match each lesson's `<stack>:<failure-pattern>` against
   the parsed failures. Load full entries only for matches. `repo::` wins over
   `global` on key collision (closer scope). **Skip any lesson whose `expires`
   is in the past** — treat it as stale.
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
   (`.agent/{branch}/test-auto-fix-plan.md`) under a `Lessons applied` note,
   marking the source scope.

There is no local INDEX to maintain: LoreKit owns storage server-side and
deduplicates on write, so the loop does not run a consolidation pass. Stale
beliefs decay through `expires`, not a line-count sweep.

Log:

```markdown
- [TIMESTAMP] Phase 2: lorekit(memory.list repo::{owner}/{repo} loop::test-auto-fix-lessons) — N lessons matched (stack=vitest), applied
- [TIMESTAMP] Phase 2: lorekit — memory.* not connected, continuing
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

**Scope classification (load-bearing).** Classify each candidate as **universal**
(a stack + failure-shape pattern that could re-derive on any project using that
stack) or **project-bound** (this repo's recurring failure shape, or one keyed to
a concrete path only this repo has). When ambiguous, default to **universal**
(`global`). Then **deduplicate first** so a recurrence UPDATES in place:

```text
# 1. Dedup search across the scopes that could hold it.
memory.search { q: "<stack> <failure-pattern> <verdict-sub-class>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal candidate — always lands in global.
memory.write { scope: "global", key: "test-auto-fix-lessons::<slug>", value: "<body>", tags: ["loop::test-auto-fix-lessons", "source::<trigger>"], source_agent: "test-auto-fix", trigger: "<trigger>" }

# 2b. Project-bound candidate — lands in this repo's scope (most value lives here).
memory.write { scope: "repo::{owner}/{repo}", key: "test-auto-fix-lessons::<slug>", value: "<body>", tags: ["loop::test-auto-fix-lessons", "source::<trigger>"], source_agent: "test-auto-fix", trigger: "<trigger>" }
```

- **No filesystem opt-in ceremony.** The loop just picks the scope; LoreKit's
  mode decides whether a `repo::` lesson is private, dashboard-synced, or
  committed to `.lorekit/`. The loop never creates directories or commits lesson
  files.
- **The privacy pre-flight is NOT optional.** A test-failure lesson never needs
  product data — drop any candidate carrying a credential, a customer name, a
  token, or PII rather than writing it. The bar is **stricter** for `repo::`
  writes since a repo scope is team-visible.
- **Dedup resolves each candidate as ADD / UPDATE.** Found the same situation
  under a key → reuse that **exact scope + key** and `memory.write` an updated
  body (same scope + key overwrites in place). An UPDATE to an entry that carries
  a `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.
  This is what makes recurrence countable and is how a *working* lesson still
  reaches the `seen_count >= 3` promotion gate.
- **Never** write a lesson that encodes a test-weakening action (delete a test,
  `.skip`/`.only`, loosened matcher, mocked SUT) — those are hard-refused in
  [`anti-patterns.md`](./anti-patterns.md).

Log (include the resolved scope + verdict shape + outcome):

```markdown
- [TIMESTAMP] Phase 7: lorekit(memory.write repo::{owner}/{repo} test-auto-fix-lessons::<slug>) — UPDATE, seen_count→3 — green
- [TIMESTAMP] Phase 6: lorekit(memory.write global test-auto-fix-lessons::<slug>) — ADD — regression reverted
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface the scope-appropriate suggestion — never act silently:

- `global` (universal) → `/create-skill diagnose test-auto-fix --symptom "<title>"`
- `repo::{owner}/{repo}` (project-bound) → `Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/test-auto-fix-lessons::<slug>")`

`test-auto-fix` has no `rules/diagnostic-surface.md`, so
`/create-skill diagnose test-auto-fix` reads the SKILL.md H2 sections (phases,
verdicts, anti-patterns) as its fallback surface plus the
`loop::test-auto-fix-lessons` lessons as evidence, and emits one
confidence-gated diff — applied only at `confidence(analysis) ≥ 90 %` with
explicit user confirmation. On success, `memory.write` an UPDATE setting the
lesson `status: promoted`. A recurring **universal** lesson may instead be
better promoted into the surface template or the verdict rubric — diagnose will
propose the best target.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied.** The only path from a lesson to a
   changed verdict rule or default fix strategy is a confidence-gated,
   user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days). The read step ignores expired
   lessons, so stale beliefs decay instead of entrenching — LoreKit owns storage
   and dedups on write, so there is no consolidation pass.
4. **Contradictions are flagged, not silently overwritten** (the dedup search
   finds the prior entry).
5. **Privacy pre-flight is never bypassed** — secrets / PII are dropped, not
   written.

A test-auto-fix lesson must **never** relax a hard refusal: it can bias the
verdict toward a fix sub-class, but it can never delete or weaken a test, mock
the SUT, lower the confidence gate, or turn a `prod-bug`/`unsure` escalation into
a silent test edit. The verdict rubric and the confidence gate are the ground
truth; a lesson is only a starting hypothesis they still have to confirm.
