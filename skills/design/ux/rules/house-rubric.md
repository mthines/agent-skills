---
title: 'House rubric — grade a UI against the repo''s own UX rules'
impact: HIGH
tags:
  - ux
  - rubric
  - audit
---

# House rubric (`.agents/aw/ux.md`)

A repo states its UX conventions in `.agents/aw/ux.md`; an audit grades the changed UI against every line that applies, then runs this skill's own passes.
Grade against written lines only: never pick the "best" UX from taste, and never rate a design better because it is the one in the diff.
**Why:** [`../references/house-rubric.md`](../references/house-rubric.md).

## File format

One rule per bullet, in exactly this shape, at most 30 bullets; `#` headings group them and are ignored by the grader:

```markdown
# Forms
- when <situation>, we <do X>, not <Y>
```

| Part | Rule |
| --- | --- |
| `when <situation>` | an observable trigger a reviewer can find in the code or a screenshot: "a form submit fails", "a list is empty", "an action deletes data" |
| `we <do X>` | the concrete house answer: a component, a copy pattern, a placement |
| `not <Y>` | the common wrong answer it replaces |

```markdown
<!-- ✗ Wrong — taste, no trigger, nothing to check -->
- Keep the UI clean and consistent.

<!-- ✓ Right — a trigger, the house answer, and the rejected one -->
- when an action deletes data, we use `ConfirmDialog` with the item name in the title, not a browser `confirm()`
- when a list is empty, we show `EmptyState` with one primary action, not a blank table
```

A bullet that does not match `when …, we …, not …` is skipped and reported as `rubric: skipped line <n> (not in when/we/not form)`.

## Grading

1. For each rule, decide whether its `when` situation occurs in the changed UI (code or screenshot); skip the ones that do not.
2. For each that applies, cite the `file:line` or screenshot that shows the house answer, or the `not` answer.
3. The `not` answer, or neither, is a finding labelled `rubric: <the rule's when clause>`, severity `High` on the primary task path, else `Medium`.
4. Then run Pass 1 and Pass 2 as usual; a rubric finding and a Pass finding on the same `file:line` merge into one.

```text
✗ Wrong — "the delete flow could feel more polished" (taste, no rule)
✓ Right — High · rubric: an action deletes data · src/Projects/Row.tsx:41 calls window.confirm(); the house answer is ConfirmDialog
```

No `.agents/aw/ux.md` → grade with this skill's own passes only, and say `rubric: none (no .agents/aw/ux.md)` in the report header.
