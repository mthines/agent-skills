import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  encodeWorkspacePath,
  getSessionStatus,
  parseSessionFile,
  parseSessionsInDir,
  getClaudeProjectsDir,
  getSessionsDir,
} from './session-jsonl-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a JSONL string from an array of event objects.
 * Each object is serialised to one line.
 */
function buildJsonl(events: object[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

const SAMPLE_SESSION_ID = 'abc12345-dead-beef-0000-111122223333';

/** Minimal valid `user` event. */
function userEvent(overrides: object = {}): object {
  return {
    type: 'user',
    sessionId: SAMPLE_SESSION_ID,
    gitBranch: 'feat/my-feature',
    cwd: '/Users/mthines/Workspace/myrepo',
    timestamp: '2026-04-30T12:00:00.000Z',
    isSidechain: false,
    message: { content: 'Hello, Claude!' },
    ...overrides,
  };
}

/** Minimal valid `assistant` event. */
function assistantEvent(overrides: object = {}): object {
  return {
    type: 'assistant',
    sessionId: SAMPLE_SESSION_ID,
    timestamp: '2026-04-30T12:01:00.000Z',
    message: { content: [{ type: 'text', text: 'Hello, human!' }] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Temp-directory fixture
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write JSONL content to a file in tmpDir and return the absolute path. */
function writeJsonl(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// encodeWorkspacePath
// ---------------------------------------------------------------------------

describe('encodeWorkspacePath', () => {
  it('replaces all slashes with dashes', () => {
    expect(encodeWorkspacePath('/Users/mthines/Workspace/mthines/repo')).toBe(
      '-Users-mthines-Workspace-mthines-repo'
    );
  });

  it('handles root slash', () => {
    expect(encodeWorkspacePath('/foo')).toBe('-foo');
  });

  it('handles path with no slashes (edge case)', () => {
    expect(encodeWorkspacePath('noslash')).toBe('noslash');
  });
});

// ---------------------------------------------------------------------------
// getSessionsDir
// ---------------------------------------------------------------------------

describe('getSessionsDir', () => {
  it('combines claude projects dir with encoded path', () => {
    const result = getSessionsDir('/Users/mthines/myrepo');
    expect(result).toBe(`${getClaudeProjectsDir()}/-Users-mthines-myrepo`);
  });
});

// ---------------------------------------------------------------------------
// getSessionStatus
// ---------------------------------------------------------------------------

describe('getSessionStatus', () => {
  it('returns active within 2 minutes', () => {
    const mtime = Date.now() - 60 * 1000; // 1 minute ago
    expect(getSessionStatus(mtime)).toBe('active');
  });

  it('returns recent within 1 hour', () => {
    const mtime = Date.now() - 30 * 60 * 1000; // 30 minutes ago
    expect(getSessionStatus(mtime)).toBe('recent');
  });

  it('returns idle beyond 1 hour', () => {
    const mtime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    expect(getSessionStatus(mtime)).toBe('idle');
  });

  it('returns active at exactly 0ms age', () => {
    expect(getSessionStatus(Date.now())).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// parseSessionFile
// ---------------------------------------------------------------------------

describe('parseSessionFile', () => {
  it('returns null for empty file', () => {
    const filePath = writeJsonl('empty.jsonl', '');
    expect(parseSessionFile(filePath)).toBeNull();
  });

  it('returns null when file does not exist', () => {
    expect(parseSessionFile(path.join(tmpDir, 'nonexistent.jsonl'))).toBeNull();
  });

  it('returns null for file with no user events', () => {
    const jsonl = buildJsonl([
      { type: 'file-history-snapshot', files: [] },
      { type: 'permission-mode', mode: 'default' },
    ]);
    const filePath = writeJsonl('no-user.jsonl', jsonl);
    expect(parseSessionFile(filePath)).toBeNull();
  });

  it('parses sessionId from first user event', () => {
    const filePath = writeJsonl('session.jsonl', buildJsonl([userEvent()]));
    const result = parseSessionFile(filePath);
    expect(result?.sessionId).toBe(SAMPLE_SESSION_ID);
  });

  it('extracts title from string content', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: 'Please implement the login feature' } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Please implement the login feature');
  });

  it('extracts title from list content with text part', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent({
          message: {
            content: [
              { type: 'tool_result', content: 'ignored' },
              { type: 'text', text: 'Implement the payments module' },
            ],
          },
        }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Implement the payments module');
  });

  it('truncates title to 80 chars with ellipsis', () => {
    const longMessage = 'A'.repeat(100);
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: longMessage } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('A'.repeat(80) + '\u2026');
    expect(result?.title?.length).toBe(81);
  });

  it('falls back to sessionId prefix when no user message content found', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([{ type: 'user', sessionId: SAMPLE_SESSION_ID, message: { content: '' } }])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe(SAMPLE_SESSION_ID.slice(0, 8));
  });

  it('skips isSidechain user events for title extraction', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent({
          isSidechain: true,
          message: { content: 'SIDECHAIN: should be ignored' },
        }),
        userEvent({
          isSidechain: false,
          message: { content: 'Real user message' },
          timestamp: '2026-04-30T12:05:00.000Z',
        }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Real user message');
  });

  it('extracts gitBranch and cwd from first user event', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ gitBranch: 'main', cwd: '/Users/mthines/project' })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.gitBranch).toBe('main');
    expect(result?.cwd).toBe('/Users/mthines/project');
  });

  it('handles missing gitBranch gracefully', () => {
    // Build event without gitBranch
    const event: Record<string, unknown> = {
      type: 'user',
      sessionId: SAMPLE_SESSION_ID,
      cwd: '/Users/mthines/project',
      timestamp: '2026-04-30T12:00:00.000Z',
      message: { content: 'Hello' },
    };
    const filePath = writeJsonl('session.jsonl', buildJsonl([event]));
    const result = parseSessionFile(filePath);
    expect(result?.gitBranch).toBeUndefined();
  });

  it('counts user and assistant messages', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent(),
        assistantEvent(),
        userEvent({ timestamp: '2026-04-30T12:02:00.000Z' }),
        assistantEvent({ timestamp: '2026-04-30T12:03:00.000Z' }),
        userEvent({ timestamp: '2026-04-30T12:04:00.000Z' }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.messageCount).toBe(5);
  });

  it('counts sidechain user events in messageCount', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent({ isSidechain: true }),
        userEvent({ isSidechain: false }),
        assistantEvent(),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.messageCount).toBe(3);
  });

  it('handles unknown event types without throwing', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        { type: 'widget-result', data: { foo: 'bar' } },
        { type: 'attachment', content: 'base64data' },
        { type: 'last-prompt', prompt: 'blah' },
        userEvent(),
      ])
    );
    expect(() => parseSessionFile(filePath)).not.toThrow();
    const result = parseSessionFile(filePath);
    expect(result?.sessionId).toBe(SAMPLE_SESSION_ID);
    // Unknown events not counted in messageCount
    expect(result?.messageCount).toBe(1);
  });

  it('extracts firstTimestamp from first user event', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent({ timestamp: '2026-04-30T10:00:00.000Z' }),
        assistantEvent({ timestamp: '2026-04-30T10:01:00.000Z' }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.firstTimestamp).toBe('2026-04-30T10:00:00.000Z');
  });

  it('extracts lastTimestamp from last user or assistant event', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent({ timestamp: '2026-04-30T10:00:00.000Z' }),
        assistantEvent({ timestamp: '2026-04-30T10:05:00.000Z' }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.lastTimestamp).toBe('2026-04-30T10:05:00.000Z');
  });

  it('returns mtime from the actual file', () => {
    const filePath = writeJsonl('session.jsonl', buildJsonl([userEvent()]));
    const stat = fs.statSync(filePath);
    const result = parseSessionFile(filePath);
    expect(result?.mtime).toBe(stat.mtimeMs);
  });

  it('survives a malformed JSON line without throwing', () => {
    const goodLine = JSON.stringify(userEvent());
    const badLine = '{ "type": "user", broken json ';
    const filePath = writeJsonl('session.jsonl', `${badLine}\n${goodLine}`);
    expect(() => parseSessionFile(filePath)).not.toThrow();
    const result = parseSessionFile(filePath);
    expect(result?.sessionId).toBe(SAMPLE_SESSION_ID);
  });

  it('handles file-history-snapshot before first user event', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        { type: 'file-history-snapshot', sessionId: SAMPLE_SESSION_ID, files: [] },
        { type: 'permission-mode', mode: 'default' },
        userEvent({ message: { content: 'Actual task description' } }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Actual task description');
  });
});

// ---------------------------------------------------------------------------
// parseSessionsInDir
// ---------------------------------------------------------------------------

describe('parseSessionsInDir', () => {
  it('returns empty array for non-existent directory', () => {
    expect(parseSessionsInDir(path.join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  it('returns empty array for directory with no jsonl files', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# hello');
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
    expect(parseSessionsInDir(tmpDir)).toEqual([]);
  });

  it('parses multiple jsonl files and sorts newest-first', () => {
    // Write two session files
    const file1 = writeJsonl('session1.jsonl', buildJsonl([userEvent({ sessionId: 'aaa00000' })]));
    const file2 = writeJsonl(
      'session2.jsonl',
      buildJsonl([userEvent({ sessionId: 'bbb11111', message: { content: 'Second session' } })])
    );

    // Touch file2 to make it newer
    const now = Date.now();
    fs.utimesSync(file1, new Date(now - 5000), new Date(now - 5000));
    fs.utimesSync(file2, new Date(now), new Date(now));

    const results = parseSessionsInDir(tmpDir);
    expect(results).toHaveLength(2);
    // Newest first
    expect(results[0].sessionId).toBe('bbb11111');
    expect(results[1].sessionId).toBe('aaa00000');
  });

  it('silently excludes files that fail to parse', () => {
    writeJsonl('good.jsonl', buildJsonl([userEvent()]));
    writeJsonl('bad.jsonl', ''); // empty — parses as null

    const results = parseSessionsInDir(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(SAMPLE_SESSION_ID);
  });

  it('ignores non-jsonl files in directory', () => {
    writeJsonl('session.jsonl', buildJsonl([userEvent()]));
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'some notes');
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, '.DS_Store'), '');

    const results = parseSessionsInDir(tmpDir);
    expect(results).toHaveLength(1);
  });
});
