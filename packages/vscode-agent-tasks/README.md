# Agent Tasks

Visualize autonomous agent workflow artifacts (`plan.md`, `task.md`, `walkthrough.md`) in the VS Code sidebar. Works with any workflow that writes artifacts to `.agent/` or `.gw/` directories — including the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill.

## Features

- **Agent Tasks sidebar** — browse all in-flight and completed agent tasks by branch
- **Task progress** — see phase, status (in-progress/blocked/completed), and sub-tasks at a glance
- **Plan viewer** — inspect the plan summary, files to create/modify, and complexity estimate
- **Walkthrough & plan auto-open** — when a `walkthrough.md` or `plan.md` is created, the extension opens it automatically in Markdown Preview (each toggleable)
- **Configurable directories** — scan `.agent/`, `.gw/`, or any custom directory name
- **Sort** — sort by date, name, or status; ascending or descending
- **Sessions panel** — view Claude Code session history for the current workspace and sibling worktrees; click to open the transcript or resume the session in a terminal

## Install

Search for **Agent Tasks** in the VS Code Marketplace or install by ID:

```
mthines.agent-tasks
```

## Usage

1. Open a workspace that contains a `.agent/` or `.gw/` directory with artifacts.
2. Click the **Agent Tasks** icon in the Activity Bar.
3. Expand a branch entry to see tasks, plan, and walkthrough.

## Sessions

The **Sessions** panel (below the Agent Tasks view in the same activity-bar container) lists Claude Code session history for the current workspace.

### How it works

Sessions are read from `~/.claude/projects/<encoded-cwd>/` — where `<encoded-cwd>` is your absolute workspace path with every non-alphanumeric character replaced by `-`. For example `/Users/you/myrepo.git/main` becomes `-Users-you-myrepo-git-main`.

Each session entry shows:
- **Label** — the first user message, whitespace-collapsed and truncated to ~50 characters
- **Description** — relative time when grouped by worktree; `branch · time` when flat
- **Icon** — reflects a heuristic status based on the file's last-modified time:
  - Blue pulse — **active** (file written within the last 2 minutes)
  - Blue clock — **recent** (file written within the last hour)
  - Gray history — **idle** (older than 1 hour)

Relative time switches to absolute (`Apr 23`) for sessions older than 7 days, and the panel auto-refreshes every 60 seconds while visible so labels don't go stale.

> **Note:** The status icon is a heuristic derived from file mtime, not a real signal from Claude Code. A paused session that last wrote 90 seconds ago will show as "active" even if Claude has stopped.

Hover over a session for a tooltip with: heuristic disclosure, last activity, branch, message count, session ID, CWD, and file path.

### Worktree grouping

When the workspace is part of a multi-worktree setup (gw-managed or plain git), sessions are grouped by worktree. The current worktree is pinned to the top, marked **(current)**, and expanded by default; other worktrees are collapsed. Discovery priority: `.gw/config.json` (sibling worktrees) → `git worktree list --porcelain` → just the workspace path. Single-worktree workspaces show a flat list.

Sessions launched from sub-directories of a worktree (e.g. `apps/api/` inside `feat/foo/`) are also surfaced and bucketed under their parent worktree by reading the `cwd` field on the session events.

### Filtering

Use the **filter icon** in the Sessions panel header (or the command **Toggle Sessions Scope**) to switch between:
- **All worktrees** (default) — every worktree's sessions, grouped, current first
- **Current worktree only** — flat list of just this worktree's sessions

The choice is persisted in `agentTasks.sessions.scope`.

### Click behavior

Clicking a session does one of two things depending on the `agentTasks.sessions.openWith` setting:

| Value | Behavior |
|-------|----------|
| `"resume"` (default) | Opens a terminal in the session's original CWD and runs `claude --resume <session-id>` |
| `"editor"` | Opens the JSONL transcript file in the VS Code text editor |

In **resume** mode the extension tracks which terminal belongs to which session within this VS Code window. Clicking the same session again focuses the existing terminal tab instead of spawning a duplicate. Closing the terminal removes the association, so a subsequent click starts a fresh process.

Cross-window terminal tracking isn't possible — the VS Code extension API is window-scoped. If you've resumed the same session in another VS Code window, clicking here will start a second `claude --resume` against the same JSONL. Claude Code itself handles this gracefully but you'll have two processes appending to the same file.

> **Note:** `resume` mode requires `claude` to be on your `PATH`. If `claude` is not installed or not found, the terminal will show an error — the extension does not validate the command.

### Activation note

As of this release, the extension also activates via `onStartupFinished` so the Sessions panel works in any workspace — even those without `.agent/` or `.gw/` directories. This means the extension is active in all workspaces. The startup overhead is minimal (~50 ms). If you only want it active in agent-workflow repos, remove `onStartupFinished` from `activationEvents` in a local extension build.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentTasks.directories` | `[".agent", ".gw"]` | Directories to scan for artifacts. Order = priority. Empty array falls back to the defaults. |
| `agentTasks.sortBy` | `"date"` | How to sort: `"date"`, `"name"`, or `"status"`. |
| `agentTasks.sortOrder` | `"desc"` | Sort direction: `"asc"` or `"desc"`. |
| `agentTasks.autoOpenWalkthrough` | `true` | Auto-open `walkthrough.md` in Preview when created. |
| `agentTasks.autoOpenPlan` | `true` | Auto-open `plan.md` in Preview when created. |
| `agentTasks.openMarkdownInPreview` | `true` | Open artifact files in Markdown Preview mode. |
| `agentTasks.sessions.openWith` | `"resume"` | What to do when a session is clicked: `"resume"` opens a terminal in the session's original CWD and runs `claude --resume <session-id>`; `"editor"` opens the JSONL file instead. |
| `agentTasks.sessions.scope` | `"all"` | Which worktrees the Sessions panel includes: `"all"` shows every worktree (grouped, current first); `"current"` shows only the current worktree. Toggle quickly via the filter icon in the panel header. |

### Configurable directories

By default the extension scans `.agent/` (primary) and `.gw/` (legacy fallback). You can change this:

```jsonc
// .vscode/settings.json
{
  "agentTasks.directories": [".agent", ".gw"]
}
```

To add a custom directory:

```jsonc
{
  "agentTasks.directories": [".agent", ".workflow", ".gw"]
}
```

If you set the array to `[]`, the extension silently falls back to the defaults `[".agent", ".gw"]`.

**Note:** Adding a new directory name requires a VS Code window reload to activate the extension in workspaces that only contain the new directory (because `activationEvents` are static). The built-in defaults `.agent` and `.gw` activate automatically.

### Migrating from `gw.*` settings

If you previously used `vscode-gw` (gw Worktrees) with Agent Tasks, the settings have moved to the `agentTasks.*` namespace. Re-configure your preferences:

- `gw.agentTasksSortBy` → `agentTasks.sortBy`
- `gw.agentTasksSortOrder` → `agentTasks.sortOrder`
- `gw.autoOpenWalkthrough` → `agentTasks.autoOpenWalkthrough`
- `gw.openMarkdownInPreview` → `agentTasks.openMarkdownInPreview`

## Commands

| Command | Description |
|---------|-------------|
| `Agent Tasks: Refresh Agent Tasks` | Reload the tree from disk |
| `Agent Tasks: Sort Agent Tasks` | Interactive sort picker |
| `Agent Tasks: Focus Agent Tasks Sidebar` | Focus the sidebar panel |
| `Agent Tasks: Refresh Sessions` | Reload the Sessions panel and rebuild the file watcher |
| `Agent Tasks: Toggle Sessions Scope` | Switch between current-worktree and all-worktrees views |

## Logging

The extension writes structured timestamped logs to a dedicated output channel — open it via **View → Output → mthines.agent-tasks**. The channel records activation, command invocations, watcher rebuilds, session refresh events, terminal lifecycle (create / focus existing / close), and errors. Useful when reporting issues or sanity-checking why a session doesn't appear.

## Artifacts recognized

The extension reads:

- `task.md` — task progress with phase, in-progress markers, sub-tasks, blockers, decisions
- `plan.md` — plan frontmatter, summary, files to create/modify, complexity
- `walkthrough.md` — post-implementation summary and files-changed table

These are written by the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill's companion skills (`create-plan`, `create-walkthrough`).

## Requirements

- VS Code 1.85.0 or later
- A workspace with `.agent/` or `.gw/` artifact directories (or custom via `agentTasks.directories`)
