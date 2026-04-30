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

Sessions are read from `~/.claude/projects/<encoded-cwd>/` — where `<encoded-cwd>` is your absolute workspace path with every `/` replaced by `-`. For example `/Users/you/myrepo` becomes `-Users-you-myrepo`.

Each session entry shows:
- **Label** — the first user message (up to 80 characters)
- **Description** — the git branch and a relative timestamp (`5m ago`, `2h ago`, etc.)
- **Icon** — reflects a heuristic status based on the file's last-modified time:
  - Blue pulse — **active** (file written within the last 2 minutes)
  - Blue history — **recent** (file written within the last hour)
  - Gray history — **idle** (older than 1 hour)

> **Note:** The status icon is a heuristic derived from file mtime, not a real signal from Claude Code. A paused session that last wrote 90 seconds ago will show as "active" even if Claude has stopped.

Hover over a session for a tooltip with: full first message, session ID, message count, last activity timestamp, CWD, and file path.

### Worktree grouping

When your workspace is a gw-managed bare repo, sessions are automatically grouped by worktree. When `.gw/config.json` is present, sibling worktrees are discovered via that config. Otherwise, `git worktree list` is used as a fallback. If only one worktree is detected, sessions are shown flat (no grouping).

### Click behavior

Clicking a session does one of two things depending on the `agentTasks.sessions.openWith` setting:

| Value | Behavior |
|-------|----------|
| `"editor"` (default) | Opens the JSONL transcript file in the VS Code text editor |
| `"resume"` | Opens a new terminal and runs `claude --resume <session-id>` |

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
| `agentTasks.sessions.openWith` | `"editor"` | What to do when a session is clicked: `"editor"` opens the JSONL file; `"resume"` runs `claude --resume <session-id>` in a new terminal. |

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

## Artifacts recognized

The extension reads:

- `task.md` — task progress with phase, in-progress markers, sub-tasks, blockers, decisions
- `plan.md` — plan frontmatter, summary, files to create/modify, complexity
- `walkthrough.md` — post-implementation summary and files-changed table

These are written by the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill's companion skills (`create-plan`, `create-walkthrough`).

## Requirements

- VS Code 1.85.0 or later
- A workspace with `.agent/` or `.gw/` artifact directories (or custom via `agentTasks.directories`)
