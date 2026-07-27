---
title: Self-Improvement Loop — optimize-approach-lessons
impact: MEDIUM
tags:
  - optimize-approach
  - self-improvement
  - memory
  - lessons
  - lorekit
---

# Self-Improvement Loop

`optimize-approach` gets better across runs through the standard **two-tier loop**.
This file declares only what is specific to this skill — scope, read/write points, promotion target.
The shared schema, the ADD/UPDATE/DELETE/NOOP write pipeline, the recurrence gate, and the five entrenchment guards are the canonical contract in [`../../../workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md); the reusable authoring recipe is [`../../../authoring/create-skill/rules/self-improvement-loop-pattern.md`](../../../authoring/create-skill/rules/self-improvement-loop-pattern.md).
The lesson schema itself is the schema authority in [`../../../authoring/persistent-memory/rules/write-pipeline.md`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
Do not re-implement memory mechanics here.

## Contents

- [Scope](#scope)
- [What the loop calibrates](#what-the-loop-calibrates)
- [Fast tier — read (Phase O0)](#fast-tier--read-phase-o0)
- [Fast tier — write (Phase O5)](#fast-tier--write-phase-o5)
- [Promotion — slow tier](#promotion--slow-tier)
- [Entrenchment guards](#entrenchment-guards)

## Scope

Bucket `optimize-approach-lessons` — on LoreKit a **tag** (`loop::optimize-approach-lessons`, reads filter by it; writes include it) plus a **key namespace** (`optimize-approach-lessons::<kebab-slug>`).
Two scopes, used together, exactly as the canonical contract defines them:

- **`global`** — universal lessons that follow the user across every repo. Always read; default write target. LoreKit creates the scope lazily on first write.
- **`repo::{owner}/{repo}`** — project-bound lessons specific to the cwd repo. Derive `{owner}/{repo}` from the `origin` remote, lowercased, `.git` stripped. LoreKit's mode (remote / local `.lorekit/`) — not a filesystem opt-in — decides whether a `repo::` lesson is private, synced, or committed.

`lorekit-memory` (the LoreKit `memory.*` tools) is an **optional companion** — if the `memory.*` tools are not connected, the whole fast tier skips silently (log one line, continue). The slow tier (`diagnose`) is unaffected.

## What the loop calibrates

Lessons here are **procedural** and about *this skill's own judgment*, never about product data:

- The optimal-vs-suboptimal bar (an axis that recurrently fired false; a materiality call that was wrong).
- The anti-overlap guards (a proposal that was really a `code-quality` / `critical` / `holistic-review` finding in disguise).
- The apply-safety judgment (a rewrite marked `apply_safe` that had to be reverted).
- The plan-time judgment (a plan-mode proposal that duplicated the Existing Code Survey / `critical`, or a re-plan the planner rejected).

`trigger-context` must be concrete (file globs, stack, axis, caller) so the O0 read matches mechanically.
Record the `caller` in every lesson's `trigger-context` (`reviewer` / `pr-reviewer` / `polish` / `aw-planner`) so a plan-mode lesson does not wrongly bias a diff-mode run and vice versa.

## Fast tier — read (Phase O0)

Narrow-to-broad fan-out at the start of the run — `repo::` first, then `global` (skips silently if `memory.*` not connected):

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::optimize-approach-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::optimize-approach-lessons"], limit: 50 }
# optional — when the run names a stack, axis, or subsystem:
memory.search { q: "<keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

Union the matches; skip any lesson whose `expires` is in the past.
Match each lesson's `trigger-context` against the current run (caller, stack, changed-file globs, candidate axis).
Apply matches as **advisory** considerations on the O2 judgment and the O5 apply-safety call — never as a hard override of the rubric.
`repo::` wins over `global` on conflict; log the conflict.
No consolidation pass — LoreKit owns storage and dedups on write; stale beliefs decay via `expires`.

## Fast tier — write (Phase O5)

Write at the end of every run — including quiet early-exit runs, since a clean run is recurrence evidence for any lesson applied at O0.
Classify each candidate **universal** vs **project-bound** by its `trigger-context` (canonical contract's classification table), dedup, then dispatch by scope:

```text
# 1. Dedup across the scopes that could hold it.
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# 2a. Universal lesson — always lands in global.
memory.write { scope: "global", key: "optimize-approach-lessons::<slug>", value: "<body>", tags: ["loop::optimize-approach-lessons", "source::<trigger>"], source_agent: "optimize-approach", trigger: "<trigger>" }

# 2b. Project-bound lesson — lands in this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "optimize-approach-lessons::<slug>", value: "<body>", tags: ["loop::optimize-approach-lessons", "source::<trigger>"], source_agent: "optimize-approach", trigger: "<trigger>" }
```

Write nothing when the retrospective surfaces nothing **and** no lesson was applied — empty lessons are noise.
There is no filesystem opt-in ceremony; the loop just picks the scope. The privacy pre-flight still runs (lessons are about this skill's mechanics, never product data) and is **stricter** for `repo::` writes since a repo scope is team-visible.
A lesson that recurs resolves to UPDATE (same scope + key overwrites in place). An UPDATE to an entry that carries a `seen_count` field MUST increment `seen_count` by 1 and refresh `expires` — this is what makes recurrence countable.

## Promotion — slow tier

After an O5 write (or an O0 read), a lesson is promotion-eligible at `seen_count >= 3` or when tagged `status: structural`.
Surface a one-line suggestion — never act silently. Target depends on scope:

| Lesson scope | Promotion target | One-liner |
| --- | --- | --- |
| `global` (universal) | this skill's source | `Lesson "<title>" recurred N times. Promote to a permanent guard? Run:  /create-skill diagnose optimize-approach --symptom "<title>"` |
| `repo::{owner}/{repo}` (project-bound) | the repo's own rules | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule? Run:  Skill("docs", "update --add-rule '<title>' --source lorekit:repo::{owner}/{repo}/optimize-approach-lessons::<slug>")` |

After a successful promotion, `memory.write` an UPDATE to the same scope + key setting `status: promoted` so it stops re-suggesting.
When the user runs the global-scope promotion, Diagnose Mode reads `optimize-approach-lessons` as evidence (see the `## Lessons scope` section in [`diagnostic-surface.md`](./diagnostic-surface.md)).

## Entrenchment guards

The five load-bearing guards from the canonical contract apply verbatim and are non-negotiable:
lessons are advisory (never auto-applied to behavior), recurrence (`seen_count >= 3`) gates promotion, every lesson expires, contradictions are flagged not overwritten, and the privacy pre-flight is never bypassed.
A lesson may never relax one of this skill's hard invariants — in particular the [`apply-mode.md`](./apply-mode.md) confidence gate, the forbidden-targets list, or the never-block-the-verdict rule.
