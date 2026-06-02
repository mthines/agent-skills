---
title: Hard Rules — Refusal, Preservation, Authority
impact: HIGH
tags:
  - safety
  - preservation
  - refusal
---

# Hard Rules

Non-negotiable invariants for every run. Violating any of these is a defect — abort and report to the user.

## Refusal conditions

| Condition                                                | Action                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Target file < 10,000 chars                               | Refuse. Report "below benefit threshold — optimization not warranted". |
| Target file does not exist or unreadable                 | Refuse. Report path tried.                                            |
| Target is not a `CLAUDE.md`, `.claude/rules/*.md`, or explicitly passed by the user | Refuse. Confirm the target before any further work.                   |
| Mode is `trim` or `extract` and user denies the diff     | Skip that entry. Continue to next.                                    |
| Cannot determine a safe destination for `extract`        | Abort the extract. Fall back to `audit` recommendation.               |

## Preservation invariants

- **Never delete content silently.** Every `trim` shortens but keeps the link to the canonical source. Every `extract` moves content — verify it lands somewhere before removing it from `CLAUDE.md`.
- **Canonical source wins.** A skill's own `SKILL.md` `description:` frontmatter is the authority for that skill's description. **Never edit it from this skill.** If the user wants to change a skill's description, route them to `/create-skill review <skill-name>`.
- **No content loss across modes.** A `trim` that drops information beyond what's recoverable from the linked source is a bug. Always link to where the dropped detail lives.
- **Show before/after on every applied change.** Format:

  ```
  Trimmed `optimize-mock-data` entry: 2,191 → 142 chars (−93%, ~510 tokens saved)
  ```

- **No silent reflow.** If trimming requires renumbering or reordering, flag it.

## Authority boundaries

| Surface                                  | This skill may                                       | This skill may NOT                                    |
| ---------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Root `CLAUDE.md`                         | Trim, extract, rewrite inventory entries             | Delete sections without preserving the content        |
| Nested `<dir>/CLAUDE.md`                 | Same as above                                        | Same as above                                         |
| `.claude/rules/*.md`                     | Trim, extract, recommend merges                      | Delete a rule file without confirming with user       |
| `skills/<name>/SKILL.md` frontmatter     | Read for comparison; flag slash-conversion candidates | **Edit. Ever.** Route to `/create-skill review`.       |
| `docs/inventory.md` and similar          | Create, append to, link from `CLAUDE.md`             | Overwrite without showing the diff                    |

The frontmatter authority boundary covers **all** YAML fields, not just `description`. Edits to `disable-model-invocation`, `user-invocable`, `metadata.workflow_type`, and others must route through `/create-skill review` so the full review checklist runs (including the description-vs-purpose check and the symlink resync).

## User confirmation

For `trim` and `extract` modes, every applied change requires explicit user approval. The flow is:

1. Show the proposed diff (before + after).
2. Show the metrics (chars saved, approx tokens saved).
3. Ask: "Apply this change? `[y/n/skip-rest]`".
4. On `y`, apply via `Edit`. On `n`, skip and continue. On `skip-rest`, stop processing further entries and emit a partial report.

For `audit` mode, no user confirmation is needed — the report is read-only.

## Preservation receipt

When a run finishes, emit a one-block summary:

```
optimize-claude-md run summary
  Mode:           trim
  Target:         /repo/CLAUDE.md
  Before:         43,012 chars / ~10,753 tokens
  After:          18,440 chars / ~4,610 tokens
  Saved:          24,572 chars / ~6,143 tokens (57%)
  Entries changed: 14 (10 trimmed, 4 extracted)
  Entries skipped: 3 (user denied)
  Canonical sources untouched: yes
  Warning threshold (~40k chars): now below
```
