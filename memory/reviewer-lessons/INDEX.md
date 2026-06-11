# reviewer-lessons — Memory Index

> Procedural lessons the `reviewer` agent learns across runs. This is the
> **fast tier** of reviewer's self-improvement loop: cheap, reversible,
> advisory. A lesson that recurs (`seen_count >= 3`) or is tagged
> `structural` becomes promotion-eligible — move it into
> `agents/reviewer/rules/` (typically `auto-fix-policy.md` or
> `diagnostic-surface.md`).
>
> Read by `reviewer` at intake (after sub-mode detection, before the
> review pipeline). Written by `/persistent-memory write reviewer-lessons
> --tier project-shared` at end-of-run when a durable lesson surfaces.
> Managed by `/persistent-memory` (`read` / `write` / `consolidate` /
> `forget`).
>
> Keep this file ≤ 200 lines. When it exceeds 200, run
> `/persistent-memory consolidate reviewer-lessons`.

## Lessons by step

> One sentence per lesson; cross-references point to entry files in `entries/`.
> Group by the reviewer step (0 — sub-mode detect, 1 — diff scope, 2 —
> review pipeline, 3 — auto-fix, 4 — verify, 5 — report) the lesson
> applies to.

### Step 0 — Sub-mode detection

### Step 1 — Diff scope

### Step 2 — Review pipeline

### Step 3 — Auto-fix

### Step 4 — Post-fix verification

- [2026-06-11-no-full-verify-on-heavy-monorepos](entries/2026-06-11-no-full-verify-on-heavy-monorepos.md) — In `--fix` / self-review sub-mode on dash0 / `components/ui`, do not run `pnpm verify` after applying fixes; run only the targeted test files. Full verify after chained autonomous rounds caused >55 GB RAM.

### Step 5 — Report

## Promotion-eligible (seen_count ≥ 3 or `structural`)

> Lessons that have proven themselves and are candidates for promotion
> into `agents/reviewer/rules/`. Move here during `consolidate`; clear
> once promoted (`status: promoted`).

---

<!-- Maintainer notes (stripped from context by Claude Code):
     - Cap: 200 lines. One sentence per lesson line.
     - Entries are procedural memory: "what to do better next time".
     - Recurrence (seen_count) is the promotion signal; never promote on one run.
     - Every lesson expires (default 90 days) — consolidate prunes stale ones.
-->
