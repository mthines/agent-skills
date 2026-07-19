---
title: Self-Improvement Loop — optimize-approach-lessons
impact: MEDIUM
tags:
  - optimize-approach
  - self-improvement
  - memory
  - lessons
---

# Self-Improvement Loop

`optimize-approach` gets better across runs through the standard **two-tier loop**.
This file declares only what is specific to this skill — scope, read/write points, promotion target.
The shared schema, the ADD/UPDATE/DELETE/NOOP write pipeline, the recurrence gate, and the five entrenchment guards are the canonical contract in [`../../../workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md); the reusable authoring recipe is [`../../../authoring/create-skill/rules/self-improvement-loop-pattern.md`](../../../authoring/create-skill/rules/self-improvement-loop-pattern.md).
Do not re-implement memory mechanics here.

## Contents

- [Scope](#scope)
- [What the loop calibrates](#what-the-loop-calibrates)
- [Fast tier — read (Phase O0)](#fast-tier--read-phase-o0)
- [Fast tier — write (Phase O5)](#fast-tier--write-phase-o5)
- [Promotion — slow tier](#promotion--slow-tier)
- [Entrenchment guards](#entrenchment-guards)

## Scope

`optimize-approach-lessons`.
Two tiers, used together, exactly as the canonical contract defines them:

- **`home`** — per-user at `~/.agent-memory/optimize-approach-lessons/`. Universal lessons that follow the user across every repo. Always read; default write target. Created lazily on first write.
- **`project-shared`** — committed at `<cwd-repo>/memory/optimize-approach-lessons/`. Opt-in: only read / written when `memory/optimize-approach-lessons/INDEX.md` already exists in the cwd repo. Never created silently.

`persistent-memory` is an **optional companion** — if it is not installed, the whole fast tier skips silently (log one line, continue). The slow tier (`diagnose`) is unaffected.

## What the loop calibrates

Lessons here are **procedural** and about *this skill's own judgment*, never about product data:

- The optimal-vs-suboptimal bar (an axis that recurrently fired false; a materiality call that was wrong).
- The anti-overlap guards (a proposal that was really a `code-quality` / `critical` / `holistic-review` finding in disguise).
- The apply-safety judgment (a rewrite marked `apply_safe` that had to be reverted).
- The plan-time judgment (a plan-mode proposal that duplicated the Existing Code Survey / `critical`, or a re-plan the planner rejected).

`trigger-context` must be concrete (file globs, stack, axis, caller) so the O0 read matches mechanically.
Record the `caller` in every lesson's `trigger-context` (`reviewer` / `pr-reviewer` / `polish` / `aw-planner`) so a plan-mode lesson does not wrongly bias a diff-mode run and vice versa.

## Fast tier — read (Phase O0)

Two-tier fan-out at the start of the run — `home` always, `project-shared` only when opted in:

```
Skill("persistent-memory", "read optimize-approach-lessons --tier home")   # skips silently if not installed
if [ -f memory/optimize-approach-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read optimize-approach-lessons --tier project-shared")
fi
```

Union both INDEXes.
Match each lesson's `trigger-context` against the current run (caller, stack, changed-file globs, candidate axis).
Apply matches as **advisory** considerations on the O2 judgment and the O5 apply-safety call — never as a hard override of the rubric.
`project-shared` wins over `home` on conflict; log the conflict.
Per-tier maintenance: if either loaded INDEX is near its 200-line cap, invoke `consolidate` at the O5 write point.

## Fast tier — write (Phase O5)

Write at the end of every run — including quiet early-exit runs, since a clean run is recurrence evidence for any lesson applied at O0.
Classify each candidate **universal** vs **project-bound** by its `trigger-context` (canonical contract's classification table), then dispatch:

```
# Universal lesson — always lands in home.
Skill("persistent-memory", "write optimize-approach-lessons --tier home --auto")

# Project-bound lesson — opt-in gated.
if [ -f memory/optimize-approach-lessons/INDEX.md ]; then
  Skill("persistent-memory", "write optimize-approach-lessons --tier project-shared --auto")
else
  Skill("persistent-memory", "write optimize-approach-lessons --tier home --auto")
  log "Project-bound lesson written to home (no committed memory/optimize-approach-lessons/). Team can opt in once: /persistent-memory write optimize-approach-lessons --tier project-shared"
fi
```

Write nothing when the retrospective surfaces nothing **and** no lesson was applied — empty lessons are noise.
`--auto` skips the consent preview but never the privacy pre-flight; lessons are about this skill's mechanics, never product data.
A lesson that recurs resolves to UPDATE, which bumps `seen_count` and refreshes `expires` — this is what makes recurrence countable.

## Promotion — slow tier

After an O5 write (or an O0 read), a lesson is promotion-eligible at `seen_count >= 3` or when tagged `status: structural`.
Surface a one-line suggestion — never act silently. Target depends on tier:

| Lesson tier | Promotion target | One-liner |
| --- | --- | --- |
| `home` (universal) | this skill's source | `Lesson "<title>" recurred N times. Promote to a permanent guard? Run:  /create-skill diagnose optimize-approach --symptom "<title>"` |
| `project-shared` (project-bound) | the repo's own rules | `Lesson "<title>" recurred N times in this repo. Promote to a repo rule? Run:  Skill("docs", "update --add-rule '<title>' --source memory/optimize-approach-lessons/entries/<id>.md")` |

When the user runs the home-tier promotion, Diagnose Mode reads `optimize-approach-lessons` as evidence (see the `## Lessons scope` section in [`diagnostic-surface.md`](./diagnostic-surface.md)).

## Entrenchment guards

The five load-bearing guards from the canonical contract apply verbatim and are non-negotiable:
lessons are advisory (never auto-applied to behavior), recurrence (`seen_count >= 3`) gates promotion, every lesson expires, contradictions are flagged not overwritten, and the privacy pre-flight is never bypassed.
A lesson may never relax one of this skill's hard invariants — in particular the [`apply-mode.md`](./apply-mode.md) confidence gate, the forbidden-targets list, or the never-block-the-verdict rule.
