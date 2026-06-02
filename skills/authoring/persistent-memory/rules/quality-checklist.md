---
title: Quality Checklist — Pre-write Self-check
impact: HIGH
tags:
  - quality
  - checklist
---

# Quality Checklist

Run before declaring a write, consolidate, or forget operation done.
Each `[ ]` is binary.

## Write

- [ ] Scope name validates against `^[a-z0-9][a-z0-9-]{0,63}$`.
- [ ] Storage tier was confirmed (default `home` shown explicitly).
- [ ] Privacy pre-flight ran and never-store refusals were surfaced.
- [ ] Every candidate has type, confidence, tags, source.
- [ ] No `confidence: low` candidate persisted without `--allow-low`.
- [ ] Each candidate tagged exactly one of ADD / UPDATE / DELETE / NOOP.
- [ ] User saw the consent preview (or `--auto` was explicit).
- [ ] INDEX.md still ≤ 200 lines; otherwise consolidate warning printed.
- [ ] AUDIT.log appended with one NDJSON line.
- [ ] Final user-facing summary states scope, tier, and counts.

## Read

- [ ] Scope resolved against all three tiers; tier reported to user.
- [ ] INDEX surfaced verbatim, not summarized.
- [ ] Detail entries fetched only when explicitly referenced.
- [ ] No write occurred during the read.

## Consolidate

- [ ] Pre-consolidation snapshot captured (INDEX lines, entry count).
- [ ] Merge groups respect "all primary tags must match" rule.
- [ ] Stale-archive candidates are episodic-only.
- [ ] User saw the full merge + archive plan.
- [ ] User approved (no `--auto` shortcut for consolidate).
- [ ] INDEX rewritten and back under 200 lines.
- [ ] AUDIT.log appended with before / after counts.

## Forget

- [ ] Target resolved to a definite candidate list (no ambiguous query).
- [ ] Every candidate body shown verbatim before deletion.
- [ ] User typed an affirmative reply (`yes`, `sure`, `ok`).
- [ ] Mode (`--archive`, `--hard-delete`, `--redact`) was explicit;
      `--archive` is the default.
- [ ] `project-shared` hard-deletes triggered the git-history warning.
- [ ] AUDIT.log appended with mode and IDs.

## Frontmatter & file integrity

- [ ] Every entry file has YAML frontmatter with: `id`, `created`,
      `updated`, `type`, `scope`, `tags`, `confidence`, `source`.
- [ ] Filename pattern is `<YYYY-MM-DD>-<slug>.md`.
- [ ] Slug is unique within scope (`-2`, `-3` suffixes on collision).
- [ ] AUDIT.log is NDJSON, append-only, never rewritten.

## Voice and tone (matches repo convention)

- [ ] Imperative voice in workflow steps.
- [ ] Third-person in surfaced summaries.
- [ ] No emoji in entry bodies or INDEX (unless the user wrote them).
- [ ] Code fences declare a language identifier.

## Reporting

When a write completes, surface:

```text
Saved 2 new, 1 updated to parenting (home).
INDEX is now 87/200 lines.
```

When a read completes, surface:

```text
Loaded parenting (home) — 23 entries, INDEX 87/200 lines.
```

When a consolidate completes:

```text
Consolidated parenting (home).
INDEX: 247 → 138 lines.
Entries: 84 → 78 (6 archived).
```

When a forget completes:

```text
Forgot 3 entries from parenting (home) — archived.
INDEX is now 84/200 lines.
```
