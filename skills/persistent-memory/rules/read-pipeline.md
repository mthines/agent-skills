---
title: Read Pipeline — Progressive Disclosure From INDEX
impact: HIGH
tags:
  - read
  - retrieval
  - progressive-disclosure
---

# Read Pipeline

## Contents

- [Phase 0 — Resolve scope](#phase-0--resolve-scope)
- [Phase 1 — Load INDEX](#phase-1--load-index)
- [Phase 2 — On-demand fetch](#phase-2--on-demand-fetch)
- [Filtering by tag](#filtering-by-tag)
- [Auto-loading by other skills](#auto-loading-by-other-skills)
- [Multi-scope read](#multi-scope-read)
- [Never do](#never-do)

Modeled on Claude Code's `MEMORY.md` pattern: a concise INDEX is
always loaded; detail entries are fetched only when referenced.

## Phase 0 — Resolve scope

Parse the scope name from `$ARGUMENTS`. Resolve the storage tier in
this order:

1. `home`: `~/.agent-memory/<scope>/INDEX.md`.
2. `project-local`: `<cwd>/.agent/memory/<scope>/INDEX.md`.
3. `project-shared`: `<cwd>/memory/<scope>/INDEX.md`.

If the scope exists in more than one tier, prefer **`project-local`**,
then `project-shared`, then `home`. Tell the user which tier was used.

If no tier has the scope, print:

```text
Scope `<name>` has no memory yet. Run `/persistent-memory write <name>` to start.
```

…and stop. Do not invent contents.

## Phase 1 — Load INDEX

Read `INDEX.md` in full and surface it in the conversation as a code
block. This is the lightweight always-loaded tier.

If `INDEX.md` exceeds 200 lines, warn the user:

```text
INDEX is 273 lines (over 200-line cap). `/persistent-memory consolidate <scope>` recommended.
```

Continue anyway — do not refuse to read.

## Phase 2 — On-demand fetch

Detail entries in `entries/` are NOT auto-loaded. Fetch one only when:

- The current task mentions a topic the INDEX flags as covered by a
  specific entry file.
- The user asks "tell me more about X" and the INDEX cross-references
  an entry.
- Another skill is about to act on the scope and needs the full detail
  (e.g. a `parenting` advice flow needs the full overwhelm-strategy
  entry, not just the one-line INDEX summary).

When fetching, read **one entry at a time**. Do not bulk-load the
`entries/` directory. The whole point of progressive disclosure is to
keep the context tight.

## Filtering by tag

When the user asks for memories about a topic (e.g. "what do I know
about Anna's school"), do not load every entry. Instead:

1. Grep the INDEX for matching tags or keywords.
2. Surface the matching INDEX lines.
3. Offer to load specific detail entries.

If the scope has grown large enough that grep on the INDEX is
insufficient, the user has outgrown Tier 1 — recommend graduating to
Tier 2 (SQLite FTS) per [`scaling-tiers.md`](./scaling-tiers.md).

## Auto-loading by other skills

When another skill (e.g. `parenting`) invokes
`Skill("persistent-memory", "read parenting")`, the only thing
returned is the INDEX content. Detail entries are loaded by that skill
on demand, using the file paths inside the INDEX. See
[`integration-with-skills.md`](./integration-with-skills.md).

## Multi-scope read

If the user asks for "all my memory" or passes `--all-scopes`, load
**every scope's INDEX, but no detail entries**. Print one INDEX per
scope, separated by an H1 heading.

If the combined INDEX content exceeds 1000 lines, ask the user to pick
specific scopes instead of dumping everything. Bulk INDEX loads
defeat the purpose.

## Never do

- Never silently summarize the INDEX before surfacing it. The user
  authored those lines; trust them.
- Never load `archive/`. Archived entries are audit trail, not active
  context.
- Never load `AUDIT.log` unless the user explicitly asks for the audit
  trail.
- Never modify any file during a `read` operation. `read` is strictly
  read-only.
