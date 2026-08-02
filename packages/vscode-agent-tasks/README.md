# Agent Tasks

Visualize autonomous agent workflow artifacts (`checks.yaml`, `plan.md`, `task.md`, `walkthrough.md`, `diagnose-*.md`) in the VS Code sidebar. Works with any workflow that writes artifacts to `.agent/` or `.gw/` directories — including the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill.

## Features

- **Agent Tasks sidebar** — browse all in-flight and completed agent tasks by branch
- **Executable checks** — `checks.yaml` renders first and expanded, one row per acceptance criterion, with a `✓ pass/total` rollup on the branch row and live status as the executor flips each check. A check going `unsatisfiable` (the executor is blocked) raises a warning notification; a failing check does not
- **Task progress** — see phase, status (in-progress/blocked/completed), and sub-tasks at a glance
- **Plan viewer** — inspect the plan summary, files to create/modify, and complexity estimate; opt-in `plan.v{N}.md` snapshots group under "Previous Versions"
- **Diagnose reports** — surface every `diagnose-{target}.md` produced by `/create-skill diagnose <target>` next to the plan and walkthrough, with the failure class and confidence score in the row description
- **Walkthrough, plan, and diagnose auto-open** — when a `walkthrough.md`, `plan.md`, or new `diagnose-*.md` is created, the extension opens it automatically in a persistent editable editor tab (each toggleable)
- **Configurable directories** — scan `.agent/`, `.gw/`, or any custom directory name
- **Sort** — sort by date, name, or status; ascending or descending
- **Sessions panel** — view Claude Code session history for the current workspace and sibling worktrees; click to open the transcript or resume the session in a terminal
- **PR status badges** — the Sessions panel enriches each branch with its Pull Request state (open, CI failing, merged, closed) via the `gh` CLI, polled every 90 s. Toggle with `agentTasks.sessions.prLinkage`
- **Session filtering** — narrow the panel to the sessions you care about (active, open PR, merged/closed PR, idle-without-PR, stalled) via the filter icon in the panel header

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
- **Label** — the first user message, whitespace-collapsed and truncated
- **Description** — relative time (`now / 5m / 3h / 2d / Apr 17`)
- **Icon** — reflects a real run-state derived from JSONL turn analysis combined with file mtime:
  - **🔵 Blue pulse — `running`**: claude is mid-turn (last `assistant.stop_reason ≠ end_turn` or a follow-up `user` event after a turn end), AND the file was written in the last 30 seconds.
  - **🟢 Green chat-bubble — `needs-input`**: claude finished a turn (last `assistant.stop_reason = end_turn` OR a `system subtype = turn_duration` event followed the last user input). Waiting for your reply.
  - **🟡 Yellow warning — `stalled`**: mid-turn JSONL state, but no writes for 30 s – 5 min. Claude likely died mid-response.
  - **⚪️ Gray history — `idle`**: nothing relevant in the last hour.

These states come from real JSONL semantics, not just file activity, so they're stable across paused sessions, slow-tool calls, and external editor saves.

The panel auto-refreshes every 15 seconds while visible (and immediately on JSONL writes via a 50 ms-debounced file watcher) so transitions between states feel realtime.

Hover over a session for a tooltip with last activity, branch, message count, session ID, CWD, and file path.

### Running section

When at least one Claude session is currently active — either with a `claude --resume` terminal open in this VS Code window, or with JSONL activity in the last 2 minutes (covering other windows / external terminals) — a pinned **Running (N)** section appears at the top of the panel. Click any item to focus its terminal (same window) or open a fresh resume terminal (cross-window). The section is hidden entirely when nothing is running, so the panel stays uncluttered. Sessions still appear in their worktree group below — Running is a shortcut, not a replacement.

### Worktree grouping

When the workspace is part of a multi-worktree setup (gw-managed or plain git), sessions are grouped by worktree. The current worktree is pinned to the top, marked **(current)**, and expanded by default; other worktrees are collapsed. Discovery priority: `.gw/config.json` (sibling worktrees) → `git worktree list --porcelain` → just the workspace path. Single-worktree workspaces show a flat list.

Sessions launched from sub-directories of a worktree (e.g. `apps/api/` inside `feat/foo/`) are also surfaced and bucketed under their parent worktree by reading the `cwd` field on the session events.

### Filtering

Use the **filter icon** in the Sessions panel header (or the command **Toggle Sessions Scope**) to switch between:
- **All worktrees** (default) — every worktree's sessions, grouped, current first
- **Current worktree only** — flat list of just this worktree's sessions

The choice is persisted in `agentTasks.sessions.scope`.

### Searching

Use the **search icon** in the Sessions panel header (or the command **Find Session…**) to open a QuickPick across **every** session for this workspace — regardless of the scope filter. Type to fuzzy-match against the message title, branch, or CWD; press Enter to open the picked session via the same `openWith` setting (resume by default).

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
| `agentTasks.autoOpenWalkthrough` | `true` | Auto-open `walkthrough.md` in an editable editor tab when created. |
| `agentTasks.autoOpenPlan` | `true` | Auto-open `plan.md` in an editable editor tab when created. |
| `agentTasks.autoOpenDiagnose` | `true` | Auto-open a `diagnose-{target}.md` report the first time it is created. Re-runs of `/create-skill diagnose` against the same target overwrite the report in place and do not re-open it. |
| `agentTasks.openMarkdownInPreview` | `true` | Open known artifact files (plan/task/walkthrough/diagnose) in Markdown Preview mode. `checks.yaml` always opens as a text document; other/unknown markdown rows always open as an editable editor tab. |
| `agentTasks.notifyUnsatisfiableCheck` | `true` | Warn when a check in `checks.yaml` transitions to `unsatisfiable` — the executor's signal that it is blocked and needs input. Failing checks are a normal part of the loop and never notify. |
| `agentTasks.scope` | `"all"` | Which worktrees the Agent Tasks panel includes: `"all"` shows every worktree (grouped, current first); `"current"` shows only the current worktree. Toggle via the filter icon in the panel header. |
| `agentTasks.hooks.enabled` | `true` | Show sessions updating live via the [`agent-tasks-hooks`](https://github.com/mthines/agent-skills/tree/main/plugins/agent-tasks-hooks) plugin. When off, the panel still works but updates lag a few seconds behind. |
| `agentTasks.sessions.openWith` | `"resume"` | What to do when a session is clicked: `"resume"` opens a terminal in the session's original CWD and runs `claude --resume <session-id>`; `"editor"` opens the JSONL file instead. |
| `agentTasks.sessions.scope` | `"all"` | Which worktrees the Sessions panel includes: `"all"` shows every worktree (grouped, current first); `"current"` shows only the current worktree. Toggle quickly via the filter icon in the panel header. |
| `agentTasks.sessions.prLinkage` | `true` | Show PR status badges in the Sessions panel. Requires the `gh` CLI. When off, no `gh` subprocess calls are made and all sessions show JSONL-derived status icons. |
| `agentTasks.sessions.filter.showActive` | `true` | Show active sessions: running, waiting for input, or unread. |
| `agentTasks.sessions.filter.showOpenPr` | `true` | Show idle sessions whose branch has an open or draft Pull Request. |
| `agentTasks.sessions.filter.showMergedClosedPr` | `false` | Show idle sessions whose Pull Request has been merged or closed. |
| `agentTasks.sessions.filter.showIdleNoPr` | `false` | Show idle sessions whose branch has no Pull Request. |
| `agentTasks.sessions.filter.showStalled` | `true` | Show stalled sessions (mid-turn but no recent writes). |

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
| `Agent Tasks: Find Session…` | Fuzzy-search every session for this workspace and open the picked one |
| `Agent Tasks: Group by Worktree` | Switch the Sessions panel between current-worktree and all-worktrees views |
| `Agent Tasks: Toggle Agent Tasks Scope (current / all worktrees)` | Same toggle for the Agent Tasks panel |
| `Agent Tasks: New Claude Session` | Start a new `claude` session in the workspace root — the `+` icon in the Sessions panel header |
| `Agent Tasks: Filter Sessions…` | Pick which session categories the panel shows (active, open PR, merged/closed PR, idle, stalled) |
| `Agent Tasks: Show All Sessions` | Clear the filter — show every session |
| `Agent Tasks: Show Fewer Sessions (Restore Default Filter)` | Restore the default filter set |
| `Agent Tasks: Turn on live session updates` | Install / re-enable the `agent-tasks-hooks` plugin for real-time status |
| `Agent Tasks: Open Pull Request` | Open the PR for the selected session's branch |
| `Agent Tasks: Create Pull Request` | Create a PR for the selected session's branch |
| `Agent Tasks: Reveal in Finder` | Reveal the selected row's file or directory in the OS file manager |
| `Agent Tasks: Copy Path` | Copy the selected row's absolute path to the clipboard |
| `Agent Tasks: Delete…` | Delete the selected artifact after confirmation (uses the trash, recoverable) |

## Logging

The extension writes structured timestamped logs to a dedicated output channel — open it via **View → Output → mthines.agent-tasks**. The channel records activation, command invocations, watcher rebuilds, session refresh events, terminal lifecycle (create / focus existing / close), and errors. Useful when reporting issues or sanity-checking why a session doesn't appear.

## Artifacts recognized

The extension reads:

- `checks.yaml` — the executable acceptance-check ledger written by `aw-create-plan`, one entry per acceptance criterion, whose `status:` the executor flips live (`pending | pass | fail | unsatisfiable`). This is the branch's **primary** artifact, so it renders first and expanded, with a compact `✓ pass/total` rollup on the branch row. The extension is a strictly read-only observer — check definitions are immutable to the executor, and `checks.yaml` is deliberately not deletable on its own.
- `task.md` — task progress with phase, in-progress markers, sub-tasks, blockers, decisions
- `plan.md` — plan frontmatter, summary, files to create/modify, complexity
- `plan.v{N}.md` — opt-in immutable plan snapshots (written only when `aw-create-plan` runs with the `snapshot` arg), grouped newest-first under a "Previous Versions" node
- `walkthrough.md` — post-implementation summary and files-changed table
- `diagnose-{target}.md` — retrospective failure-analysis reports produced by `/create-skill diagnose <target>`. The row label carries the target skill name; the description shows the failure class and confidence score parsed from the header bullet list (`- Failure class: …`, `- Confidence (Step 6): N%`). Multiple targets coexist as siblings under the same branch.

These are written by the [`autonomous-workflow`](https://github.com/mthines/agent-skills) skill's companion skills (`aw-create-plan`, `aw-create-walkthrough`) and by `/create-skill diagnose`.

## Requirements

- VS Code 1.85.0 or later
- A workspace with `.agent/` or `.gw/` artifact directories (or custom via `agentTasks.directories`) — the Sessions panel works in any workspace
- [`gh`](https://cli.github.com) — optional, only for the Sessions panel's PR status badges. Without it a one-time notice fires and every session falls back to JSONL-derived status. Disable the feature entirely with `agentTasks.sessions.prLinkage: false`.
- [Claude Code](https://claude.com/claude-code) — optional, for the Sessions panel and click-to-resume (`claude --resume <id>`)
- The [`agent-tasks-hooks`](https://github.com/mthines/agent-skills/tree/main/plugins/agent-tasks-hooks) plugin — optional, for real-time session status instead of a few seconds of lag
