/**
 * Parser for Claude Code session JSONL transcript files.
 *
 * IMPORTANT: This module has NO dependency on the VS Code API so it can be
 * unit-tested with vitest. All VS Code-specific logic belongs in providers/
 * or watchers/.
 *
 * NOTE: The ~/.claude/projects/ JSONL format is undocumented and owned by the
 * Claude Code team. It can change between versions without notice. All parsing
 * is centralised here so a schema bump is a one-file change. Unknown event
 * types and unknown fields on known event types are silently skipped / ignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SessionMetadata {
  /** Session identifier read from the `sessionId` field of JSONL events. */
  sessionId: string;
  /** Absolute path to the source `.jsonl` file. */
  filePath: string;
  /**
   * First user message (non-sidechain), whitespace-collapsed and truncated to
   * `MAX_TITLE_LEN` characters. Falls back to "Untitled session" when no user
   * message has any text content.
   */
  title: string;
  /** `gitBranch` field from the first `user` event, or undefined if absent. */
  gitBranch: string | undefined;
  /** `cwd` field from the first `user` event, or undefined if absent. */
  cwd: string | undefined;
  /** ISO 8601 timestamp of the first `user` event. */
  firstTimestamp: string | undefined;
  /** ISO 8601 timestamp of the last `user` or `assistant` event. */
  lastTimestamp: string | undefined;
  /** Count of `user` + `assistant` events (including sidechain events). */
  messageCount: number;
  /** File mtime in milliseconds (from `fs.statSync`). */
  mtime: number;
  /**
   * `type` of the last `user`/`assistant` event seen. Lets the provider
   * distinguish "claude is responding" (`assistant` was last) from "waiting
   * for the user's next prompt" (`user` was last) when a session is running.
   * Undefined if no qualifying event was found.
   */
  lastEventType: 'user' | 'assistant' | undefined;
  /**
   * True iff the session reached an end-of-turn state with no later user
   * input — i.e. either:
   *   - the last `assistant` event has `stop_reason: end_turn`, OR
   *   - the last `system subtype: turn_duration` event came after the last
   *     `user` event.
   *
   * Combined with mtime in the provider this distinguishes:
   *   - `running` (mid-turn, fresh mtime → claude is responding)
   *   - `needs-input` (turn ended, user hasn't replied yet)
   *   - `stalled` (mid-turn, stale mtime → claude died)
   *   - `idle` (old, nothing happening)
   *
   * This is dramatically more stable than mtime alone — real signal from
   * the JSONL events rather than a heuristic on file activity.
   */
  turnEnded: boolean;
  /**
   * Cleaned-up extract from the LATEST `system subtype: away_summary` event
   * (Claude composes this at every turn end). Already stripped of the
   * "Goal: " prefix and the trailing "(disable recaps in /config)"
   * parenthetical, and whitespace-collapsed. Undefined if the session
   * hasn't reached a turn end yet.
   *
   * The provider prefers this over the first user message as the tree-item
   * label because it's an actual claude-generated description of what the
   * session is about — far more useful for scanning than the user's opening
   * prompt (which is often template boilerplate or a slash command).
   */
  claudeSummary: string | undefined;
  /** Most recent `last-prompt.lastPrompt` (whatever the user typed last). */
  lastPrompt: string | undefined;
  /** First text part from the most recent `assistant` event, if any. */
  lastAssistantText: string | undefined;
}

/**
 * Run-state of a session combining JSONL turn analysis with file mtime.
 *
 * Derived in the provider (`deriveRunState`) from:
 *   - `SessionMetadata.turnEnded` (real signal: last `assistant.stop_reason`
 *     was `end_turn` or last system `turn_duration` followed the last user)
 *   - `SessionMetadata.mtime` (file activity)
 *   - terminal-open state in this VS Code window
 *
 * States:
 *   - `running`     — claude is actively responding (mid-turn + fresh mtime)
 *   - `needs-input` — claude finished, waiting for the user's next prompt
 *   - `stalled`     — mid-turn but no recent writes (claude likely died)
 *   - `idle`        — old, nothing happening
 *
 * Replaces the old mtime-only heuristic ('active' | 'recent' | 'idle') with
 * stable JSONL-derived signals.
 */
export type SessionStatus = 'running' | 'needs-input' | 'stalled' | 'idle';

// ---------------------------------------------------------------------------
// Utility: path encoding
// ---------------------------------------------------------------------------

/**
 * Encode an absolute workspace path to the directory name used by Claude Code
 * under `~/.claude/projects/`.
 *
 * Encoding rule (verified against live files 2026-04-30):
 *   Replace every character that is not `[A-Za-z0-9-]` with `-`.
 *   This collapses `/`, `.`, spaces, and other punctuation into dashes —
 *   notably `.git` becomes `-git`, and `/.claude` becomes `--claude`.
 *
 * Examples:
 *   `/Users/mthines/Workspace/repo.git/main` → `-Users-mthines-Workspace-repo-git-main`
 *   `/Users/mthines/.claude`                 → `-Users-mthines--claude`
 *   `/Users/mthines/Library/Application Support/Code` →
 *     `-Users-mthines-Library-Application-Support-Code`
 */
export function encodeWorkspacePath(absolutePath: string): string {
  return absolutePath.replace(/[^A-Za-z0-9-]/g, '-');
}

/** Returns `~/.claude/projects` expanded to an absolute path. */
export function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Returns the session directory for a given workspace path.
 * Does NOT check whether the directory exists.
 */
export function getSessionsDir(workspacePath: string): string {
  return path.join(getClaudeProjectsDir(), encodeWorkspacePath(workspacePath));
}

// ---------------------------------------------------------------------------
// Utility: status classification
// ---------------------------------------------------------------------------

/** mtime within this window means claude is plausibly still writing */
export const RUNNING_THRESHOLD_MS = 30 * 1000; // 30 seconds
/** mtime within this window with mid-turn signal means claude died */
export const STALLED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
/** mtime within this window keeps a needs-input state visible */
export const NEEDS_INPUT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Pure helper. Combines the parser's `turnEnded` signal (real JSONL semantics)
 * with file mtime to derive a stable run-state. The provider layers terminal-
 * open / closed-after-mtime overrides on top.
 */
export function deriveRunState(
  turnEnded: boolean,
  mtimeMs: number,
  now = Date.now()
): SessionStatus {
  const age = now - mtimeMs;

  if (turnEnded) {
    if (age < NEEDS_INPUT_TTL_MS) return 'needs-input';
    return 'idle';
  }

  // Mid-turn (JSONL says claude was working)
  if (age < RUNNING_THRESHOLD_MS) return 'running';
  if (age < STALLED_THRESHOLD_MS) return 'stalled';
  return 'idle';
}

/**
 * Backwards-compat shim used by older test code that classified by mtime
 * alone. Treats the absence of a `turnEnded` signal as mid-turn.
 *
 * @deprecated prefer `deriveRunState(turnEnded, mtime)`.
 */
export function getSessionStatus(mtimeMs: number): SessionStatus {
  return deriveRunState(false, mtimeMs);
}

// ---------------------------------------------------------------------------
// JSONL parsing internals
// ---------------------------------------------------------------------------

/** Minimal shape of a parsed JSONL line (typed loosely — unknown fields ok). */
interface RawEvent {
  type?: string;
  sessionId?: string;
  gitBranch?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
  /** `system` events carry subtype (`turn_duration`, `away_summary`, …). */
  subtype?: string;
  /** `system subtype: away_summary` events carry the recap text here. */
  content?: string;
  /** `last-prompt` events carry the most recent prompt here. */
  lastPrompt?: string;
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
    /** `assistant` events: `end_turn`, `tool_use`, `max_tokens`, … */
    stop_reason?: string | null;
  };
}

/**
 * Strip the boilerplate prefix/suffix from an `away_summary.content` string.
 *
 *   "Goal: X. Next: Y. (disable recaps in /config)"
 *      → "X. Next: Y."
 *
 *   "X completed. Next: Y. (disable recaps in /config)"
 *      → "X completed. Next: Y."
 */
function cleanAwaySummary(content: string): string {
  let s = content.trim();
  // Trim trailing recap-config nudge in any common form
  s = s.replace(/\s*\((?:disable )?recaps[^)]*\)\s*$/i, '').trim();
  // Strip leading "Goal:" / "Goal -" / "Goal —"
  s = s.replace(/^Goal\s*[:\-—]\s*/i, '').trim();
  return s;
}

/**
 * Strip Claude Code's internal slash-command and template markup from a raw
 * user-message string and return a clean human-facing title.
 *
 * Slash commands arrive in the JSONL as XML-ish tag soup, e.g.:
 *   <command-message>ranger</command-message>
 *   <command-name>/ranger</command-name>
 *   <command-args>context info</command-args>
 *   <local-command-caveat>...</local-command-caveat>
 *
 * The user actually typed `/ranger context info`. Show that. For non-command
 * messages with stray tags (e.g. `<ide_opened_file>...`, `<attachment>...`),
 * just strip the tags and keep the text.
 */
function cleanCommandMarkup(text: string): string {
  // Slash-command pattern — synthesise `/NAME [args]` from the tags.
  const cmdName = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1];
  const cmdMessage = /<command-message>\s*([^<]+?)\s*<\/command-message>/.exec(text)?.[1];
  const cmdArgs = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();

  if (cmdName || cmdMessage) {
    const raw = cmdName ?? cmdMessage ?? '';
    const name = raw.startsWith('/') ? raw : `/${raw}`;
    return cmdArgs ? `${name} ${cmdArgs}` : name;
  }

  // Generic markup strip for non-slash-command tag soup
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract a plain-text title from a `user` event's `message.content`.
 * Returns undefined if the content yields no non-empty text.
 *
 * Strips Claude Code internal markup (slash-command wrappers, IDE-context
 * tags, attachments) — what the user actually typed wins.
 */
function extractContentText(content: string | Array<{ type?: string; text?: string }> | undefined): string | undefined {
  if (!content) return undefined;

  let raw: string | undefined;
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        raw = part.text;
        break;
      }
    }
  }

  if (!raw) return undefined;
  const cleaned = cleanCommandMarkup(raw);
  return cleaned || undefined;
}

/**
 * Maximum visible characters for a session title in the tree view label.
 *
 * Tuned tight (35) so the muted-grey description (relative time / branch)
 * has room to render alongside the label even on narrow side panels.
 * Going wider — 50, 80 — pushed the description off-screen and made the
 * timestamp invisible.
 */
export const MAX_TITLE_LEN = 35;

/**
 * Collapse all whitespace runs (newlines, tabs, repeated spaces) into single
 * spaces and trim the result. Keeps single-line tree view labels readable for
 * messages that originally contained markdown, code fences, or template blocks.
 */
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Truncate a string to maxLen characters, appending `…` if truncated. */
function truncate(s: string, maxLen = MAX_TITLE_LEN): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\u2026'; // …
}

// ---------------------------------------------------------------------------
// Public parsing API
// ---------------------------------------------------------------------------

/**
 * In-process cache of parsed sessions, keyed by absolute file path. Stores
 * the mtime that produced the cached metadata; a `parseSessionFile` call only
 * re-reads + re-parses when the file's mtime has changed since the cache
 * entry was written.
 *
 * This dramatically speeds up tree refreshes when most sessions on disk are
 * unchanged (the common case) — without it every refresh would re-read every
 * JSONL file, including multi-MB ones.
 *
 * Bounded in practice by the number of distinct session files the user has
 * (tens to hundreds). New mtimes overwrite old entries for the same path, so
 * memory growth is one entry per unique session file.
 */
const parseCache = new Map<string, { mtime: number; data: SessionMetadata }>();

/** Reset the parse cache. Exposed mainly for tests. */
export function clearSessionParseCache(): void {
  parseCache.clear();
}

/**
 * Parse a single JSONL session file and return `SessionMetadata`.
 *
 * Returns `null` when:
 * - the file cannot be read
 * - the file is empty
 * - no `user` event is found to provide a sessionId
 *
 * Unknown event types are silently skipped. Missing fields degrade to
 * `undefined` — nothing throws.
 *
 * Uses an mtime-keyed cache; unchanged files skip the read+parse entirely.
 */
export function parseSessionFile(filePath: string): SessionMetadata | null {
  let raw: string;
  let mtime: number;

  try {
    const stat = fs.statSync(filePath);
    mtime = stat.mtimeMs;
    const cached = parseCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.data;
    }
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (!raw.trim()) return null;

  const lines = raw.split('\n').filter((l) => l.trim());

  let sessionId: string | undefined;
  let title: string | undefined;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let messageCount = 0;
  let titleFound = false;
  let lastEventType: 'user' | 'assistant' | undefined;

  // Turn-state markers (line indices). We compute turnEnded at the end by
  // comparing the index of the last end-of-turn marker to the last user
  // event — turn ended iff the end-of-turn marker came AFTER the last user.
  let lastUserIdx = -1;
  let lastEndTurnIdx = -1;
  let lineIdx = 0;

  // Claude-generated context fields. We track the LATEST value of each
  // because they reflect the current state of the session — older summaries
  // are stale.
  let claudeSummary: string | undefined;
  let lastPrompt: string | undefined;
  let lastAssistantText: string | undefined;

  for (const line of lines) {
    lineIdx++;
    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      // Malformed line — skip
      continue;
    }

    const type = event.type;

    // Track end-of-turn markers from non-user/assistant events too. The
    // canonical end-of-turn pattern in real Claude Code JSONL is:
    //   assistant (stop_reason=end_turn) → system (subtype=turn_duration)
    // We accept either marker as "turn ended at this line".
    if (type === 'system' && event.subtype === 'turn_duration') {
      lastEndTurnIdx = lineIdx;
      continue;
    }

    // Claude-generated session summary, written at every turn end.
    if (type === 'system' && event.subtype === 'away_summary' && event.content) {
      claudeSummary = cleanAwaySummary(event.content);
      continue;
    }

    // User's most recent prompt (flat event with `lastPrompt` field).
    if (type === 'last-prompt' && typeof event.lastPrompt === 'string') {
      lastPrompt = event.lastPrompt.trim() || undefined;
      continue;
    }

    // Only process user and assistant events for the main data fields
    if (type !== 'user' && type !== 'assistant') {
      // Unknown / other event types → silently skip
      continue;
    }

    messageCount++;
    lastEventType = type as 'user' | 'assistant';

    if (type === 'user') lastUserIdx = lineIdx;
    if (type === 'assistant') {
      if (event.message?.stop_reason === 'end_turn') {
        lastEndTurnIdx = lineIdx;
      }
      // Track latest assistant text content for tooltip context.
      const text = extractContentText(event.message?.content);
      if (text) lastAssistantText = text;
    }

    if (type === 'user') {
      // Set sessionId from first user event that has one
      if (!sessionId && event.sessionId) {
        sessionId = event.sessionId;
      }

      // Set envelope fields from first user event
      if (!gitBranch && event.gitBranch) {
        gitBranch = event.gitBranch;
      }
      if (!cwd && event.cwd) {
        cwd = event.cwd;
      }

      // First timestamp from first user event
      if (!firstTimestamp && event.timestamp) {
        firstTimestamp = event.timestamp;
      }

      // Title: first non-sidechain user event with extractable text content
      if (!titleFound && event.isSidechain !== true) {
        const text = extractContentText(event.message?.content);
        if (text) {
          title = truncate(collapseWhitespace(text));
          titleFound = true;
        }
      }
    }

    // Last timestamp from last user or assistant event
    if (event.timestamp) {
      lastTimestamp = event.timestamp;
    }
  }

  // We require at least a sessionId to return a result
  if (!sessionId) return null;

  // turnEnded iff the most recent end-of-turn marker followed the most recent
  // user event (or there are no user events but there is an end-of-turn).
  const turnEnded = lastEndTurnIdx > lastUserIdx;

  // Title preference (most-meaningful first):
  //   1. Claude's `away_summary` goal extract (real session description)
  //   2. The first user message we extracted (cleaned of slash-command markup)
  //   3. "Untitled session" placeholder
  let chosenTitle: string;
  if (claudeSummary) {
    chosenTitle = truncate(collapseWhitespace(claudeSummary));
  } else if (title) {
    chosenTitle = title;
  } else {
    chosenTitle = 'Untitled session';
  }

  const data: SessionMetadata = {
    sessionId,
    filePath,
    title: chosenTitle,
    gitBranch,
    cwd,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    mtime,
    lastEventType,
    turnEnded,
    claudeSummary,
    lastPrompt,
    lastAssistantText,
  };
  parseCache.set(filePath, { mtime, data });
  return data;
}

/**
 * Parse all `*.jsonl` files in `dirPath` and return them sorted newest-first
 * by mtime (descending).
 *
 * Files that fail to parse are silently excluded. Non-existent directories
 * return an empty array without throwing.
 */
export function parseSessionsInDir(dirPath: string): SessionMetadata[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: SessionMetadata[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const session = parseSessionFile(path.join(dirPath, entry.name));
      if (session) {
        sessions.push(session);
      }
    }
  }

  // Sort newest-first by mtime
  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions;
}
