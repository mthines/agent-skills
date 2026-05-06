---
title: Description Writing — Anatomy and Triggers
impact: HIGH
tags:
  - description
  - discovery
  - triggers
---

# Description Writing

The `description` field is the single most important piece of metadata.
Claude uses it to choose between potentially hundreds of skills. The
combined `description` + `when_to_use` is truncated at **1,536 characters**
in the skill listing — front-load the important parts.

## Anatomy

A good description has three parts in this order:

1. **What it does** — third-person verb + object. The first sentence.
2. **When to use it** — specific contexts, file types, or signals.
3. **Trigger phrases** — concrete strings the user (or another agent) is
   likely to type. 3–8 of them, including the slash form.

## Template

```
<Third-person verb> <object/scope>. Applies <approach / methodology /
references>. Use when <specific context or signal>. Triggers on
"<phrase 1>", "<phrase 2>", "<phrase 3>", "/<name>".
```

## Worked examples

### Good

```yaml
description: >
  Reviews TypeScript code for cognitive complexity, readability, and
  maintainability using guard clauses, early returns, and discriminated
  unions. Use during PR review, after writing new code, or whenever the
  user asks to "clean this up", "make this readable", or "reduce
  complexity". Triggers on "review code", "audit complexity",
  "/code-quality".
```

Why: starts with a strong verb (`Reviews`), names the artefact (`TypeScript
code`), names the methodology (`guard clauses, early returns`), explains
when, and lists explicit trigger strings.

### Good (slash command)

```yaml
description: >
  Generates a narrative PR description, pushes the branch, and watches CI,
  auto-fixing simple lint/format/lockfile failures. Escalates judgment
  calls via /confidence rather than guessing. Triggers on "open a PR",
  "create pull request", "/create-pr".
```

### Bad — vague

```yaml
description: Helps with documents
```

Why bad: no verb specificity, no context, no triggers. Claude has to guess.

### Bad — first-person

```yaml
description: >
  I can help you process Excel files and generate reports. You can ask me
  about pivots and charts.
```

Why bad: first/second-person voice, no triggers, no specific file type.
Rewrite as `Processes Excel files: pivots, charts, …`.

### Bad — over-broad

```yaml
description: Does everything related to code reviews and refactoring
```

Why bad: "everything" is not a trigger. Claude cannot decide whether this
skill applies. Split into focused skills (`code-quality`,
`review-changes`, `refactor`).

## Voice

| Use                          | Avoid                                |
| ---------------------------- | ------------------------------------ |
| `Reviews …`                  | `I review …`, `You can review …`    |
| `Generates …`                | `This skill helps you generate …`    |
| `Detects …`                  | `Will detect …`                      |
| `Use when …`                 | `Use this when you want to …`        |

## Trigger phrases — choosing them

Trigger phrases are the strings the user is likely to type. Look for:

- The verb the user would say: "review", "generate", "fix", "explain".
- The object: "PR", "tests", "this function", "the migration".
- Pet phrases your team uses: "ship it", "make it pretty", "ratchet up".
- The slash form: `/<name>` — always include this.

If the skill has a clear "ask for help" phrase ("step back", "rethink
this", "zoom out" for `holistic-analysis`), include it verbatim.

## Length budget

| Section                            | Chars (rough) |
| ---------------------------------- | ------------- |
| First sentence (what)              | 80–150        |
| Second sentence (methodology)      | 80–200        |
| Third sentence (when)              | 60–150        |
| Trigger phrases list               | 80–250        |
| **Total**                          | **≤ 1024**    |

If you need more than 1024 chars, you are doing too much in one skill.
Split, do not stretch the description.
