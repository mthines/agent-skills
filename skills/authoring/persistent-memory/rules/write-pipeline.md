---
title: Write Pipeline — Extract, Resolve, Persist
impact: HIGH
tags:
  - write
  - extraction
  - update
  - mem0
---

# Write Pipeline

## Contents

- [The four operations](#the-four-operations)
- [Phase 2 — Extract candidates](#phase-2--extract-candidates)
- [Phase 3 — Resolve against existing entries](#phase-3--resolve-against-existing-entries)
- [Phase 4 — Consent preview](#phase-4--consent-preview)
- [Phase 5 — Write and audit](#phase-5--write-and-audit)
- [Lesson-scope entries](#lesson-scope-entries)
- [Concurrent writers](#concurrent-writers)
- [Edge cases](#edge-cases)

Two-phase write modeled on Mem0's Extraction → Update pipeline. Every
candidate memory is first extracted from the conversation, then
resolved against existing entries with one of four operations.

## The four operations

| Op       | When to apply                                                                              |
| -------- | ------------------------------------------------------------------------------------------ |
| `ADD`    | The fact is new — no existing entry covers it.                                             |
| `UPDATE` | An existing entry covers the same fact but is stale, partial, or contradicted.             |
| `DELETE` | An existing entry is now obsolete or invalidated by the new fact.                          |
| `NOOP`   | The fact is already captured accurately; do nothing.                                       |

Every candidate gets exactly one tag before persistence. Show the
user the full table before writing — this is the consent preview.

## Phase 2 — Extract candidates

Read the **last N conversation turns** (default: the full current
conversation; cap at the last 50 turns to bound cost). For each
candidate fact, emit one row in a working table:

| # | Type        | Statement (one sentence)                          | Tags                | Confidence | Source            |
| - | ----------- | ------------------------------------------------- | ------------------- | ---------- | ----------------- |
| 1 | preference  | Anna prefers watercolour over acrylic for art    | anna, hobbies, art  | high       | user-stated       |
| 2 | episodic    | We started a new bedtime routine on 2026-05-12   | bedtime, anna       | high       | user-stated       |
| 3 | procedural  | When Anna is overwhelmed, give her quiet time   | anna, regulation    | medium     | inferred          |

### Extraction rules

- One statement per row. Atomic, factual, falsifiable.
- Type must be one of `semantic`, `episodic`, `procedural`,
  `preference`. See [`memory-taxonomy.md`](./memory-taxonomy.md).
- Confidence is `high` (explicit user statement), `medium` (strongly
  implied), `low` (model inference). Reject `low`-confidence facts by
  default; require an explicit flag to keep them.
- Source is `user-stated`, `inferred`, `external` (e.g. a fetched URL),
  or `system` (e.g. tool output).
- Strip stylistic chatter, hedges, and meta-commentary. Keep the fact,
  not the conversation.
- Never extract anything that matches the never-store list in
  [`privacy-and-consent.md`](./privacy-and-consent.md).

### What to extract

Aim for **durable, recall-worthy facts**. The litmus test: would a
future conversation benefit from knowing this?

- ✅ `Anna's favourite teacher is Mr. Chen` (durable preference).
- ✅ `We decided to switch to weekly piano lessons starting June 2026`
  (durable decision with a date).
- ✅ `Anna gets overwhelmed in crowds of 20+ people` (durable trait).
- ❌ `Anna had pasta tonight` (ephemeral — unless flagged as part of a
  pattern).
- ❌ `Anna seemed happy today` (vague, not falsifiable).
- ❌ `The user said "great"` (conversation noise).

## Phase 3 — Resolve against existing entries

Load the scope's `INDEX.md` and any entries it points to that share
tags with a candidate. For each candidate, decide ADD / UPDATE /
DELETE / NOOP:

```text
For each candidate C:
  matches = entries E where overlap(E.tags, C.tags) >= 1
  if matches is empty:
    C.op = ADD
  else:
    best = the most specific match in `matches`
    if C says the same thing as best:
      C.op = NOOP
    else if C augments or refines best:
      C.op = UPDATE  (target: best.id)
    else if C contradicts best and supersedes it:
      C.op = DELETE  (target: best.id)
      and a follow-up C' = ADD
```

### Comparison rule

Two statements "say the same thing" if a human reader would consider
them substitutable in a future conversation. When in doubt, default to
UPDATE — never silently NOOP a refinement.

### Multi-match handling

If a candidate matches two or more existing entries equally, list all
matches in the preview and let the user pick the target. Do not pick
arbitrarily.

## Phase 4 — Consent preview

Render the full plan as one markdown block:

```text
Scope: parenting (home)

Plan:
 [ADD]    preference  — Anna prefers watercolour over acrylic for art
 [UPDATE] procedural  — When Anna is overwhelmed, give her quiet time
                         (target: 2026-04-02-anna-overwhelm-strategy.md)
 [NOOP]   episodic    — Bedtime routine started 2026-05-12 (already recorded)

Reply 'yes' to apply, 'edit' to change tags, or 'cancel'.
```

Block until the user replies. If the user passed `--auto`, skip the
prompt but still print the plan to the conversation so it appears in
the transcript.

### `--auto` rules

- Only honored if explicitly passed in `$ARGUMENTS`.
- Refuses any candidate with `confidence: low`.
- Refuses any candidate whose statement matches the privacy never-store
  list — even if the privacy pre-flight in Phase 1 missed it.

## Phase 5 — Write and audit

For each approved candidate:

### `ADD`

1. Generate the entry filename: `<YYYY-MM-DD>-<slug>.md` (date from
   `ts` field; slug from the first 5–7 lowercased words of the
   statement, joined with `-`).
2. If the filename already exists, append `-2`, `-3`, etc.
3. Write the entry file from
   [`../templates/memory-entry.md`](../templates/memory-entry.md),
   filling in frontmatter and body.
   When writing to a lesson scope, use
   [`../templates/lesson-entry.md`](../templates/lesson-entry.md) instead —
   see [Lesson-scope entries](#lesson-scope-entries).
4. Add one line to `INDEX.md` under the appropriate section.

### `UPDATE`

1. Read the target entry file.
2. Update its body. Set `updated:` in the frontmatter to now.
3. An UPDATE to an entry that carries a `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.
4. If the new content materially supersedes the old, append a brief
   `## History` block to the entry body with the prior wording and a
   timestamp. Never silently overwrite history.
5. Update the corresponding INDEX line if the summary changed.

### `DELETE`

1. Move the target entry file from `entries/` to `archive/`.
2. Remove the corresponding INDEX line.
3. Do not delete from `archive/`. Audit retention is non-negotiable.

### `NOOP`

Do nothing. Do not bump timestamps. Do not log to AUDIT.log.

### AUDIT.log

Append one NDJSON line. Required fields: `ts`, `op:"write"`, `scope`,
`added`, `updated`, `deleted`, `actor`, `auto`. Example:

```json
{"ts":"2026-05-15T10:23:00Z","op":"write","scope":"parenting","added":2,"updated":1,"deleted":0,"actor":"user","auto":false}
```

### INDEX hygiene

After every write, verify `INDEX.md` is still ≤ 200 lines. If it is
not, surface a one-line warning:

```text
INDEX is now 207 lines — `/persistent-memory consolidate parenting` is overdue.
```

## Lesson-scope entries

A **lesson scope** is a scope consumed by a host skill's self-improvement loop (for example the per-user `aw-lessons`, `aw-tester-lessons`, `fix-bug-lessons`, `batch-lessons`, and `reviewer-lessons` scopes under `~/.agent-memory/`).
Entries written to a lesson scope use the extended template at [`../templates/lesson-entry.md`](../templates/lesson-entry.md), not the base entry template.
Five frontmatter fields are **mandatory** on every lesson-scope entry:

| Field             | Purpose                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `phase`           | The host-skill phase the lesson applies to.                                                            |
| `trigger-context` | A concrete matching signal (file glob, task type, tech) — never a subjective condition.                |
| `seen_count`      | Recurrence counter; starts at 1 on ADD, incremented by every UPDATE (the promotion-gate signal).      |
| `status`          | `active` \| `promoted` \| `retired` \| `structural`.                                                  |
| `expires`         | ISO 8601 expiry; default created + 90 days, refreshed on each re-sighting.                             |

This schema is the contract shared with the host-skill loops — see
[`autonomous-workflow/rules/self-improvement-loop.md`](../../../workflow/autonomous-workflow/rules/self-improvement-loop.md).
A write to a lesson scope that omits any of the five fields is a defect; do not persist it.

## Concurrent writers

Shared lesson scopes can be written by parallel agents (for example fan-out executors that all inherit the lesson-write step), so writes must assume a concurrent writer exists.

- **Entry files are safe.** ADD only creates new files (the filename-collision rule appends `-2`, `-3`, …), so concurrent entry writes cannot clobber each other.
- **`INDEX.md` and `AUDIT.log` are read-modify-write hazards.** A writer MUST re-read `INDEX.md` immediately before writing, apply its change to that fresh copy, and re-check the file after the write; if the post-write content does not contain the change, re-read and re-apply. `AUDIT.log` is append-only — never rewrite it in place.
- **Orchestrators serialize.** An orchestrator that fans out parallel workers must not let workers write lesson scopes directly: executors return lesson candidates, and the orchestrator writes serially. This pipeline expects exactly one writer per scope at a time.

## Edge cases

- **No conversation context** (the user typed `/persistent-memory write
  parenting "Anna's favourite colour is teal"`): treat the trailing
  string as a single candidate with `source: user-stated`, `confidence:
  high`. Skip extraction; go straight to Phase 3.
- **Conflicting candidates within one batch** (e.g. two candidates
  contradict each other): surface both in the preview, let the user
  pick or merge before applying.
- **First write to a scope**: there are no existing entries. Every
  candidate is `ADD`. Create the directory, write a fresh `INDEX.md`
  using the template, and append the entries.
