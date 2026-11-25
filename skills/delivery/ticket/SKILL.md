---
name: ticket
description: >
  Connects work to the repo's ticket tracker — Linear, GitHub issues, or none —
  from a committed `.agents/aw/tracker.yml`: `setup` writes it, `create` opens a
  ticket (or hands off to a configured skill such as a Linear planning skill),
  `link` ties a ticket to a PR, and `move` sets its state for a pipeline stage;
  a script decides whether to link, ask, create, or skip. Triggers on "create a
  ticket for this", "link this to AI-123", "set up the tracker", "/ticket".
disable-model-invocation: false
argument-hint: 'setup | create "<request>" | link <ticket> <pr-url> | move <ticket> build|ready|merge'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - linear
    - github-issues
    - tickets
    - tracker
    - atelier
---

# ticket

Ties work to a ticket in the repo's tracker, so every PR points at the ticket that asked for it and the ticket follows the PR.
[`scripts/ticket.mjs`](./scripts/ticket.mjs) makes every decision: link, ask, create, or skip; which state a stage maps to; which PR line links.
This skill does the tracker calls the script cannot make.
Config format: [`rules/config.md`](./rules/config.md).

```bash
T="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/ticket}/scripts/ticket.mjs"
node "$T" --decide --request "<the request>" [--ticket <id|url>] [--unattended]   # TICKET: link <id> | ask | create | skip — <why>
```

| `--decide` prints | Do |
| --- | --- |
| `TICKET: link <id>` | Use that ticket; never create a second one |
| `TICKET: ask` | Ask once: "Create a `<provider>` ticket for this?" — yes → [`create`](#create); no → no ticket, and say so |
| `TICKET: create` | Run [`create`](#create) without asking (`require: always`) |
| `TICKET: skip — <why>` | No ticket; repeat `<why>` to the caller |

A repo without `tracker.yml` never gets a ticket created: the script links a ticket the request names and skips otherwise, because creating one is visible to other people and there is no team to put it in.

```text
✗ no tracker.yml, "add a dark-mode toggle" → create a Linear ticket in the first team the MCP lists
✓ no tracker.yml, "add a dark-mode toggle" → TICKET: skip — no .agents/aw/tracker.yml; /atelier setup configures a tracker
```

## Modes

### `setup`

Interactive only. Writes `.agents/aw/tracker.yml` once, validates it on re-runs.

1. Detect: Linear MCP tools present (`save_issue`, `list_teams`), `gh` authenticated for the repo's `origin`, and an existing `tracker.yml`.
2. Ask in one batched question: the provider (`linear`, `github`, `none`); for Linear the team (from `list_teams`) and an optional project; `require` (`ask` recommended, `always` when every change must have a ticket, `never`); labels; and an optional `skills.create` pointer (for example `project-management:linear-planning`).
3. Write `tracker.yml` per [`rules/config.md`](./rules/config.md) with only the keys that differ from the defaults; put a personal value (another workspace's team, a token variable) in `~/.agents/aw/config.yml` → `repos.<owner/repo>.tracker`.
4. Validate: `node "$T" --check` prints `tracker.yml ok: …`. Commit nothing; print the path for the user to review.

### `create`

Open one ticket for a request, then print `TICKET: <id> <url>`.

1. `skills.create` set → `Skill("<skills.create>", "<request> — create exactly one ticket and print its id and URL")`, and take the id from its output; the pointed skill owns titles, estimates, and templates.
2. Otherwise, by provider:
   - `linear`: `save_issue` with `team` (and `project`, `labels` from config), a one-line title from the request, and the request as the description.
   - `github`: `gh issue create --title "<title>" --body "<request>"` with `--label` per configured label.
3. Never create a second ticket for a request that already has one: check the request text with `--decide` first.

### `link`

Tie a ticket to a PR.

1. `node "$T" --pr-line --ticket <id>` prints the line (`Closes AI-3112`, `Closes #12`); the PR body carries it once — add it with `gh pr edit` only when it is missing.
2. Linear: attach the PR URL to the issue (`create_attachment`) when the issue does not already show it.

### `move`

Set the ticket's state for a pipeline stage.

1. `node "$T" --state --stage <build|ready|merge>` prints the state; `none` → do nothing.
2. Linear: `save_issue` with that state. GitHub: `closed` at `merge` is done by the PR's `Closes #n`; confirm the issue closed, never close it by hand before the merge.

## Hard rules

- **The script decides.** Link, ask, create, or skip comes from `--decide`; never from your judgment.
- **Never create unattended under `require: ask`.** The script prints `skip` there; report it as `Needs you: no ticket`.
- **One ticket per request.** A named ticket is linked, never duplicated.
- **A tracker failure never blocks the caller.** Report it as one `Degraded:` line; the work goes on.
