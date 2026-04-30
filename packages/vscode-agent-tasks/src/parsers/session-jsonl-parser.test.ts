import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  encodeWorkspacePath,
  deriveRunState,
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

  it('replaces dots with dashes (e.g. `.git` → `-git`)', () => {
    expect(encodeWorkspacePath('/Users/mthines/Workspace/yourstory-ai.git/main')).toBe(
      '-Users-mthines-Workspace-yourstory-ai-git-main'
    );
  });

  it('encodes a leading dot directory (`/.claude` → `--claude`)', () => {
    expect(encodeWorkspacePath('/Users/mthines/.claude')).toBe('-Users-mthines--claude');
  });

  it('replaces spaces with dashes', () => {
    expect(encodeWorkspacePath('/Users/mthines/Library/Application Support/Code')).toBe(
      '-Users-mthines-Library-Application-Support-Code'
    );
  });

  it('preserves existing hyphens in path segments', () => {
    expect(encodeWorkspacePath('/Users/mthines/Workspace/gw-tools.git/main')).toBe(
      '-Users-mthines-Workspace-gw-tools-git-main'
    );
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
// deriveRunState
// ---------------------------------------------------------------------------

describe('deriveRunState', () => {
  it('mid-turn within 30s → running', () => {
    const mtime = Date.now() - 10 * 1000;
    expect(deriveRunState(false, mtime)).toBe('running');
  });

  it('mid-turn 30s–5min → stalled (claude died)', () => {
    const mtime = Date.now() - 2 * 60 * 1000;
    expect(deriveRunState(false, mtime)).toBe('stalled');
  });

  it('mid-turn beyond 5min → idle', () => {
    const mtime = Date.now() - 30 * 60 * 1000;
    expect(deriveRunState(false, mtime)).toBe('idle');
  });

  it('turn ended within 1h → needs-input', () => {
    const mtime = Date.now() - 5 * 60 * 1000;
    expect(deriveRunState(true, mtime)).toBe('needs-input');
  });

  it('turn ended beyond 1h → idle', () => {
    const mtime = Date.now() - 2 * 60 * 60 * 1000;
    expect(deriveRunState(true, mtime)).toBe('idle');
  });

  it('mid-turn at exactly now → running', () => {
    expect(deriveRunState(false, Date.now())).toBe('running');
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

  it('truncates title to MAX_TITLE_LEN chars with ellipsis', () => {
    const longMessage = 'A'.repeat(100);
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: longMessage } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('A'.repeat(35) + '\u2026');
    expect(result?.title?.length).toBe(36);
  });

  it('prefers Claude away_summary "Goal:" extract over first user message', () => {
    const events: object[] = [
      userEvent({ message: { content: '<command-message>ranger</command-message>' } }),
      assistantEvent({ message: { content: 'sure', stop_reason: 'end_turn' } }),
      {
        type: 'system',
        subtype: 'away_summary',
        sessionId: SAMPLE_SESSION_ID,
        content:
          'Goal: fix the ranger bug in apps/api. Just done with TDD; tests green. Next: commit. (disable recaps in /config)',
      },
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.title.startsWith('fix the ranger bug')).toBe(true);
    expect(result?.claudeSummary).toContain('fix the ranger bug');
    expect(result?.claudeSummary).not.toMatch(/^Goal:/);
    expect(result?.claudeSummary).not.toMatch(/disable recaps/);
  });

  it('uses LATEST away_summary when multiple are present', () => {
    const events: object[] = [
      userEvent(),
      {
        type: 'system',
        subtype: 'away_summary',
        sessionId: SAMPLE_SESSION_ID,
        content: 'Goal: old summary',
      },
      userEvent({ timestamp: '2026-04-30T12:05:00.000Z' }),
      {
        type: 'system',
        subtype: 'away_summary',
        sessionId: SAMPLE_SESSION_ID,
        content: 'Goal: latest summary that should win',
      },
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.claudeSummary).toBe('latest summary that should win');
  });

  it('captures latest last-prompt and assistant text for tooltip context', () => {
    const events: object[] = [
      userEvent(),
      assistantEvent({ message: { content: [{ type: 'text', text: 'first reply' }] } }),
      { type: 'last-prompt', sessionId: SAMPLE_SESSION_ID, lastPrompt: 'most recent prompt' },
      assistantEvent({
        timestamp: '2026-04-30T12:10:00.000Z',
        message: { content: [{ type: 'text', text: 'most recent reply' }] },
      }),
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.lastPrompt).toBe('most recent prompt');
    expect(result?.lastAssistantText).toBe('most recent reply');
  });

  it('falls back to first user message when no away_summary present', () => {
    const events: object[] = [
      userEvent({ message: { content: 'just a regular question' } }),
      assistantEvent({ message: { content: 'reply', stop_reason: 'tool_use' } }),
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('just a regular question');
    expect(result?.claudeSummary).toBeUndefined();
  });

  it('renders slash-command tag soup as `/name args`', () => {
    const raw =
      '<command-message>ranger</command-message>\n' +
      '<command-name>/ranger</command-name>\n' +
      '<command-args>SUP-123 dashboard issue</command-args>';
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: raw } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('/ranger SUP-123 dashboard issue');
  });

  it('renders slash-command without args as just `/name`', () => {
    const raw =
      '<command-message>ux</command-message>\n<command-name>/ux</command-name>\n<command-args></command-args>';
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: raw } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('/ux');
  });

  it('infers leading slash when only command-message is present', () => {
    const raw = '<command-message>review</command-message>';
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: raw } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('/review');
  });

  it('strips stray XML-like tags from non-command user messages', () => {
    const raw = '<ide_opened_file>/Users/x/foo.ts</ide_opened_file>Why is this broken?';
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: raw } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('/Users/x/foo.ts Why is this broken?');
  });

  it('collapses internal whitespace and newlines into single spaces', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent({ message: { content: '  Hello\n\n  Claude\t\tworld   ' } })])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Hello Claude world');
  });

  it('falls back to "Untitled session" when no user message content found', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([{ type: 'user', sessionId: SAMPLE_SESSION_ID, message: { content: '' } }])
    );
    const result = parseSessionFile(filePath);
    expect(result?.title).toBe('Untitled session');
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

  it('marks turnEnded when last assistant has stop_reason=end_turn', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent(),
        assistantEvent({ message: { content: 'reply', stop_reason: 'end_turn' } }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.turnEnded).toBe(true);
  });

  it('marks turnEnded when system turn_duration follows last user', () => {
    const events: object[] = [
      userEvent(),
      assistantEvent({ message: { content: 'mid', stop_reason: 'tool_use' } }),
      { type: 'system', subtype: 'turn_duration', durationMs: 100, sessionId: SAMPLE_SESSION_ID },
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.turnEnded).toBe(true);
  });

  it('does NOT mark turnEnded when assistant is last with stop_reason=tool_use', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent(),
        assistantEvent({ message: { content: 'using a tool', stop_reason: 'tool_use' } }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.turnEnded).toBe(false);
  });

  it('does NOT mark turnEnded when user event follows the last end_turn', () => {
    const events: object[] = [
      userEvent(),
      assistantEvent({ message: { content: 'reply', stop_reason: 'end_turn' } }),
      userEvent({ timestamp: '2026-04-30T12:10:00.000Z', message: { content: 'follow-up' } }),
    ];
    const filePath = writeJsonl('session.jsonl', buildJsonl(events));
    const result = parseSessionFile(filePath);
    expect(result?.turnEnded).toBe(false);
  });

  it('records lastEventType as `assistant` when assistant event is last', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([userEvent(), assistantEvent()])
    );
    const result = parseSessionFile(filePath);
    expect(result?.lastEventType).toBe('assistant');
  });

  it('records lastEventType as `user` when user event is last', () => {
    const filePath = writeJsonl(
      'session.jsonl',
      buildJsonl([
        userEvent(),
        assistantEvent(),
        userEvent({ timestamp: '2026-04-30T12:05:00.000Z', message: { content: 'follow-up' } }),
      ])
    );
    const result = parseSessionFile(filePath);
    expect(result?.lastEventType).toBe('user');
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
