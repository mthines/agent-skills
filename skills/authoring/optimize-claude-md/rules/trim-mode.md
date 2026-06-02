---
title: Trim Mode — Interactive Per-Offender Shortening
impact: HIGH
tags:
  - trim
  - interactive
  - diff
  - approval
---

# Trim Mode

Walks the top-N offenders from Phase 1, proposes a shortened replacement (one-line hook + link), shows the diff, and applies on user approval. Preserves content by always linking to the canonical source.

## Procedure

1. Run Phases 1 + 2 silently (no audit report printed — go straight to walking).
2. Sort entries by char count, descending. Process up to **N = 20** by default, or the count the user passed.
3. For each entry, follow the per-entry loop below.
4. After the last entry (or `skip-rest`), emit the preservation receipt from [`hard-rules.md`](./hard-rules.md).

## Per-entry loop

For each offender:

1. **Locate** the entry. Capture the exact text + line number.
2. **Identify the canonical source**. For inventory entries that name a skill or agent in the first backticks, the source is `skills/<name>/SKILL.md` or `agents/<name>.md` (or `.md`).
3. **Build the proposed replacement**. Format:

   ```markdown
   - `<name>` — <one-line purpose ≤ 150 chars>. See [`<path-to-canonical>`](./<path>).
   ```

   Guidelines for the one-line purpose:
   - Re-use the first sentence of the canonical `description:` frontmatter, **truncated at the first period**.
   - If that sentence is > 150 chars, summarize in your own words but keep it third-person and prescriptive.
   - **Never copy verbose internal jargon** (research citations, internal acronyms, sub-phase numbers). The canonical source carries that.

4. **Show the diff**. Use this format:

   ```
   ────────────────────────────────────────────────────────
   Entry: `fix-bug`           Line: 59
   Before: 3,582 chars / ~895 tokens
   After:    142 chars / ~35 tokens
   Saved:  3,440 chars / ~860 tokens (96%)
   ────────────────────────────────────────────────────────

   - BEFORE:
   - `fix-bug` — Single-bug counterpart to `batch-linear-tickets`. v2.1
     ships an intake → complexity triage → evidence → preflight … [3,582 chars]

   + AFTER:
   + `fix-bug` — Single-bug pipeline: intake → triage → repro → analyse →
   +   gate → handoff → verify. See [`skills/fix-bug/SKILL.md`](./skills/fix-bug/SKILL.md).
   ```

5. **Ask for approval**. Exact prompt:

   ```
   Apply this trim? [y]es / [n]o / [e]dit / [s]kip-rest
   ```

   - `y` → apply via `Edit`, increment counter, continue.
   - `n` → leave entry untouched, continue.
   - `e` → ask the user for their preferred one-liner, validate ≤ 150 chars, repeat from step 4.
   - `s` → stop the loop, emit the partial preservation receipt.

6. **Verify the diff applied cleanly**. If `Edit` errors (non-unique match), back off — read the surrounding context with `Read` and retry with a longer `old_string`.

## What to trim and what to leave

Trim if all of these hold:

- Entry is ≥ 500 chars.
- Entry is classified `cold-path` (per [`classification.md`](./classification.md)).
- A canonical source exists and is reachable from the trimmed entry's link.

Leave if any of these hold:

- Entry is `hot-path` (project commands, hard invariants, file pointers).
- Entry is < 500 chars (probably already terse).
- No canonical source can be linked. **Fall back to `audit` recommendation.**

## Examples

### Good — preserves info via link

```markdown
- `animations` — CSS-first web-animation slash command. Brainstorm + perceived-performance + technical workflow modes. See [`skills/animations/SKILL.md`](./skills/animations/SKILL.md).
```

### Bad — strips info without a link

```markdown
- `animations` — Web animation skill.
```

The user can't get back to the full description. Always link.

### Bad — edits the canonical SKILL.md description

This is forbidden by [`hard-rules.md`](./hard-rules.md). Never modify a skill's own `description:` frontmatter from this skill. If the description itself needs shortening, route the user to `/create-skill review <skill-name>`.

## Common mistakes

- **Removing the trailing link.** The one-line hook without the link breaks discoverability. **Fix:** template includes the link.
- **Truncating mid-sentence.** "Single-bug pipeline. Intake → triage → repro → ana" — fix: truncate at a period or summarize.
- **Editing multiple entries in one `Edit` call.** Match failures cascade. **Fix:** one `Edit` per entry.
- **Skipping the user-approval gate to save time.** The gate is non-negotiable per [`hard-rules.md`](./hard-rules.md). **Fix:** always ask.
- **Forgetting to print the per-entry savings.** Required by [`hard-rules.md`](./hard-rules.md). **Fix:** print before/after on every entry.
