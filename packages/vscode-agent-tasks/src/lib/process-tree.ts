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

// ---------------------------------------------------------------------------
// Pending-adoption queue helpers (pure — no VS Code dependency)
// ---------------------------------------------------------------------------

/**
 * A terminal that was spawned by the "+" new-session button and is waiting
 * for the next new JSONL session that appears in the same cwd to be assigned
 * to it. VS Code terminal objects are opaque values from the caller's
 * perspective — this module treats them as `unknown` to stay VS Code–free.
 */
export interface PendingAdoption<T = unknown> {
  /** The VS Code Terminal object (typed as `T` to avoid VS Code imports). */
  terminal: T;
  /** The cwd that was passed to `vscode.window.createTerminal({ cwd })`. */
  cwd: string;
  /** `Date.now()` at the time the terminal was spawned. */
  spawnedAt: number;
}

export interface ClaimResult<T> {
  /** The terminal to adopt for the new session. */
  terminal: T;
  /** The remaining queue after removing the claimed entry. */
  remaining: Array<PendingAdoption<T>>;
}

/**
 * Try to claim a pending adoption for a newly discovered session.
 *
 * Rules:
 *   - Stale entries (`now - spawnedAt > ttlMs`) are evicted regardless.
 *   - The first non-stale entry whose `cwd` exactly matches `session.cwd`
 *     is claimed (FIFO order).
 *   - Returns `null` when no match is found after eviction.
 *
 * Both `session.cwd` and `pending.cwd` must be pre-normalized by the caller
 * (e.g. via `path.resolve`) to prevent spurious mismatches from trailing
 * slashes or symlink differences.
 */
export function claimPendingAdoption<T>(
  pending: Array<PendingAdoption<T>>,
  sessionCwd: string,
  now: number,
  ttlMs: number
): ClaimResult<T> | null {
  const live = pending.filter((p) => now - p.spawnedAt <= ttlMs);
  const idx = live.findIndex((p) => p.cwd === sessionCwd);
  if (idx === -1) return null;
  const terminal = live[idx].terminal;
  const remaining = [...live.slice(0, idx), ...live.slice(idx + 1)];
  return { terminal, remaining };
}
