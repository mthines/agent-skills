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
}

/**
 * Heuristic status derived from file mtime.
 *
 * HEURISTIC: Claude Code does not write terminal markers or heartbeat records.
 * The only available signal is the file mtime. Classifications:
 *   - active  — mtime within the last 2 minutes (Claude likely still writing)
 *   - recent  — mtime within the last 1 hour
 *   - idle    — older than 1 hour
 *
 * This WILL misclassify paused sessions and very fast sessions. Accepted
 * limitation for v1.
 */
export type SessionStatus = 'active' | 'recent' | 'idle';

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

const ACTIVE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const RECENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Classify a session by its file mtime.
 *
 * HEURISTIC — see `SessionStatus` type for caveats.
 */
export function getSessionStatus(mtimeMs: number): SessionStatus {
  const age = Date.now() - mtimeMs;
  if (age < ACTIVE_THRESHOLD_MS) return 'active';
  if (age < RECENT_THRESHOLD_MS) return 'recent';
  return 'idle';
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
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
  };
}

/**
 * Extract a plain-text title from a `user` event's `message.content`.
 * Returns undefined if the content yields no non-empty text.
 */
function extractContentText(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string | undefined {
  if (!content) return undefined;

  if (typeof content === 'string') {
    return content.trim() || undefined;
  }

  // Array of content parts — find the first `text` part with non-empty text
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return undefined;
}

/**
 * Maximum visible characters for a session title in the tree view label.
 * Tuned for a typical narrow VS Code sidebar (~30–40 chars visible per row),
 * leaving room for the description (`relative time` / `branch · time`).
 */
export const MAX_TITLE_LEN = 50;

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

  for (const line of lines) {
    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      // Malformed line — skip
      continue;
    }

    const type = event.type;

    // Only process user and assistant events for the main data fields
    if (type !== 'user' && type !== 'assistant') {
      // Unknown / other event types → silently skip
      continue;
    }

    messageCount++;

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

  const data: SessionMetadata = {
    sessionId,
    filePath,
    title: title ?? 'Untitled session',
    gitBranch,
    cwd,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    mtime,
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
