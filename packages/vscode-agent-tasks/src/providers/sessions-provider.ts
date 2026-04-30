/**
 * TreeDataProvider for the "Sessions" panel.
 *
 * Surfaces Claude Code session history from `~/.claude/projects/<encoded-cwd>/`
 * for the current workspace and (optionally) sibling worktrees discovered via
 * `.gw/config.json` or `git worktree list --porcelain`.
 *
 * Tree structure:
 *   - Single worktree → flat list of SessionItems
 *   - Multiple worktrees → WorktreeGroupItems (current first, marked), each
 *     containing SessionItems
 *
 * Sessions started from sub-directories of a worktree (e.g. `apps/api/`) are
 * also surfaced: candidate dirs are matched by encoded prefix, then verified
 * by the `cwd` field on the session events and bucketed under the longest
 * matching worktree.
 *
 * NOTE: This provider depends on the VS Code API and cannot be unit-tested
 * with vitest. Manual smoke-test checklist is in the PR description.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';
import {
  SessionMetadata,
  SessionStatus,
  deriveRunState,
  encodeWorkspacePath,
  getClaudeProjectsDir,
  parseSessionsInDir,
} from '../parsers/session-jsonl-parser';

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Format a session mtime as a compact, human-readable timestamp.
 *
 * Tight format: `now`, `5m`, `3h`, `2d` for recent activity (≤7 days), then
 * absolute `MMM D` for older. The `ago` suffix is dropped — implicit from
 * context in a recency-sorted list and saves 3–4 chars per row, which
 * matters at sidebar widths.
 */
function formatTime(mtimeMs: number, now = Date.now()): string {
  const ageMs = now - mtimeMs;
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return 'now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const d = new Date(mtimeMs);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Tree item: RunningGroupItem
// ---------------------------------------------------------------------------

/**
 * A pinned section at the top of the Sessions tree showing every session
 * the extension considers "running":
 *   - the session's `claude --resume` terminal is open in this VS Code
 *     window (definite signal), OR
 *   - the JSONL file's mtime is within the last 2 minutes (heuristic for
 *     sessions running in another VS Code window or a standalone terminal).
 *
 * The section is hidden entirely when no sessions match — the goal is a
 * zero-noise overview when nothing's running, and an instant "where are my
 * agents?" answer when something is.
 */
export class RunningGroupItem extends vscode.TreeItem {
  constructor(public readonly sessions: SessionMetadata[]) {
    super(`Running (${sessions.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('broadcast', new vscode.ThemeColor('charts.red'));
    this.tooltip = new vscode.MarkdownString(
      `${sessions.length} active session${sessions.length === 1 ? '' : 's'} — ` +
        `terminal open in this window, or recent JSONL activity from another source.`
    );
    this.contextValue = 'claudeRunningGroup';
  }
}

// ---------------------------------------------------------------------------
// Tree item: WorktreeGroupItem
// ---------------------------------------------------------------------------

/**
 * A collapsible group node representing one worktree.
 *
 * Visual treatment:
 *   - current worktree → `circle-filled` (charts.blue), expanded by default,
 *     description "(current) · N"
 *   - other worktrees  → `git-branch` (default color), collapsed, description "N"
 *
 * Label is the last 1–2 path segments, joined with `/`. Full path lives in the
 * tooltip.
 */
export class WorktreeGroupItem extends vscode.TreeItem {
  constructor(
    public readonly worktreePath: string,
    public readonly sessions: SessionMetadata[],
    public readonly isCurrent: boolean
  ) {
    const segments = worktreePath.split(path.sep).filter(Boolean);
    const label =
      segments.length >= 2
        ? segments.slice(-2).join('/')
        : segments[segments.length - 1] ?? worktreePath;

    super(
      label,
      isCurrent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.iconPath = isCurrent
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'))
      : new vscode.ThemeIcon('git-branch');

    const countLabel = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
    this.description = isCurrent ? `(current) · ${countLabel}` : countLabel;

    const md = new vscode.MarkdownString();
    if (isCurrent) md.appendMarkdown(`**Current worktree**\n\n`);
    md.appendMarkdown(`\`${worktreePath}\`\n\n${countLabel}`);
    this.tooltip = md;

    this.contextValue = isCurrent ? 'claudeWorktreeGroupCurrent' : 'claudeWorktreeGroup';
  }
}

// ---------------------------------------------------------------------------
// Tree item: SessionItem
// ---------------------------------------------------------------------------

/**
 * A leaf node representing one Claude Code session.
 *
 * Layout:
 *   - Label:       the message text (truncated short — see MAX_TITLE_LEN).
 *   - Description: just the relative time, always (branch is in the tooltip).
 *
 * VS Code renders the description in muted/grey, so the timestamp visually
 * subordinates to the message. Keeping description short — `5m`, `Apr 17` —
 * means it survives narrow panels far more often than `branch · time` did.
 *
 * Status is computed by the provider so it can layer terminal-open / closed
 * signals on top of the raw mtime heuristic.
 */
export class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly session: SessionMetadata,
    options: { status: SessionStatus }
  ) {
    super(session.title, vscode.TreeItemCollapsibleState.None);

    const timeStr = formatTime(session.mtime);
    const branch = session.gitBranch ?? '?';

    this.description = timeStr;
    this.iconPath = SessionItem.iconForStatus(options.status);
    this.tooltip = SessionItem.buildTooltip(session, timeStr, options.status, branch);
    this.contextValue = 'claudeSession';

    // Command fires on click — handled in extension.ts
    this.command = {
      command: 'agentTasks.sessions.openSession',
      title: 'Open Session',
      arguments: [this],
    };
  }

  /**
   * Status icons differ in BOTH shape AND luminance so the distinction
   * survives color-blindness and dark/light theme changes (WCAG 1.4.1).
   *   - running     → blue pulse        (claude is mid-turn, writing)
   *   - needs-input → green comment-discussion (claude waiting for you)
   *   - stalled     → yellow warning    (mid-turn but no recent writes)
   *   - idle        → gray history      (old, nothing happening)
   */
  private static iconForStatus(status: SessionStatus): vscode.ThemeIcon {
    switch (status) {
      case 'running':
        return new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.blue'));
      case 'needs-input':
        return new vscode.ThemeIcon(
          'comment-discussion',
          new vscode.ThemeColor('charts.green')
        );
      case 'stalled':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'idle':
      default:
        return new vscode.ThemeIcon('history');
    }
  }

  /** Truncate a possibly-multiline string for tooltip display. */
  private static snippet(s: string, maxLen = 280): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > maxLen ? flat.slice(0, maxLen) + '\u2026' : flat;
  }

  private static buildTooltip(
    session: SessionMetadata,
    timeStr: string,
    status: SessionStatus,
    branch: string
  ): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Last activity:** ${timeStr} · _${status}_\n\n`);
    md.appendMarkdown(`**Branch:** \`${branch}\` · **Messages:** ${session.messageCount}\n\n`);

    if (session.claudeSummary) {
      md.appendMarkdown(`**Goal**\n\n${SessionItem.snippet(session.claudeSummary, 400)}\n\n`);
    }
    if (session.lastPrompt) {
      md.appendMarkdown(`**You said**\n\n> ${SessionItem.snippet(session.lastPrompt)}\n\n`);
    }
    if (session.lastAssistantText) {
      md.appendMarkdown(`**Claude replied**\n\n> ${SessionItem.snippet(session.lastAssistantText)}\n\n`);
    }

    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**Session ID:** \`${session.sessionId}\`\n\n`);
    if (session.cwd) {
      md.appendMarkdown(`**CWD:** \`${session.cwd}\`\n\n`);
    }
    md.appendMarkdown(`**File:** \`${session.filePath}\``);
    return md;
  }
}

// ---------------------------------------------------------------------------
// Union type for provider elements
// ---------------------------------------------------------------------------

type SessionTreeItem = RunningGroupItem | WorktreeGroupItem | SessionItem;

// ---------------------------------------------------------------------------
// Worktree discovery helpers
// ---------------------------------------------------------------------------

/**
 * Walk up from `startPath` up to `maxLevels` looking for a `.gw/config.json`.
 * Returns the directory containing `.gw/` (the gw root) or null. We use the
 * directory itself rather than any `root` field because real gw configs don't
 * always store `root`.
 */
function findGwRoot(startPath: string, maxLevels = 5): string | null {
  let dir = startPath;
  for (let i = 0; i < maxLevels; i++) {
    const configPath = path.join(dir, '.gw', 'config.json');
    try {
      if (fs.statSync(configPath).isFile()) return dir;
    } catch {
      // not found, continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Enumerate worktree paths under a gw root by scanning subdirectories that
 * contain a `.git` *file* (worktree marker) — not a `.git` directory which
 * would be the bare repo itself. Recurses one level for the `feat/<branch>`
 * convention.
 */
function getWorktreePathsFromGw(workspacePath: string): string[] | null {
  const root = findGwRoot(workspacePath);
  if (!root) return null;

  const paths: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.gw' || entry.name.startsWith('.')) continue;
      const sub = path.join(dir, entry.name);
      const gitPath = path.join(sub, '.git');
      try {
        const stat = fs.statSync(gitPath);
        if (stat.isFile()) {
          paths.push(sub);
          continue; // don't recurse into a worktree
        }
      } catch {
        // no .git here; recurse to find nested worktrees (e.g. feat/x)
      }
      visit(sub, depth + 1);
    }
  };

  visit(root, 0);
  return paths.length > 0 ? paths : null;
}

/**
 * Enumerate worktree paths via `git worktree list --porcelain`. Returns null
 * if the command fails (not a git repo, git missing, etc.).
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
 * Return the deduplicated list of worktree paths for the workspace. Always
 * includes the workspace path itself.
 *
 * Priority:
 *   1. gw root + sibling worktrees (gw-aware)
 *   2. `git worktree list --porcelain` fallback
 *   3. Just the workspace path (single-worktree / non-git)
 */
function discoverWorktreePaths(workspacePath: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  const add = (p: string) => {
    const normalised = p.replace(/[/\\]+$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      paths.push(normalised);
    }
  };

  const gwPaths = getWorktreePathsFromGw(workspacePath);
  if (gwPaths) {
    for (const p of gwPaths) add(p);
    add(workspacePath);
    return paths;
  }

  const gitPaths = getWorktreePathsFromGit(workspacePath);
  if (gitPaths) {
    for (const p of gitPaths) add(p);
    add(workspacePath);
    return paths;
  }

  add(workspacePath);
  return paths;
}

// ---------------------------------------------------------------------------
// Session discovery (subdirectory-aware)
// ---------------------------------------------------------------------------

/**
 * Find every `~/.claude/projects/*` directory whose encoded prefix matches at
 * least one of the worktree paths. Includes both exact matches (the worktree
 * itself) and prefix matches (subdirectories of the worktree, since
 * `encodeWorkspacePath` deterministically maps `/<segment>` → `-<segment>`).
 *
 * Over-matching by encoded prefix is cheap and is corrected later by the
 * cwd-based bucketing pass, so siblings with overlapping name prefixes
 * (e.g. `foo` vs `foo-bar`) don't get cross-attributed.
 */
function findCandidateSessionDirs(worktreePaths: string[]): string[] {
  const projectsDir = getClaudeProjectsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const encodedPrefixes = worktreePaths.map((wt) => encodeWorkspacePath(wt));
  const out: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const encoded of encodedPrefixes) {
      if (entry.name === encoded || entry.name.startsWith(encoded + '-')) {
        out.push(path.join(projectsDir, entry.name));
        break;
      }
    }
  }
  return out;
}

/**
 * Parse all sessions from candidate dirs and bucket them by the longest
 * matching worktree path (using the session's `cwd` field). Sessions whose
 * `cwd` doesn't fall under any worktree are dropped. Each bucket is sorted
 * newest-first.
 */
function bucketSessionsByWorktree(
  worktreePaths: string[],
  candidateDirs: string[]
): Map<string, SessionMetadata[]> {
  // Sort by descending path length for longest-prefix match
  const sortedWts = [...worktreePaths].sort((a, b) => b.length - a.length);

  const buckets = new Map<string, SessionMetadata[]>();
  for (const wt of worktreePaths) buckets.set(wt, []);

  for (const dir of candidateDirs) {
    const sessions = parseSessionsInDir(dir);
    for (const session of sessions) {
      const cwd = session.cwd;
      if (!cwd) continue;
      const match = sortedWts.find(
        (wt) => cwd === wt || cwd.startsWith(wt + path.sep)
      );
      if (match) {
        const bucket = buckets.get(match);
        if (bucket) bucket.push(session);
      }
    }
  }

  for (const sessions of buckets.values()) {
    sessions.sort((a, b) => b.mtime - a.mtime);
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// SessionsProvider
// ---------------------------------------------------------------------------

export type SessionsScope = 'current' | 'all';

export class SessionsProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cache of session dirs being watched — exposed for SessionWatcher rebuild. */
  private _sessionDirs: string[] = [];

  /**
   * Sessions whose `claude --resume` terminal is currently open in THIS
   * window. Forces the status icon to "active" regardless of mtime — a
   * stronger signal than the file-watcher heuristic. Updated by the click
   * handler and `onDidCloseTerminal` listener in extension.ts.
   */
  private openTerminalSessions = new Set<string>();

  /**
   * Timestamp of the most recent close-of-our-terminal for a session. When
   * the close is more recent than the file mtime, we cap the status at
   * `recent` so a freshly-closed session can't keep showing as `active`
   * just because its JSONL was written seconds before close. Allows the
   * panel to react instantly to terminal close.
   */
  private terminalClosedAt = new Map<string, number>();

  /** The session directories currently being observed. */
  get sessionDirs(): string[] {
    return this._sessionDirs;
  }

  /**
   * Tell the provider that a `claude --resume` terminal for this session has
   * just been opened (`open=true`) or closed (`open=false`) in this window.
   * Refreshes the tree so the status icon updates immediately.
   */
  setTerminalOpen(sessionId: string, open: boolean): void {
    if (open) {
      this.openTerminalSessions.add(sessionId);
      this.terminalClosedAt.delete(sessionId);
    } else {
      this.openTerminalSessions.delete(sessionId);
      this.terminalClosedAt.set(sessionId, Date.now());
    }
    this.refresh();
  }

  /**
   * Compute the effective status for a session, layering UI-known signals on
   * top of the mtime heuristic:
   *   1. Terminal open in this window         → `active` (definite)
   *   2. Terminal was closed after last mtime → cap at `recent` (we ended it)
   *   3. Otherwise                            → plain mtime heuristic
   */
  /**
   * Compute the effective status for a session, layering UI-known signals
   * on top of the JSONL-derived `deriveRunState`:
   *   1. Terminal open in this window     → `running` (definite)
   *   2. We closed the terminal post-mtime → `idle`   (we ended it)
   *   3. Otherwise                         → `deriveRunState(turnEnded, mtime)`
   */
  computeStatus(session: SessionMetadata): SessionStatus {
    if (this.openTerminalSessions.has(session.sessionId)) return 'running';

    // Tolerance covers a JSONL flush during terminal shutdown — claude can
    // write one last byte AFTER we've torn down the terminal, which would
    // otherwise leave the session looking running for up to 5 minutes.
    const closedAt = this.terminalClosedAt.get(session.sessionId);
    const CLOSE_TOLERANCE_MS = 2_000;
    if (closedAt !== undefined && closedAt + CLOSE_TOLERANCE_MS > session.mtime) {
      return 'idle';
    }

    return deriveRunState(session.turnEnded, session.mtime);
  }

  /**
   * Whether a session counts as "alive" for the pinned overview section.
   * Includes:
   *   - `running` (claude is mid-turn, still writing)
   *   - `needs-input` only when very fresh (<5 min) — claude finished a
   *     response and the user is plausibly about to reply. Older sessions
   *     in needs-input are noise (user walked away days ago).
   *   - terminal open in this window forces inclusion regardless.
   */
  isRunning(session: SessionMetadata): boolean {
    if (this.openTerminalSessions.has(session.sessionId)) return true;

    const status = this.computeStatus(session);
    if (status === 'running') return true;
    if (status === 'needs-input' && Date.now() - session.mtime < 5 * 60 * 1000) {
      return true;
    }
    return false;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Return every session visible from the current workspace, regardless of
   * the `agentTasks.sessions.scope` setting. Used by the find command — when
   * the user is searching, they want to reach any session, not just the ones
   * currently rendered in the tree.
   *
   * Sessions are flattened across all worktrees and sorted newest-first.
   */
  getAllSessions(): SessionMetadata[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const worktreePaths = discoverWorktreePaths(workspacePath);
    const candidateDirs = findCandidateSessionDirs(worktreePaths);
    const buckets = bucketSessionsByWorktree(worktreePaths, candidateDirs);

    const all: SessionMetadata[] = [];
    for (const sessions of buckets.values()) all.push(...sessions);
    all.sort((a, b) => b.mtime - a.mtime);
    return all;
  }

  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element instanceof RunningGroupItem) {
      return element.sessions.map(
        (s) => new SessionItem(s, { status: this.computeStatus(s) })
      );
    }
    if (element instanceof WorktreeGroupItem) {
      return element.sessions.map(
        (s) => new SessionItem(s, { status: this.computeStatus(s) })
      );
    }
    if (element instanceof SessionItem) {
      return [];
    }
    return this.buildRootItems();
  }

  private buildRootItems(): SessionTreeItem[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const scope = vscode.workspace
      .getConfiguration('agentTasks.sessions')
      .get<SessionsScope>('scope', 'all');

    const allWorktrees = discoverWorktreePaths(workspacePath);

    // Identify the current worktree as the longest worktree path that the
    // workspacePath sits inside. Falls back to workspacePath when nothing else
    // qualifies (e.g. single-worktree case).
    const sortedByLength = [...allWorktrees].sort((a, b) => b.length - a.length);
    const currentWorktree =
      sortedByLength.find(
        (wt) => workspacePath === wt || workspacePath.startsWith(wt + path.sep)
      ) ?? workspacePath;

    const worktreePaths = scope === 'current' ? [currentWorktree] : allWorktrees;

    const candidateDirs = findCandidateSessionDirs(worktreePaths);
    this._sessionDirs = candidateDirs;

    const buckets = bucketSessionsByWorktree(worktreePaths, candidateDirs);

    // Collect every session across worktrees once so we can build the pinned
    // "Running" section. Running sessions are MOVED to the section, not
    // duplicated — they're filtered out of their worktree group below to
    // avoid showing the same row twice.
    const allSessions: SessionMetadata[] = [];
    for (const sessions of buckets.values()) allSessions.push(...sessions);
    const running = allSessions
      .filter((s) => this.isRunning(s))
      .sort((a, b) => b.mtime - a.mtime);
    const runningIds = new Set(running.map((s) => s.sessionId));

    const items: SessionTreeItem[] = [];
    if (running.length > 0) {
      items.push(new RunningGroupItem(running));
    }

    // Single worktree (or scope === 'current') → flat list (running already
    // surfaced in the section above, so exclude them here).
    if (worktreePaths.length <= 1) {
      const sessions = (buckets.get(worktreePaths[0]) ?? []).filter(
        (s) => !runningIds.has(s.sessionId)
      );
      items.push(
        ...sessions.map((s) => new SessionItem(s, { status: this.computeStatus(s) }))
      );
      return items;
    }

    // Multi-worktree → grouped, current first, others by most-recent activity.
    // Running sessions are excluded from their worktree group because they
    // already appear in the pinned section.
    const groups: Array<{ wt: string; sessions: SessionMetadata[]; mtime: number }> = [];
    for (const wt of worktreePaths) {
      const sessions = (buckets.get(wt) ?? []).filter((s) => !runningIds.has(s.sessionId));
      const mtime = sessions.reduce((max, s) => Math.max(max, s.mtime), 0);
      groups.push({ wt, sessions, mtime });
    }

    const visibleGroups = groups.filter((g) => g.wt === currentWorktree || g.sessions.length > 0);

    visibleGroups.sort((a, b) => {
      if (a.wt === currentWorktree) return -1;
      if (b.wt === currentWorktree) return 1;
      return b.mtime - a.mtime;
    });

    items.push(
      ...visibleGroups.map(
        (g) => new WorktreeGroupItem(g.wt, g.sessions, g.wt === currentWorktree)
      )
    );

    return items;
  }
}
