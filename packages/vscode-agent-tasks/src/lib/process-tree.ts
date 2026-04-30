/**
 * Pure process-tree helpers for terminal adoption.
 *
 * No VS Code dependency. No I/O. Accepts pre-parsed `ps` output so every
 * function is unit-testable with vitest and plain data fixtures.
 */

/** One row from `ps -A -o pid,ppid,command`. */
export interface PsEntry {
  pid: number;
  ppid: number;
  command: string;
}

/**
 * Parse the stdout of `ps -A -o pid,ppid,command`.
 *
 * - Skips the header line.
 * - Skips malformed lines (non-numeric pid/ppid, fewer than 3 tokens).
 * - Handles macOS right-padded and Linux left-padded numeric columns.
 * - The `command` field is everything after the second whitespace-delimited
 *   token, so paths with spaces are preserved.
 */
export function parsePsOutput(raw: string): PsEntry[] {
  const lines = raw.split('\n');
  const entries: PsEntry[] = [];
  let headerSkipped = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // The first non-empty line is always the header (PID PPID COMMAND).
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }

    // Split on whitespace — at most 3 parts so command preserves spaces.
    const parts = trimmed.split(/\s+/, 3);
    if (parts.length < 3) continue;

    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    if (isNaN(pid) || isNaN(ppid)) continue;

    // Reconstruct the full command: everything after the first two tokens.
    // We can't use `parts[2]` directly because split(..., 3) truncates.
    // Find the start of the command field in the original trimmed string.
    const afterPid = trimmed.slice(parts[0].length).trimStart();
    const afterPpid = afterPid.slice(parts[1].length).trimStart();

    entries.push({ pid, ppid, command: afterPpid });
  }

  return entries;
}

/**
 * BFS from `shellPid` through `snapshot`'s children map, looking for a
 * descendant whose command contains `claude` AND `--resume <sessionId>`.
 *
 * Returns the matching PID, or `undefined` if none is found.
 * A visited Set guards against cycles (should not occur in real process trees,
 * but avoids infinite loops on malformed snapshots).
 *
 * A bare `claude` invocation (no `--resume <id>`) does NOT match — such
 * sessions are not adoptable via the argv fast-path.
 */
export function findClaudeDescendant(
  shellPid: number,
  sessionId: string,
  snapshot: PsEntry[]
): number | undefined {
  // Build a children map: ppid → [child entries]
  const children = new Map<number, PsEntry[]>();
  for (const entry of snapshot) {
    const list = children.get(entry.ppid);
    if (list) {
      list.push(entry);
    } else {
      children.set(entry.ppid, [entry]);
    }
  }

  // Verify shellPid exists in snapshot (skip if not found).
  const shellExists = snapshot.some((e) => e.pid === shellPid);
  if (!shellExists) return undefined;

  const visited = new Set<number>();
  const queue: number[] = [shellPid];

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const kids = children.get(current) ?? [];
    for (const child of kids) {
      // Match: command contains `claude` AND `--resume <sessionId>`.
      if (child.command.includes('claude') && child.command.includes(`--resume ${sessionId}`)) {
        return child.pid;
      }
      queue.push(child.pid);
    }
  }

  return undefined;
}

/**
 * Parse the stdout of `lsof -a -p <pids> -d cwd -Fpn`.
 *
 * The `-F` flag produces field output. Each block starts with a `p` line
 * (PID) followed by one or more field lines. For `-d cwd` there is exactly
 * one `n` line per PID that contains the cwd path.
 *
 * Lines with other prefixes (`f`, `t`, etc.) are silently ignored. A PID
 * with no `n` line is omitted from the result. Malformed `p` lines (non-
 * numeric digit sequence) are also skipped.
 *
 * Returns a Map of PID → cwd string.
 */
export function parseLsofCwdOutput(raw: string): Map<number, string> {
  const result = new Map<number, string>();
  let currentPid: number | undefined;

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const prefix = line[0];
    const value = line.slice(1);

    if (prefix === 'p') {
      const pid = parseInt(value, 10);
      currentPid = isNaN(pid) ? undefined : pid;
    } else if (prefix === 'n' && currentPid !== undefined) {
      result.set(currentPid, value);
      // Reset so a second `n` line (unexpected) doesn't overwrite silently.
      currentPid = undefined;
    }
    // All other prefixes (f, t, etc.) are ignored.
  }

  return result;
}

/**
 * BFS from `shellPid`, returning the PIDs of ALL descendants whose command
 * contains `claude` (case-sensitive substring match). Empty array if none.
 *
 * Used by the cwd-match slow-path in `tryAdoptTerminal`. Unlike
 * `findClaudeDescendant`, this function does NOT filter by session ID — the
 * caller correlates against the lsof cwd map.
 *
 * A visited Set guards against cycles in malformed snapshots.
 * Returns an empty array when `shellPid` is not in `snapshot`.
 */
export function collectClaudeDescendants(shellPid: number, snapshot: PsEntry[]): number[] {
  const shellExists = snapshot.some((e) => e.pid === shellPid);
  if (!shellExists) return [];

  // Build children map.
  const children = new Map<number, PsEntry[]>();
  for (const entry of snapshot) {
    const list = children.get(entry.ppid);
    if (list) {
      list.push(entry);
    } else {
      children.set(entry.ppid, [entry]);
    }
  }

  const visited = new Set<number>();
  const queue: number[] = [shellPid];
  const claudePids: number[] = [];

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const child of children.get(current) ?? []) {
      if (child.command.includes('claude')) {
        claudePids.push(child.pid);
      }
      queue.push(child.pid);
    }
  }

  return claudePids;
}
