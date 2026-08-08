---
name: linear-planning
description: >
  Plans and creates well-structured Linear projects, milestones, and tickets
  from a rough idea or a meeting transcript — running a scoping session first
  (or seeding scope from the transcript via the `meeting-notes` skill),
  searching for related
  and duplicate work, wiring dependencies (blocks / blocked-by / related), and
  defining sequenced milestones before anything is written. Drafts the full
  structure as markdown, previews it for approval, then creates it in Linear
  over MCP (save_project / save_milestone / save_issue) and returns live URLs.
  Four modes: project (scope a whole project into a dependency-ordered ticket
  set), ticket (one well-structured issue), scope (run the scoping meeting
  only), audit (review an existing project or ticket for structure gaps and fix
  them). Ticket shape follows a Context / Outcome / Acceptance criteria / Out of
  scope / Notes template. Triggers on "plan a Linear project", "create
  structured tickets", "scope this project", "break this into tickets", "turn
  this meeting into a Linear project", "plan this meeting's work in Linear",
  "audit this Linear project", "/linear-planning".
disable-model-invocation: true
argument-hint: '[project|ticket|scope|audit] [<rough description | Linear URL>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: scaffolder
  tags:
    - linear
    - project-planning
    - tickets
    - milestones
    - dependencies
    - scoping
    - estimation
    - mcp
---

# Linear Planning

Turn a rough idea — or a meeting transcript — into a well-structured Linear
project: a scoped problem, sequenced milestones, and a dependency-ordered set
of tickets — or a single well-formed ticket.
The skill **always scopes before it structures, and always previews before it
creates.**
It never writes to Linear until you approve the drafted markdown.

> **This `SKILL.md` is a thin index.** The scoping questions, structure rules,
> dependency logic, and exact MCP contract live in `rules/*.md` and load on
> demand. A full worked example lives in `references/planning-playbook.md`.
> Emitted artefact shapes live in `templates/*.md`. Load only what the current
> phase needs.

---

## Mode Detection

Parse the argument (first token) and detect the mode.

| Mode      | Default | Trigger                                                              |
| --------- | ------- | -------------------------------------------------------------------- |
| `project` | **yes** | Default. "plan a project", "break this into tickets", or no mode.    |
| `ticket`  |         | "one ticket", "write a ticket", or a single unit of work.            |
| `scope`   |         | "scope this", "run a scoping session", "just the plan" — no writes.  |
| `audit`   |         | "audit", "review this project/ticket", or a Linear URL as input.     |

If the argument is a Linear URL (`linear.app/...`), default to `audit`.
State the detected mode and the resolved team in one line before continuing:

```text
Mode: project
Team: <team name> (<TEAM-KEY>)
```

---

## Intake: rough idea or meeting transcript

The input to `project` / `ticket` / `scope` modes can be either source; the
mode controls the *output* shape, the intake controls how Phase 1 is seeded:

- **A rough idea** (text) → run the full scoping session (Phase 1).
- **A meeting transcript or `meeting-notes` output** → don't cold-interview.
  Run `Skill("meeting-notes", "<transcript path|url|paste>")` first (or use its
  output if already provided), then **seed the scope** from its Decisions,
  Action items, Open questions, and Key points. Phase 1 collapses to a short
  gap-fill and confirmation — the meeting already did most of the scoping.

Either way Phase 2 onward is unchanged: search existing work, structure,
preview, create. Never invent scope the transcript doesn't support — carry its
Open questions into the plan as `<TBD>` items to confirm, not as decisions.

---

## Workflow

Each phase has a gate; do not proceed until it passes.
Modes run a subset of the phases — see the mode map below the table.

| Phase | Name                | Rule file                                                                 | Gate                                                        |
| ----- | ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0     | Connect & context   | [`rules/linear-mcp-contract.md`](./rules/linear-mcp-contract.md)          | Team resolved; workspace labels / statuses / cycles read    |
| 1     | Scoping session     | [`rules/scoping-session.md`](./rules/scoping-session.md)                  | Problem, outcomes, constraints, risks, boundaries captured  |
| 2     | Search & dependencies | [`rules/dependencies-and-search.md`](./rules/dependencies-and-search.md) | Related / duplicate work surfaced; dependencies identified  |
| 3     | Structure           | [`rules/project-structure.md`](./rules/project-structure.md), [`rules/ticket-structure.md`](./rules/ticket-structure.md) | Project + milestones + tickets drafted as markdown          |
| 4     | Preview & approve   | [`rules/linear-mcp-contract.md`](./rules/linear-mcp-contract.md)          | User approved the drafted markdown verbatim or with edits   |
| 5     | Create & wire       | [`rules/linear-mcp-contract.md`](./rules/linear-mcp-contract.md)          | Project → milestones → issues → dependencies created; URLs returned |

### Mode → phases

| Mode      | Phases run                                     |
| --------- | ---------------------------------------------- |
| `project` | 0 → 1 → 2 → 3 → 4 → 5                           |
| `ticket`  | 0 → 1 (light) → 2 → 3 (ticket only) → 4 → 5    |
| `scope`   | 0 → 1 → 2 → **stop**: output the scoping doc, do not create |
| `audit`   | 0 → read target → [`rules/audit-checklist.md`](./rules/audit-checklist.md) → 4 → 5 (apply fixes) |

---

## The preview → create gate (non-negotiable)

Phase 5 is guarded.
Never call any `save_*` MCP tool until **all** of these hold:

1. The full structure was rendered as markdown in Phase 4 (project brief +
   milestone list + every ticket + the dependency graph).
2. The user replied with explicit approval ("create it", "go", "looks good")
   or edits that you re-rendered and they then approved.
3. You have echoed the create plan: *"Creating 1 project, 3 milestones, 11
   issues, 4 dependency links in team `ENG`."*

Silence is not approval.
If the user only reacted to part of the preview, re-confirm the whole set.
On approval, create in the order defined in
[`rules/linear-mcp-contract.md`](./rules/linear-mcp-contract.md) and return a
list of live URLs grouped by milestone.

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase / Mode | Files                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 0, 4, 5      | [`rules/linear-mcp-contract.md`](./rules/linear-mcp-contract.md)                               |
| 1            | [`rules/scoping-session.md`](./rules/scoping-session.md), [`templates/scoping-questions.md`](./templates/scoping-questions.md) |
| 1 (from a meeting) | [`meeting-notes`](../../analysis/meeting-notes/SKILL.md) — run first, then seed Phase 1 from its output |
| 2            | [`rules/dependencies-and-search.md`](./rules/dependencies-and-search.md)                       |
| 3 (project)  | [`rules/project-structure.md`](./rules/project-structure.md), [`templates/project-brief.md`](./templates/project-brief.md) |
| 3 (ticket)   | [`rules/ticket-structure.md`](./rules/ticket-structure.md), [`templates/ticket.md`](./templates/ticket.md) |
| `audit`      | [`rules/audit-checklist.md`](./rules/audit-checklist.md)                                       |
| example      | [`references/planning-playbook.md`](./references/planning-playbook.md)                         |

---

## Core Principles

1. **Scope before structure.** A ticket set is only as good as the scoping
   that produced it. Run the interview in `rules/scoping-session.md` first;
   never jump straight to writing tickets.
2. **Search before you create.** Every project and ticket is checked against
   existing Linear work for duplicates and dependencies. Reuse or link; do not
   silently re-create.
3. **Preview before you write.** The user approves markdown; the skill creates
   the Linear objects. Two distinct steps, always.
4. **Milestones are the delivery increments.** Every project is structured as a
   sequence of shippable milestones (at least two) that break the work into
   smaller chunks — each one demoable on its own. A project without milestones
   is a defect; if the work can't be split, it's a single ticket, not a project.
5. **Vertical slices, not layers.** Each ticket should deliver an
   independently shippable, testable outcome — not "the backend part".
6. **Dependencies are explicit.** If ticket B needs ticket A, wire it with
   `blockedBy` / `blocks`. An unstated dependency is a planning defect.
7. **Do not invent specifics.** Preserve every link, ID, `@mention`, and file
   path from the input verbatim; use `<TBD>` rather than fabricating numbers,
   owners, or dates.
8. **A meeting is scope.** When the input is a transcript, seed the plan from
   `meeting-notes` output rather than re-interviewing; confirm the gaps, don't
   re-derive what the meeting already decided.

---

## Anti-patterns (one-liners)

- Creating tickets before running the scoping session.
- Writing to Linear before the user approved the markdown preview.
- Horizontal-layer tickets ("DB", "API", "UI") that can't ship on their own.
- A project with no milestones, or a single catch-all milestone holding everything.
- Milestones that are buckets of unrelated work rather than shippable increments.
- Duplicate tickets because Phase 2 search was skipped.
- Implied dependencies left unwired in Linear.
- Ceremonial fields (priority, estimate, owner, dates) invented without input.

---

## Definition of Done

- [ ] Mode and team stated up front.
- [ ] Scoping session ran (project / ticket / scope modes) or the target was
      read (audit mode).
- [ ] Related-work / duplicate search ran and results were surfaced.
- [ ] Full structure previewed as markdown and explicitly approved.
- [ ] Linear objects created in the correct order; dependencies wired.
- [ ] Live URLs returned, grouped by milestone.
- [ ] `scope` mode stopped before any write and returned the scoping doc.
