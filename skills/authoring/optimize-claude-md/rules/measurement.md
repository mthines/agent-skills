---
title: Measurement — Chars, Tokens, Lines, Sections
impact: HIGH
tags:
  - measurement
  - tokens
  - bash
---

# Measurement

Capture quantitative metrics on the target file before any analysis. Every recommendation must cite numbers.

## Top-level metrics

Use `Bash` to capture the file totals first:

```bash
TARGET="${1:-./CLAUDE.md}"
wc -c "$TARGET"   # total chars
wc -l "$TARGET"   # total lines
```

Convert chars to approximate tokens at the **4 chars / token** ratio (Anthropic's published guidance for English prose; close enough for budgeting):

```
tokens ≈ chars / 4
```

Threshold reminders:

| Metric                         | Threshold        | Source                                       |
| ------------------------------ | ---------------- | -------------------------------------------- |
| Performance warning (Claude Code) | 40,000 chars   | Claude Code session-start warning            |
| Approx tokens at warning       | ~10,000 tokens   | `40,000 / 4`                                 |
| Compaction slice per skill     | 5,000 tokens     | `create-skill`'s `token-economics.md`        |
| Compaction combined budget     | 25,000 tokens    | `create-skill`'s `token-economics.md`        |

## Per-section metrics (H2 buckets)

Split the file into H2 (`## `) sections and measure each. Use this shell pattern:

```bash
awk '
  /^## / {
    if (section) printf "%6d  %s\n", chars, section
    section = $0; chars = length($0) + 1
    next
  }
  { chars += length($0) + 1 }
  END { if (section) printf "%6d  %s\n", chars, section }
' "$TARGET" | sort -rn
```

Report the top-5 sections by char count.

## Per-entry metrics (bullet lists)

Inventory entries are the usual offender. Match list items that start `- ` (or `- \``) and measure each:

```bash
awk '/^- / { printf "%6d  %s\n", length($0), $0 }' "$TARGET" | sort -rn | head -20
```

Variation for skill/agent inventories where the name is the first backtick token:

```bash
awk '/^- `/ {
  match($0, /`[^`]+`/)
  name = substr($0, RSTART+1, RLENGTH-2)
  printf "%6d  %s\n", length($0), name
}' "$TARGET" | sort -rn | head -20
```

## Companion file scan

`CLAUDE.md` rarely lives alone. Detect siblings that the harness also loads or links:

```bash
fd -t f 'CLAUDE\.md|AGENTS\.md' --max-depth 4 .
fd -t f '\.md$' .claude/rules 2>/dev/null
```

For each, capture `wc -c` and add to the report. Nested `CLAUDE.md` files that duplicate root content are a frequent finding.

## Frontmatter-vs-inventory duplication check

For repos that own skills (`skills/<name>/SKILL.md`):

1. For each H2 inventory section in `CLAUDE.md`, extract entry names (e.g. `\`fix-bug\``).
2. For each matched skill, read `skills/<name>/SKILL.md` frontmatter `description`.
3. If the inventory entry has > 70% lexical overlap with the description (rough heuristic — measure by shared 5-grams or shared sentences), flag it as **redundant with frontmatter**.

This is the #1 win: the harness already preloads the description, so the long inventory paragraph pays twice.

## Output of Phase 1

Persist measurement results inline as a markdown table:

```markdown
## Measurement

| Metric             | Value                  |
| ------------------ | ---------------------- |
| Total chars        | 43,012                 |
| Approx tokens      | ~10,753                |
| Total lines        | 232                    |
| Threshold breach   | yes (warning fires)    |
| Section count (H2) | 7                      |
| Top section        | "Repository Structure" (35,802 chars) |
| Top entry          | `fix-bug` (3,582 chars) |
| Sibling files      | 0                      |
```

That table is the foundation for Phase 2 classification.
