---
title: Conventional Comments — prefix table and decorations
impact: MEDIUM
tags:
  - reviewer
  - pr-reviewer
  - conventional-comments
---

# Conventional Comments

Both agents emit comments that conform to the [Conventional Comments](https://conventionalcomments.org/) spec. Many repos (including dash0) require the prefix; applying it unconditionally is safe — harmless in repos that don't enforce it, load-bearing in those that do.

## Category → prefix

| Category from review | Body prefix |
| --- | --- |
| `praise` | `praise:` |
| `nitpick` | `nitpick:` |
| `suggestion` | `suggestion:` |
| `issue` | `issue:` |
| `question` | `question:` |

The prefix is prepended **before** the comment-shape mechanical check runs (see `comment-shape.md`) — the shape check is the last gate, so the 240-char cap applies to the final posted text including prefix and decoration. In practice the prefix adds 8–12 characters; a finding that was already at 230 chars is pushed over the cap by the prepend and `comment-shape.md` drops it. That is intended: a 230-character finding is already too long.

## Decorations

After the prefix, the comment may include exactly one of:

- `**(non-blocking)**` — appended at the end of the first sentence for suggestions, nitpicks, questions, and praise.
- `**(blocking)**` — appended at the end of the first sentence for issues that meet the strict blocking criteria (broken behaviour, security, data loss, misimplemented intent).

Decorations are part of the Conventional Comments spec and help PR authors triage at a glance.

## Examples

```
praise: Nice — the discriminated union makes exhaustiveness checks free. **(non-blocking)**
```

```
issue: Empty catch swallows network vs. not-found errors — worth surfacing the failure. **(blocking)**
```

```
suggestion: Could use a `Map` here for clearer iteration semantics. **(non-blocking)**
```

```
question: Is the empty catch intentional? Curious whether we want to surface the error. **(non-blocking)**
```

## Mechanical check

Before any emit:

```python
def has_conventional_prefix(body: str) -> bool:
    return any(body.startswith(p) for p in (
        "praise:", "nitpick:", "suggestion:", "issue:", "question:"
    ))
```

If `False`, prepend the prefix derived from the category. This is a recoverable failure — prepend, do not drop. After prepending, re-run the `comment-shape.md` length check.

## What this rule does not enforce

- Conventional Comments also defines `chore:`, `thought:`, `todo:`. The agents do not use these — they map to `nitpick` or terminal-output for terseness.
- Multi-line bodies. Both agents constrain bodies to ≤ 2 sentences via `comment-shape.md`; Conventional Comments allows longer bodies, but the agents enforce stricter.
- Subject vs body split. Conventional Comments allows a heading-style subject and a body underneath. Forbidden here by `comment-shape.md` (no headings, no multi-paragraph).
