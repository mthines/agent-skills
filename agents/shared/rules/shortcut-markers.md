---
title: Shortcut markers — a deliberate limit, written where the code is
impact: MEDIUM
tags:
  - shortcut
  - tech-debt
  - review
  - authoring
---

# Shortcut markers

A shortcut is code that is correct today but has a known ceiling: one process, a small input, no retry.
Mark it with one comment on the line, or the line above, in this exact form:

```text
shortcut: <the limit>, <when to upgrade>
```

The text before the first comma followed by a space is the ceiling, so `10,000 rows` stays whole; the text after it is the trigger that says when to revisit.
Rationale: [`../references/shortcut-markers.md`](../references/shortcut-markers.md).

## When writing code

1. Take a shortcut only when the task does not need the bigger version; name the limit as a number or a condition.
2. Write the trigger as an observable event: a count, a size, a second replica, a second caller.
3. Never mark a cut to validation at a trust boundary, error handling that prevents data loss, security, or accessibility: those are never shortcuts, they are defects.

```python
# ✗ Wrong — no ceiling, no trigger, and a ticket the reader cannot open
# TODO(ENG-412): make this scale
rows = load_all(path)

# ✗ Wrong — a ceiling with no trigger; nobody knows when "later" is
rows = load_all(path)  # shortcut: whole file in memory

# ✓ Right — the ceiling, then the event that makes it wrong
rows = load_all(path)  # shortcut: whole file in memory, stream it once inputs pass 50 MB
```

## When reviewing code

A finder still flags a hunk under a marker: it cites the marker in `evidence` and states the assumed load and its source (`assumed: 2 GB imports — PR description`; `assumed: unknown` when nothing states one).
The verifier then treats a well-formed marker as a decision, not a finding.
The verifier keeps the candidate only in these cases:

| Case | Candidate |
| --- | --- |
| The PR description, a linked ticket, a governing doc, or deploy config already puts the load past the stated ceiling | the finder's own class, citing the marker and the source of the load |
| The marker has no trigger (no comma, or nothing after it) | `quality`, asking for the trigger |
| The marker sits on a trust-boundary check, data-loss handling, security, or accessibility code | the finder's own class: the marker does not excuse it |
| The code under the marker is wrong even below the ceiling | the finder's own class: the marker covers the limit, not a bug |

```text
✗ Finding: "load_all reads the whole file into memory; stream it."   (the marker already says so, and nothing says inputs pass 50 MB)
✓ Finding: "The marker allows 50 MB, but the PR description says imports are customer exports of up to 2 GB; load_all will exhaust memory."
```

## The ledger

`/polish debt` lists every marker in the repo, one row each, and tags a marker with no trigger `no-trigger`: [`skills/quality/polish/rules/debt.md`](../../../skills/quality/polish/rules/debt.md).
`polish simplify` keeps markers: they are why-comments.
