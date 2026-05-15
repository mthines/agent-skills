---
title: Consolidate Pipeline — Sleep-Style Compression
impact: HIGH
tags:
  - consolidate
  - compression
  - pruning
  - sleep-consolidation
---

# Consolidate Pipeline

## Contents

- [When to run](#when-to-run)
- [Phase 0 — Snapshot](#phase-0--snapshot)
- [Phase 1 — Group + merge](#phase-1--group--merge)
- [Phase 2 — Prune stale](#phase-2--prune-stale)
- [Phase 3 — Preview + apply](#phase-3--preview--apply)
- [Phase 4 — Rewrite INDEX](#phase-4--rewrite-index)
- [Safety rules](#safety-rules)
- [Anti-entrenchment](#anti-entrenchment)

Periodic compression pass modeled on sleep-consolidated memory research
(SCM). Goal: merge duplicates, summarize stale entries, prune obsolete
facts. Run when the INDEX exceeds 200 lines, or every 30–90 days for
active scopes — the user decides.

## When to run

Suggest consolidation when **any** of these are true:

- `INDEX.md` exceeds 200 lines.
- `entries/` contains > 100 files.
- The last `consolidate` line in `AUDIT.log` is more than 90 days old
  and the scope has had > 20 writes since.
- The user asks for it.

Never auto-consolidate without explicit user approval. Consolidation is
lossy by design.

## Phase 0 — Snapshot

Before reading or moving anything, record the current state:

```text
Pre-consolidation snapshot for scope `parenting` (home):
- INDEX: 247 lines
- entries/: 84 files
- archive/: 12 files
- Last consolidate: 2026-02-03 (102 days ago)
```

Save this snapshot in memory; do not write it to disk yet. It will go
into the AUDIT.log line at the end.

## Phase 1 — Group + merge

Walk `entries/`. For each pair of entries, decide whether they should
merge. Two entries should merge when:

- They share **all** primary tags (the first 2 tags in their
  frontmatter), AND
- Their statements describe the same durable fact at different points
  in time (i.e. the later one is a refinement of the earlier).

For each merge group, draft a single replacement entry:

- Take the most recent entry as the base.
- Append a `## History` block listing the prior entries' timestamps and
  one-line summaries.
- Filename: keep the most recent entry's filename.

Do **not** merge entries that share tags but describe different facts.
Tag overlap is necessary, not sufficient.

### Worked example

Before:

```text
2026-02-10-bedtime-routine-7pm.md      — Bedtime at 7pm with story.
2026-03-15-bedtime-routine-added-bath.md — Added a bath before story.
2026-05-12-bedtime-routine-current.md   — Bath, story, lullaby.
```

After:

```text
2026-05-12-bedtime-routine-current.md   — Bath, story, lullaby.
                                          ## History
                                          - 2026-03-15: Added a bath before story.
                                          - 2026-02-10: Bedtime at 7pm with story.
```

The two earlier files move to `archive/`. The current file gets a
`History` block.

## Phase 2 — Prune stale

A stale entry is one where:

- Type is `episodic`, AND
- `created` is older than 180 days, AND
- No `UPDATE` has touched it since.

Stale `episodic` entries are candidates for archive. Stale `semantic`,
`procedural`, and `preference` entries are NOT auto-archived —
durable facts age slowly.

Mark candidates with `[ARCHIVE]` in the preview. The user can opt out
per-entry.

## Phase 3 — Preview + apply

Render the full plan:

```text
Consolidate plan for parenting (home):

Merges (3 groups → 3 entries; 6 files → archive):
 [MERGE] bedtime-routine: 3 files → 2026-05-12-bedtime-routine-current.md
 [MERGE] piano-lessons:   2 files → 2026-04-30-piano-current.md
 [MERGE] anna-friends:    2 files → 2026-05-01-anna-friends.md

Archives (stale episodic):
 [ARCHIVE] 2025-11-12-grandparents-visited.md (188 days old, no updates)

Reply 'yes' to apply, 'edit' to deselect entries, or 'cancel'.
```

Block until the user replies.

## Phase 4 — Rewrite INDEX

After files are moved, rewrite `INDEX.md` from the surviving entries.
Use the same template at
[`../templates/INDEX.md`](../templates/INDEX.md).

The new INDEX must be ≤ 200 lines. If it is not, the merge groups were
too conservative — flag this to the user and re-run with broader groups.

### AUDIT.log line

Append one NDJSON line:

```json
{"ts":"2026-05-15T10:23:00Z","op":"consolidate","scope":"parenting","merged_groups":3,"archived":7,"index_lines_before":247,"index_lines_after":138}
```

## Safety rules

- Never modify `archive/`. Consolidation only moves entries into
  `archive/`, never out.
- Never delete the original entry file before its successor exists on
  disk. Move atomically: write new → fsync → move old.
- If any step errors out, leave the scope untouched. Partial
  consolidation is forbidden.
- The user can always reverse a consolidation manually by moving files
  back from `archive/` to `entries/` and re-running `read` — the skill
  does not block this.

## Anti-entrenchment

Reflexion research warns that self-reflection can entrench mistakes.
Consolidation has the same risk: a wrong fact merged into the canonical
entry is now harder to dislodge.

Mitigation:

- Always show the user the merge plan before applying.
- The `## History` block preserves the original statements verbatim, so
  the user can spot drift.
- The `forget` operation works on consolidated entries — they are not
  privileged.
