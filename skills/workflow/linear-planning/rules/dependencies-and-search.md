---
title: Search & Dependencies — Related Work and Wiring
impact: HIGH
tags:
  - search
  - duplicates
  - dependencies
  - blocks
  - relations
---

# Search & Dependencies

Before drafting structure, find work that already exists, and after drafting,
wire the ordering constraints between tickets.
This rule covers Phase 2: related-work / duplicate search, and the dependency
graph that Phase 5 turns into Linear relations.

## Contents

- Step 1 — Search for related and duplicate work
- Step 2 — Build the dependency graph
- Sequencing sanity checks
- Ordering constraints vs milestones
- Examples
- Common mistakes

## Step 1 — Search for related and duplicate work

Run these searches with the terms from the scoping doc (feature nouns, surface
names, error strings). Report what you find; do not silently proceed.

| Goal                          | MCP call                                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| Existing projects on the topic | `list_projects` with `query`, `includeMilestones: true`            |
| Existing / duplicate tickets   | `list_issues` with `query` (searches title + description), `team`  |
| Open work in a project         | `list_issues` with `project`, `fields: [title, status, url]`       |
| A specific referenced ticket   | `get_issue` with the identifier (e.g. `ENG-501`)                    |

Search **more than one phrasing** — users and past authors name things
differently ("export" vs "download vs "PDF"). Two or three queries, not one.

### What to do with a match

| Finding                                            | Action                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| An existing ticket already covers this             | Stop. Surface it and ask whether to extend it instead.        |
| A project already exists for this topic            | Add milestones / tickets to it rather than creating a new one.|
| A ticket is adjacent (overlaps but isn't the same) | Plan to link it with `relatedTo`.                             |
| A ticket must be done first                        | Plan to link it with `blockedBy`.                             |

## Step 2 — Build the dependency graph

For the drafted ticket set, decide the ordering constraints **before** preview
so the preview shows them.
A dependency exists when ticket B cannot start (or cannot be verified) until
ticket A is done.

Represent it as a small list the preview can render:

```text
ENG-☐ Export single dashboard   blockedBy  ENG-☐ Spike: server-side rendering
ENG-☐ Bulk export               blockedBy  ENG-☐ Export single dashboard
ENG-☐ Export docs               relatedTo  ENG-☐ Export single dashboard
```

### Relation types

| Relation    | Meaning                                             | MCP field on `save_issue` |
| ----------- | --------------------------------------------------- | ------------------------- |
| Blocks      | This ticket must finish before the other can start. | `blocks`                  |
| Blocked by  | This ticket cannot start until the other finishes.  | `blockedBy`               |
| Related     | Relevant context, no ordering constraint.           | `relatedTo`               |
| Duplicate   | Same work as another ticket.                        | `duplicateOf`             |

`blocks`, `blockedBy`, and `relatedTo` are **append-only** — they add
relations, they never remove existing ones. Wiring the same link twice is safe
but noisy; wire each relation once, from one side only (setting `blockedBy` on
B implies `blocks` on A — do not set both).

## Sequencing sanity checks

- **No cycles.** If A blocks B and B blocks A, one of them is mis-scoped.
- **The walking skeleton has no blockers** (other than spikes). If the first
  demoable slice is blocked by three tickets, it isn't the skeleton.
- **Cross-team dependencies are flagged**, not buried. If another team owns a
  blocker, note it explicitly and consider a placeholder / tracking ticket.

## Ordering constraints vs milestones

A dependency and a milestone boundary often coincide but are not the same:

- Milestone = *when we can ship/demo*.
- Dependency = *what must exist first for a specific ticket*.

Wire both. Don't rely on milestone order alone to communicate a hard blocker.

## Examples

### Good — a checked dependency graph

```text
Spike (M1) blocks Export single (M1) blocks Bulk export (M2)
Export docs (M3) relatedTo Export single (M1)
No cycles. Skeleton = Export single, blocked only by the spike.
```

### Bad — implied ordering left unwired

```text
"Bulk export obviously comes after single export."
```

Why bad: obvious to the author, invisible in Linear. The board shows both as
ready; someone starts bulk first. **Fix:** wire `blockedBy`.

## Common mistakes

- Searching one phrasing and declaring "no duplicates". **Fix:** try 2–3
  synonyms and the surface name.
- Setting both `blocks` on A and `blockedBy` on B for one relation. **Fix:**
  wire it once, from one side.
- Encoding a blocker only as milestone order. **Fix:** also set the relation.
- A dependency cycle from over-splitting. **Fix:** merge or re-slice.
