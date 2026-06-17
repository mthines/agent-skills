---
title: Storage Layout — Tiers, Scopes, Directory Structure
impact: HIGH
tags:
  - storage
  - layout
  - scope
  - tiers
---

# Storage Layout

## Contents

- [Tier table](#tier-table)
- [Scope naming rules](#scope-naming-rules)
- [Per-scope directory layout](#per-scope-directory-layout)
- [Listing scopes](#listing-scopes)
- [Bootstrap](#bootstrap)

Every memory operation resolves two things before touching disk:

1. **Scope** — the logical bucket (e.g. `parenting`, `relationship-anna`, `project-acme`).
2. **Storage tier** — where on disk the scope lives.

If either is ambiguous, ask the user once (single batched message). Never
guess. Never silently fall back to a default the user did not see.

## Tier table

| Tier             | Root path                              | Committed?         | Cross-machine? | Default for                                        |
| ---------------- | -------------------------------------- | ------------------ | -------------- | -------------------------------------------------- |
| `home` (default) | `~/.agent-memory/<scope>/`             | No                 | No (user dir)  | Personal scopes that span repos (parenting, work)  |
| `project-local`  | `<repo>/.agent/memory/<scope>/`        | No (must gitignore) | No            | Per-project private notes                          |
| `project-shared` | `<repo>/memory/<scope>/`               | Yes                | Yes (git)      | Team-shared project knowledge                      |

### Tier selection rules

- If the user did not specify a tier, default to **`home`**. State the
  default explicitly: `Storage tier: home (default)`.
- **A caller may pin the tier inline with `--tier <home|project-local|project-shared>`**
  (e.g. `write aw-lessons --tier home --auto` for a cross-project fast-tier
  lesson scope, or `write team-runbooks --tier project-shared --auto` for a
  committed team scope). A pinned tier resolves the scope to that tier without
  an interactive prompt — including `--tier project-shared`, where the pin
  **is** the standing consent (a host skill writing to an established,
  committed scope on the user's behalf; the scope already living in the repo
  is the user's prior opt-in). The pin still errors-and-exits if the tier
  requires a git repo and the working directory is not one, and the **privacy
  pre-flight still runs** (`--tier` and `--auto` never bypass the never-store
  list). State the resolved tier explicitly: `Storage tier: home (pinned)`.
- If the user asks for `project-local` or `project-shared` and the
  current working directory is not a git repo, error and exit. Do not
  silently fall back to `home`.
- If the user asks for `project-local`, verify `.gitignore` already
  excludes `.agent/`. If not, append `.agent/` to `.gitignore` and tell
  the user you did so.
- `project-shared` requires explicit user confirmation: this content
  ships in the repository and is visible to every collaborator.

## Scope naming rules

- Match `^[a-z0-9][a-z0-9-]{0,63}$`. Lowercase, kebab-case, no slashes,
  no dots, no spaces.
- Reject reserved words: `claude`, `anthropic`, `system`, `default`.
- Prefer narrow scopes (`parenting`, `relationship-anna`) over mega-scopes
  (`life`, `everything`). Mega-scopes balloon the INDEX past 200 lines
  and degrade recall.
- A scope is created the first time it is written to. Do not pre-create
  empty scopes.

## Per-scope directory layout

Identical across all three tiers:

```text
<storage-root>/<scope>/
├── INDEX.md          # Curated summary, ≤ 200 lines. Always loaded by `read`.
├── entries/          # One markdown file per memory entry. Loaded on demand.
│   └── <yyyy-mm-dd>-<slug>.md
├── archive/          # Consolidated, superseded, or forgotten entries (kept for audit).
│   └── <yyyy-mm-dd>-<slug>.md
└── AUDIT.log         # Append-only NDJSON ledger of every write / consolidate / forget.
```

### `INDEX.md`

The single hot file. Loaded into context every time the scope is read.
Hard cap **200 lines** — same threshold Claude Code uses for `MEMORY.md`.
If the INDEX exceeds 200 lines, `consolidate` is overdue.

Format: see [`../templates/INDEX.md`](../templates/INDEX.md).

### `entries/<yyyy-mm-dd>-<slug>.md`

One file per memory entry. Filename pattern:

```text
<ISO-date>-<kebab-case-slug>.md
```

Examples:

```text
2026-05-15-anna-loves-watercolour.md
2026-05-15-bedtime-routine-current.md
2026-05-14-call-with-grandparents-monthly.md
```

The slug must be unique within the scope. If a collision occurs, append
`-<counter>` (e.g. `-2`, `-3`).

Each entry has YAML frontmatter; see
[`../templates/memory-entry.md`](../templates/memory-entry.md).

### `archive/`

Same layout as `entries/`. Entries are MOVED here (not copied) when:

- `consolidate` merges them into a new combined entry.
- `forget` runs with `--archive` instead of `--hard-delete` (the default
  for `forget` — see [`forget-pipeline.md`](./forget-pipeline.md)).

Never delete an archived entry programmatically. The user can prune
`archive/` manually with `rm` if they choose.

### `AUDIT.log`

Append-only NDJSON. One line per operation. Never rewrite. Never compact
automatically.

Example line:

```json
{"ts":"2026-05-15T10:23:00Z","op":"write","scope":"parenting","added":2,"updated":1,"deleted":0,"actor":"user","auto":false}
```

Required fields: `ts`, `op` (`write` | `consolidate` | `forget`),
`scope`, and per-op counts (`added`, `updated`, `deleted`, `archived`).

## Listing scopes

When `list` runs, walk all three tier roots that exist, then for each
scope print:

```text
<tier>/<scope>  —  <N> entries, <M>-line INDEX, last write <date>
```

Skip tiers whose root does not exist. Do not auto-create them.

## Bootstrap

The first time the skill writes to a tier root that does not exist,
create it and tell the user. Example:

```text
Created ~/.agent-memory/ — your personal memory root.
```

If the tier is `project-local` and `.gitignore` does not already cover
`.agent/`, append it and tell the user. Never silently leak memory into
git.
