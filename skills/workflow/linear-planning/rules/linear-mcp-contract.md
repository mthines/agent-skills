---
title: Linear MCP Contract — Connect, Preview, Create
impact: HIGH
tags:
  - mcp
  - linear
  - creation-order
  - preview
  - safety
---

# Linear MCP Contract

The exact Linear MCP surface this skill uses, the Phase 0 context gathering,
the preview protocol, and the strict create order for Phase 5.
Tool names are the `mcp__plugin_linear_linear__*` set; this rule uses their
short names.

## Contents

- Phase 0 — Connect & context (read-only)
- The write tools
- Phase 4 — Preview protocol
- Phase 5 — Create order (strict)
- Failure handling
- Returning results
- Common mistakes

## Phase 0 — Connect & context (read-only)

Resolve the workspace context before scoping. Never write in this phase.

| Need                          | Call                                             |
| ----------------------------- | ------------------------------------------------ |
| The team (key + id)           | `list_teams` — confirm which team with the user  |
| Existing projects on the topic | `list_projects` with `query`, `includeMilestones: true` |
| Valid statuses for the team   | `list_issue_statuses` with `team`                |
| Valid labels                  | `list_issue_labels` (or `list_project_labels`)   |
| Current cycle (if used)       | `list_cycles` with `team`                        |

Resolve the **team first** — it is required to create a project or an issue.
If the user did not name a team and only one is plausible, propose it and
confirm. Do not guess silently.
Only use labels / statuses / cycles that actually exist in the workspace;
never invent a label name.

## The write tools

| Tool             | Creates / updates | Required on create                          |
| ---------------- | ----------------- | ------------------------------------------- |
| `save_project`   | Project           | `name` **and** a team via `addTeams` (or `setTeams`) |
| `save_milestone` | Project milestone | `project` **and** `name`                    |
| `save_issue`     | Issue             | `title` **and** `team`                      |

Update instead of create by passing `id` (project name/id/slug, milestone
name/id, or issue identifier like `ENG-123`).
For issue descriptions, write markdown directly — **do not escape newlines**;
use literal line breaks, per the Linear MCP guidance.

## Phase 4 — Preview protocol

Render the entire structure as markdown in one message. It must contain:

1. **Project brief** — name, summary, and the description body.
2. **Milestones** — ordered list with each milestone's one-line intent.
3. **Every ticket** — grouped under its milestone, each with title +
   acceptance criteria (full body available on request).
4. **Dependency graph** — the `blockedBy` / `relatedTo` list from
   [`dependencies-and-search.md`](./dependencies-and-search.md).
5. **A create summary line** — counts of each object type and the target team.

Then stop and ask for approval. Do not proceed on silence or a partial
reaction. If the user edits, re-render and re-confirm the whole set.

## Phase 5 — Create order (strict)

Dependencies between objects force this order. Follow it exactly.

1. **Project** — `save_project` (`name`, `addTeams: [<team>]`, `summary`,
   `description`, plus dates / lead / priority only if the scope provided
   them). Capture the returned project id/slug.
2. **Milestones** — one `save_milestone` per milestone (`project`, `name`,
   `description`, `targetDate` only if real). Capture each milestone id/name.
3. **Issues** — one `save_issue` per ticket (`team`, `title`, `project`,
   `milestone`, `description`, plus `priority` / `estimate` / `labels` only if
   provided). Capture each returned identifier (e.g. `ENG-123`).
4. **Dependencies** — only after all issues exist, wire relations with
   `save_issue` updates (`id` + `blockedBy` / `blocks` / `relatedTo`).
   Wire each relation once, from one side (see the dependencies rule).

Why this order: milestones need the project; issues reference the project and
milestone; relations need both issue identifiers to exist first.

## Failure handling

- **A create call fails.** Stop the batch, report which objects were already
  created (with URLs), and ask before retrying — do not blindly re-run and
  double-create.
- **A label / status doesn't exist.** Drop it or ask; never create workspace
  labels as a side effect of planning.
- **The team is ambiguous.** Return to Phase 0 and confirm; do not pick one.

## Returning results

After Phase 5, return live URLs grouped by milestone:

```markdown
Project: <name> — <url>
Milestone 1 — <name>
  • ENG-101 <title> — <url>
  • ENG-102 <title> — <url>
Milestone 2 — <name>
  • ENG-103 <title> — <url>
Dependencies wired: ENG-102 blockedBy ENG-101, …
```

## Common mistakes

- Calling `save_project` without `addTeams`. **Fix:** teams are required on
  create.
- Wiring dependencies before all issues exist. **Fix:** relations are the last
  step.
- Escaping newlines in a description string. **Fix:** send literal markdown.
- Re-running a failed batch wholesale. **Fix:** report what exists, then
  targeted retry.
