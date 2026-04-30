# vscode-agent-tasks

VS Code extension for visualizing autonomous agent workflow artifacts.

## Commands

```bash
# Development
nx dev vscode-agent-tasks         # Watch mode with esbuild

# Build
nx build vscode-agent-tasks       # Build extension
nx package vscode-agent-tasks     # Create .vsix package

# Testing
nx test vscode-agent-tasks        # Run vitest tests
nx lint vscode-agent-tasks        # Run ESLint

# Publishing
nx release vscode-agent-tasks     # Publish to VS Code Marketplace + Open VSX
nx release vscode-agent-tasks --configuration=dry-run  # Dry-run release
```

## Architecture

```
src/
  extension.ts              # Entry point, command registration
  providers/                # TreeDataProviders for sidebar views
    agent-tasks-provider    # Agent tasks explorer view
    sessions-provider       # Sessions panel — lists Claude Code session history
  parsers/                  # Parsing utilities (NO VS Code dependency — testable with vitest)
    markdown-parser.ts      # Parses task.md, plan.md, walkthrough.md
    session-jsonl-parser.ts # Parses ~/.claude/projects/<encoded-cwd>/*.jsonl files
  watchers/                 # File system watchers
    artifact-watcher.ts     # Watches .agent/.gw dirs for artifact changes
    session-watcher.ts      # Watches ~/.claude/projects/<encoded-cwd>/ for JSONL changes
```

## Key Concepts

- **Artifact directories** — configured via `agentTasks.directories` (default: `[".agent", ".gw"]`); the extension scans each in order
- **Agent Tasks** — read from `<dir>/<branch>/` directories (`task.md`, `plan.md`, `walkthrough.md`)
- **Artifact Watcher** — watches configured dirs for changes, triggers view refresh; auto-opens `walkthrough.md` and `plan.md` on creation; rebuilds watchers when `agentTasks.directories` changes or a configured root appears after activation
- **Bare-repo indirection** — only for `.gw/`: reads `config.json` to find the default-branch worktree's `.gw/` dir
- **Sessions** — read from `~/.claude/projects/<encoded-cwd>/` JSONL files; `<encoded-cwd>` replaces every `/` in the absolute workspace path with `-`. Status is a heuristic derived from file mtime (active <2m, recent <1h, idle otherwise)
- **Session Watcher** — watches the session directories; debounces at 500 ms (vs 150 ms for artifacts) because JSONL files are written continuously during active sessions
- **Worktree grouping in Sessions** — checks `.gw/config.json` first; falls back to `git worktree list --porcelain`; shows flat list when only one worktree detected

## Configuration namespace

All settings use `agentTasks.*` (NOT `gw.*`):

- `agentTasks.directories` — artifact directory names (array)
- `agentTasks.sortBy` — sort field (`date`/`name`/`status`)
- `agentTasks.sortOrder` — sort direction (`asc`/`desc`)
- `agentTasks.autoOpenWalkthrough` — auto-open `walkthrough.md` on create
- `agentTasks.autoOpenPlan` — auto-open `plan.md` on create
- `agentTasks.openMarkdownInPreview` — preview mode
- `agentTasks.sessions.openWith` — `"editor"` (default) or `"resume"` — what clicking a session does

## Extension Manifest

All commands, views, settings, and keybindings are defined in `package.json`:

- Commands: `contributes.commands` (all `agentTasks.*`)
- Views: `contributes.views` (`agentTasksExplorer` and `agentSessionsExplorer` inside `agentTasks` activity bar)
- Settings: `contributes.configuration` (`agentTasks.*` namespace)
- Activation: `workspaceContains:.agent`, `workspaceContains:.gw`, `onStartupFinished`, `onView:agentSessionsExplorer`

## Command IDs

| Command | Description |
|---------|-------------|
| `agentTasks.refresh` | Refresh Agent Tasks tree |
| `agentTasks.sort` | Sort picker QuickPick |
| `agentTasks.focus` | Focus sidebar |
| `agentTasks.openMarkdown` | Internal — open a markdown file path |
| `agentTasks.openPlan` | Open plan.md for a branch item |
| `agentTasks.openTask` | Open task.md for a branch item |
| `agentTasks.openWalkthrough` | Open walkthrough.md for a branch item |
| `agentTasks.sessions.refresh` | Refresh Sessions tree |
| `agentTasks.sessions.openSession` | Internal — open or resume a session (registered on SessionItem) |

## Code Style

- Use explicit return types on exported functions
- Prefer `interface` over `type` for object shapes
- Use `vscode.` prefix for VS Code API types (not bare imports)
- Commands receive optional TreeItem argument from context menus

## Testing

- Unit tests use vitest with `.test.ts` suffix alongside source files
- Test parsers directly (no VS Code API mocking needed)
- Parsers are pure functions — isolate from VS Code types
- `vscode` import will fail in vitest — keep parsers clean of VS Code deps

## Gotchas

- VS Code API only available in extension context, not in tests
- `vscode` import will fail in vitest — isolate parsers from VS Code types
- The bare-repo `.gw/config.json` indirection only fires when `dirName === '.gw'`
- Do NOT add ANSI handling, git CLI calls, or QuickPick to the parsers
- Sessions JSONL format is undocumented and owned by the Claude Code team — all parsing is in `session-jsonl-parser.ts`; unknown events are silently skipped
- `vi.spyOn(fs, ...)` does not work with ESM modules in vitest — use real temp directories for parser tests instead of mocking `fs`
- Session status icons are heuristic (mtime-based) — document this caveat clearly in any user-facing text
