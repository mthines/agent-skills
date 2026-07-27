---
title: Self-Improvement Loop — batch-linear-tickets Episodic Lessons
impact: MEDIUM
tags:
  - self-improvement
  - memory
  - lessons
  - batch-linear-tickets
  - promotion
  - lorekit
  - meta
---

# Self-Improvement Loop (batch-linear-tickets)

`/batch-linear-tickets` improves across batches through the same **two-tier
loop** as `autonomous-workflow`. This file is the batch-specific contract. The
shared lesson schema and entrenchment guards are canonical in
[`../../autonomous-workflow/rules/self-improvement-loop.md`](../../autonomous-workflow/rules/self-improvement-loop.md)
— read that for the full design; this file states only what differs.

## Contents

- [What this loop owns (and what it inherits for free)](#what-this-loop-owns-and-what-it-inherits-for-free)
- [Scope](#scope)
- [Read lessons (Phase 1)](#read-lessons-phase-1)
- [Write lessons (Phase 5)](#write-lessons-phase-5)
- [Lesson promotion to skill source](#lesson-promotion)
- [Entrenchment guards](#entrenchment-guards)

---

## What this loop owns (and what it inherits for free)

Phase 4 dispatches `aw-planner` + `aw-executor` per approved ticket. Those
agents **already** read / write the `aw-lessons` scope for the planning and
implementation phases. **The batch skill inherits that automatically** — no
wiring needed and no duplication here.

**Serialization contract for the fan-out.**
Parallel executors return lesson candidates in their result payload; the orchestrator writes all lessons serially after fan-out completes.
Executors MUST NOT write to shared lesson scopes directly during fan-out — concurrent `memory.write` calls to the same `loop::aw-lessons` scope + key can race and clobber each other's `seen_count`.

This loop owns only the lessons unique to **batch-level orchestration** — the
decisions `aw-planner` / `aw-executor` never make:

| Owned by `batch-lessons` | Inherited from `aw-lessons` (via fan-out) |
| ------------------------ | ----------------------------------------- |
| Ticket type misclassification — `bug` vs `feature` (Phase 1a) | Plan quality (aw-planner) |
| Cross-ticket correlation patterns — recurring shared-file conflicts, duplicate clusters (Phase 2) | Implementation / tests / CI (aw-executor) |
| Chronic `Needs Info` patterns — ticket shapes that always lack acceptance criteria (Phase 1d) | |

Because this surface is workspace-specific, batch lessons are often most useful
when promoted into the project's classification / correlation rules — see
[Lesson promotion](#lesson-promotion).

---

## Scope

The fast tier runs on **LoreKit** — its `memory.*` MCP tools (surfaced by the
`lorekit-memory` skill). If those tools are **not connected**, the whole fast
tier is a silent no-op (log one line, continue).

- **Bucket = tag + key namespace.** LoreKit's partition axis is
  repo/branch/global, not named buckets. This loop keeps its lessons separate
  with the **tag** `loop::batch-lessons` (reads filter by it; writes include it)
  and the **key namespace** `batch-lessons::<kebab-slug>`.
- **Scopes (two, used together):**
  - **`global`** — per-user, cross-repo. Universal classification / correlation
    patterns.
  - **`repo::{owner}/{repo}`** — this repository's lessons. Workspace-specific
    label sets and correlation patterns — almost always project-bound since
    label conventions are per-workspace. Derive `{owner}/{repo}` from the
    `origin` remote, lowercased (strip a trailing `.git`).
- `trigger-context` is keyed by **ticket label set** / **ticket-type** /
  **affected-area** so the Phase 1 read can match mechanically. Since label
  sets are usually project-specific, expect most `batch-lessons` to land in the
  `repo::{owner}/{repo}` scope.

Lesson schema is the shared procedural-memory shape (four mandatory fields:
*What failed / Why / What to do next time / Promotion target*). The metadata a
filesystem store would keep in frontmatter travels inside the `value` markdown
as a top `<!-- meta: phase=.. seen_count=.. status=.. expires=..
trigger-context=".." -->` comment; the `phase` field names the batch phase
(`1a`, `1d`, `2`). Schema authority:
[`persistent-memory/rules/write-pipeline.md`](../../../authoring/persistent-memory/rules/write-pipeline.md).

---

## Read lessons (Phase 1)

**Anchor:** `lessons-read`

At the **start of Phase 1**, before classifying ticket types, load lessons.
The read is **narrow-to-broad** — this repo's scope first, then `global`
(skips silently if `memory.*` is not connected):

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::batch-lessons"], limit: 50 }
memory.list { scope: "global", tags: ["loop::batch-lessons"], limit: 50 }
# optional when a ticket names a subsystem/area:
memory.search { q: "<label set or area keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

Merge the matches. Apply matches as **advisory inputs**: a classification
lesson biases the `bug`/`feature` call for tickets with the matching label
set; a correlation lesson primes Phase 2 to look for a known recurring
conflict pattern. Lessons never override an explicit `--type` flag or
auto-approve a `Needs Info` ticket. **Skip lessons whose `expires` has passed.**
A `repo::` lesson wins on conflict with a `global` lesson (closer scope).

There is no local INDEX to maintain and no consolidation pass — LoreKit owns
storage and dedups on write; stale beliefs decay through `expires`.

---

## Write lessons (Phase 5)

**Anchor:** `lessons-write`

At **Phase 5 (Results)**, after execution outcomes are known, write a lesson
when the batch's own orchestration was shown to misfire:

| Trigger | Lesson captures |
| ------- | --------------- |
| A ticket's type was wrong (a `feature`-classified ticket needed bug root-cause analysis, or vice-versa, discovered during planning/execution) | The label set → correct type mapping for this workspace |
| A cross-ticket conflict surfaced in execution that Phase 2 correlation missed | The signal Phase 2 should have correlated on |
| A ticket shape was chronically `Needs Info` | What evidence the investigator needed up front |

Classify each candidate: universal label-set patterns → `global`; workspace-
specific label conventions or repo-specific correlation patterns →
`repo::{owner}/{repo}`. When ambiguous, default to `global`. Then
**deduplicate first** so a recurrence UPDATES in place, and write:

```text
# 1. Look for a near-duplicate across the scopes that could hold it.
memory.search { q: "<key words of the lesson>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal candidate — lands in global.
memory.write { scope: "global", key: "batch-lessons::<slug>", value: "<body>", tags: ["loop::batch-lessons", "source::phase-5"], source_agent: "batch-linear-tickets", trigger: "phase-5" }

# 2b. Project-bound candidate — lands in this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "batch-lessons::<slug>", value: "<body>", tags: ["loop::batch-lessons", "source::phase-5"], source_agent: "batch-linear-tickets", trigger: "phase-5" }
```

- **No filesystem opt-in ceremony.** The loop just picks the scope; LoreKit's
  mode decides whether a `repo::` lesson is private, dashboard-synced, or
  committed. The loop never creates directories or commits lesson files.
- The write skips consent, not the privacy pre-flight (stricter for `repo::`
  writes — content is team-visible).
- A recurring lesson resolves to **UPDATE** and bumps `seen_count`. An UPDATE to
  an entry that carries a `seen_count` field MUST increment `seen_count` by 1
  and refresh `expires`. At `seen_count >= 3`, surface the scope-appropriate
  promotion suggestion (`global` → skill source; `repo::` → repo rules).

---

## Lesson promotion

**Anchor:** `lesson-promotion`

A lesson reaching `seen_count >= 3` (or tagged `structural`) is promotion-eligible:

```text
# global (universal) lesson:
Lesson "<title>" has recurred N times (phase <p>). Promote it?  Run:
/create-skill diagnose batch-linear-tickets --symptom "<lesson title>"

# repo:: (project-bound) lesson:
Lesson "<title>" has recurred N times in this repo. Promote it to a repo rule?
Run:  Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/batch-lessons::<slug>")
```

Diagnose Mode reads the `loop::batch-lessons` lessons as evidence, walks this
skill's [diagnostic surface](./diagnostic-surface.md), and emits a
confidence-gated diff against this skill's source (commonly into
[`ticket-type-classification.md`](./ticket-type-classification.md) or
[`cross-ticket-correlation.md`](./cross-ticket-correlation.md)) — applied only
at `confidence(analysis) ≥ 90 %` with explicit user confirmation. Workspace
label-convention lessons may instead belong in the project's own
classification-override config (see SKILL.md § Customization) or the repo's own
rules via the `docs` skill — the diagnosis says which. On success, set the
lesson `status: promoted` (via a `memory.write` UPDATE to the same scope + key).

---

## Entrenchment guards

Identical to the canonical loop:

1. **Lessons are advisory, never auto-applied to behavior.** The only path to a
   behavior change is a confidence-gated, user-approved `diagnose` apply.
2. **Recurrence (`seen_count >= 3`), not one batch, gates promotion.**
3. **Every lesson expires** (default 90 days); the read step ignores expired
   lessons, so stale beliefs decay instead of entrenching.
4. **Contradictions are flagged, not silently overwritten** (the dedup search
   finds the prior entry).
5. **Privacy pre-flight is never bypassed** by an autonomous write.

A batch lesson must never auto-approve a ticket, override an explicit `--type`
flag, or relax the Phase 3 approval gate — the user stays in control of every
batch.
