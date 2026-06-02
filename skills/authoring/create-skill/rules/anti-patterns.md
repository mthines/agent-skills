---
title: Anti-Patterns — Common Skill-Writing Mistakes
impact: HIGH
tags:
  - anti-patterns
  - mistakes
  - quality
---

# Anti-Patterns

A field guide to mistakes that make skills unreliable, expensive, or hard
to maintain. Each entry shows the bad pattern, why it's bad, and the fix.

## Discovery anti-patterns

### A1 — Vague description

```yaml
# Bad
description: Helps with documents
```

```yaml
# Good
description: >
  Extracts text and tables from PDF files, fills forms, and merges
  documents. Use when working with PDFs, forms, or document extraction.
  Triggers on "extract from PDF", "fill PDF form", "/pdf-tools".
```

**Why bad:** Claude has nothing to match against. The skill never triggers,
or triggers on the wrong tasks.

### A2 — First-person voice

```yaml
# Bad
description: I can help you process Excel files.
```

```yaml
# Good
description: >
  Processes Excel files: pivots, charts, data summaries.
```

**Why bad:** The description is injected into the system prompt. First-
or second-person ("I", "you") confuses point-of-view and degrades discovery.

### A3 — Reserved words in `name`

```yaml
# Bad
name: claude-helper
```

The frontmatter validator rejects `claude` and `anthropic` in the `name`.
Use a domain-specific name instead.

### A4 — Missing trigger phrases

```yaml
# Bad
description: Reviews PRs.
```

```yaml
# Good
description: >
  Reviews PRs for quality, correctness, and tests. Triggers on
  "review PR", "audit changes", "/review-changes".
```

**Why bad:** Without explicit triggers, Claude has to infer when to load
the skill from a sparse signal. Inference is inconsistent across model
sizes.

## Structure anti-patterns

### S1 — Mega-skill

A single skill that "does everything related to code reviews and
refactoring and testing".

**Why bad:** Lower accuracy, harder to compose, larger context cost. One
skill, one job.

**Fix:** Split into focused skills (`code-quality`, `review-changes`,
`tdd`) and compose with `Skill()` calls.

### S2 — Deeply nested references

```text
SKILL.md → advanced.md → details.md → really-here.md
```

**Why bad:** Claude partial-reads files reached via multiple hops (`head
-100` etc.). Information is silently lost.

**Fix:** Link every important file directly from `SKILL.md`. Keep
references one level deep.

### S3 — `SKILL.md` over the cap

A 700-line `SKILL.md`.

**Why bad:** Once loaded, it stays in context for the whole session and
costs 5,000 tokens after compaction. Pushes other skills out.

**Fix:** Split into `rules/` and link from a thin index. See
`structure-decision.md`.

### S4 — Long reference file with no TOC

A 400-line `reference.md` with no table of contents.

**Why bad:** When Claude previews via `head`, it sees only the first ~100
lines and concludes the file is incomplete or off-topic.

**Fix:** Add a `## Contents` table at the top.

## Content anti-patterns

### C1 — Throat-clearing prose

```markdown
# Bad
It's important to understand that when working with code, you should always
make sure to consider the context and think carefully about the implications
of any changes you make to the codebase.

# Good
Read the function and its callers before editing.
```

**Why bad:** Pure tokens, zero information. Claude already knows to think
carefully.

### C2 — Defining what Claude already knows

```markdown
# Bad
A pull request (PR) is a way to propose changes to a repository.

# Good
(omit — Claude knows what a PR is)
```

### C3 — Time-sensitive claims

```markdown
# Bad
If you're doing this before August 2025, use the v1 API. After August
2025, use the v2 API.

# Good
Use the v2 API:
api.example.com/v2/messages

(Optional collapsed details for legacy info.)
```

**Why bad:** Goes stale. Claude can't tell what year it is reliably from
the skill alone.

### C4 — Inconsistent terminology

Mixing "API endpoint", "URL", "API route", "path" inside a single skill.

**Why bad:** Claude has to figure out whether they mean the same thing.
Pick one term and stick with it.

### C5 — Voodoo constants

```python
TIMEOUT = 47
RETRIES = 5
```

**Why bad:** No reader can decide whether to change them.

**Fix:**
```python
# 30s covers the slow-network tail; 47 was chosen empirically after a
# noisy CI run added 17s of overhead.
TIMEOUT = 47

# 3 retries clears most intermittent failures; 5 covers chained
# dependencies that retry independently.
RETRIES = 5
```

### C6 — "Punt to the model" scripts

```python
def process_file(path):
    return open(path).read()  # let Claude figure out errors
```

**Why bad:** Forces Claude to handle errors at the orchestration layer
where it has less context than the script.

**Fix:** Handle errors explicitly inside the script with helpful messages.

## Behaviour anti-patterns

### B1 — Too many options offered

```markdown
# Bad
You can use pypdf, or pdfplumber, or PyMuPDF, or pdf2image, or...

# Good
Use pdfplumber for text extraction.
For scanned PDFs, use pdf2image with pytesseract.
```

**Why bad:** Decision paralysis. Claude picks inconsistently across
sessions.

**Fix:** Pick a default; offer a single named escape hatch.

### B2 — Wrong degree of freedom

A migration script written as "use whatever flags seem reasonable".

**Why bad:** Migrations are fragile. Variable behavior is unsafe.

**Fix:** Low-freedom prescription:
```bash
python scripts/migrate.py --verify --backup
```

The opposite (`code review process`) should be high-freedom prose, not a
rigid script.

### B3 — Backslash paths

```markdown
# Bad
See scripts\helper.py

# Good
See scripts/helper.py
```

**Why bad:** Breaks on Unix. Forward slashes work everywhere.

### B4 — Assuming installed tooling

```markdown
# Bad
Use the pdf library to process the file.

# Good
Install: pip install pypdf

Use:
```python
from pypdf import PdfReader
reader = PdfReader("file.pdf")
```
```

## Quick triage

When reviewing a skill, scan for these in order:

1. Is the `description` third-person, ≤ 1024 chars, with explicit triggers?
2. Is `SKILL.md` ≤ 500 lines?
3. Are references one level deep from `SKILL.md`?
4. Is every reference > 100 lines TOC-ed?
5. Are there time-sensitive claims, mega-scope statements, or
   throat-clearing prose?
6. Are paths forward-slash?

If any of those are `no`, fix that before looking at content.
