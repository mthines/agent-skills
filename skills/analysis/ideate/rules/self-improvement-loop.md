---
title: Self-Improvement Loop — ideate-lessons Contract
impact: MEDIUM
tags:
  - self-improvement
  - lessons
  - memory
  - calibration
---

# Self-Improvement Loop

The `ideate` instance of the two-tier loop.
Shared schema, guards, and pipeline live in the canonical design — [`autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md) — and the memory mechanics live in [`persistent-memory`](../../../authoring/persistent-memory/SKILL.md).
This file declares only what differs: scope, read/write points, lesson content policy, and promotion targets.

## Scope

- Name: `ideate-lessons`.
- Tiers: `home` (always, `~/.agent-memory/ideate-lessons/`) + `project-shared` (opt-in, `<repo>/memory/ideate-lessons/` — only when its `INDEX.md` already exists).
- Optional dependency: skip the whole loop silently if `persistent-memory` is not installed.

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

```text
Skill("persistent-memory", "read ideate-lessons --tier home")
if [ -f memory/ideate-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read ideate-lessons --tier project-shared")
fi
```

Apply matches as advisory constraints on triage, operator rotation, judging, and stopping — never as generation input.
If either tier's `INDEX.md` nears 200 lines, suggest `Skill("persistent-memory", "consolidate ideate-lessons --tier <tier>")`.

## Write points

Writes use `--auto` (privacy pre-flight still runs); pin the tier explicitly per the classification: universal → `--tier home`; project-bound and opted-in → `--tier project-shared`; project-bound without opt-in → `--tier home` plus a one-line opt-in hint.

| When                                                                 | Candidate lesson                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| End of run (Phase 7), after the user's pick/reject verdict on the report. | Judge calibration: which axis over/under-predicted the user's actual selection. |
| End of run, when the run stats show a process failure (yield collapse, wasted round, gate bounce). | The specific mechanics failure and the adjustment.                              |
| Aborted run (user stopped mid-pipeline).                                | Triage lesson: what depth/framing choice caused the abandonment.                |

The user's verdict is the loop's ground truth — a run without a verdict writes process lessons only, never calibration lessons.

Lesson body carries the four mandatory fields (*What failed / Why / What to do next time / Promotion target*) plus `seen_count`, `status`, `expires` (default 90 days), and a concrete `trigger-context`.

## Promotion

When a lesson reaches `seen_count >= 3` (or is tagged `status: structural`), suggest — never auto-run:

- `home` lesson → `/create-skill diagnose ideate` (reads [`diagnostic-surface.md`](./diagnostic-surface.md)).
- `project-shared` lesson → `Skill("docs", "update --add-rule …")` into the repo's own rules.

## Entrenchment guards

1. Lessons are advisory — the only path to a behavior change is the confidence-gated, user-approved `diagnose` apply.
2. Recurrence (`seen_count >= 3`), not one run, gates promotion.
3. Every lesson expires (default 90 days); `consolidate` prunes.
4. Contradictions are flagged, not overwritten.
5. The privacy pre-flight is never bypassed by `--auto`.
6. A lesson never relaxes a hard invariant in [`diagnostic-surface.md`](./diagnostic-surface.md) — including this file's content invariant.
