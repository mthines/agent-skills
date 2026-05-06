/**
 * Pure session-filter helper. No VS Code imports — vitest-safe.
 *
 * The Sessions panel can show 70+ sessions per worktree, most of which are
 * old idle transcripts. This module decides which sessions to render based on
 * user-configurable filters. The always-show rule guarantees that signal
 * (running, needs-input, unread) is never suppressed regardless of filters
 * — a filter that hides the session you just started is a footgun, not a
 * feature.
 */

import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

export interface SessionFilter {
  /** Hide sessions whose mtime is older than N days. 0 disables. */
  hideStaleAfterDays: number;
  /** Hide sessions whose computed status is `idle`. */
  hideIdle: boolean;
  /** Hide sessions whose PR enrichment is `pr-merged` or `pr-closed`. */
  hidePrMergedClosed: boolean;
  /** Hide sessions that do not have an associated PR (status === 'no-pr'). */
  onlyWithPr: boolean;
}

/** Defaults — tuned via `/ux`: keep the panel quiet without surprising users. */
export const DEFAULT_SESSION_FILTER: SessionFilter = {
  hideStaleAfterDays: 14,
  hideIdle: false,
  hidePrMergedClosed: false,
  onlyWithPr: false,
};

export interface FilterableSession {
  status: SessionStatus;
  mtime: number;
  /** Optional — undefined if PR linkage is disabled or no enrichment cached. */
  prEnrichment?: PrEnrichment;
}

export type HiddenReason =
  | 'stale'
  | 'idle'
  | 'pr-merged-closed'
  | 'no-pr-required';

export interface FilterResult<T extends FilterableSession> {
  /** Sessions kept after applying the filter. */
  visible: T[];
  /** Number of sessions suppressed. */
  hiddenCount: number;
  /** Counts per reason — useful for the panel status message. */
  hiddenByReason: Record<HiddenReason, number>;
}

const ALWAYS_SHOW: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'running',
  'needs-input',
  'unread',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Apply a `SessionFilter` to a list of sessions. Always-show statuses
 * (`running`, `needs-input`, `unread`) bypass every filter. Other statuses
 * are removed if any active filter rule matches.
 *
 * The `now` parameter is injected so tests are deterministic.
 */
export function applySessionFilter<T extends FilterableSession>(
  sessions: T[],
  filter: SessionFilter,
  now: number
): FilterResult<T> {
  const visible: T[] = [];
  const hiddenByReason: Record<HiddenReason, number> = {
    stale: 0,
    idle: 0,
    'pr-merged-closed': 0,
    'no-pr-required': 0,
  };

  for (const session of sessions) {
    if (ALWAYS_SHOW.has(session.status)) {
      visible.push(session);
      continue;
    }

    let hidden: HiddenReason | undefined;

    if (
      filter.hideStaleAfterDays > 0 &&
      now - session.mtime > filter.hideStaleAfterDays * DAY_MS
    ) {
      hidden = 'stale';
    } else if (
      filter.hideIdle &&
      session.status === 'idle' &&
      session.prEnrichment?.status !== 'pr'
    ) {
      // An idle session that is attached to a known PR is signal, not noise —
      // it's something the user is iterating on or about to merge. Only hide
      // idle sessions whose branch has no PR (or whose PR state is still
      // loading / errored — those will become "pr" on the next poll tick).
      hidden = 'idle';
    } else if (
      filter.hidePrMergedClosed &&
      session.prEnrichment?.status === 'pr' &&
      (session.prEnrichment.info.state === 'merged' ||
        session.prEnrichment.info.state === 'closed')
    ) {
      hidden = 'pr-merged-closed';
    } else if (
      filter.onlyWithPr &&
      session.prEnrichment !== undefined &&
      session.prEnrichment.status === 'no-pr'
    ) {
      // Sessions whose PR state is still loading or errored are NOT hidden —
      // we can't yet make an informed call, and flicker is worse than noise.
      hidden = 'no-pr-required';
    }

    if (hidden === undefined) {
      visible.push(session);
    } else {
      hiddenByReason[hidden]++;
    }
  }

  const hiddenCount =
    hiddenByReason.stale +
    hiddenByReason.idle +
    hiddenByReason['pr-merged-closed'] +
    hiddenByReason['no-pr-required'];

  return { visible, hiddenCount, hiddenByReason };
}

/** True when the filter differs from the documented defaults. */
export function isFilterActive(filter: SessionFilter): boolean {
  return (
    filter.hideStaleAfterDays !== DEFAULT_SESSION_FILTER.hideStaleAfterDays ||
    filter.hideIdle !== DEFAULT_SESSION_FILTER.hideIdle ||
    filter.hidePrMergedClosed !== DEFAULT_SESSION_FILTER.hidePrMergedClosed ||
    filter.onlyWithPr !== DEFAULT_SESSION_FILTER.onlyWithPr
  );
}

/**
 * Build a one-line summary of the active filter, suitable for `TreeView.message`.
 * Returns undefined when the filter is at defaults AND nothing was hidden.
 */
export function describeFilter(
  filter: SessionFilter,
  hiddenCount: number
): string | undefined {
  if (hiddenCount === 0 && !isFilterActive(filter)) return undefined;

  const parts: string[] = [];
  if (filter.hideStaleAfterDays > 0) {
    parts.push(`older than ${filter.hideStaleAfterDays}d`);
  }
  if (filter.hideIdle) parts.push('idle');
  if (filter.hidePrMergedClosed) parts.push('merged/closed PRs');
  if (filter.onlyWithPr) parts.push('without PR');

  if (parts.length === 0) return undefined;
  const sessionWord = hiddenCount === 1 ? 'session' : 'sessions';
  return `Hiding ${hiddenCount} ${sessionWord} (${parts.join(', ')})`;
}
