/**
 * PrPoller — polls PR status at a 90-second cadence, independent of the
 * adaptive session tick.
 *
 * The poller tracks the set of active branches (provided by the sessions
 * provider on each `buildRootItems` call) and fetches enrichment for the
 * top 20 most-recently-active branches on each interval tick.
 *
 * Design rationale:
 *   - Separate from the 5s/30s adaptive tick so PR polling never accelerates
 *     with hook activity — GitHub API calls are expensive regardless.
 *   - Cap at 20 branches: 20 × 90s ≈ 800 req/hour, well within GitHub's
 *     5000 req/hour limit.
 *   - `onPrStatusChanged` fires after each poll batch; callers should call
 *     `sessionsProvider.refresh()`.
 */

import type { PrStatusCache } from './pr-status-cache';

/** Maximum number of branches polled per interval tick. */
export const PR_POLLER_MAX_BRANCHES = 20;

/** Poll interval in milliseconds. */
export const PR_POLLER_INTERVAL_MS = 90_000;

export interface BranchTarget {
  branch: string;
  worktreePath: string;
  /** mtime of the most recent session on this branch, for priority sorting. */
  mtime: number;
}

export class PrPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeBranches: BranchTarget[] = [];
  private onChanged: (() => void) | undefined;

  constructor(
    private readonly cache: PrStatusCache,
    options: { intervalMs?: number } = {}
  ) {
    const intervalMs = options.intervalMs ?? PR_POLLER_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  /**
   * Register a callback fired after each completed poll batch.
   * Caller should call `sessionsProvider.refresh()`.
   */
  onPrStatusChanged(callback: () => void): void {
    this.onChanged = callback;
  }

  /**
   * Update the set of active branches to poll. Called by the sessions
   * provider on each `buildRootItems()`. Replaces the previous set entirely.
   *
   * Branches are sorted by mtime descending and capped at PR_POLLER_MAX_BRANCHES.
   */
  setActiveBranches(branches: BranchTarget[]): void {
    const sorted = [...branches]
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, PR_POLLER_MAX_BRANCHES);
    this.activeBranches = sorted;
  }

  private async poll(): Promise<void> {
    const branches = this.activeBranches;
    if (branches.length === 0) return;

    await Promise.all(
      branches.map((b) => this.cache.fetchEnrichment(b.branch, b.worktreePath))
    );

    this.onChanged?.();
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
