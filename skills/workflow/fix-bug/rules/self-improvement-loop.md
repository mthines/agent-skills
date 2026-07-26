---
title: Self-Improvement Loop — fix-bug Episodic Lessons
impact: HIGH
tags:
  - self-improvement
  - memory
  - lessons
  - fix-bug
  - promotion
  - lorekit
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

The fast tier runs on **LoreKit** — its `memory.*` MCP tools (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier is a silent no-op (log one line, continue).

- **Bucket = tag + key namespace.** LoreKit's partition axis is
  repo/branch/global, not named buckets. This loop keeps its lessons separate
  with the **tag** `loop::fix-bug-lessons` (reads filter by it; writes include
  it) and the **key namespace** `fix-bug-lessons::<kebab-slug>`.
- **Scopes (two, used together):**
  - **`global`** — per-user, cross-repo. Follows the user across every
    repository. Default for **universal** bug-class lessons. Always read;
    default write target.
  - **`repo::{owner}/{repo}`** — this repository's lessons. Default for
    **project-bound** bug-class lessons (a bug pattern only this codebase
    produces). Derive `{owner}/{repo}` from the `origin` remote, lowercased
    (strip a trailing `.git`). LoreKit's mode (remote / local `.lorekit/`)
    decides whether these are private, dashboard-synced, or committed — the
    loop only selects the scope.
- Lessons are keyed by **`bugClass`** and **input shape** (the Phase 0
  classification) in their `trigger-context`, so the Phase 0.5 read can match
  them mechanically against the current bug. Scope is determined at write time
  by whether the `bugClass` or input shape is repo-specific.

Lesson record schema is identical to the shared one (procedural memory; the four
mandatory fields *What failed / Why / What to do next time / Promotion target*).
The metadata a filesystem store would keep in frontmatter travels inside the
`value` markdown as a top `<!-- meta: phase=.. seen_count=.. status=..
expires=.. trigger-context=".." -->` comment; the `phase` field names the
fix-bug phase (`0`, `0.5`, `2.5`, `3`, `5`, `8`). The schema authority is
[`persistent-memory/rules/write-pipeline.md`](../../../authoring/persistent-memory/rules/write-pipeline.md).

---

## Read lessons (Phase 0.5)

**Anchor:** `lessons-read`

At the start of **Complexity Triage (Phase 0.5)**, after `bugClass` is inferred
(Phase 0c) but before the triage decision commits, load lessons.

The read is **narrow-to-broad** — project-bound lessons from `repo::` first,
then universal lessons from `global` — merging the results (skips silently if
`memory.*` is not connected):

```text
# (1) Project-bound lessons for this repo.
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::fix-bug-lessons"], limit: 50 }

# (2) Universal lessons that follow the user across every repo.
memory.list { scope: "global", tags: ["loop::fix-bug-lessons"], limit: 50 }

# (3) Optional — when the bugClass or symptom names a subsystem/error, add a search:
memory.search { q: "<bugClass or error keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

1. Merge the matches. Match each lesson's `trigger-context` against the current
   `bugClass` + input shape. Consider the full entry only for matches.
   **Skip any lesson whose `expires` is in the past.** A `repo::` lesson wins
   on conflict with a `global` lesson (closer scope) — log the conflict.
2. Apply matches as **inputs** to the decision they target: a triage lesson
   biases the `simple`/`complex` call (it never overrides the conservative
   default toward `complex`); a reproduction-layer lesson biases Phase 2.5's
   layer routing; an analysis lesson is passed to `holistic-analysis` (or the
   lightweight analysis) as a "previously this bugClass was misattributed to X"
   hint.
3. Lessons are **advisory** — they never relax a confidence gate, the Phase 5
   thresholds, the reproduction gate, or any hard invariant.
4. Record applied lessons in the bug-notes ledger under `Lessons applied`.

There is no local INDEX to maintain and no consolidation pass: LoreKit owns
storage server-side and dedups on write. Stale beliefs decay through `expires`
(the read step ignores expired lessons), not a line-count sweep.

Log to the ledger:

```markdown
- [TIMESTAMP] Phase 0.5: lorekit(memory.list repo::{owner}/{repo} loop::fix-bug-lessons) — N lessons matched (bugClass=<x>), applied
- [TIMESTAMP] Phase 0.5: lorekit(memory.list global loop::fix-bug-lessons) — M lessons matched
- [TIMESTAMP] Phase 0.5: lorekit — memory.* not connected, continuing
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

**Scope classification (load-bearing).** Classify each candidate as
**universal** (a `bugClass` any project could hit) or **project-bound** (the
bugClass cites a repo-specific symbol, file path, or domain term). When
ambiguous, default to **universal** (`global`) — a misclassified universal
lesson harms nothing elsewhere because its `trigger-context` still has to match.

Then **deduplicate first** so a recurrence UPDATES in place instead of piling
up, and dispatch by verdict:

```text
# 1. Look for a near-duplicate across the scopes that could hold it.
memory.search { q: "<key words of the lesson>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal candidate — lands in global.
memory.write { scope: "global", key: "fix-bug-lessons::<slug>", value: "<body>", tags: ["loop::fix-bug-lessons", "source::<trigger>"], source_agent: "fix-bug", trigger: "<trigger>" }

# 2b. Project-bound candidate — lands in this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "fix-bug-lessons::<slug>", value: "<body>", tags: ["loop::fix-bug-lessons", "source::<trigger>"], source_agent: "fix-bug", trigger: "<trigger>" }
```

- **No filesystem opt-in ceremony.** The loop just picks the scope; LoreKit's
  mode decides whether a `repo::` lesson is private, dashboard-synced, or
  committed. The loop never creates directories or commits lesson files.
- **Privacy pre-flight is NOT optional.** Never store secrets / PII — and a
  `bugClass` lesson never needs product data. The bar is **stricter** for
  `repo::` writes since the content is team-visible.
- **Dedup resolves each candidate as ADD / UPDATE.** A recurring lesson reuses
  the same **scope + key** and resolves to **UPDATE**, which bumps `seen_count`.
  An UPDATE to an entry that carries a `seen_count` field MUST increment
  `seen_count` by 1 and refresh `expires`. This is what makes recurrence
  countable and how a lesson reaches the `seen_count >= 3` promotion gate.
- At `seen_count >= 3`, surface the **scope-appropriate** promotion suggestion:
  `global` → `/create-skill diagnose fix-bug`; `repo::` → repo rules.

Log to the ledger's `Phase log`:

```markdown
- [TIMESTAMP] Phase 7: lorekit(memory.write global fix-bug-lessons::<slug>) — UPDATE, seen_count→3
- [TIMESTAMP] Phase 8: lorekit(memory.write repo::{owner}/{repo} fix-bug-lessons::<slug>) — ADD — project-bound
- [TIMESTAMP] Phase 5: lorekit — memory.* not connected, continuing
```

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `status: structural`) is
promotion-eligible. Surface — never act silently. The target **depends on the
lesson's scope**:

```text
# global (universal) lesson:
Lesson "<title>" has recurred N times (phase <p>). Promote it to a permanent
fix-bug guard?  Run:  /create-skill diagnose fix-bug --symptom "<lesson title>"

# repo:: (project-bound) lesson:
Lesson "<title>" has recurred N times in this repo. Promote it to a repo rule?
Run:  Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/fix-bug-lessons::<slug>")
```

Diagnose Mode reads the `loop::fix-bug-lessons` lessons as evidence, walks
fix-bug's [diagnostic surface](./diagnostic-surface.md), and emits one
confidence-gated diff against fix-bug's source — applied only at
`confidence(analysis) ≥ 90 %` with explicit user confirmation. On success, set
the lesson `status: promoted` (via a `memory.write` UPDATE to the same scope +
key). The `repo::` promotion path uses the `docs` skill under the same
confidence + user-approval contract.

---

## Entrenchment guards

Identical to the canonical loop — the dominant risk is self-reinforcing error:

1. **Lessons are advisory, never auto-applied to behavior.** The only path from
   a lesson to a changed fix-bug gate / threshold / invariant is a
   confidence-gated, user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one run, gates promotion.**
3. **Every lesson expires** (default 90 days); the read step ignores expired
   lessons, so stale beliefs decay instead of entrenching.
4. **Contradictions are flagged, not silently overwritten** (the dedup search
   finds the prior entry).
5. **Privacy pre-flight is never bypassed** by an autonomous write.

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
