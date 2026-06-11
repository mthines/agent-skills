# aw-lessons — Memory Index

> Procedural lessons the `autonomous-workflow` learns across runs. This is the
> **fast tier** of the workflow's self-improvement loop: cheap, reversible,
> advisory. A lesson that recurs (`seen_count >= 3`) or is tagged
> `structural` becomes promotion-eligible — see
> [`skills/workflow/autonomous-workflow/rules/self-improvement-loop.md`](../../skills/workflow/autonomous-workflow/rules/self-improvement-loop.md).
>
> Read by `aw-planner` (Phase 1) and `aw-executor` (Phase 3/4). Written on
> Phase 4 stuck-loop escalation and Phase 7 end-of-run. Managed by
> `/persistent-memory` (`read` / `write` / `consolidate` / `forget`).
>
> Keep this file ≤ 200 lines. When it exceeds 200, run
> `/persistent-memory consolidate aw-lessons`.

## Lessons by phase

> One sentence per lesson; cross-references point to entry files in `entries/`.
> Group by the workflow phase the lesson applies to. Empty until the workflow
> records its first lesson.

### Phase 0 — Validation

### Phase 1 — Planning

### Phase 2 — Worktree

### Phase 3 — Implementation

### Phase 4 — Testing

- See Phase 7 entry below — the chained-rounds RAM lesson sits at end-of-run, since `aw`'s own verify is correct and the actionable owner is [`reviewer-lessons`](../reviewer-lessons/INDEX.md).

### Phase 5 — Documentation

### Phase 6 — PR Creation

### Phase 7 — CI Gate

- [2026-06-11-no-chained-reviewer-after-autonomous-pr](entries/2026-06-11-no-chained-reviewer-after-autonomous-pr.md) — Closing nudge on heavy monorepos: warn the orchestrator not to chain `reviewer --fix` + `aw-executor` after the PR is open. Primary owner is [`reviewer-lessons`](../reviewer-lessons/INDEX.md).

## Promotion-eligible (seen_count ≥ 3 or `structural`)

> Lessons that have proven themselves and are candidates for
> `/create-skill diagnose autonomous-workflow`. Move here during
> `consolidate`; clear once promoted (`status: promoted`).

---

<!-- Maintainer notes (stripped from context by Claude Code):
     - Cap: 200 lines. One sentence per lesson line.
     - Entries are procedural memory: "what to do better next time".
     - Recurrence (seen_count) is the promotion signal; never promote on one run.
     - Every lesson expires (default 90 days) — consolidate prunes stale ones.
-->
