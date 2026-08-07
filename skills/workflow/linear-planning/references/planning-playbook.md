---
title: Planning Playbook — Rough Idea to Structured Project
impact: MEDIUM
tags:
  - reference
  - example
  - walkthrough
  - end-to-end
---

# Planning Playbook

A full worked example of `project` mode, from a one-line request to created
Linear objects.
Load this when you want to see how the phases fit together end-to-end.

## Contents

- The input
- Phase 0 — Connect & context
- Phase 1 — Scoping session
- Phase 2 — Search & dependencies
- Phase 3 — Structure (project, milestones, tickets)
- Phase 4 — Preview
- Phase 5 — Create & wire
- What made this good

---

## The input

> "/linear-planning project let users export dashboards to PDF"

---

## Phase 0 — Connect & context

- `list_teams` → user confirms team **Engineering (`ENG`)**.
- `list_projects` `query: "export"` `includeMilestones: true` → no existing
  export project.
- `list_issue_labels` → `feature`, `spike` exist; `enhancement` does not.
- Output: `Mode: project · Team: Engineering (ENG)`.

---

## Phase 1 — Scoping session

Batched questions asked; user answers:

```text
Problem: No way to export dashboards; support gets ~5 requests/week.
Outcome: A user can export a dashboard to PDF from its menu.
Boundaries: No scheduled exports, no CSV, no per-widget export.
Users/surfaces: All app users; dashboard view + its ⋯ menu.
Constraints: No hard date. Not tied to a cycle.
Unknowns: Unsure charts render server-side — needs a spike.
Slicing: Single-dashboard manual export first, bulk later.
```

Confirmed scoping doc rendered back and approved.

---

## Phase 2 — Search & dependencies

- `list_issues` `query: "export"` `team: ENG` → `OPS-412` (support macro
  request) is **related**, not a duplicate.
- `list_issues` `query: "PDF"` → nothing new.
- Dependency graph drafted:

```text
Spike: server-side rendering        (M1)
Export single dashboard  blockedBy  Spike
Bulk export              blockedBy  Export single dashboard   (M2)
Export docs              relatedTo  Export single dashboard   (M3)
Export single dashboard  relatedTo  OPS-412
```

---

## Phase 3 — Structure

### Project brief (abridged)

```markdown
# Dashboard export
**Summary:** Let users export dashboards to PDF from the dashboard menu.

## Problem
Users can't export dashboards; support fields ~5 requests/week (OPS-412).

## Outcome
A user exports any single dashboard to PDF; bulk export follows.

## Milestones
1. Manual PDF export (walking skeleton)
2. Robustness & scale
3. GA
```

### Milestones and tickets

```text
M1 — Manual PDF export
  • Spike: confirm server-side chart rendering
  • Export a single dashboard to PDF from the ⋯ menu
M2 — Robustness & scale
  • Handle large dashboards (pagination)
  • Export error states + retry
M3 — GA
  • Feature flag → all users
  • Export docs + support macro (relates OPS-412)
```

Each ticket body follows [`templates/ticket.md`](../templates/ticket.md) with
verifiable acceptance criteria.

---

## Phase 4 — Preview

The whole structure — brief, 3 milestones, 6 tickets with acceptance criteria,
and the dependency graph — is rendered in one message, ending with:

```text
Creating 1 project, 3 milestones, 6 issues, 4 dependency links in team ENG. Approve?
```

User replies "go".

---

## Phase 5 — Create & wire

In order:

1. `save_project` name `Dashboard export`, `addTeams: ["ENG"]`, `summary`,
   `description`.
2. `save_milestone` ×3 against the project.
3. `save_issue` ×6 with `team: ENG`, `project`, `milestone`, `description`.
4. Relation updates: `save_issue` `id: <export-single>` `blockedBy: [<spike>]`;
   `save_issue` `id: <bulk>` `blockedBy: [<export-single>]`;
   `relatedTo` links for docs and `OPS-412`.

Returned URLs grouped by milestone.

---

## What made this good

- The spike absorbed the only real unknown, so every other ticket was
  estimable.
- Milestone 1 was the thinnest end-to-end slice — demoable alone.
- Search caught `OPS-412` and linked it instead of duplicating it.
- No dates, owners, or estimates were invented — the scope didn't provide them.
- Nothing was written until the single preview was approved.
