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
import {
  SessionMetadata,
  SessionStatus,
  UNREAD_TTL_MS,
  deriveRunState,
  encodeWorkspacePath,
  getClaudeProjectsDir,
  parseSessionsInDir,
} from '../parsers/session-jsonl-parser';
import { discoverWorktreePaths } from '../lib/worktree-discovery';
import {
  LinkedArtifacts,
  findLinkedArtifacts,
  hasLinkedArtifacts,
} from '../lib/session-artifact-correlator';
import type { HookEvent, HookEventName } from '../lib/hook-event-types';
import type { PrEnrichment } from '../lib/pr-status-cache';
import type { PrPoller, BranchTarget } from '../lib/pr-poller';
import { resolveDisplayStatus, type DisplayStatus } from '../lib/pr-status-reducer';
import { sessionUri, type SessionActivityDecorationProvider } from './session-activity-decoration-provider';
import {
  applySessionFilter,
  describeFilter,
  DEFAULT_SESSION_FILTER,
  isFilterActive,
  isFilterMoreInclusiveThanDefault,
  type SessionFilter,
} from '../lib/session-filter';

/**
 * Below this total session count, the default filter is bypassed so a small
 * Sessions panel never shows a "Show N more sessions" footer. Explicit user
 * filter customisations still apply regardless of count.
 */
const SESSION_FILTER_BYPASS_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// Configured artifact directory names (mirrors agent-tasks-provider.ts)
// ---------------------------------------------------------------------------

/**
 * Returns the configured artifact directory names, falling back to the
 * defaults when the setting is empty or unset. Mirrored from
 * `agent-tasks-provider.ts` so the Sessions panel uses the same dir list
 * for correlation as the Agent Tasks panel uses for discovery.
 */
function getConfiguredArtifactDirs(): string[] {
  const cfg = vscode.workspace
    .getConfiguration('agentTasks')
    .get<string[]>('directories', []);
  return cfg.length > 0 ? cfg : ['.agent', '.gw'];
}

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
  /**
   * Artifact files (`task.md` / `plan.md` / `walkthrough.md`) generated by
   * autonomous-workflow runs at this session's `(worktree, gitBranch)`. When
   * any are present the session row becomes collapsible and surfaces them
   * as children — the visible signal that this session produced artifacts.
   *
   * Empty / undefined when no correlation exists, in which case the row is
   * a leaf and single-click resumes the session as before.
   */
  public readonly linkedArtifacts: LinkedArtifacts | undefined;

  /** The PR enrichment for this session, if available. */
  public readonly prEnrichment: PrEnrichment | undefined;
  /** The resolved display status (may be a PR-derived status). */
  public readonly displayStatus: DisplayStatus;

  constructor(
    public readonly session: SessionMetadata,
    options: {
      status: SessionStatus;
      linkedArtifacts?: LinkedArtifacts;
      prEnrichment?: PrEnrichment;
    }
  ) {
    const linked = options.linkedArtifacts;
    const hasLinks = !!linked && hasLinkedArtifacts(linked);

    super(
      session.title,
      hasLinks
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.linkedArtifacts = hasLinks ? linked : undefined;
    this.prEnrichment = options.prEnrichment;
    this.displayStatus = resolveDisplayStatus(options.status, options.prEnrichment);

    const timeStr = formatTime(session.mtime);
    const branch = session.gitBranch ?? '?';

    // Description: `<branch-truncated> · <time>` — branch gives at-a-glance
    // context for which worktree the session was started in. Truncated at 25
    // characters to keep it readable at narrow panel widths. Falls back to
    // `? · <time>` when gitBranch is undefined.
    const branchTrunc =
      branch.length > 25 ? branch.slice(0, 25) + '\u2026' : branch;
    this.description = `${branchTrunc} · ${timeStr}`;

    this.iconPath = SessionItem.iconForStatus(this.displayStatus);
    // Synthetic resourceUri keys this row into the FileDecorationProvider so
    // the activity dot (running/needs-input/unread/stalled) renders next to
    // the row without VS Code trying to open the URI.
    this.resourceUri = sessionUri(session.sessionId);
    this.tooltip = SessionItem.buildTooltip(
      session,
      timeStr,
      this.displayStatus,
      branch,
      this.linkedArtifacts,
      options.prEnrichment
    );

    // contextValue encodes both artifact presence and PR state for menu conditions.
    // Format: claudeSession[WithArtifacts][WithPr]
    // WithPr is set whenever a PR exists for this branch, regardless of the
    // session's run state — so "Open PR" is available on running/needs-input
    // sessions too, not just idle sessions whose displayStatus is pr-*.
    const prContextSuffix =
      options.prEnrichment?.status === 'pr' ? 'WithPr' : '';
    this.contextValue = hasLinks
      ? `claudeSessionWithArtifacts${prContextSuffix}`
      : `claudeSession${prContextSuffix}`;

    // Row-click command is only attached for leaf sessions. For collapsible
    // sessions the row toggles expansion and the inline play icon resumes,
    // avoiding the jarring "click expands AND opens a terminal" double-fire.
    if (!hasLinks) {
      this.command = {
        command: 'agentTasks.sessions.openSession',
        title: 'Open Session',
        arguments: [this],
      };
    }
  }

  /**
   * Status icons differ in BOTH shape AND color so the distinction survives
   * color-blindness and dark/light theme changes (WCAG 1.4.1).
   * Every status uses a distinct glyph — no color-only signals.
   *
   *   - running         → pulse (blue)              — claude is mid-turn, writing
   *   - needs-input     → comment-discussion (yellow) — claude finished, terminal open
   *   - unread          → circle-filled (blue)       — claude finished, no terminal open
   *   - stalled         → warning (yellow)            — mid-turn, no recent writes
   *   - pr-open         → git-pull-request (green)    — session idle, PR open
   *   - pr-ci-failing   → git-pull-request (red)      — session idle, PR open + CI failing
   *   - pr-merged       → git-merge (purple)           — session idle, PR merged
   *   - pr-closed       → git-pull-request-closed (muted) — session idle, PR closed
   *   - idle            → history (default)            — old, nothing happening
   */
  static iconForStatus(status: DisplayStatus): vscode.ThemeIcon {
    switch (status) {
      case 'running':
        return new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.blue'));
      case 'needs-input':
        return new vscode.ThemeIcon(
          'comment-discussion',
          new vscode.ThemeColor('charts.yellow')
        );
      case 'unread':
        return new vscode.ThemeIcon(
          'circle-filled',
          new vscode.ThemeColor('charts.blue')
        );
      case 'stalled':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'pr-open':
        return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.green'));
      case 'pr-ci-failing':
        return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.red'));
      case 'pr-merged':
        return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
      case 'pr-closed':
        return new vscode.ThemeIcon(
          'git-pull-request-closed',
          new vscode.ThemeColor('notebookStatusErrorIcon.foreground')
        );
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
    status: DisplayStatus,
    branch: string,
    linkedArtifacts?: LinkedArtifacts,
    prEnrichment?: PrEnrichment
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

    if (linkedArtifacts && hasLinkedArtifacts(linkedArtifacts)) {
      const parts: string[] = [];
      if (linkedArtifacts.taskPath) parts.push('task.md');
      if (linkedArtifacts.planPath) parts.push('plan.md');
      if (linkedArtifacts.walkthroughPath) parts.push('walkthrough.md');
      if (linkedArtifacts.diagnosePaths && linkedArtifacts.diagnosePaths.length > 0) {
        const noun =
          linkedArtifacts.diagnosePaths.length === 1
            ? 'diagnose report'
            : `${linkedArtifacts.diagnosePaths.length} diagnose reports`;
        parts.push(noun);
      }
      if (linkedArtifacts.otherMarkdownPaths && linkedArtifacts.otherMarkdownPaths.length > 0) {
        const noun =
          linkedArtifacts.otherMarkdownPaths.length === 1
            ? '1 other file'
            : `${linkedArtifacts.otherMarkdownPaths.length} other files`;
        parts.push(noun);
      }
      md.appendMarkdown(`**Linked artifacts:** ${parts.join(' · ')}\n\n`);
    }

    // PR section — shown when there is a successfully-fetched PR enrichment
    if (prEnrichment?.status === 'pr') {
      const { info } = prEnrichment;
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**PR #${info.number}:** [${SessionItem.snippet(info.title, 80)}](${info.url})\n\n`);
      md.appendMarkdown(`**State:** ${info.state} · **CI:** ${info.ciState}\n\n`);
      // Failing CI: list which checks failed (if available — gh doesn't always return names)
      if (info.ciState === 'failing') {
        md.appendMarkdown(`_CI checks are failing — see PR for details._\n\n`);
      }
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
// Tree item: LinkedArtifactItem
// ---------------------------------------------------------------------------

/**
 * A leaf node under a `SessionItem` representing one artifact file
 * (`task.md`, `plan.md`, or `walkthrough.md`) generated by an
 * autonomous-workflow run on the same `(worktree, gitBranch)` pair.
 *
 * Single-click opens the file via `agentTasks.openMarkdown` as a persistent,
 * editable editor tab (`preview: false`). Icons mirror the Agent Tasks panel
 * so the visual association is consistent.
 */
export class LinkedArtifactItem extends vscode.TreeItem {
  constructor(
    label: string,
    iconId: string,
    public readonly filePath: string,
    contextValueOverride?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = contextValueOverride ?? 'claudeSessionArtifact';
    this.tooltip = filePath;
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: `Open ${label}`,
      arguments: [filePath],
    };
  }
}

// ---------------------------------------------------------------------------
// Tree item: FilterStatusItem
// ---------------------------------------------------------------------------

/**
 * A leaf rendered at the very bottom of the Sessions tree, surfacing a
 * one-click filter affordance. Two modes:
 *
 *   - `expand`  → "Hiding N sessions (…)"  — clears all filters (show all).
 *     Used when the current filter is suppressing rows.
 *   - `restore` → "Showing all categories" — restores the default filter
 *     (active + open PR). Used after the user expanded the view and wants
 *     to collapse back without hunting through the QuickPick.
 *
 * Visually subtle: muted icon colour and the message rendered in the (grey)
 * `description` slot so the row reads as metadata, not work.
 */
export class FilterStatusItem extends vscode.TreeItem {
  constructor(mode: 'expand' | 'restore', message: string) {
    super('', vscode.TreeItemCollapsibleState.None);
    this.description = message;
    if (mode === 'expand') {
      this.iconPath = new vscode.ThemeIcon(
        'eye',
        new vscode.ThemeColor('descriptionForeground')
      );
      this.tooltip = `${message}\n\nClick to clear all filters and show every session.`;
      this.contextValue = 'claudeSessionsFilterStatus';
      this.command = {
        command: 'agentTasks.sessions.resetFilter',
        title: 'Show all sessions',
      };
    } else {
      this.iconPath = new vscode.ThemeIcon(
        'filter',
        new vscode.ThemeColor('descriptionForeground')
      );
      this.tooltip = `${message}\n\nClick to show fewer — back to the default filter (active sessions + open PRs).`;
      this.contextValue = 'claudeSessionsFilterStatus';
      this.command = {
        command: 'agentTasks.sessions.restoreDefaultFilter',
        title: 'Show fewer',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Tree item: PrLinkItem
// ---------------------------------------------------------------------------

/**
 * A leaf node under a `SessionItem` representing the GitHub Pull Request for
 * the session's branch — or the option to create one. Sibling of `Plan`
 * and `Walkthrough`. Click to open the PR in the browser, or to open the
 * GitHub create-PR page when no PR exists.
 *
 * Uses `gitBranch` + `worktreePath` to scope the action; the actual PR URL
 * (when known) comes from the cache. We deliberately render this row even
 * for `loading` enrichment so the user has a fast path to GitHub during the
 * brief window before `gh` returns.
 */
export class PrLinkItem extends vscode.TreeItem {
  constructor(
    public readonly mode: 'open' | 'create' | 'loading',
    public readonly branch: string,
    public readonly worktreePath: string,
    public readonly prUrl: string | undefined
  ) {
    const label =
      mode === 'open'
        ? 'Open Pull Request'
        : mode === 'create'
        ? 'Create Pull Request'
        : 'Pull Request (loading…)';
    super(label, vscode.TreeItemCollapsibleState.None);

    this.iconPath = new vscode.ThemeIcon('git-pull-request');
    this.contextValue =
      mode === 'open'
        ? 'claudeSessionPrLink'
        : mode === 'create'
        ? 'claudeSessionPrCreate'
        : 'claudeSessionPrLoading';
    this.tooltip =
      mode === 'open'
        ? prUrl ?? `Open the PR for ${branch}`
        : mode === 'create'
        ? `Open GitHub to create a PR for ${branch}`
        : `Fetching PR status for ${branch}…`;

    if (mode === 'open') {
      this.command = {
        command: 'agentTasks.sessions.openPRForBranch',
        title: 'Open Pull Request',
        arguments: [{ branch, worktreePath, prUrl }],
      };
    } else if (mode === 'create') {
      this.command = {
        command: 'agentTasks.sessions.createPRForBranch',
        title: 'Create Pull Request',
        arguments: [{ branch, worktreePath }],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Union type for provider elements
// ---------------------------------------------------------------------------

type SessionTreeItem =
  | RunningGroupItem
  | WorktreeGroupItem
  | SessionItem
  | LinkedArtifactItem
  | PrLinkItem
  | FilterStatusItem;

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
// Hook override types
// ---------------------------------------------------------------------------

/**
 * TTL for a hook-driven status override. Long enough that a hook-driven
 * `needs-input` stays visible until the periodic tick or the next hook event
 * supersedes it. 5 minutes covers any realistic human response time.
 *
 * Exported for unit tests.
 */
export const HOOK_OVERRIDE_TTL_MS = 5 * 60 * 1000;

/**
 * Pure function. Maps a hook event name to the session status it implies.
 *
 * Conservative `needs-input`: only `Notification` (Claude Code's explicit
 * "user attention required" signal) produces it. A bare `Stop` is just
 * "turn ended" and many turns end without actually needing input
 * (e.g. agent reporting that CI is green). So:
 *
 *   - `Notification`      → `needs-input` (reliable, explicit)
 *   - `Stop` + terminal closed → `unread`  (user wasn't watching)
 *   - `Stop` + terminal open   → undefined (no override; lets Tier 1
 *     keep `running` while terminal is open, or `deriveRunState` return
 *     `idle` once the terminal closes)
 *   - `UserPromptSubmit`  → `running` (also clears any prior override)
 *   - `SessionStart`      → `running`
 *   - `SessionEnd`        → `idle`
 *
 * Exported for unit tests.
 */
export function hookEventToStatus(
  eventName: HookEventName,
  isTerminalOpen: boolean
): SessionStatus | undefined {
  switch (eventName) {
    case 'UserPromptSubmit':
      return 'running';
    case 'Stop':
      return isTerminalOpen ? undefined : 'unread';
    case 'SessionStart':
      return 'running';
    case 'SessionEnd':
      return 'idle';
    case 'Notification':
      return 'needs-input';
  }
}

/**
 * Pure function. Returns true if a Stop-derived `unread` override should be
 * discarded because the user already cleared unread AFTER the event's ts.
 *
 * This guards against duplicate Stop events re-setting `unread` after the user
 * has dismissed a session. The rule: if clearUnread was called AFTER the event
 * was emitted, the event is stale — discard it.
 *
 * Exported for unit tests.
 */
export function shouldDiscardStopOverride(
  eventTs: number,
  clearedAt: number | undefined
): boolean {
  return clearedAt !== undefined && clearedAt > eventTs;
}

/** The shape stored in `hookOverrides` for each session. */
interface HookSessionState {
  status: SessionStatus;
  ts: number;
}

// ---------------------------------------------------------------------------
// SessionsProvider
// ---------------------------------------------------------------------------

export type SessionsScope = 'current' | 'all';

/** Read the SessionFilter from VS Code configuration, falling back to defaults. */
export function readSessionFilter(): SessionFilter {
  const cfg = vscode.workspace.getConfiguration('agentTasks.sessions.filter');
  return {
    showActive: cfg.get<boolean>('showActive', DEFAULT_SESSION_FILTER.showActive),
    showOpenPr: cfg.get<boolean>('showOpenPr', DEFAULT_SESSION_FILTER.showOpenPr),
    showMergedClosedPr: cfg.get<boolean>(
      'showMergedClosedPr',
      DEFAULT_SESSION_FILTER.showMergedClosedPr
    ),
    showIdleNoPr: cfg.get<boolean>('showIdleNoPr', DEFAULT_SESSION_FILTER.showIdleNoPr),
    showStalled: cfg.get<boolean>('showStalled', DEFAULT_SESSION_FILTER.showStalled),
  };
}

export class SessionsProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /**
   * Fires once for each session ID that was NOT present on the previous
   * refresh. Used by `extension.ts` to claim pending adoptions from the
   * "+" new-session button without polling.
   */
  private readonly _onDidDiscoverSession = new vscode.EventEmitter<SessionMetadata>();
  readonly onDidDiscoverSession: vscode.Event<SessionMetadata> = this._onDidDiscoverSession.event;

  /** Session IDs seen in the last `buildRootItems` call. Used to diff new arrivals. */
  private _knownSessionIds = new Set<string>();

  /** Cache of session dirs being watched — exposed for SessionWatcher rebuild. */
  private _sessionDirs: string[] = [];

  /**
   * Per-session linked artifacts, populated during `buildRootItems` from
   * `findLinkedArtifacts(worktreePath, session.gitBranch, configuredDirs)`.
   * Keyed by sessionId so `getChildren(SessionItem)` and `RunningGroupItem`
   * construction can both reach it. Cleared and rebuilt on every refresh.
   */
  private sessionLinks = new Map<string, LinkedArtifacts>();

  /**
   * Map of `sessionId → worktreePath` for the bucket worktree this session
   * was assigned to. Used by `makeArtifactChildren` to scope PR actions to
   * the right repo. Cleared and rebuilt on every refresh.
   */
  private sessionWorktrees = new Map<string, string>();

  /**
   * Optional PR status cache. When set, used by `makeSessionItem` to look up
   * PR enrichment for sessions on a named branch. Set by `extension.ts` after
   * constructing the provider. `null` means prLinkage is disabled.
   */
  prStatusCache: import('../lib/pr-status-cache').PrStatusCache | null = null;

  /**
   * Optional PR poller. When set, `buildRootItems()` pushes the current active
   * branches to it so it can poll the correct set on each 90s tick.
   */
  prPoller: PrPoller | null = null;

  /**
   * Optional activity-decoration provider. When set, `buildRootItems()`
   * pushes the current `sessionId → SessionStatus` map so it can render the
   * coloured dot badge next to active rows.
   */
  activityDecoration: SessionActivityDecorationProvider | null = null;

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

  /**
   * Hook-event overrides keyed by sessionId. Set by `applyHookEvent()` and
   * consumed by `computeStatus()` as the second-priority tier (after
   * `openTerminalSessions`, before `terminalClosedAt`).
   *
   * Entries expire after `HOOK_OVERRIDE_TTL_MS` (5 minutes) so a stale
   * hook event doesn't permanently override the JSONL-derived state if
   * something goes wrong.
   */
  private hookOverrides = new Map<string, HookSessionState>();

  /**
   * Records when `clearUnread(sessionId)` was last called.
   * Keyed by sessionId; value is a wall-clock millisecond timestamp.
   *
   * Used in `applyHookEvent()` to discard duplicate Stop events that arrive
   * after the user has already dismissed a session as unread. If a Stop event's
   * `ts` is before the recorded `clearedAt`, it is a stale or duplicate event
   * and must be discarded to prevent the unread badge from re-appearing.
   *
   * Entries are pruned alongside `hookOverrides` (same 5-minute window).
   */
  private unreadClearedAt = new Map<string, number>();

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
   * Apply a hook event received from `HookEventWatcher`. Maps the event to a
   * session status, stores it as an override, and triggers a tree refresh so
   * the status icon updates immediately — before the JSONL file is written.
   *
   * `Notification` events trigger a refresh without updating the status.
   *
   * Lost / dropped Stop events: `emit-event.js` exits 0 on any I/O failure,
   * so a Stop event may be silently lost. In that case the session falls through
   * to Tier 4 (`deriveRunState`) which returns `needs-input` for sessions with
   * `turnEnded=true` within 1h — a slight mis-classification (`needs-input`
   * instead of `unread`) but never a silent failure.
   *
   * Terminal-open snapshot: the `isTerminalOpen` check is evaluated at the
   * moment `applyHookEvent` processes the event (~30ms after fire via the
   * watcher debounce). The accepted trade-off: in the rare case where the
   * terminal was closed in that 30ms window, we may classify as `needs-input`
   * instead of `unread`. This is acceptable — the 30ms window is negligible in
   * practice.
   */
  applyHookEvent(event: HookEvent): void {
    const isTerminalOpen = this.openTerminalSessions.has(event.sessionId);
    const status = hookEventToStatus(event.event, isTerminalOpen);

    if (status !== undefined) {
      // Duplicate-Stop guard: if `clearUnread` was called for this session
      // AFTER this event's ts, the event is stale or a duplicate — discard it
      // to prevent the unread badge from re-appearing after the user dismissed it.
      if (
        status === 'unread' &&
        shouldDiscardStopOverride(event.ts, this.unreadClearedAt.get(event.sessionId))
      ) {
        // Stale or duplicate Stop — the user already dismissed this session.
        // Refresh so any other state changes (e.g. TTL expiry) are still visible.
        this.pruneExpiredHookOverrides();
        this.refresh();
        return;
      }

      // Precedence guard: a Notification → `needs-input` override should
      // survive a subsequent `Stop` → `unread` for the same session. The
      // user's pending input request is more important than "agent finished
      // while you were away". Only `UserPromptSubmit` (the user replying)
      // clears `needs-input`.
      const existing = this.hookOverrides.get(event.sessionId);
      if (
        status === 'unread' &&
        existing?.status === 'needs-input' &&
        Date.now() - existing.ts < HOOK_OVERRIDE_TTL_MS
      ) {
        this.pruneExpiredHookOverrides();
        this.refresh();
        return;
      }

      this.hookOverrides.set(event.sessionId, { status, ts: event.ts });
    }

    this.pruneExpiredHookOverrides();
    // Always refresh — Notification events should still update the panel
    this.refresh();
  }

  /**
   * Clear the `unread` status for a session. Called by `extension.ts` when the
   * user opens a session (click, Enter, or Resume).
   *
   * Records a `clearedAt` timestamp so that any subsequent duplicate Stop
   * events with an older `ts` are discarded (idempotence guard).
   */
  clearUnread(sessionId: string): void {
    this.unreadClearedAt.set(sessionId, Date.now());
    this.hookOverrides.delete(sessionId);
    this.refresh();
  }

  /**
   * Drop hook overrides and unreadClearedAt entries older than the TTL so the
   * maps can't grow unboundedly. After 5 minutes, any duplicate is harmless
   * because the original override TTL would have already cleared it.
   */
  private pruneExpiredHookOverrides(): void {
    const cutoff = Date.now() - HOOK_OVERRIDE_TTL_MS;
    for (const [sessionId, state] of this.hookOverrides) {
      if (state.ts < cutoff) {
        this.hookOverrides.delete(sessionId);
      }
    }
    for (const [sessionId, clearedAt] of this.unreadClearedAt) {
      if (clearedAt < cutoff) {
        this.unreadClearedAt.delete(sessionId);
      }
    }
  }

  /**
   * Returns true if any session has a hook override with a timestamp within
   * the last 60 seconds. Used by the adaptive tick in extension.ts to switch
   * between fast (5s) and slow (30s) polling intervals.
   */
  hasRecentHookActivity(): boolean {
    const threshold = Date.now() - 60_000;
    for (const state of this.hookOverrides.values()) {
      if (state.ts > threshold) return true;
    }
    return false;
  }

  /**
   * Compute the effective status for a session, layering UI-known signals
   * on top of the JSONL-derived `deriveRunState`:
   *   1. Terminal open in this window     → `running` (definite)
   *   2. Hook override within TTL         → hook-driven status (sub-second)
   *   2.5. Unread TTL expiry             → `idle` (24h elapsed since mtime)
   *   3. We closed the terminal post-mtime → `idle`   (we ended it)
   *   4. Otherwise                         → `deriveRunState(turnEnded, mtime)`
   */
  computeStatus(session: SessionMetadata): SessionStatus {
    // Tier 1: terminal open in this window — definite signal
    if (this.openTerminalSessions.has(session.sessionId)) return 'running';

    // Tier 2: hook event override — sub-second signal from the plugin
    const hookOverride = this.hookOverrides.get(session.sessionId);
    if (hookOverride !== undefined && Date.now() - hookOverride.ts < HOOK_OVERRIDE_TTL_MS) {
      // Tier 2.5: unread TTL expiry — if the hook override is `unread` but the
      // session is older than 24 hours (by mtime), downgrade to `idle`.
      if (hookOverride.status === 'unread' && Date.now() - session.mtime > UNREAD_TTL_MS) {
        return 'idle';
      }
      return hookOverride.status;
    }

    // Tier 3: tolerance covers a JSONL flush during terminal shutdown — claude
    // can write one last byte AFTER we've torn down the terminal, which would
    // otherwise leave the session looking running for up to 5 minutes.
    const closedAt = this.terminalClosedAt.get(session.sessionId);
    const CLOSE_TOLERANCE_MS = 2_000;
    if (closedAt !== undefined && closedAt + CLOSE_TOLERANCE_MS > session.mtime) {
      return 'idle';
    }

    // Tier 4: JSONL-derived fallback (remains fully functional when hooks are
    // not installed or have been disabled)
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
      return element.sessions.map((s) => this.makeSessionItem(s));
    }
    if (element instanceof WorktreeGroupItem) {
      return element.sessions.map((s) => this.makeSessionItem(s));
    }
    if (element instanceof SessionItem) {
      return this.makeArtifactChildren(element);
    }
    if (element instanceof LinkedArtifactItem) {
      return [];
    }
    if (element instanceof PrLinkItem) {
      return [];
    }
    if (element instanceof FilterStatusItem) {
      return [];
    }
    return this.buildRootItems();
  }

  /**
   * Construct a `SessionItem` with the latest computed status, any cached
   * linked artifacts, and PR enrichment if available.
   * Centralised so both `RunningGroupItem` and `WorktreeGroupItem` children
   * share identical wiring.
   */
  private makeSessionItem(session: SessionMetadata): SessionItem {
    const prEnrichment =
      this.prStatusCache && session.gitBranch
        ? this.prStatusCache.getEnrichment(session.gitBranch)
        : undefined;

    return new SessionItem(session, {
      status: this.computeStatus(session),
      linkedArtifacts: this.sessionLinks.get(session.sessionId),
      prEnrichment,
    });
  }

  /**
   * Children of a `SessionItem` are one `LinkedArtifactItem` per artifact
   * file present at `<worktree>/<dir>/<branch>/`.
   *
   * Order (known/recognised first, unknown last):
   *   1. task.md
   *   2. plan.md
   *   3. walkthrough.md
   *   4. diagnose-*.md reports (sorted by filename)
   *   5. Pull Request row (when branch + worktree are known)
   *   6. Other `.md` files that agents created but the extension does not
   *      recognise explicitly (e.g. `specs.md`, `notes.md`), sorted by
   *      filename — always at the bottom so known entries stay prominent.
   */
  private makeArtifactChildren(
    session: SessionItem
  ): Array<LinkedArtifactItem | PrLinkItem> {
    const links = session.linkedArtifacts;
    if (!links) return [];
    const out: Array<LinkedArtifactItem | PrLinkItem> = [];

    // Known/recognised entries first.
    if (links.taskPath) out.push(new LinkedArtifactItem('Task', 'tasklist', links.taskPath));
    if (links.planPath) out.push(new LinkedArtifactItem('Plan', 'notebook', links.planPath));
    if (links.walkthroughPath) {
      out.push(new LinkedArtifactItem('Walkthrough', 'book', links.walkthroughPath));
    }
    if (links.diagnosePaths) {
      for (const diagPath of links.diagnosePaths) {
        const filename = diagPath.split(/[\\/]/).pop() ?? diagPath;
        const targetMatch = /^diagnose-(.+)\.md$/.exec(filename);
        const label = targetMatch ? `Diagnose: ${targetMatch[1]}` : 'Diagnose';
        out.push(new LinkedArtifactItem(label, 'beaker', diagPath));
      }
    }

    // Pull Request row — always rendered between the recognised artifacts and
    // the unknown "other" files, so the user has a visible, recognisable button
    // next to Plan/Walkthrough rather than relying on right-click discovery.
    const branch = session.session.gitBranch;
    const worktreePath = this.sessionWorktrees.get(session.session.sessionId);
    if (branch && worktreePath) {
      const enrichment = session.prEnrichment;
      if (!enrichment || enrichment.status === 'loading') {
        out.push(new PrLinkItem('loading', branch, worktreePath, undefined));
      } else if (enrichment.status === 'pr') {
        out.push(new PrLinkItem('open', branch, worktreePath, enrichment.info.url));
      } else if (enrichment.status === 'no-pr' || enrichment.status === 'error') {
        out.push(new PrLinkItem('create', branch, worktreePath, undefined));
      }
    }

    // Unknown "other" markdown files at the bottom — always after known entries.
    // Use the shared `otherMarkdownFile` contextValue so right-click menus can
    // target these rows across both the Sessions and Agent Tasks trees.
    if (links.otherMarkdownPaths) {
      for (const mdPath of links.otherMarkdownPaths) {
        const filename = mdPath.split(/[\\/]/).pop() ?? mdPath;
        // Strip the `.md` extension for a compact label (e.g. `specs.md` → `specs`).
        const label = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
        out.push(new LinkedArtifactItem(label, 'markdown', mdPath, 'otherMarkdownFile'));
      }
    }

    return out;
  }

  /**
   * Last filter status message — updated on every `buildRootItems` and read
   * by extension.ts to set `TreeView.message`. `undefined` when the filter
   * is at defaults and nothing was hidden.
   */
  private _filterMessage: string | undefined;

  /**
   * Footer mode for the current rendered state. `expand` when the filter is
   * suppressing rows (offer "show all"); `restore` when the user has loosened
   * the filter beyond defaults and we want to offer "show fewer". `undefined`
   * means no footer at all (filter at defaults, nothing hidden).
   */
  private _footerMode: 'expand' | 'restore' | undefined;

  /** Filter status message for the current rendered state. */
  public getFilterMessage(): string | undefined {
    return this._filterMessage;
  }

  private buildRootItems(): SessionTreeItem[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const scope = vscode.workspace
      .getConfiguration('agentTasks.sessions')
      .get<SessionsScope>('scope', 'all');

    const filter = readSessionFilter();

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

    // Recompute linked-artifact correlation for every visible session. The
    // bucket worktree (longest match for `session.cwd`) is the correlation
    // root — paired with `session.gitBranch` it locates the artifact dir
    // that an autonomous-workflow run would have written under.
    this.sessionLinks.clear();
    this.sessionWorktrees.clear();
    const artifactDirs = getConfiguredArtifactDirs();
    const branchTargets: BranchTarget[] = [];
    for (const [worktreePath, sessions] of buckets) {
      for (const session of sessions) {
        if (!session.gitBranch) continue;
        this.sessionWorktrees.set(session.sessionId, worktreePath);
        const links = findLinkedArtifacts(worktreePath, session.gitBranch, artifactDirs);
        if (hasLinkedArtifacts(links)) {
          this.sessionLinks.set(session.sessionId, links);
        }
        // Collect branch targets for PR polling
        branchTargets.push({
          branch: session.gitBranch,
          worktreePath,
          mtime: session.mtime,
        });
      }
    }

    // Push the current active branches to the PR poller so it knows what to
    // fetch on the next 90s tick.
    if (this.prPoller) {
      this.prPoller.setActiveBranches(branchTargets);
    }

    // Apply user visibility filter per bucket. Inclusion model — a session is
    // shown iff its category is enabled. running/needs-input/unread always
    // count as the `active` category which is always-on, so signal cannot be
    // accidentally hidden by toggling a flag.
    //
    // Skip filtering entirely when the total session count is at or below the
    // bypass threshold AND the user has not customised the filter — a small
    // panel should never show a "Show N more sessions" footer.
    let totalSessions = 0;
    for (const sessions of buckets.values()) totalSessions += sessions.length;
    const skipFilter =
      totalSessions <= SESSION_FILTER_BYPASS_THRESHOLD && !isFilterActive(filter);
    let combinedHidden = 0;
    const aggregatedHiddenByCategory = {
      active: 0,
      'open-pr': 0,
      'merged-closed-pr': 0,
      'idle-no-pr': 0,
      stalled: 0,
    };
    if (!skipFilter) {
      for (const [worktreePath, sessions] of buckets) {
        const filterable = sessions.map((s) => ({
          session: s,
          status: this.computeStatus(s),
          mtime: s.mtime,
          prEnrichment:
            this.prStatusCache && s.gitBranch
              ? this.prStatusCache.getEnrichment(s.gitBranch)
              : undefined,
        }));
        const filtered = applySessionFilter(filterable, filter);
        combinedHidden += filtered.hiddenCount;
        for (const k of Object.keys(aggregatedHiddenByCategory) as Array<
          keyof typeof aggregatedHiddenByCategory
        >) {
          aggregatedHiddenByCategory[k] += filtered.hiddenByCategory[k];
        }
        buckets.set(
          worktreePath,
          filtered.visible.map((f) => f.session)
        );
      }
    }
    const hiddenMessage = describeFilter({
      visible: [],
      hiddenCount: combinedHidden,
      hiddenByCategory: aggregatedHiddenByCategory,
    });
    if (hiddenMessage) {
      this._filterMessage = hiddenMessage;
      this._footerMode = 'expand';
    } else if (isFilterMoreInclusiveThanDefault(filter)) {
      this._filterMessage = 'Collapse sessions';
      this._footerMode = 'restore';
    } else {
      this._filterMessage = undefined;
      this._footerMode = undefined;
    }

    // Collect every session across worktrees once so we can build the pinned
    // "Running" section. Running sessions are MOVED to the section, not
    // duplicated — they're filtered out of their worktree group below to
    // avoid showing the same row twice.
    const allSessions: SessionMetadata[] = [];
    for (const sessions of buckets.values()) allSessions.push(...sessions);

    // Fire onDidDiscoverSession for any session ID not seen in the previous
    // render. This gives extension.ts a precise hook to claim pending adoptions
    // from the "+" button without polling. We defer into a microtask so the
    // event fires after the tree view has already consumed `buildRootItems`.
    const prevKnown = this._knownSessionIds;
    const nextKnown = new Set(allSessions.map((s) => s.sessionId));
    this._knownSessionIds = nextKnown;
    if (prevKnown.size > 0) {
      // Only fire discovery events once we have an established baseline
      // (the very first render populates the baseline without emitting events,
      // to avoid false-positives on extension startup).
      for (const session of allSessions) {
        if (!prevKnown.has(session.sessionId)) {
          void Promise.resolve().then(() => this._onDidDiscoverSession.fire(session));
        }
      }
    }

    // Push the current activity map to the FileDecorationProvider so the
    // coloured dot badge renders for running/needs-input/unread/stalled rows.
    if (this.activityDecoration) {
      const map = new Map<string, SessionStatus>();
      for (const session of allSessions) {
        map.set(session.sessionId, this.computeStatus(session));
      }
      this.activityDecoration.setStatuses(map);
    }

    const items: SessionTreeItem[] = [];

    // Single worktree (or scope === 'current') → flat list. Active sessions
    // are no longer pinned at the top — the activity dot makes them visible
    // wherever they sort in the list, which is less disruptive when one
    // session bounces between idle and running.
    if (worktreePaths.length <= 1) {
      const sessions = buckets.get(worktreePaths[0]) ?? [];
      items.push(...sessions.map((s) => this.makeSessionItem(s)));
      this.appendFilterStatusItem(items);
      return items;
    }

    // Multi-worktree → grouped, current first, others by most-recent activity.
    const groups: Array<{ wt: string; sessions: SessionMetadata[]; mtime: number }> = [];
    for (const wt of worktreePaths) {
      const sessions = buckets.get(wt) ?? [];
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

    this.appendFilterStatusItem(items);
    return items;
  }

  /**
   * Append a muted footer row at the very bottom of the tree, mirroring the
   * current filter state. Two shapes:
   *   - filter is hiding rows  → "Hiding N…" footer; click to show all.
   *   - filter is looser than defaults → "Showing all categories" footer;
   *     click to show fewer (back to defaults).
   * Default-state filters render no footer.
   */
  private appendFilterStatusItem(items: SessionTreeItem[]): void {
    if (!this._footerMode || !this._filterMessage) return;
    items.push(new FilterStatusItem(this._footerMode, this._filterMessage));
  }
}
