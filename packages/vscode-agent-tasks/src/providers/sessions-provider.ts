/**
 * TreeDataProvider for the "Sessions" panel.
 *
 * Surfaces Claude Code session history from `~/.claude/projects/<encoded-cwd>/`
 * for the current workspace and optionally for sibling worktrees when detected
 * via `.gw/config.json` or `git worktree list --porcelain`.
 *
 * Tree structure:
 *   Single worktree → flat list of SessionItems
 *   Multiple worktrees → WorktreeGroupItems (each containing SessionItems)
 *
 * NOTE: This provider depends on the VS Code API and cannot be unit-tested with
 * vitest. Manual smoke-test checklist is in the PR description / walkthrough.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {
  SessionMetadata,
  SessionStatus,
  getSessionStatus,
  getSessionsDir,
  parseSessionsInDir,
} from '../parsers/session-jsonl-parser';

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

/**
 * Format a millisecond age as a human-readable relative-time string.
 * Uses simple integer rounding — no external libraries.
 */
function relativeTime(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Tree item: WorktreeGroupItem
// ---------------------------------------------------------------------------

/**
 * A collapsible group node representing one worktree in a multi-worktree
 * workspace.
 *
 * Label is the last two path segments joined with `/` to keep it readable
 * without being excessively long (full path is in the tooltip).
 *
 * Example:
 *   `/Users/mthines/Workspace/mthines/agent-skills.git/main`
 *   → label: `agent-skills.git/main`
 */
export class WorktreeGroupItem extends vscode.TreeItem {
  constructor(
    public readonly worktreePath: string,
    public readonly sessions: SessionMetadata[]
  ) {
    const segments = worktreePath.split(path.sep).filter(Boolean);
    const label =
      segments.length >= 2
        ? segments.slice(-2).join('/')
        : segments[segments.length - 1] ?? worktreePath;

    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('source-control');
    this.description = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
    this.tooltip = new vscode.MarkdownString(
      `**Worktree:** \`${worktreePath}\`\n\n${sessions.length} session(s)`
    );
    this.contextValue = 'claudeWorktreeGroup';
  }
}

// ---------------------------------------------------------------------------
// Tree item: SessionItem
// ---------------------------------------------------------------------------

/**
 * A leaf node representing one Claude Code session.
 *
 * - Label: first user message truncated to 80 chars
 * - Description: `<branch> · <relative time>`
 * - Icon: varies by mtime-based heuristic status (active/recent/idle)
 * - Tooltip: full title, session ID, message count, last activity, cwd, file path
 *
 * HEURISTIC: icon/status is derived from file mtime — see `getSessionStatus`
 * for caveats.
 */
export class SessionItem extends vscode.TreeItem {
  constructor(public readonly session: SessionMetadata) {
    super(session.title, vscode.TreeItemCollapsibleState.None);

    const status: SessionStatus = getSessionStatus(session.mtime);
    const age = Date.now() - session.mtime;
    const timeStr = relativeTime(age);
    const branch = session.gitBranch ?? '?';

    this.description = `${branch} · ${timeStr}`;
    this.iconPath = SessionItem.iconForStatus(status);
    this.tooltip = SessionItem.buildTooltip(session, timeStr);
    this.contextValue = 'claudeSession';

    // Command fires on click — handled in extension.ts
    this.command = {
      command: 'agentTasks.sessions.openSession',
      title: 'Open Session',
      arguments: [this],
    };
  }

  private static iconForStatus(status: SessionStatus): vscode.ThemeIcon {
    switch (status) {
      case 'active':
        // Blue pulse — heuristic: Claude is likely still writing
        return new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.blue'));
      case 'recent':
        // Blue history — heuristic: session ended recently
        return new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.blue'));
      case 'idle':
      default:
        // Default (gray) history — session is old
        return new vscode.ThemeIcon('history');
    }
  }

  private static buildTooltip(session: SessionMetadata, timeStr: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${session.title}**\n\n`);
    md.appendMarkdown(`**Session ID:** \`${session.sessionId}\`\n\n`);
    md.appendMarkdown(`**Messages:** ${session.messageCount}\n\n`);
    if (session.lastTimestamp) {
      md.appendMarkdown(`**Last activity:** ${session.lastTimestamp} (${timeStr})\n\n`);
    }
    if (session.cwd) {
      md.appendMarkdown(`**CWD:** \`${session.cwd}\`\n\n`);
    }
    md.appendMarkdown(`**File:** \`${session.filePath}\`\n\n`);
    md.appendMarkdown(
      `\n\n_Status icon is a heuristic based on file mtime and may not reflect actual session state._`
    );
    return md;
  }
}

// ---------------------------------------------------------------------------
// Union type for provider elements
// ---------------------------------------------------------------------------

type SessionTreeItem = WorktreeGroupItem | SessionItem;

// ---------------------------------------------------------------------------
// Worktree discovery helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `startPath` up to `maxLevels` ancestors looking for a
 * `.gw/config.json` file. Returns the parsed config object or null.
 */
function findGwConfig(startPath: string, maxLevels = 5): { root?: string; defaultBranch?: string } | null {
  let dir = startPath;
  for (let i = 0; i < maxLevels; i++) {
    const configPath = path.join(dir, '.gw', 'config.json');
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content) as { root?: string; defaultBranch?: string };
    } catch {
      // Not found at this level — try parent
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Enumerate worktree paths using `.gw/config.json`.
 *
 * Reads `root` from the config and lists subdirectories that contain a `.git`
 * file (worktree marker, not a directory `.git` which would be the main repo).
 */
function getWorktreePathsFromGwConfig(workspacePath: string): string[] | null {
  const config = findGwConfig(workspacePath);
  if (!config?.root) return null;

  const root = config.root;
  let subdirs: fs.Dirent[];
  try {
    subdirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const paths: string[] = [];
  for (const entry of subdirs) {
    if (!entry.isDirectory()) continue;
    const worktreePath = path.join(root, entry.name);
    // A git worktree (not the bare repo itself) has a `.git` FILE
    const gitPath = path.join(worktreePath, '.git');
    try {
      const stat = fs.statSync(gitPath);
      if (stat.isFile()) {
        paths.push(worktreePath);
      }
    } catch {
      // No .git — not a worktree
    }
  }
  return paths.length > 0 ? paths : null;
}

/**
 * Enumerate worktree paths via `git worktree list --porcelain`.
 * Returns null if the command fails (not a git repo, git not installed, etc.).
 */
function getWorktreePathsFromGit(workspacePath: string): string[] | null {
  try {
    const output = child_process.execSync('git worktree list --porcelain', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 3000,
    });

    const paths: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length).trim());
      }
    }
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

/**
 * Return the deduplicated list of worktree paths for the workspace.
 * Always includes the workspace path itself.
 *
 * Priority:
 *   1. `.gw/config.json` if present
 *   2. `git worktree list --porcelain` fallback
 *   3. Just the workspace path (single-worktree / non-git scenario)
 */
function discoverWorktreePaths(workspacePath: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  const add = (p: string) => {
    const normalised = p.replace(/\/$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      paths.push(normalised);
    }
  };

  // Try gw config first
  const gwPaths = getWorktreePathsFromGwConfig(workspacePath);
  if (gwPaths) {
    for (const p of gwPaths) add(p);
    add(workspacePath); // ensure workspace itself is included
    return paths;
  }

  // Fallback to git worktree list
  const gitPaths = getWorktreePathsFromGit(workspacePath);
  if (gitPaths) {
    for (const p of gitPaths) add(p);
    add(workspacePath);
    return paths;
  }

  // Just the workspace
  add(workspacePath);
  return paths;
}

// ---------------------------------------------------------------------------
// SessionsProvider
// ---------------------------------------------------------------------------

export class SessionsProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cache of session dirs being watched — exposed for SessionWatcher rebuild. */
  private _sessionDirs: string[] = [];

  // No constructor arguments required — provider is initialised lazily on first getChildren call.
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {
    // Intentionally empty — provider state is built lazily in buildRootItems()
  }

  /** The session directories currently being observed. */
  get sessionDirs(): string[] {
    return this._sessionDirs;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element instanceof WorktreeGroupItem) {
      return element.sessions.map((s) => new SessionItem(s));
    }

    if (element instanceof SessionItem) {
      return [];
    }

    // Root level — build tree
    return this.buildRootItems();
  }

  /**
   * Build the root-level tree items.
   *
   * If only one worktree has sessions, or all sessions come from the same
   * worktree, show them flat (no WorktreeGroupItem wrapper). Otherwise, group
   * by worktree.
   */
  private buildRootItems(): SessionTreeItem[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const worktreePaths = discoverWorktreePaths(workspacePath);

    // Collect sessions per worktree, track session dirs for watcher
    const sessionDirs: string[] = [];
    const groups: Array<{ worktreePath: string; sessions: SessionMetadata[] }> = [];

    for (const wt of worktreePaths) {
      const dir = getSessionsDir(wt);
      sessionDirs.push(dir);
      const sessions = parseSessionsInDir(dir);
      if (sessions.length > 0) {
        groups.push({ worktreePath: wt, sessions });
      }
    }

    // Update cached session dirs (for watcher rebuild)
    this._sessionDirs = sessionDirs;

    // No sessions anywhere
    if (groups.length === 0) return [];

    // Single worktree OR all sessions from one worktree → show flat
    if (
      worktreePaths.length === 1 ||
      groups.length === 1
    ) {
      // Combine all sessions across groups and sort newest-first
      const allSessions = groups.flatMap((g) => g.sessions).sort((a, b) => b.mtime - a.mtime);
      return allSessions.map((s) => new SessionItem(s));
    }

    // Multiple worktrees — show grouped
    return groups.map((g) => new WorktreeGroupItem(g.worktreePath, g.sessions));
  }
}
