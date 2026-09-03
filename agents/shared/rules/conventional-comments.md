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

The prefix is the payload's `PREFIX` field, and `render-comment.mjs` puts it at position 0 — it is never prepended to prose the model already wrote. That matters for one reason beyond tidiness: `record-comment-relevance.mjs` reads the tier off `^<prefix> (<tier>):`, so the prefix's *position* is a machine contract, not a style. The prose cap is measured on `BODY` alone (`comment-shape.md § Hard caps`), so the prefix, the tier label and the title cannot push a correct finding over it.

## Decorations

Exactly one of these ends **line 1** — the title line on a claim, the prose line on a one-liner:

- `**(non-blocking)**` — for suggestions, nitpicks, and questions.
- `**(blocking)**` — for issues that meet the strict blocking criteria (broken behaviour, security, data loss, misimplemented intent). The renderer **rejects** it on any other prefix: a blocking suggestion is a contradiction other rules parse, since Gate 3 reads this token to decide whether an open thread fails a PR.
- Neither, on `praise` — nothing is being asked for.

Decorations help PR authors triage at a glance, and *line 1* is where that glance lands. The observed drift is precisely this: a posted comment carried a plain-text `(blocking)` at the end of its **second** sentence, where it is both unbolded and past the point a reader has stopped scanning. Position and emphasis are both derived now.

## Severity decoration

The reviewer tiers every finding by default (`review-config.md` § Severity-aware thresholds) and shows the tier as a **label decoration** — in the Conventional-Comments position between the label and the colon:

```text
issue (high): 🟠 **<title>** **(blocking)**
suggestion (low): ⚪ **<title>** **(non-blocking)**
nitpick (low): <prose> **(non-blocking)**
```

The tier is one of `critical` / `high` / `medium` / `low`, from `Skill("severity", "finding")`, and it renders **twice**: as this label, which the machines read, and as the matching glyph (`🔴` / `🟠` / `🟡` / `⚪`) before the bold title, which is what a human scans. The glyph comes from the one map in `comment-spine.mjs` that the report's severity tally also uses, so `high` looks the same on both surfaces. The label is orthogonal to and does **not** replace the end-of-line `**(blocking)**` / `**(non-blocking)**` decoration — that token is load-bearing (other rules parse it) and stays exactly as is. `scripts/record-comment-relevance.mjs` reads the tier from this label into the relevance record's `severity` field. Both label and glyph are omitted when no tier was assigned (a flat-override run, or a non-`pr-reviewer` bot).

## Examples

Every code symbol in the prose is backticked. `suggestion:` and `issue:` comments with a concrete patch include a fenced fix block — see `comment-shape.md § Suggestion / issue → include a fix block`.

```
praise: Nice — the discriminated union on `Result<T>` makes exhaustiveness checks free. **(non-blocking)**
```

```
issue (high): 🟠 **Empty catch swallows a network failure** **(blocking)**

`catch {}` cannot tell a network error from a not-found, so a transient outage reads as a missing user.

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
suggestion (low): ⚪ **Record is prototype-key exposed here** **(non-blocking)**

A `Map<string, Value>` reads clearer than `Record<string, Value>` here and avoids prototype-key pitfalls.

```typescript
const cache = new Map<string, Value>();
```
```

```
question: Is the empty `catch {}` intentional? Curious whether we want to surface the error to the caller. **(non-blocking)**
```

## Mechanical check

`render-comment.mjs` builds line 1 from `PREFIX` and `TIER` and asserts this regex against its own
output before returning, so the shape cannot be reached by any other route. The regex below is the
one `record-comment-relevance.mjs` uses to read the tier back — the two are the same shape from
opposite ends, which is why the title had to go *after* the colon rather than before it:

```python
import re

# Tolerates the optional severity label decoration, e.g. "issue (high):".
PREFIX_RE = re.compile(
    r"^(praise|nitpick|suggestion|issue|question)( \((critical|high|medium|low)\))?:")

def has_conventional_prefix(body: str) -> bool:
    return bool(PREFIX_RE.match(body))
```

A body that fails this is not repaired by prepending — it is a renderer bug, because the renderer built the line from the enumerated `PREFIX` and `TIER` fields and cannot produce a non-conforming one from a payload it accepted. Report it; do not hand-patch the body.

## What this rule does not enforce

- Conventional Comments also defines `chore:`, `thought:`, `todo:`. `pr-reviewer` does not use these — they map to `nitpick` or terminal-output for terseness.
- Multi-line bodies. `pr-reviewer` constrains prose to ≤ 2 sentences and ≤ 200 chars via `comment-shape.md`; Conventional Comments allows longer bodies, but the agent enforces stricter.
- A heading-style subject. Conventional Comments allows one; `comment-shape.md` forbids headings on this surface and uses a **bold** title line instead. That is not a cosmetic preference: a `###` is the report's own identity marker, so a heading on a finding would make the two surfaces ambiguous, and a heading also renders at a size that dominates the comment it is labelling.
