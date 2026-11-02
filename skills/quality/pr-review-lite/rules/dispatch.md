# Dispatch — what lite reviews, groups, and skips

Dispatch is code, not a model decision: the same packet and options give the same units and the same skips.

## What lite reuses, read-only

| Input | From | Used for |
| --- | --- | --- |
| Review packet | `prepare-review.mjs`, run unchanged | PR description, REVIEW.md notes, every hunk with right-side line numbers |
| Impact graph | `context.json` → `paths.impact` | A bounded summary of the most-consumed changed symbols |
| Finder rubric | `pr-reviewer/rules/finders.md`, read at run time | The reviewer prefix, verbatim |
| Team lenses | `context.json` → `lenses.loaded`, selected by `prepare-review.mjs` | The `## Team lenses` block of the reviewer prefix ([`lenses.md`](./lenses.md)) |
| Exclude list | `.agents/review/lite.yaml` (optional) | Extra paths to skip |

`lite.yaml` takes one key; anything else is ignored:

```yaml
exclude:
  - "docs/**"
  - "**/*.generated.ts"
```

## What is skipped

Every skipped file goes to `skipped.json` as `{path, reason}`. Reasons, in the order they are tested:

1. `excluded by lite.yaml (<glob>)`.
2. `vendored path`, `build output`, `snapshot`, `binary or asset`, `generated bundle`.
3. `generated file` (the packet's `generated` role, which covers lockfiles).
4. `not inlined in the packet (<note>)` — a file the packet only lists.
5. `unit cap (<n>) reached`.
6. `review call failed: <error>` or `unparseable reply (…)` — the unit's call threw or returned no JSON array; the files were not reviewed.

```text
✗ Wrong — drop a file the packet could not inline and say nothing
✓ Right — skipped.json: {"path":"src/huge.ts","reason":"not inlined in the packet (not inlined (packet cap) …)"}
```

## How files group

1. Keep packet order (largest change first within a role).
2. Fill a unit until adding the next file would pass `--unit-tokens` (default 12000, estimated at 4 characters per token).
3. A file larger than the budget gets a unit of its own and is never split or dropped.
4. Units past `--max-units` (default 12) are skipped with the cap reason.
