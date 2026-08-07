---
title: Ticket Structure — Anatomy, Descriptions, Sizing
impact: HIGH
tags:
  - tickets
  - descriptions
  - acceptance-criteria
  - sizing
  - estimation
---

# Ticket Structure

Write every ticket to the same shape so it can be skimmed before it is read.
The description body uses the section order below; the literal skeleton lives
in [`templates/ticket.md`](../templates/ticket.md).
This shape is derived from the author's preferred Linear ticket template.

## Contents

- The section order
- Titles
- Acceptance criteria — the heart of the ticket
- Sizing — one vertical slice per ticket
- Parent / sub-issue vs dependency
- Estimates
- Examples
- Common mistakes

## The section order

| Section              | Purpose                                                        | Omit when …                       |
| -------------------- | ------------------------------------------------------------- | --------------------------------- |
| Context              | Why this exists, what happens today, who is affected.         | Never.                            |
| Outcome              | What "done" looks like in plain language (the result).        | Never.                            |
| Acceptance criteria  | 3–6 verifiable `- [ ]` checks a reader answers yes/no.        | Never.                            |
| Out of scope         | What this ticket explicitly does not do.                      | The scope suggested no boundary.  |
| Notes                | Links, related tickets, `@mentions`, file paths, hints.       | The input carried none.           |

Rules, in priority order:

1. **Preserve every link, URL, ticket reference (`#ABC-123`), `@mention`, and
   file path from the input, verbatim.** If one doesn't fit Context / Outcome /
   Acceptance criteria, it goes in Notes — which becomes mandatory the moment
   any link would otherwise be orphaned.
2. **Do not invent specifics.** Vague input → write generically or leave
   `<TBD>`. Never fabricate numbers, names, paths, URLs, or references.
3. **No ceremonial fields** (priority, estimate, owner, ETA) unless the input
   provided them.
4. Keep sentences short. Use `code` formatting for filenames, identifiers,
   commands, and config keys.

## Titles

An action-oriented imperative, ≤ ~10 words, no trailing period.

| Good                                  | Bad                          |
| ------------------------------------- | ---------------------------- |
| `Add PDF export to dashboard menu`    | `Export`                     |
| `Fix retry loop on failed webhook`    | `Webhook bug`                |
| `Spike: confirm server-side rendering`| `Investigate rendering`      |

## Acceptance criteria — the heart of the ticket

Each criterion is independently verifiable — a reviewer can mark it done
without judgment.

```markdown
- [ ] A user can export a single dashboard to PDF from the `⋯` menu.
- [ ] The PDF preserves chart titles, legends, and the applied time range.
- [ ] Export of a dashboard with 0 widgets shows an empty-state message.
```

Not acceptance criteria: "works well", "is performant", "handles edge cases".
If you can't phrase it as a yes/no check, it is not done being scoped.

## Sizing — one vertical slice per ticket

A ticket delivers **one independently shippable, testable outcome**.

| Signal a ticket is too big                          | Split by …                          |
| --------------------------------------------------- | ----------------------------------- |
| The title needs "and" to be accurate                | The two outcomes.                   |
| More than ~6 acceptance criteria                    | Grouping criteria into sub-outcomes.|
| It spans multiple milestones                        | Milestone boundary.                 |
| It mixes a spike with the implementation            | Spike ticket + build ticket.        |

Split **vertically** (a thin end-to-end feature), never **horizontally**
(the DB layer, then the API layer). A horizontal ticket can't ship or be
demoed on its own.

## Parent / sub-issue vs dependency

- Use a **parent issue with sub-issues** (`parentId`) when one deliverable has
  genuine checklist-like children tracked together.
- Use a **dependency** (`blocks` / `blockedBy`) when two separately shippable
  tickets have an ordering constraint. See
  [`dependencies-and-search.md`](./dependencies-and-search.md).
- Do not model an ordering constraint as a parent/child relationship.

## Estimates

Only add an `estimate` when the user works with estimates and the ticket is a
well-understood vertical slice.
Never estimate a ticket with an open unknown — that is what a spike is for.
If the team uses points, keep slices small enough that most are 1–3 points; a
ticket that "feels like an 8" is usually two tickets.

## Examples

### Good — a scoped ticket body

```markdown
## Context
Users can't export dashboards; support fields ~5 requests/week. Related: `#OPS-412`.

## Outcome
A user exports any single dashboard to PDF from the dashboard `⋯` menu.

## Acceptance criteria
- [ ] "Export to PDF" appears in the dashboard `⋯` menu.
- [ ] The PDF preserves chart titles, legends, and the current time range.
- [ ] A dashboard with no widgets exports a one-page empty state.

## Out of scope
- Scheduled or recurring exports.
- CSV or per-widget export.

## Notes
- Design: https://figma.com/…
- Depends on `#ENG-501` (server-side chart rendering spike).
```

### Bad — a horizontal, unverifiable ticket

```markdown
Title: Backend for export
Do the backend work for exports. Should be robust and cover edge cases.
```

Why bad: ships nothing on its own, no acceptance criteria, "robust / edge
cases" is unverifiable, and orphans the real feature.

## Common mistakes

- Acceptance criteria that are adjectives, not checks. **Fix:** rewrite each as
  a yes/no condition.
- One ticket, two outcomes joined by "and". **Fix:** split it.
- A dependency modelled as parent/child. **Fix:** use `blockedBy` / `blocks`.
- Estimating around an unknown. **Fix:** spike first, estimate after.
