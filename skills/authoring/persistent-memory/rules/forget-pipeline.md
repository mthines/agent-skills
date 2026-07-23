---
title: Forget Pipeline — Delete, Redact, Audit
impact: HIGH
tags:
  - forget
  - delete
  - redact
  - privacy
---

# Forget Pipeline

## Contents

- [Resolving the target](#resolving-the-target)
- [Modes: hard delete vs redact vs archive](#modes-hard-delete-vs-redact-vs-archive)
- [Consent gate](#consent-gate)
- [Apply](#apply)
- [Bulk forgets](#bulk-forgets)
- [Right to be forgotten](#right-to-be-forgotten)
- [Never do](#never-do)

User-driven removal of memory. Forgetting is not a bug — it is required
for privacy, accuracy, and pruning entrenched mistakes. This pipeline is
strict about consent and audit.

## Resolving the target

The user can specify the target in three ways:

1. **By entry id** (filename without `.md`):
   `/persistent-memory forget parenting 2026-05-15-anna-loves-watercolour`
2. **By slug substring**:
   `/persistent-memory forget parenting "anna-loves-watercolour"`
3. **By natural-language query**:
   `/persistent-memory forget parenting "anything about Anna's old school"`

For (1) and (2), resolve exactly one file. If zero or more than one
matches, list candidates and ask the user to disambiguate.

For (3), grep the INDEX and entry frontmatter tags. Show the user a
candidate list before doing anything:

```text
Candidates for "anything about Anna's old school":
 [1] 2025-09-02-old-school-pickup-time.md
 [2] 2025-09-15-old-school-teacher-mr-park.md
 [3] 2026-01-04-school-change-decision.md

Reply with a comma-separated list of numbers to forget, or 'cancel'.
```

Block until the user replies.

## Modes: hard delete vs redact vs archive

| Mode             | Default | What happens                                                                       |
| ---------------- | ------- | ---------------------------------------------------------------------------------- |
| `--archive`      | **yes** | Entry moves to `archive/`. INDEX line removed. Audit ledger updated.               |
| `--hard-delete`  |         | Entry is `git rm`/`rm`-ed permanently. INDEX line removed. Audit ledger updated.   |
| `--redact`       |         | Entry stays in `entries/`, body replaced with `[REDACTED at <ts>]`, frontmatter `redacted: true`. |

Default to `--archive`. Hard delete only when the user passes the flag
explicitly — once gone, it is unrecoverable.

Redact is preferred over delete when the user wants the **shape** of
the memory (its existence and timestamp) preserved but the content
gone — useful for cases like "I told you something I shouldn't have,
remove the content but keep the slot so I remember to ask later."

## Consent gate

Always show the user the **full** content of every entry that will be
touched before doing it:

```text
About to forget 3 entries from parenting (home):

--- 2025-09-02-old-school-pickup-time.md ---
<full body>

--- 2025-09-15-old-school-teacher-mr-park.md ---
<full body>

--- 2026-01-04-school-change-decision.md ---
<full body>

Mode: --archive (default)

Type 'yes' to proceed, 'redact' to redact instead, 'delete' to hard-delete instead, or 'cancel'.
```

Wait for an explicit affirmative reply. Single-word "yes" is enough;
"sure", "ok", "go" are also accepted. A non-affirmative reply cancels.

## Apply

For each approved target:

### `--archive` (default)

1. Read the entry's frontmatter.
2. Append `archived_at: <ISO-8601 UTC timestamp of now>` to the frontmatter.
   If `archived_at` already exists (e.g. a re-archive), overwrite it.
3. Write the updated frontmatter back to the file.
4. `mv entries/<file>.md archive/<file>.md`.
5. Remove the corresponding INDEX line.
6. Append AUDIT.log line.

The `archived_at` field is the clock the purge pipeline uses to determine
when the entry is eligible for permanent deletion (see
[`purge-pipeline.md`](./purge-pipeline.md)).

### `--hard-delete`

1. `rm entries/<file>.md`.
2. Remove the corresponding INDEX line.
3. Append AUDIT.log line.

If the scope is on `project-shared` tier (committed to git), warn the
user:

```text
This scope is in version control. A hard delete removes the file from
the working tree but NOT from git history. To purge history, run
`git filter-repo` or `git filter-branch`. Continue with hard delete? (yes/no)
```

### `--redact`

1. Rewrite the entry file: keep frontmatter, set `redacted: true`,
   `updated:` to now, replace body with `[REDACTED at <ts>]`.
2. Rewrite the corresponding INDEX line to read
   `[redacted] <yyyy-mm-dd>`.
3. Append AUDIT.log line.

### AUDIT.log

One NDJSON line:

```json
{"ts":"2026-05-15T10:23:00Z","op":"forget","scope":"parenting","mode":"archive","ids":["2025-09-02-old-school-pickup-time","2025-09-15-old-school-teacher-mr-park"]}
```

## Bulk forgets

`/persistent-memory forget <scope> --all` is supported but requires a
double confirmation: first the candidate list, then a second prompt
asking the user to type the scope name verbatim.

## Right to be forgotten

If the user is exercising a third party's right to be forgotten (e.g.
"please forget everything about my colleague Sarah who left the
company"), prefer `--hard-delete` AND warn that:

- Git history (if `project-shared`) is not affected.
- The audit ledger still references the entry IDs (but not their
  content — IDs use slugs, which may themselves identify a person).

If identification leaks through entry IDs, recommend renaming the slug
before the audit line is written. This is a manual step; flag it.

## Never do

- Never forget an entry without showing its contents first.
- Never bulk-forget on a natural-language query without a candidate
  list.
- Never modify or delete `AUDIT.log` — only append.
- Never hard-delete from `project-shared` without warning about git
  history.
