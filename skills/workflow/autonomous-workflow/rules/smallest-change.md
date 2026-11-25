---
title: 'Smallest complete change — reach before write, then the ladder'
impact: HIGH
tags:
  - autonomous-workflow
  - executor
  - implementation
  - simplicity
---

# Smallest complete change

Read before the first edit of Phase 3, in every tier.
Be lazy about the solution, never about the change: the smallest diff that reaches every place the task must reach.
`fit --inventory` checks the result after the fact (`quality-pass.md`); this rule is the same judgement made while writing.
**Why:** [`../references/smallest-change.md`](../references/smallest-change.md).

## Step 1 — Reach before write

Before the first edit, list every place the change must reach, from the code, in the Progress Log:

1. **Callers** of every function, type, or export you will change: `git grep -n '\b<name>\b'`.
2. **Tests and fixtures** that exercise them, including snapshots and golden files.
3. **Config and wiring**: registration lists, schemas, env defaults, feature flags, generated files.
4. **Exports and docs** that name the changed behaviour.

Mark each hit `changes` or `unaffected (<reason>)`.
For a bug fix, the fix lands once, in the shared function every caller goes through, never in the one caller where the symptom showed.

```text
✗ Wrong — fixes the symptom in the caller the ticket named; two other callers keep the bug
  edit src/routes/export.ts: if (!rows) rows = []

✓ Right — the list comes from git grep, the fix is in the shared function
  C-reach: loadRows — src/routes/export.ts:41 changes (test), src/jobs/nightly.ts:88 unaffected (passes a default),
           src/routes/feed.ts:17 changes (same null path) → fix in src/data/rows.ts:12
```

## Step 2 — The ladder

For each piece of new behaviour, stop at the first rung that holds:

| # | Rung | Take it when |
| --- | --- | --- |
| 1 | It does not need to exist | No requirement or AC needs it; name what you skipped in one line in the walkthrough |
| 2 | It is already in this codebase | A helper, component, service, or pattern does it; use it the way its neighbours do |
| 3 | The standard library or platform does it | And the project has no house version of it |
| 4 | An installed dependency does it | Never add a dependency for a few lines |
| 5 | One line a reader gets at a glance | A one-liner that needs decoding is not short |
| 6 | The minimum code that works | Nothing else held |

- Add no option, config, wrapper, abstraction, or "for later" code that no requirement needs.
- Keep the codebase's layers, interfaces, and conventions; deletion beats addition.
- Between two options of equal size, take the one correct on edge cases.
- New non-trivial logic (a branch, a loop, a parser, money, security, a data write) leaves at least one test that fails when it breaks.
- A known ceiling gets a marker: `shortcut: <the limit>, <when to upgrade>` (`agents/shared/rules/shortcut-markers.md` in this repo).

```ts
// ✗ Wrong — a configurable cache class for one call site nobody asked to configure
export class TtlCache<K, V> { constructor(private opts: { ttlMs: number; max?: number }) {} /* 80 lines */ }

// ✓ Right — rung 2: the codebase already memoizes this way
const getPlan = memoize(fetchPlan); // src/lib/memoize.ts, as in src/billing/limits.ts
```

## Never cut

The ladder never removes these, at any rung: validation at a trust boundary, error handling that prevents data loss, security checks, accessibility, and anything a requirement or AC asks for.
Code you move or merge keeps its error handling and validation.
