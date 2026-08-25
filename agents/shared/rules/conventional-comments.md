---
title: Conventional Comments — prefix table and decorations
impact: MEDIUM
tags:
  - pr-reviewer
  - conventional-comments
---

# Conventional Comments

`pr-reviewer` emits comments that conform to the [Conventional Comments](https://conventionalcomments.org/) spec. Many repos (including dash0) require the prefix; applying it unconditionally is safe — harmless in repos that don't enforce it, load-bearing in those that do.

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

## Severity decoration

The reviewer tiers every finding by default (`review-config.md` § Severity-aware thresholds) and shows the tier as a **label decoration** — in the Conventional-Comments position between the label and the colon:

```text
issue (high): <prose> **(blocking)**
suggestion (low): <prose> **(non-blocking)**
```

The tier is one of `critical` / `high` / `medium` / `low`, from `Skill("severity", "finding")`. It is orthogonal to and does **not** replace the end-of-sentence `**(blocking)**` / `**(non-blocking)**` decoration — that token is load-bearing (other rules parse it) and stays exactly as is. `scripts/record-comment-relevance.mjs` reads the tier from this label into the relevance record's `severity` field. Omit the label only when no tier was assigned (a flat-override run, or a non-`pr-reviewer` bot).

## Examples

Every code symbol in the prose is backticked. `suggestion:` and `issue:` comments with a concrete patch include a fenced fix block — see `comment-shape.md § Suggestion / issue → include a fix block`.

```
praise: Nice — the discriminated union on `Result<T>` makes exhaustiveness checks free. **(non-blocking)**
```

```
issue: Empty `catch {}` swallows network vs. not-found errors — worth surfacing the failure. **(blocking)**

```typescript
try {
  return await fetchUser(id);
} catch (err) {
  if (err instanceof NotFoundError) return null;
  throw err;
}
```
```

```
suggestion: A `Map<string, Value>` reads clearer than `Record<string, Value>` here and avoids prototype-key pitfalls. **(non-blocking)**

```typescript
const cache = new Map<string, Value>();
```
```

```
question: Is the empty `catch {}` intentional? Curious whether we want to surface the error to the caller. **(non-blocking)**
```

## Mechanical check

Before any emit:

```python
import re

# Tolerates the optional severity label decoration, e.g. "issue (high):".
PREFIX_RE = re.compile(
    r"^(praise|nitpick|suggestion|issue|question)( \((critical|high|medium|low)\))?:")

def has_conventional_prefix(body: str) -> bool:
    return bool(PREFIX_RE.match(body))
```

If `False`, prepend the prefix derived from the category (with the `(tier)` label when a tier was assigned). This is a recoverable failure — prepend, do not drop. After prepending, re-run the `comment-shape.md` length check.

## What this rule does not enforce

- Conventional Comments also defines `chore:`, `thought:`, `todo:`. `pr-reviewer` does not use these — they map to `nitpick` or terminal-output for terseness.
- Multi-line bodies. `pr-reviewer` constrains bodies to ≤ 2 sentences via `comment-shape.md`; Conventional Comments allows longer bodies, but the agent enforces stricter.
- Subject vs body split. Conventional Comments allows a heading-style subject and a body underneath. Forbidden here by `comment-shape.md` (no headings, no multi-paragraph).
