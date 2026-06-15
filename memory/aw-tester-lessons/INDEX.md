# aw-tester-lessons — Memory Index

> Procedural lessons the `aw-tester` agent learns across runs. This is the
> **slow tier** of the tester's self-improvement loop: cross-run, persisted,
> advisory. A lesson that recurs (`seen_count >= 3`) or is tagged `structural`
> becomes promotion-eligible — see the self-improvement section of
> [`skills/workflow/autonomous-workflow/templates/aw-tester.agent.md`](../../skills/workflow/autonomous-workflow/templates/aw-tester.agent.md).
>
> Read by `aw-tester` on startup. Written after each run that produced a
> locator failure, an auth refresh, or an `inconclusive` verdict. Managed by
> `/persistent-memory` (`read` / `write` / `consolidate` / `forget`).
>
> Keep this file ≤ 200 lines. When it exceeds 200, run
> `/persistent-memory consolidate aw-tester-lessons`.

## Lessons by category

> One sentence per lesson; cross-references point to entry files in `entries/`.
> Group by the failure type the lesson addresses. Empty until aw-tester
> records its first lesson.

### Locator resolution failures

### Auth failures

### Network / fixture failures

### Spec format issues

## Promotion-eligible (seen_count ≥ 3 or `structural`)

> Lessons that have proven themselves and are candidates for
> `/create-skill diagnose autonomous-workflow --symptom "<lesson title>"`.
> Move here during `consolidate`; clear once promoted (`status: promoted`).

---

<!-- Maintainer notes (stripped from context by Claude Code):
     - Cap: 200 lines. One sentence per lesson line.
     - Entries are procedural memory: "what to do better next time".
     - Recurrence (seen_count) is the promotion signal; never promote on one run.
     - Every lesson expires (default 90 days) — consolidate prunes stale ones.
     - Fast-tier (in-run) heuristics live ONLY in the agent's working memory,
       not here. Only cross-run wins get persisted.
-->
