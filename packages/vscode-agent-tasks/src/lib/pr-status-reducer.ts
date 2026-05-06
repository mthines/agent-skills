/**
 * resolveDisplayStatus — pure helper to combine SessionStatus + PrEnrichment
 * into the final display status for a session tree item.
 *
 * Rules:
 *   - Any non-idle SessionStatus takes precedence over PR state.
 *   - Only `idle` sessions can show PR-derived display statuses.
 *   - PR enrichment that isn't status 'pr' (loading, no-pr, error) falls
 *     through to the underlying session status.
 *
 * No VS Code imports — this module is pure and vitest-safe.
 */

import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

export type DisplayStatus =
  | SessionStatus
  | 'pr-open'
  | 'pr-ci-failing'
  | 'pr-merged'
  | 'pr-closed';

/**
 * Resolves the display status for a session row.
 *
 * When the session is `idle` and there is a successfully-fetched PR enrichment,
 * the PR state is used for the icon. All other SessionStatus values take
 * precedence (running, needs-input, unread, stalled all override PR state).
 */
export function resolveDisplayStatus(
  sessionStatus: SessionStatus,
  prEnrichment: PrEnrichment | undefined
): DisplayStatus {
  // Non-idle session states always take precedence
  if (sessionStatus !== 'idle') return sessionStatus;

  // No enrichment or enrichment not yet a successful PR result — fall through
  if (!prEnrichment || prEnrichment.status !== 'pr') return 'idle';

  const { state, ciState } = prEnrichment.info;

  if (state === 'open' || state === 'draft') {
    return ciState === 'failing' ? 'pr-ci-failing' : 'pr-open';
  }
  if (state === 'merged') return 'pr-merged';
  if (state === 'closed') return 'pr-closed';

  return 'idle';
}
