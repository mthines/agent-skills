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
  extension.ts              # Entry point, command registration, terminal tracking
  lib/
    logger.ts               # `mthines.agent-tasks` OutputChannel wrapper
    process-tree.ts         # Pure helpers: `parsePsOutput`, `findClaudeDescendant` — no VS Code dep, vitest-testable
  providers/                # TreeDataProviders for sidebar views
    agent-tasks-provider    # Agent tasks explorer view
    sessions-provider       # Sessions panel — Running section + worktree groups
  parsers/                  # Pure modules — NO VS Code dependency, vitest-testable
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
- **Session encoding** — `~/.claude/projects/<encoded-cwd>/` where `<encoded-cwd>` replaces every non-`[A-Za-z0-9-]` character with `-` (`.git` → `-git`, spaces → `-`, leading `.` → `-`). NOT just slash replacement.
- **Session run-state** — four real states from JSONL turn analysis combined with mtime: `running` (mid-turn, fresh writes), `needs-input` (last `assistant.stop_reason = end_turn` OR `system subtype = turn_duration` followed last user), `stalled` (mid-turn, no writes 30 s–5 min), `idle`. `deriveRunState(turnEnded, mtime)` is pure in `session-jsonl-parser.ts`; the provider layers terminal-open / closed-after-mtime overrides for definitive signals.
- **Subdir-aware session discovery** — `findCandidateSessionDirs` prefix-matches `~/.claude/projects/*` against every worktree's encoded path, then `bucketSessionsByWorktree` verifies each session's `cwd` field and assigns to the longest-matching worktree. Catches sessions started from `apps/api/`, `packages/x/`, etc.
- **Pinned Running section** — `RunningGroupItem` is prepended at the top of the tree whenever any session is `running` or recently `needs-input` (terminal open in this window OR mtime <5 min). Hidden entirely when empty. Sessions also still appear in their worktree group below — this is a shortcut, not a replacement.
- **Worktree grouping in Sessions** — gw-aware (walks up to find `.gw/config.json`, then enumerates sibling worktrees by `.git` file marker) → falls back to `git worktree list --porcelain` → finally just the workspace path. Multi-worktree always groups; current worktree pinned first and marked `(current)`. Single-worktree shows flat.
- **Session Watcher** — 50 ms trailing debounce (was 500 ms — kept tight for realtime icon transitions). 15 s visibility-bound refresh tick drives `running → stalled` ageing-out without waiting on file events.
- **Per-session terminal tracking** — `extension.ts` maintains a `Map<sessionId, vscode.Terminal>` so re-clicking a session focuses its existing tab instead of spawning a duplicate. `onDidCloseTerminal` cleans up. Cross-window is impossible — VS Code's API is window-scoped.
- **Terminal adoption on click** — when `openSession` finds no tracked terminal for a session, `tryAdoptTerminal` runs a one-shot `ps -A -o pid,ppid,command` scan across `vscode.window.terminals`. For each terminal it awaits `terminal.processId` (the shell PID), then calls `findClaudeDescendant` to BFS the process tree for a descendant whose command contains `claude --resume <sid>`. The first match is adopted into `sessionTerminals` and focused; all failures fall through silently to spawn. Sessions started without `--resume <id>` (bare `claude` invocations) are not adoptable in v1. The scan runs only inside `openSession` — never on refresh, watcher tick, or panel render.
- **Parse cache** — `parseSessionFile` is mtime-keyed; unchanged JSONL files skip read+parse on refresh. Bounded by unique session count (tens to hundreds).

## Configuration namespace

All settings use `agentTasks.*` (NOT `gw.*`):

- `agentTasks.directories` — artifact directory names (array)
- `agentTasks.sortBy` — sort field (`date`/`name`/`status`)
- `agentTasks.sortOrder` — sort direction (`asc`/`desc`)
- `agentTasks.autoOpenWalkthrough` — auto-open `walkthrough.md` on create
- `agentTasks.autoOpenPlan` — auto-open `plan.md` on create
- `agentTasks.openMarkdownInPreview` — preview mode
- `agentTasks.sessions.openWith` — `"resume"` (default — open terminal in session's `cwd` and run `claude --resume <id>`) or `"editor"` (open the JSONL transcript)
- `agentTasks.sessions.scope` — `"all"` (default — every worktree, grouped) or `"current"` (just the active worktree). Toggle via filter icon in panel header.

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
| `agentTasks.sessions.toggleScope` | Toggle `current` / `all` worktrees in the Sessions panel |
| `agentTasks.sessions.find` | Open a QuickPick across every session for this workspace |
| `agentTasks.sessions.newSession` | Start a new `claude` session in the workspace root CWD. Appears as a `+` icon in the `agentSessionsExplorer` panel title bar (`navigation@0`). Hidden from command palette. Does not pre-populate `sessionTerminals` — Feature 1's adoption scan handles the next click. |

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
- Sessions JSONL format is undocumented and owned by the Claude Code team — all parsing is in `session-jsonl-parser.ts`; unknown events are silently skipped, but specific markers (`assistant.stop_reason`, `system subtype`) ARE used to derive `turnEnded`
- `vi.spyOn(fs, ...)` does not work with ESM modules in vitest — use real temp directories for parser tests instead of mocking `fs`
- Run-state is real (JSONL turn analysis), not heuristic. The pure `deriveRunState(turnEnded, mtime)` is the source of truth; provider only OVERRIDES it with terminal-open (force `running`) or close-after-mtime (force `idle`) — never invert the derivation
- Worktree-relative encoded-path prefix matching for session dirs over-matches sibling worktrees (`foo` matches `foo-bar` directories). Always verify by reading the session's `cwd` field and assigning to the longest matching worktree.
- VS Code TreeItem `description` is rendered muted/grey and disappears entirely on narrow panels. Keep it short (`5m`, `Apr 17`) — long descriptions get clipped. Branch is in the tooltip.
