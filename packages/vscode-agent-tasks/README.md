# Agent Tasks

Visualize autonomous agent workflow artifacts (`plan.md`, `task.md`, `walkthrough.md`) in the VS Code sidebar. Works with any workflow that writes artifacts to `.agent/` or `.gw/` directories — including the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill.

## Features

- **Agent Tasks sidebar** — browse all in-flight and completed agent tasks by branch
- **Task progress** — see phase, status (in-progress/blocked/completed), and sub-tasks at a glance
- **Plan viewer** — inspect the plan summary, files to create/modify, and complexity estimate
- **Walkthrough & plan auto-open** — when a `walkthrough.md` or `plan.md` is created, the extension opens it automatically in Markdown Preview (each toggleable)
- **Configurable directories** — scan `.agent/`, `.gw/`, or any custom directory name
- **Sort** — sort by date, name, or status; ascending or descending

## Install

Search for **Agent Tasks** in the VS Code Marketplace or install by ID:

```
mthines.agent-tasks
```

## Usage

1. Open a workspace that contains a `.agent/` or `.gw/` directory with artifacts.
2. Click the **Agent Tasks** icon in the Activity Bar.
3. Expand a branch entry to see tasks, plan, and walkthrough.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentTasks.directories` | `[".agent", ".gw"]` | Directories to scan for artifacts. Order = priority. Empty array falls back to the defaults. |
| `agentTasks.sortBy` | `"date"` | How to sort: `"date"`, `"name"`, or `"status"`. |
| `agentTasks.sortOrder` | `"desc"` | Sort direction: `"asc"` or `"desc"`. |
| `agentTasks.autoOpenWalkthrough` | `true` | Auto-open `walkthrough.md` in Preview when created. |
| `agentTasks.autoOpenPlan` | `true` | Auto-open `plan.md` in Preview when created. |
| `agentTasks.openMarkdownInPreview` | `true` | Open artifact files in Markdown Preview mode. |

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
