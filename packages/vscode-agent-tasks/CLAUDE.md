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
    logger.ts                       # `mthines.agent-tasks` OutputChannel wrapper
    worktree-discovery.ts           # Shared worktree discovery helpers (pure Node.js, vitest-testable)
    session-artifact-correlator.ts  # Pure helper — `(worktree, branch, dirs)` → linked artifact file paths
  providers/                # TreeDataProviders for sidebar views
    agent-tasks-provider    # Agent tasks explorer view — multi-worktree groups + scope toggle
    sessions-provider       # Sessions panel — Running section + worktree groups + artifact correlation
  parsers/                  # Pure modules — NO VS Code dependency, vitest-testable
    markdown-parser.ts      # Parses task.md, plan.md, walkthrough.md
    session-jsonl-parser.ts # Parses ~/.claude/projects/<encoded-cwd>/*.jsonl files
  watchers/                 # File system watchers
    artifact-watcher.ts     # Watches .agent/.gw dirs for artifact changes — refreshes BOTH Agent Tasks AND Sessions trees
    session-watcher.ts      # Watches ~/.claude/projects/<encoded-cwd>/ for JSONL changes
```

## Key Concepts

- **Artifact directories** — configured via `agentTasks.directories` (default: `[".agent", ".gw"]`); the extension scans each in order
- **Agent Tasks** — read from `<dir>/<branch>/` directories (`task.md`, `plan.md`, `walkthrough.md`)
- **Multi-worktree artifact discovery** — `ArtifactWatcher.findArtifactRoots()` enumerates `<worktreePath>/<configuredDir>/` for every worktree returned by `discoverWorktreePaths()` in addition to the walk-up logic. This ensures `autoOpenPlan` fires when a planner agent writes `plan.md` into a sibling worktree's `.agent/` directory.
- **Artifact Watcher** — watches configured dirs for changes, triggers view refresh; auto-opens `walkthrough.md` and `plan.md` on creation; rebuilds watchers when `agentTasks.directories` changes or a configured root appears after activation; watches all sibling worktrees
- **Bare-repo indirection** — only for `.gw/`: reads `config.json` to find the default-branch worktree's `.gw/` dir
- **Worktree grouping in Agent Tasks** — mirrors Sessions panel; `discoverWorktreePaths()` enumerates all worktrees; current worktree pinned first and expanded; others collapsed. Single-worktree shows flat. `WorktreeArtifactGroupItem` is the group node for 2+ branches.
- **1-branch flatten rule** — when a multi-worktree group contains exactly 1 `AgentBranchItem`, a `WorktreeFlatItem` is emitted instead of `WorktreeArtifactGroupItem`. The flattened node IS the branch: expanding it shows Tasks/Plan/Walkthrough directly (no intermediate branch level). Its icon and description are derived from the branch state via the shared `getBranchIcon()` / `getBranchDescription()` free functions. Context values `agentWorktreeFlat` / `agentWorktreeFlatCompleted` mirror `agentBranch` / `agentBranchCompleted` so inline Open Plan / Open Walkthrough actions appear. The `openPlan`, `openTask`, and `openWalkthrough` commands resolve `WorktreeFlatItem → item.branch` before reading `artifactDir`.
- **Agent Tasks scope toggle** — `agentTasks.scope` (`"all"` default | `"current"`). When `"current"`, flat list for the current worktree only. `EmptyScopeItem` shows a helpful placeholder when the current worktree is empty but others have artifacts. Toggle via the filter icon in the panel header.
- **Shared worktree discovery** — `src/lib/worktree-discovery.ts` exports `findGwRoot`, `getWorktreePathsFromGw`, `getWorktreePathsFromGit`, `discoverWorktreePaths`. Used by both Sessions and Agent Tasks providers and by `ArtifactWatcher`. Pure Node.js — no VS Code API — vitest-testable.
- **Panel order** — Sessions panel appears FIRST (above Agent Tasks) in the activity bar because it is the higher-frequency surface.
- **Session encoding** — `~/.claude/projects/<encoded-cwd>/` where `<encoded-cwd>` replaces every non-`[A-Za-z0-9-]` character with `-` (`.git` → `-git`, spaces → `-`, leading `.` → `-`). NOT just slash replacement.
- **Session run-state** — four real states from JSONL turn analysis combined with mtime: `running` (mid-turn, fresh writes), `needs-input` (last `assistant.stop_reason = end_turn` OR `system subtype = turn_duration` followed last user), `stalled` (mid-turn, no writes 30 s–5 min), `idle`. `deriveRunState(turnEnded, mtime)` is pure in `session-jsonl-parser.ts`; the provider layers terminal-open / closed-after-mtime overrides for definitive signals.
- **Subdir-aware session discovery** — `findCandidateSessionDirs` prefix-matches `~/.claude/projects/*` against every worktree's encoded path, then `bucketSessionsByWorktree` verifies each session's `cwd` field and assigns to the longest-matching worktree. Catches sessions started from `apps/api/`, `packages/x/`, etc.
- **Pinned Running section** — `RunningGroupItem` is prepended at the top of the tree whenever any session is `running` or recently `needs-input` (terminal open in this window OR mtime <5 min). Hidden entirely when empty. Sessions also still appear in their worktree group below — this is a shortcut, not a replacement.
- **Worktree grouping in Sessions** — gw-aware (walks up to find `.gw/config.json`, then enumerates sibling worktrees by `.git` file marker) → falls back to `git worktree list --porcelain` → finally just the workspace path. Multi-worktree always groups; current worktree pinned first and marked `(current)`. Single-worktree shows flat.
- **Session Watcher** — 50 ms trailing debounce (was 500 ms — kept tight for realtime icon transitions). 15 s visibility-bound refresh tick drives `running → stalled` ageing-out without waiting on file events.
- **Per-session terminal tracking** — `extension.ts` maintains a `Map<sessionId, vscode.Terminal>` so re-clicking a session focuses its existing tab instead of spawning a duplicate. `onDidCloseTerminal` cleans up. Cross-window is impossible — VS Code's API is window-scoped.
- **Parse cache** — `parseSessionFile` is mtime-keyed; unchanged JSONL files skip read+parse on refresh. Bounded by unique session count (tens to hundreds).
- **Session ↔ artifact correlation** — `findLinkedArtifacts(worktreePath, gitBranch, configuredDirs)` in `lib/session-artifact-correlator.ts` joins a session to its `<worktree>/<dir>/<branchName>/{task,plan,walkthrough}.md` files. The bucket worktree (longest match for `session.cwd`) is the correlation root, paired with `session.gitBranch`. When any artifact exists, the `SessionItem` becomes collapsible (`contextValue = claudeSessionWithArtifacts`), the row-click `command` is dropped (so single-click expands cleanly), and a `$(play)` inline action exposes Resume. `LinkedArtifactItem` children open via `agentTasks.openMarkdown`. The correlation map is rebuilt on every `buildRootItems` and on every `artifactWatcher.onArtifactChanged` event so chevrons appear/disappear live.

## Configuration namespace

All settings use `agentTasks.*` (NOT `gw.*`):

- `agentTasks.directories` — artifact directory names (array)
- `agentTasks.sortBy` — sort field (`date`/`name`/`status`)
- `agentTasks.sortOrder` — sort direction (`asc`/`desc`)
- `agentTasks.autoOpenWalkthrough` — auto-open `walkthrough.md` on create
- `agentTasks.autoOpenPlan` — auto-open `plan.md` on create
- `agentTasks.openMarkdownInPreview` — preview mode
- `agentTasks.scope` — `"all"` (default — every worktree, grouped) or `"current"` (just the active worktree, flat). Toggle via filter icon in Agent Tasks panel header.
- `agentTasks.sessions.openWith` — `"resume"` (default — open terminal in session's `cwd` and run `claude --resume <id>`) or `"editor"` (open the JSONL transcript)
- `agentTasks.sessions.scope` — `"all"` (default — every worktree, grouped) or `"current"` (just the active worktree). Toggle via filter icon in Sessions panel header.

## Extension Manifest

All commands, views, settings, and keybindings are defined in `package.json`:

- Commands: `contributes.commands` (all `agentTasks.*`)
- Views: `contributes.views` (`agentSessionsExplorer` FIRST, then `agentTasksExplorer` inside `agentTasks` activity bar — Sessions is the higher-frequency surface)
- Settings: `contributes.configuration` (`agentTasks.*` namespace)
- Activation: `workspaceContains:.agent`, `workspaceContains:.gw`, `onStartupFinished`, `onView:agentSessionsExplorer`

## Command IDs

| Command | Description |
|---------|-------------|
| `agentTasks.refresh` | Refresh Agent Tasks tree |
| `agentTasks.sort` | Sort picker QuickPick |
| `agentTasks.focus` | Focus sidebar |
| `agentTasks.toggleScope` | Toggle `current` / `all` worktrees in the Agent Tasks panel |
| `agentTasks.openMarkdown` | Internal — open a markdown file path |
| `agentTasks.openPlan` | Open plan.md for a branch item |
| `agentTasks.openTask` | Open task.md for a branch item |
| `agentTasks.openWalkthrough` | Open walkthrough.md for a branch item |
| `agentTasks.sessions.refresh` | Refresh Sessions tree |
| `agentTasks.sessions.openSession` | Internal — open or resume a session (registered on SessionItem) |
| `agentTasks.sessions.toggleScope` | Toggle `current` / `all` worktrees in the Sessions panel |
| `agentTasks.sessions.find` | Open a QuickPick across every session for this workspace |

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
