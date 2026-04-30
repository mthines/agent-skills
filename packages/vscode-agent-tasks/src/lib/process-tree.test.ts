import { describe, it, expect } from 'vitest';
import {
  parsePsOutput,
  findClaudeDescendant,
  claimPendingAdoption,
  type PsEntry,
  type PendingAdoption,
} from './process-tree';

// ---------------------------------------------------------------------------
// parsePsOutput — 6 test cases
// ---------------------------------------------------------------------------

describe('parsePsOutput', () => {
  it('parses typical multi-line output (header + 3 data rows)', () => {
    const raw = `  PID  PPID COMMAND
    1     0 /sbin/launchd
  501     1 /usr/bin/login
  502   501 -zsh`;

    const entries = parsePsOutput(raw);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ pid: 1, ppid: 0, command: '/sbin/launchd' });
    expect(entries[1]).toEqual({ pid: 501, ppid: 1, command: '/usr/bin/login' });
    expect(entries[2]).toEqual({ pid: 502, ppid: 501, command: '-zsh' });
  });

  it('returns [] for only a header line', () => {
    const raw = '  PID  PPID COMMAND';
    expect(parsePsOutput(raw)).toEqual([]);
  });

  it('handles leading/trailing whitespace and macOS right-aligned PID/PPID', () => {
    const raw = `  PID  PPID COMMAND
 1234   567 node server.js`;

    const entries = parsePsOutput(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ pid: 1234, ppid: 567, command: 'node server.js' });
  });

  it('skips malformed lines (non-numeric PID)', () => {
    const raw = `  PID  PPID COMMAND
  abc   123 some-process
  999   123 real-process`;

    const entries = parsePsOutput(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].pid).toBe(999);
  });

  it('returns [] for an empty string', () => {
    expect(parsePsOutput('')).toEqual([]);
  });

  it('preserves spaces in command paths', () => {
    const raw = `  PID  PPID COMMAND
  100    99 /Applications/Visual Studio Code.app/Contents/MacOS/Electron --type=renderer`;

    const entries = parsePsOutput(raw);
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toBe(
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron --type=renderer'
    );
  });
});

// ---------------------------------------------------------------------------
// findClaudeDescendant — 8 test cases
// ---------------------------------------------------------------------------

describe('findClaudeDescendant', () => {
  const shellPid = 100;
  const sessionId = 'abc12345-0000-0000-0000-000000000000';

  it('returns the PID of a direct child running claude --resume <sessionId>', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: `claude --resume ${sessionId}` },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBe(200);
  });

  it('finds a deep descendant (shell → bash → node → claude)', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'bash' },
      { pid: 300, ppid: 200, command: 'node' },
      { pid: 400, ppid: 300, command: `claude --resume ${sessionId}` },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBe(400);
  });

  it('returns undefined when the sessionId does not match', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'claude --resume xyz99999-0000-0000-0000-000000000000' },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBeUndefined();
  });

  it('returns undefined when there is no claude process in the tree', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'bash' },
      { pid: 300, ppid: 200, command: 'node server.js' },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBeUndefined();
  });

  it('returns the correct PID when multiple claude processes exist with different IDs', () => {
    const otherId = 'zzz99999-0000-0000-0000-000000000000';
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 201, ppid: 100, command: `claude --resume ${otherId}` },
      { pid: 202, ppid: 100, command: `claude --resume ${sessionId}` },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBe(202);
  });

  it('returns undefined when shellPid is absent from snapshot', () => {
    const snapshot: PsEntry[] = [
      { pid: 999, ppid: 1, command: '-zsh' }, // different pid
      { pid: 200, ppid: 999, command: `claude --resume ${sessionId}` },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBeUndefined();
  });

  it('returns undefined for an empty snapshot', () => {
    expect(findClaudeDescendant(shellPid, sessionId, [])).toBeUndefined();
  });

  it('does NOT match a bare `claude` invocation (no --resume <id>)', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'claude' },
    ];
    expect(findClaudeDescendant(shellPid, sessionId, snapshot)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// claimPendingAdoption — 6 test cases
// ---------------------------------------------------------------------------

describe('claimPendingAdoption', () => {
  const TTL = 60_000;
  const NOW = 1_000_000;
  // A mock terminal type (opaque object) — real terminal would be vscode.Terminal
  type MockTerminal = { id: string };

  function makePending(id: string, cwd: string, spawnedAt = NOW - 1000): PendingAdoption<MockTerminal> {
    return { terminal: { id }, cwd, spawnedAt };
  }

  it('claims the first entry whose cwd matches (exact string compare)', () => {
    const pending = [makePending('t1', '/Users/alice/project')];
    const result = claimPendingAdoption(pending, '/Users/alice/project', NOW, TTL);
    if (result === null) throw new Error('expected a claim result');
    expect(result.terminal).toEqual({ id: 't1' });
    expect(result.remaining).toHaveLength(0);
  });

  it('returns null when no cwd matches', () => {
    const pending = [makePending('t1', '/Users/alice/project')];
    const result = claimPendingAdoption(pending, '/Users/bob/other', NOW, TTL);
    expect(result).toBeNull();
  });

  it('evicts stale entries (past TTL) and returns null when no fresh match', () => {
    // spawnedAt = NOW - TTL - 1 → stale
    const stale = makePending('t1', '/Users/alice/project', NOW - TTL - 1);
    const result = claimPendingAdoption([stale], '/Users/alice/project', NOW, TTL);
    expect(result).toBeNull();
  });

  it('evicts stale entries and still claims a fresh match', () => {
    const stale = makePending('old', '/Users/alice/project', NOW - TTL - 1);
    const fresh = makePending('t2', '/Users/alice/project');
    const result = claimPendingAdoption([stale, fresh], '/Users/alice/project', NOW, TTL);
    if (result === null) throw new Error('expected a claim result');
    expect(result.terminal).toEqual({ id: 't2' });
    expect(result.remaining).toHaveLength(0);
  });

  it('returns FIFO order — claims the earliest matching entry when multiple match', () => {
    const first = makePending('t1', '/Users/alice/project', NOW - 5000);
    const second = makePending('t2', '/Users/alice/project', NOW - 1000);
    const result = claimPendingAdoption([first, second], '/Users/alice/project', NOW, TTL);
    if (result === null) throw new Error('expected a claim result');
    expect(result.terminal).toEqual({ id: 't1' });
    // second remains
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].terminal).toEqual({ id: 't2' });
  });

  it('does not claim when cwd is a prefix but not an exact match', () => {
    const pending = [makePending('t1', '/Users/alice/project')];
    // Longer path — not an exact match
    const result = claimPendingAdoption(
      pending,
      '/Users/alice/project/subdir',
      NOW,
      TTL
    );
    expect(result).toBeNull();
  });
});
