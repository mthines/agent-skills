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

## Contents

- Discovery anti-patterns (A1–A4)
- Structure anti-patterns (S1–S6)
- Content anti-patterns (C1–C7)
- Behaviour anti-patterns (B1–B6)
- Quick triage

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

The Skills API rejects a `name` containing `claude` or `anthropic` anywhere in
the string; the validator FAILs this under `--portable` and warns otherwise.
Use a domain-specific name for a skill meant to be uploaded.

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

### S5 — Claude-Code-only fields in a portable skill

```yaml
# Bad — for a skill meant to run on the Skills API / claude.ai upload
name: my-skill
description: ...
disable-model-invocation: true
context: fork
```

**Why bad:** the portability profile accepts exactly six fields (`name`,
`description`, `license`, `compatibility`, `metadata`, `allowed-tools`).
Every other field — `disable-model-invocation`, `context`, `paths`,
`hooks`, and the rest — is a hard error there
(`Unexpected key(s) in SKILL.md frontmatter`).

**Fix:** decide the target runtime up front (`rules/frontmatter.md` §
Portability profile) and validate with
`node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> --portable`
before shipping a skill meant to run outside Claude Code.

### S6 — `synced` as a folder name

```text
# Bad
skills/my-category/synced/SKILL.md
```

**Why bad:** `synced` (any capitalisation) is reserved — Claude Code syncs
the skills enabled on a claude.ai account into `~/.claude/skills/synced/`,
so a skill folder with that name collides with the sync location and does
not resolve the way a normal skill directory does.

**Fix:** pick a domain-specific directory name, same as for the `name`
field itself (see A3).

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

### C7 — `: ` in an unquoted YAML scalar

```yaml
# Bad
description: Reviews PRs: correctness, tests, and style.
```

**Why bad:** an unquoted plain scalar containing `: ` is ambiguous YAML —
some parsers read it as a nested mapping key rather than a colon inside
the text, and this repo's own L1 check (`F2`) fails the frontmatter block
outright on it.

```yaml
# Good
description: >
  Reviews PRs for correctness, tests, and style.
```

**Fix:** rephrase to avoid the colon, or quote the whole scalar
(`"Reviews PRs: correctness, tests, and style."`).

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

````markdown
# Bad
Use the pdf library to process the file.

# Good
Install: pip install pypdf

Use:
```python
from pypdf import PdfReader
reader = PdfReader("file.pdf")
```
````

### B5 — All-caps MUST/NEVER as the only lever

```markdown
# Bad
You MUST NEVER skip the validation step. ALWAYS run it FIRST.
```

**Why bad:** all-caps emphasis is a yellow flag, not a fix — it signals
the author is compensating for an unclear rule with volume instead of
clarity, and it does not scale (the next rule needs to shout louder).

```markdown
# Good
Run the validator before declaring the skill done. Skipping it has
shipped skills with a dangling link in production twice; treat "no time"
as a reason to shrink the skill, not to skip the check.
```

**Fix:** explain the *why* so the agent has a reason to comply beyond
volume. Reserve escalated wording (bold, a repeated warning) for a rule
that has demonstrably been skipped before — after an observed failure,
not pre-emptively.

### B6 — Overfitting to the test prompts

A skill whose instructions were tuned only against the exact prompts used
to build it (see `evaluation.md` § Generalize, don't overfit).

**Why bad:** the skill looks finished because it passes its own test
suite, then fails the first real request phrased differently.

**Fix:** validate against at least one held-out prompt that was not used
during iteration before declaring the skill done.

## Quick triage

When reviewing a skill, run the mechanical pre-pass first:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <dir> [--portable]
```

Then scan for what the validator cannot check:

1. Does the `description` state both **what** and **when**, with triggers
   that are not just the skill's own name?
2. Are there time-sensitive claims, mega-scope statements, or
   throat-clearing prose?
3. Is each rule file self-contained — loadable in isolation?
4. Does every actionable rule pair a good and a bad example?
5. Are there all-caps MUST/NEVER rules that could instead explain the why?

If the validator reports any FAIL, fix that before looking at content.
