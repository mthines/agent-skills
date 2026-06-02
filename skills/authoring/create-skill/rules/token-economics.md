---
title: Token Economics — Conciseness as a Feature
impact: HIGH
tags:
  - tokens
  - context
  - performance
  - conciseness
---

# Token Economics

The context window is a public good. Your skill shares it with the system
prompt, conversation history, every other skill's metadata, and the user's
actual request. Every token is a recurring cost — once `SKILL.md` is loaded,
it stays in context for the rest of the session and through compaction
(re-attached at the cost of a 5,000-token slice per skill, sharing a
25,000-token combined budget).

## The default assumption

> **Claude is already very smart.** Add only what Claude does not already
> have.

Challenge each line:

- Does Claude really need this explanation?
- Can I assume Claude knows this concept?
- Does this paragraph justify its token cost?

## Concrete budgets

| File                         | Soft target | Hard cap        |
| ---------------------------- | ----------- | --------------- |
| `description`                | ~600 chars  | 1024 chars      |
| `SKILL.md` body              | ~250 lines  | 500 lines       |
| Each rule in `rules/`        | ~150 lines  | 400 lines       |
| Each reference file          | (no cap)    | TOC mandatory > 100 lines |
| Total skill on disk          | (no cap)    | n/a             |

`references/` and `templates/` cost nothing until read, so they can be
verbose. `SKILL.md` and `rules/` are the expensive surfaces.

## Concise vs verbose — worked example

### Verbose (≈ 150 tokens)

```markdown
## Extract PDF text

PDF (Portable Document Format) files are a common file format that contains
text, images, and other content. To extract text from a PDF, you'll need
to use a library. There are many libraries available for PDF processing,
but pdfplumber is recommended because it's easy to use and handles most
cases well. First, you'll need to install it using pip. Then you can use
the code below.
```

### Concise (≈ 50 tokens)

````markdown
## Extract PDF text

Use pdfplumber:

```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
````

The concise version assumes Claude knows what PDFs are, what libraries are,
and what `pip install` does. **All of those assumptions are correct.**

## Habits to remove

- **Throat-clearing.** "It's important to note that …", "As you may know,
  …", "Let me explain …".
- **Definitions of common terms.** No need to explain what a PR, a test, a
  Git branch, or a TypeScript interface is.
- **Restating the obvious.** "When the user asks you to do X, you should do
  X." The trigger phrase already says that.
- **Rationale before instruction.** Lead with the rule. Add a one-line
  `Why:` only when the reason changes the agent's edge-case behavior.
- **Examples for self-evident rules.** "Use kebab-case for file names — for
  example, `my-file.md`." The example adds nothing.

## Habits to keep

- **Decision tables.** A 6-row table beats 3 paragraphs.
- **Numbered steps.** Sequence is easier to follow than prose.
- **One-line `Why:`** when an edge case might tempt the agent to deviate.
- **Code over prose.** A 5-line code block often replaces a paragraph.
- **Front-loaded rules.** State the rule, then optionally a counter-example.

## Lifecycle and compaction

Auto-compaction re-attaches the **most recent invocation** of each skill
after summarising older conversation, capped at 5,000 tokens per skill and
25,000 tokens combined. Implications:

- Older invocations of the same skill are dropped — re-invoke the skill if
  you need the full text after a long session.
- A bloated `SKILL.md` consumes its 5,000-token slice on every re-attach,
  pushing other skills out.
- A lean `SKILL.md` plus on-demand rules survives compaction with minimal
  loss because rule content is loaded fresh from disk on the next read.

The cheapest skill is one with a tight `SKILL.md` and most knowledge in
`rules/`. Optimise for that shape.

## Measuring

Quick approximations:

| Metric                 | How to check                                    |
| ---------------------- | ----------------------------------------------- |
| `SKILL.md` line count  | `wc -l SKILL.md`                                |
| `description` length   | `wc -c <(yq '.description' SKILL.md)`           |
| Largest rule           | `wc -l rules/*.md \| sort -n \| tail`           |
| Longest paragraph      | Eyeball — anything > 6 lines is a smell         |

If `wc -l SKILL.md` ≥ 500, you have a structural problem. Split.
