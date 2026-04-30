import { describe, it, expect } from 'vitest';
import {
  parsePsOutput,
  findClaudeDescendant,
  parseLsofCwdOutput,
  collectClaudeDescendants,
  type PsEntry,
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
// parseLsofCwdOutput — 6 test cases
// ---------------------------------------------------------------------------

describe('parseLsofCwdOutput', () => {
  it('parses a single PID with one cwd line', () => {
    const raw = 'p1234\nfcwd\nn/Users/alice/projects/my-app';
    const result = parseLsofCwdOutput(raw);
    expect(result.size).toBe(1);
    expect(result.get(1234)).toBe('/Users/alice/projects/my-app');
  });

  it('parses multiple PIDs each with their own cwd', () => {
    const raw = [
      'p100',
      'fcwd',
      'n/home/alice/app',
      'p200',
      'fcwd',
      'n/home/bob/other',
    ].join('\n');
    const result = parseLsofCwdOutput(raw);
    expect(result.size).toBe(2);
    expect(result.get(100)).toBe('/home/alice/app');
    expect(result.get(200)).toBe('/home/bob/other');
  });

  it('omits a PID that has no n line', () => {
    // PID 300 has no n line — should not appear in the map.
    const raw = 'p300\nfcwd\np400\nfcwd\nn/tmp/work';
    const result = parseLsofCwdOutput(raw);
    expect(result.has(300)).toBe(false);
    expect(result.get(400)).toBe('/tmp/work');
  });

  it('ignores f, t, and other prefix lines', () => {
    const raw = 'p999\nf42\ntREG\nn/var/project\ntDEV\nfother';
    const result = parseLsofCwdOutput(raw);
    expect(result.get(999)).toBe('/var/project');
  });

  it('returns an empty map for empty input', () => {
    expect(parseLsofCwdOutput('').size).toBe(0);
    expect(parseLsofCwdOutput('\n\n').size).toBe(0);
  });

  it('skips malformed p lines with non-numeric digits', () => {
    const raw = 'pabc\nn/should/not/appear\np500\nn/valid/path';
    const result = parseLsofCwdOutput(raw);
    expect(result.has(NaN)).toBe(false);
    expect(result.get(500)).toBe('/valid/path');
  });
});

// ---------------------------------------------------------------------------
// collectClaudeDescendants — 6 test cases
// ---------------------------------------------------------------------------

describe('collectClaudeDescendants', () => {
  it('returns the PID of a direct child claude process', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'claude' },
    ];
    expect(collectClaudeDescendants(100, snapshot)).toEqual([200]);
  });

  it('returns only claude PIDs among mixed descendants', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 201, ppid: 100, command: 'node server.js' },
      { pid: 202, ppid: 100, command: 'claude' },
      { pid: 203, ppid: 100, command: 'bash' },
    ];
    expect(collectClaudeDescendants(100, snapshot)).toEqual([202]);
  });

  it('finds a deep descendant (3 levels deep)', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'bash' },
      { pid: 300, ppid: 200, command: 'node' },
      { pid: 400, ppid: 300, command: 'claude -c' },
    ];
    expect(collectClaudeDescendants(100, snapshot)).toEqual([400]);
  });

  it('returns empty array when no claude descendants exist', () => {
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'node' },
    ];
    expect(collectClaudeDescendants(100, snapshot)).toEqual([]);
  });

  it('returns empty array when shell PID is not in snapshot', () => {
    const snapshot: PsEntry[] = [
      { pid: 999, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 999, command: 'claude' },
    ];
    expect(collectClaudeDescendants(100, snapshot)).toEqual([]);
  });

  it('terminates and returns results when snapshot contains a cycle', () => {
    // pid 300 → ppid 200 → ppid 300 (cycle). Should not infinite-loop.
    const snapshot: PsEntry[] = [
      { pid: 100, ppid: 1, command: '-zsh' },
      { pid: 200, ppid: 100, command: 'bash' },
      { pid: 300, ppid: 200, command: 'claude' },
      { pid: 200, ppid: 300, command: 'bash-cycle' }, // creates artificial cycle
    ];
    const result = collectClaudeDescendants(100, snapshot);
    expect(result).toContain(300);
    // Must terminate — if this test completes, no infinite loop.
  });
});
