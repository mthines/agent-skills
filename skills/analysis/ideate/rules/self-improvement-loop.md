---
title: Self-Improvement Loop — ideate-lessons Contract
impact: MEDIUM
tags:
  - self-improvement
  - lessons
  - memory
  - calibration
  - lorekit
---

# Self-Improvement Loop

The `ideate` instance of the two-tier loop.
Shared schema, guards, and pipeline live in the canonical design — [`autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md) — and the lesson schema is the schema authority in [`persistent-memory/rules/write-pipeline.md`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
The fast tier runs on LoreKit's `memory.*` tools (via the `lorekit-memory` skill); this file declares only what differs: scope, read/write points, lesson content policy, and promotion targets.

## Scope

- Bucket: `ideate-lessons` — on LoreKit a **tag** (`loop::ideate-lessons`) plus a **key namespace** (`ideate-lessons::<slug>`).
- Scopes, both used together: `global` (universal, always read, default write target) + `repo::{owner}/{repo}` (project-bound, cwd repo; `{owner}/{repo}` from `origin`, lowercased, `.git` stripped). LoreKit's mode decides whether a `repo::` lesson is private, synced, or committed — the loop only picks the scope.
- Optional dependency: skip the whole loop silently if LoreKit `memory.*` is not connected.

## The content hard invariant

**Divergence runs lessons-blind.**
Lessons cover *mechanics only*:

| Allowed (mechanics)                                                              | Never stored (content)                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Depth-triage corrections ("X-shaped asks needed deep, quick was chosen").          | What kinds of ideas the user tends to pick.                      |
| Operator effectiveness per *problem shape* ("far-analogy yield collapsed on pure naming problems"). | Domains, themes, or styles to favor or avoid in generation.      |
| Judge calibration deltas (user verdict vs judge ranking).                          | Any specific idea, mechanism, or solution direction.             |
| Stopping-behavior errors (burst stopped too early / evolution round wasted).       | User preference profiles of any kind.                            |

A content lesson is a homogenization vector: it would quietly narrow every future divergence toward past picks — the failure this skill exists to prevent.
When a candidate lesson mentions idea content, discard it, or restate it as a pure mechanics observation.

## Read point (Phase 0)

Narrow-to-broad fan-out — `repo::` first, then `global` (skips silently if `memory.*` not connected):

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::ideate-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::ideate-lessons"], limit: 50 }
# optional — when the problem names a domain or technique:
memory.search { q: "<keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

Union the matches; the store drops expired lessons for you (`ttl_days`), so there is no client-side expiry filter to run.
Apply matches as advisory constraints on triage, operator rotation, judging, and stopping — never as generation input.
`repo::` wins over `global` on conflict.
No consolidation pass — LoreKit owns storage and dedups on write; stale beliefs decay via the store's own `ttl_days` expiry.

## Write points

Classify each candidate universal vs project-bound by its **Applies when** line, dedup with `memory.search`, then `memory.write` with the scope pinned **explicitly** (universal → `global`; project-bound → `repo::{owner}/{repo}`), the tag `loop::ideate-lessons`, and `ttl_days: 90`.
The privacy pre-flight still runs on every write (stricter for `repo::` since it is team-visible); autonomous writes skip only the consent preview, never the privacy pre-flight.

| When                                                                 | Candidate lesson                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| End of run (Phase 7), after the user's pick/reject verdict on the report. | Judge calibration: which axis over/under-predicted the user's actual selection. |
| End of run, when the run stats show a process failure (yield collapse, wasted round, gate bounce). | The specific mechanics failure and the adjustment.                              |
| Aborted run (user stopped mid-pipeline).                                | Triage lesson: what depth/framing choice caused the abandonment.                |

The user's verdict is the loop's ground truth — a run without a verdict writes process lessons only, never calibration lessons.

The lesson body is **markdown and nothing else** — never a `<!-- meta: … -->` block, and never a hand-written count or expiry date.
Every store-backed fact has its own first-class `memory.write` field: the store owns `seen_count`, `ttl_days` sets the expiry, and `status::<value>` / `source::<trigger>` are tags; the concrete matching signal travels as a visible **Applies when:** line directly under the title.
Full body shape: [`write-pipeline.md#lesson-scope-entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
A lesson that recurs resolves to UPDATE (same scope + key overwrites in place).
A recurrence resolves to an UPDATE: the store increments `seen_count` by 1 for you, and re-passing `ttl_days` refreshes the expiry.

## Promotion

When a lesson reaches the store's own `seen_count >= 3` (or carries the `status::structural` tag), suggest — never auto-run:

- `global` lesson → `/create-skill diagnose ideate` (reads [`diagnostic-surface.md`](./diagnostic-surface.md)).
- `repo::{owner}/{repo}` lesson → `Skill("docs", "update --add-rule …")` into the repo's own rules.

After a successful promotion, `memory.write` an UPDATE to the same scope + key adding the `status::promoted` tag.

## Entrenchment guards

1. Lessons are advisory — the only path to a behavior change is the confidence-gated, user-approved `diagnose` apply.
2. Recurrence (`seen_count >= 3`), not one run, gates promotion.
3. Every lesson expires — pass `ttl_days: 90` on every write; a recurrence re-passes it, which refreshes the expiry from the last sighting, and the store stops returning an expired lesson so stale beliefs decay.
4. Contradictions are flagged, not overwritten.
5. The privacy pre-flight is never bypassed by autonomous writes.
6. A lesson never relaxes a hard invariant in [`diagnostic-surface.md`](./diagnostic-surface.md) — including this file's content invariant.
