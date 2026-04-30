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
  extension.ts           # Entry point, command registration
  providers/             # TreeDataProviders for sidebar views
    agent-tasks-provider # Agent tasks explorer view
  parsers/               # Markdown parsing utilities
    markdown-parser.ts   # Parses task.md, plan.md, walkthrough.md
  watchers/              # File system watchers for artifact directories
    artifact-watcher.ts  # Watches configured dirs for changes
```

## Key Concepts

- **Artifact directories** — configured via `agentTasks.directories` (default: `[".agent", ".gw"]`); the extension scans each in order
- **Agent Tasks** — read from `<dir>/<branch>/` directories (`task.md`, `plan.md`, `walkthrough.md`)
- **Artifact Watcher** — watches configured dirs for changes, triggers view refresh; auto-opens `walkthrough.md` on creation
- **Bare-repo indirection** — only for `.gw/`: reads `config.json` to find the default-branch worktree's `.gw/` dir

## Configuration namespace

All settings use `agentTasks.*` (NOT `gw.*`):

- `agentTasks.directories` — artifact directory names (array)
- `agentTasks.sortBy` — sort field (`date`/`name`/`status`)
- `agentTasks.sortOrder` — sort direction (`asc`/`desc`)
- `agentTasks.autoOpenWalkthrough` — auto-open on create
- `agentTasks.openMarkdownInPreview` — preview mode

## Extension Manifest

All commands, views, settings, and keybindings are defined in `package.json`:

- Commands: `contributes.commands` (all `agentTasks.*`)
- Views: `contributes.views` (`agentTasksExplorer` inside `agentTasks` activity bar)
- Settings: `contributes.configuration` (`agentTasks.*` namespace)
- Activation: `workspaceContains:.agent` and `workspaceContains:.gw`

## Command IDs

| Command | Description |
|---------|-------------|
| `agentTasks.refresh` | Refresh tree |
| `agentTasks.sort` | Sort picker QuickPick |
| `agentTasks.focus` | Focus sidebar |
| `agentTasks.openMarkdown` | Internal — open a markdown file path |
| `agentTasks.openPlan` | Open plan.md for a branch item |
| `agentTasks.openTask` | Open task.md for a branch item |
| `agentTasks.openWalkthrough` | Open walkthrough.md for a branch item |

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
