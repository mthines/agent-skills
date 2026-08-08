---
title: Audit Checklist — Review and Refine Existing Work
impact: MEDIUM
tags:
  - audit
  - review
  - refine
  - structure-gaps
---

# Audit Checklist

Review an existing Linear project or ticket for structure gaps, then propose
and (on approval) apply fixes.
Runs in `audit` mode, typically triggered by a Linear URL as input.

## Step 1 — Read the target

| Target        | Read with                                                         |
| ------------- | ----------------------------------------------------------------- |
| A project URL | `get_project`, then `list_issues` with `project` and `list_milestones` |
| A ticket URL  | `get_issue` (+ `list_comments` if context is needed)              |

Identify the team, milestones, tickets, and existing dependencies before
judging anything.

## Step 2 — Score against the checklist

Mark each **PASS / WARN / FAIL** with one line of evidence (ticket identifier
or field).

### Project-level

- [ ] Project has a `summary` and a description that states the problem and the
      outcome.
- [ ] Milestones are shippable increments, not disciplines (backend / QA).
- [ ] Milestone count is sane (2–5 for a typical project).
- [ ] Every ticket is assigned to a milestone (no orphans).
- [ ] Dependencies across tickets are wired, not just implied by order.
- [ ] No obvious duplicate tickets (cross-check with `list_issues` `query`).

### Ticket-level

- [ ] Title is an action-oriented imperative.
- [ ] Description has Context, Outcome, and Acceptance criteria.
- [ ] Acceptance criteria are verifiable yes/no checks, not adjectives.
- [ ] The ticket is one vertical slice, not a horizontal layer.
- [ ] Blockers are wired with `blockedBy` / `blocks`.
- [ ] Links / references from any linked source are preserved.
- [ ] No invented estimates / owners / dates.

## Step 3 — Propose fixes, then apply

Present the findings as a prioritised list (biggest structural gap first), then
the concrete edits you would make.
Enter the **preview → create gate**: show the proposed edits as markdown, get
approval, then apply with `save_project` / `save_milestone` / `save_issue`
updates (pass `id`), and wire missing relations last.

Use `patch` (not full `description`) when changing part of a long existing
description, so untouched content is preserved exactly.

## What audit must not do

- Do not rewrite tickets that already pass — churn is a cost.
- Do not delete or close tickets; propose it and let the user decide.
- Do not invent missing acceptance criteria from nothing — mark them `<TBD>`
  and ask, unless the ticket body makes the intent unambiguous.

## Example finding

```text
FAIL  ENG-140 "Backend" — horizontal layer, no acceptance criteria.
  Fix: split into ENG "Export single dashboard (end-to-end)" with 3 ACs;
       move server work into that vertical slice.
WARN  Project has 7 milestones — likely phases. Consider merging M4–M6.
PASS  ENG-141 has clear ACs and is a clean vertical slice.
```

## Common mistakes

- Auditing without reading every ticket first. **Fix:** load the full set.
- Applying edits before the preview gate. **Fix:** propose, approve, then
  write.
- Overwriting a long description in full to change one line. **Fix:** use
  `patch`.
