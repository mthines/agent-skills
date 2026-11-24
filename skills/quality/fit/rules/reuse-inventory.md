---
title: 'Inventory mode — justify every new thing the diff adds'
impact: HIGH
tags:
  - fit
  - reuse
  - inventory
---

# Inventory mode (`/fit --inventory`)

Judge each item the diff adds, one verdict per item: reuse an existing thing, extend one, or keep the new one with a reason.
Report only; never edit files, never re-run, never block.
**Why:** [`../references/reuse-inventory.md`](../references/reuse-inventory.md).

## Step 1 — List the items

```bash
FIT_DIR="<the directory this skill loaded from>"
BASE="${BASE:-$(git merge-base HEAD origin/main)}"
OUT=$(mktemp); node "$FIT_DIR/scripts/reuse-inventory.mjs" --base "$BASE" > "$OUT"; echo "exit=$?"; cat "$OUT"
```

Each row is `<kind>\t<name>\t<file>:<line>`, kind one of `file`, `export`, `component`, `route`.
`inventory: 0 items` → print `Reuse: nothing new added.` and stop.
A non-zero exit → print `Reuse: not run (<the script's stderr line>)` and stop.

## Step 2 — Search before you judge

For each item, run at least one search for an existing equivalent outside the diff before writing a verdict:

| Kind | Search for |
| --- | --- |
| `export` | the same verb + noun under other names (`grep -rn "function \(format\|render\)Date"`), and the module the item's neighbours import from |
| `component` | a component with the same role in the design-system or shared folder (`Button`, `Modal`, `EmptyState`), and the registry or Storybook stories when the repo has them |
| `route` | the same resource path or handler in the router, an OpenAPI spec, or the API client |
| `file` | a sibling file with the same responsibility (a second `utils.ts`, a second `client.ts`) |

Exclude the diff's own files from the hits.
Group items that share one cause into one row (`5 exports from a new date helper` → one row).

## Step 3 — Write one verdict per item

| Verdict | When | Must name |
| --- | --- | --- |
| `reuse` | an existing thing already does this; the new one duplicates it | the existing `path:line` |
| `extend` | an existing thing does most of it; a parameter, variant, or prop would cover the rest | the existing `path:line` and the change |
| `new` | the search found nothing equivalent, or the existing one serves a different contract | the reason in one clause |

Severity: `reuse` on a route, a component, or a shared mechanism (HTTP client, cache, auth check) is `High`; any other `reuse` or `extend` is `Medium`; `new` carries no severity.

```text
✗ Wrong — a verdict with no search behind it, and no path
  export formatDuration — new
✓ Right — searched, found, named
  export formatDuration (src/ui/Timer.tsx:12) — reuse: src/lib/time.ts:40 formatElapsed has the same contract — Medium
✓ Right — searched, nothing equivalent
  route POST /api/exports (app/api/exports/route.ts:3) — new: no export endpoint exists; /api/reports is read-only
```

## Output

Print a table, `reuse` and `extend` rows first, then a count line:

```markdown
| Item | Verdict | Existing | Severity |
| --- | --- | --- | --- |
| `component SaveBar` (src/Editor/SaveBar.tsx:1) | extend | `src/ui/ActionBar.tsx:8` — add a `variant="save"` | Medium |
| `route GET /api/users/:id` (app/api/users/[id]/route.ts:4) | new — no user detail endpoint exists | — | — |

Reuse: <N> items — <r> reuse, <e> extend, <n> new.
```
