---
title: Comment shape — hard caps and mechanical checks
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - comment-shape
---

# Comment shape

Every inline review comment — whether posted to GitHub by `pr-reviewer` or emitted to the terminal by `reviewer` Self-Review — passes these checks before it leaves the agent.

Research grounding: AI-review tools that ship < 5 % false-positive rate and short, scannable comments (CodeRabbit, Greptile in their 2026 field tests) are the ones developers keep reading. Long comments are skipped; skipped comments make the entire review feel like noise.

## Hard caps

| Property | Cap | On fail |
| --- | --- | --- |
| `body.length` | ≤ 240 characters | Trim once; drop on second fail |
| Sentence count | ≤ 2 | Drop |
| Headings (`#`, `##`, `###`) in body | 0 | Drop |
| Bullet lists (`-`, `*`, `1.`) in body | 0 | Drop |
| Code fences | ≤ 1, ≤ 6 lines, language tagged | Strip extra fences; drop on missing tag |

Character count is measured **after** the Conventional-Comments prefix is prepended (so `suggestion: ` + body must fit). Sentence count is measured against the full body and counts `.`, `!`, `?` followed by space or end-of-string.

## Shape

Lead with the point. Optional minimal snippet. Nothing else.

```
<one-sentence point — what + why>

```<lang>
<≤ 6-line snippet — optional>
```
```

Examples that pass:

- `suggestion: Could use a Map here for clearer iteration semantics.`
- `nitpick: \`userIds\` reads clearer than \`ids\` in this scope.`
- `question: Is the empty catch intentional? Curious whether we want to surface the error.`
- `praise: Nice — the discriminated union makes exhaustiveness checks free.`

Examples that fail:

- Anything starting with `## Why` or `### Issue` — heading in body → drop.
- Anything containing `1. First, …\n2. Second, …` — bullets in body → drop.
- A 320-character explanation of why the function name is confusing — trim once to ≤ 240; if the trim breaks the point, drop and surface in the terminal output instead.

## Tone

- Friendly and collaborative — peer pointing something out, not a gatekeeper.
- Prefer questions over assertions when there's any chance the author has context the agent does not.
- Soften with `maybe`, `consider`, `could`, `what do you think about` — they read as collaborative.
- Never restate the code the comment is pinned to.
- For snippets in a `suggestion` comment, append the italic disclaimer `_Pseudo-code — verify before applying._` after the fence.

## What goes elsewhere

If a finding needs more than 240 characters and 2 sentences to land, it does not belong as an inline comment. Route it to:

- The terminal summary (Step 3 in either agent) for design-level concerns.
- A linked file (`docs/`, `RFC.md`) for genuinely long-form rationale.
- A separate `question:` comment that asks for context first.

## Mechanical pre-emit check

Both agents run this immediately before emitting / posting:

```python
def passes_shape(body: str) -> tuple[bool, str]:
    if len(body) > 240:
        return (False, "length")
    if sum(body.count(c) for c in ".!?") > 2:
        return (False, "sentences")
    if any(body.lstrip().startswith(p) for p in ("#", "## ", "### ", "- ", "* ", "1. ")):
        return (False, "structure")
    return (True, "")
```

The check runs **after** Conventional-Comments prefix prepending and **after** the optional `(blocking)` / `(non-blocking)` decoration, so the cap applies to what the PR author actually sees.

On `length` fail: attempt one trim pass that drops the trailing rationale clause. If the trimmed body no longer makes the point standalone, drop the comment and surface it in the terminal output for the user to post manually.

On `sentences` or `structure` fail: drop without retry. These shapes are not recoverable and re-trying the same model in the same turn would re-produce them.

Dropped comments are logged with the dropped body verbatim in the agent's terminal output so the user can paste them manually if they want — never silently discarded.
