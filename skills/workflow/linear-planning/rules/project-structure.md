---
title: Project Structure — Projects and Milestones
impact: HIGH
tags:
  - project
  - milestones
  - sequencing
  - structure
---

# Project Structure

Turn a confirmed scoping doc into a Linear **project** with a description that
reads well and **milestones** that are shippable increments.
This rule covers the project brief and the milestone breakdown.
Ticket anatomy is in [`ticket-structure.md`](./ticket-structure.md); wiring
dependencies is in [`dependencies-and-search.md`](./dependencies-and-search.md).

## Contents

- When to use a project vs a single ticket
- The project brief
- Milestones — shippable increments, not phases
- Mapping tickets to milestones
- Examples
- Common mistakes

## When to use a project vs a single ticket

| Signal                                                        | Use          |
| ------------------------------------------------------------- | ------------ |
| One shippable outcome, ≤ ~2 days, no sub-steps worth tracking | Single ticket |
| Multiple tickets, or work that spans more than a few days     | Project      |
| Work that reaches a meaningful state in stages                | Project      |
| Cross-team or cross-service coordination                      | Project      |

**Every project is structured as a sequence of milestones — this is not
optional.** Milestones are the delivery increments that break the work into
smaller, shippable chunks; a project without them is just a bag of tickets with
no delivery story. If the work genuinely cannot be split into at least two
increments, it is not a project — make it a single ticket instead.

## The project brief

Write the project `description` as markdown using
[`templates/project-brief.md`](../templates/project-brief.md).
It leads with **why**, then **what done looks like**, then structure.
Keep it skimmable — the brief is read once and referenced often.

Set project fields only when the scope provides them:

| Field         | Set it when …                                                    |
| ------------- | ---------------------------------------------------------------- |
| `summary`     | Always — one line, ≤ 255 chars, the elevator pitch.              |
| `targetDate`  | A real deadline exists. Pair with `targetDateResolution`.        |
| `startDate`   | The user gives a start or it is tied to a cycle.                 |
| `lead`        | The user names an owner. Never invent one.                       |
| `priority`    | The user states urgency (1=Urgent … 4=Low).                     |
| `labels`      | They match existing workspace labels (checked in Phase 0).       |
| `links`       | The input carries external URLs (design, doc, spec).             |

## Milestones — the delivery increments (mandatory)

Every project is decomposed into milestones **before** any ticket is drafted.
A milestone is a **coherent, demonstrable delivery increment** — a chunk the
team can ship or demo on its own — not a stage of a waterfall.
Milestones are how the project breaks into smaller, independently shippable
pieces; drafting tickets without them is a defect, not a shortcut.
The test for each milestone: *could the team ship or demo at this point and have
delivered real, standalone value?*

| Good milestone                                  | Bad milestone                          |
| ----------------------------------------------- | -------------------------------------- |
| "Read-only export works end-to-end"             | "Backend done"                         |
| "Editing available behind a feature flag"       | "Frontend"                             |
| "GA: exports enabled for all users"             | "Testing"                              |

### Sizing and count

- Every project has **at least 2 milestones**; aim for **2–5** on a typical
  project.
- Each milestone holds a handful of tickets, not one and not twenty.
- If you can only find one increment, the work is a single ticket, not a
  project — do not create a one-milestone project.
- If it has more than ~6, the project is really two projects, or the
  milestones are phases in disguise.

### Sequencing

Order milestones so each builds on the last and the earliest one is the
**walking skeleton** — the thinnest slice that proves the whole path works.
Give each a `targetDate` only if the scope has real dates; otherwise leave
dates off rather than inventing them.

## Mapping tickets to milestones

Every ticket belongs to exactly one milestone (via `save_issue` `milestone`).
A ticket that doesn't fit any milestone is a signal the milestone set is wrong
— revisit the breakdown, don't create an orphan.

## Examples

### Good — a sequenced project

```markdown
Project: Dashboard export
Milestone 1 — Manual PDF export (walking skeleton)
  • Spike: confirm server-side chart rendering
  • Export a single dashboard to PDF from the menu
Milestone 2 — Robustness & scale
  • Handle large dashboards / pagination
  • Error states and retry
Milestone 3 — GA
  • Feature flag → all users
  • Docs + support macro
```

Why: milestone 1 is demoable on its own, the spike de-risks estimation, and
each later milestone adds a shippable layer.

### Bad — phases masquerading as milestones

```markdown
Milestone 1 — Backend
Milestone 2 — Frontend
Milestone 3 — QA
```

Why bad: none of these ships value alone, and milestone 3 defers all risk to
the end. Re-slice vertically.

## Common mistakes

- Milestones named after disciplines (backend / frontend / QA). **Fix:** name
  them after demoable outcomes.
- Inventing target dates to look complete. **Fix:** leave dates off unless the
  scope stated them.
- A giant first milestone and a trivial rest. **Fix:** make milestone 1 the
  thinnest end-to-end slice, then grow.
