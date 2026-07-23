---
title: Purge Pipeline — TTL-Based Hard Deletion of Archived Entries
impact: HIGH
tags:
  - purge
  - ttl
  - auto-delete
  - archive
  - privacy
---

# Purge Pipeline

## Contents

- [Purpose](#purpose)
- [Retention tiers](#retention-tiers)
- [Resolving the target scope](#resolving-the-target-scope)
- [Phase 0 — Scan archive](#phase-0--scan-archive)
- [Phase 1 — Classify candidates](#phase-1--classify-candidates)
- [Phase 2 — Consent preview](#phase-2--consent-preview)
- [Phase 3 — Hard delete + audit](#phase-3--hard-delete--audit)
- [GDPR override](#gdpr-override)
- [Never do](#never-do)

## Purpose

Archived entries in `archive/` are soft-deleted: they are not returned
by `read` but they do persist on disk.
The purge pipeline permanently removes archived entries that have exceeded
their retention window, freeing storage and honouring implicit privacy
expectations.

Purge is not a replacement for `forget --hard-delete`.
Purge is a scheduled or manual sweep that cleans up the accumulated
`archive/` backlog based on **how long an entry has been archived**, not
on user intent to remove a specific item.

## Retention tiers

The default retention window is **30 days** from `archived_at`.
All thresholds below are measured from the `archived_at` frontmatter field
written by the forget and consolidate pipelines — not from `created`.

| Tier label   | Days before purge | Who sets it                  |
| ------------ | ----------------- | ---------------------------- |
| `short`      | 7 days            | Free / minimal installs      |
| `standard`   | 30 days (default) | Default for all scopes       |
| `extended`   | 90 days           | Set per scope in `INDEX.md`  |
| `keep`       | Never auto-purge  | Set per scope in `INDEX.md`  |

Encode the retention tier in the scope's `INDEX.md` front-matter block
(the comment block at the top):

```markdown
<!-- purge-retention: extended -->
```

If the front-matter block is absent or the key is missing, treat the
scope as `standard` (30 days).

The retention tier applies to all archived entries in the scope.
It cannot be set per-entry after the entry is archived.

## Resolving the target scope

The user may invoke purge in three ways:

1. **One scope** — `/persistent-memory purge <scope>`.
2. **All scopes** — `/persistent-memory purge --all`.
3. **Dry-run** — append `--dry-run` to either form; prints the candidate
   list without deleting anything.

For (1), resolve the scope and tier exactly as in
[`storage-layout.md`](./storage-layout.md).
For (2), walk every scope directory in every tier root that exists and
run the pipeline for each.
For (3), complete Phases 0 and 1, print the candidate list, and stop.
Write nothing — not even an AUDIT.log line — on a dry run.

## Phase 0 — Scan archive

List every file in `archive/` for the target scope.
For each file, read its frontmatter and extract `archived_at`.

If a file has no `archived_at` field:

- Treat `archived_at` as `updated` (the last write timestamp before
  archiving).
- If `updated` is also absent, treat `archived_at` as `created`.
- If all three are absent, treat the file as **not eligible** for this
  run and warn the user:
  ```text
  Warning: archive/2025-10-01-some-entry.md has no datestamp — skipping.
  ```

## Phase 1 — Classify candidates

Compute `days_archived = today − archived_at` for each file.
Determine the scope's retention threshold from its `INDEX.md` front-matter.

| Result    | Condition                                          |
| --------- | -------------------------------------------------- |
| `PURGE`   | `days_archived ≥ retention_threshold` and tier ≠ `keep` |
| `KEEP`    | `days_archived < retention_threshold`              |
| `EXEMPT`  | Scope tier is `keep`                               |
| `SKIP`    | No usable datestamp (see Phase 0)                  |

Entries tagged `PURGE` are the deletion candidates for Phase 2.

If no candidates are tagged `PURGE`, print:

```text
No archived entries in <scope> have exceeded their retention window
(threshold: <N> days, oldest archived: <date>).
```

And stop. Do not write an AUDIT.log line.

## Phase 2 — Consent preview

Show the user every entry tagged `PURGE` with its slug and `archived_at`
date before touching any file:

```text
Purge candidates for scope `parenting` (home) — threshold: 30 days

  archive/2026-01-10-old-school-pickup-time.md  (archived 2026-03-12, 42 days ago)
  archive/2026-02-01-grandparents-visited.md    (archived 2026-03-01, 53 days ago)

These entries will be permanently deleted (unrecoverable).
Type 'yes' to proceed or 'cancel' to abort.
```

Block until the user replies.
Accept "yes", "sure", "ok", "go" as affirmative.
Any other reply cancels without deleting.

Skip the consent gate only when the `--auto` flag is passed.
Only omit `--auto` when the caller is an automated scheduled sweep that
the user has already configured (e.g. a cron job they explicitly set up).

## Phase 3 — Hard delete + audit

For each approved `PURGE` candidate, in order:

1. `rm archive/<file>.md`.
2. Append one NDJSON line to `AUDIT.log`:

```json
{"ts":"2026-06-01T08:00:00Z","op":"purge","scope":"parenting","ids":["2026-01-10-old-school-pickup-time","2026-02-01-grandparents-visited"],"retention_days":30}
```

Required fields: `ts`, `op` (`purge`), `scope`, `ids` (array of slugs
without `.md`), `retention_days`.

After all deletions, print a summary:

```text
Purged 2 archived entries from `parenting` (home).
AUDIT.log updated.
```

## GDPR override

When the user states they are exercising a right-to-erasure request
(e.g. "please purge everything about Sarah, she left the company"),
bypass the retention window entirely: mark all matching archived entries
`PURGE` regardless of `days_archived`.

Issue the standard consent preview and proceed as normal on approval.

Warn the user that:

- `AUDIT.log` still contains the purged entry IDs (slugs), which may
  themselves be identifying.
- If the scope is `project-shared`, git history retains the file; to
  purge history, the user must run `git filter-repo` manually.

## Never do

- Never delete an entry from `archive/` without an AUDIT.log line.
- Never delete `entries/` files — only `archive/` files.
  Active entries must go through `forget` first.
- Never run without a consent preview unless `--auto` is explicit.
- Never skip the GDPR warnings when the user mentions a third party's
  right to be forgotten.
- Never compact or rewrite `AUDIT.log` — only append.
