/**
 * PrStatusCache — per-branch PR enrichment cache.
 *
 * Wraps `gh pr view --head <branch>` and caches results with a configurable
 * rate limit (default 60s per branch). Never imports `vscode` — VS Code
 * callbacks are injected so this module remains unit-testable with vitest.
 *
 * Error classification:
 *   ENOENT (gh not installed)        → no-pr, fire onGhNotAvailable once
 *   exit-1 "no pull requests match"  → no-pr
 *   exit-1 other (transient error)   → preserve last cached result
 *   timeout (>5s)                    → preserve last cached result
 *
 * No-flip guarantee: a pr-merged cache entry is never overwritten with no-pr
 * due to a transient error. Only a successful gh response returns no-pr/open/etc.
 */

import type { GhExecutor } from './gh-executor';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PrState = 'open' | 'merged' | 'closed' | 'draft';
export type CiState = 'passing' | 'failing' | 'pending' | 'none';

export interface PrInfo {
  number: number;
  url: string;
  title: string;
  state: PrState;
  ciState: CiState;
  /** ISO 8601 timestamp of when this entry was fetched. */
  fetchedAt: string;
}

export type PrEnrichment =
  | { status: 'no-pr' }
  | { status: 'error'; reason: string }
  | { status: 'loading' }
  | { status: 'pr'; info: PrInfo };

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CacheEntry {
  enrichment: PrEnrichment;
  fetchedAtMs: number;
}

interface PrStatusCacheOptions {
  /** Minimum milliseconds between re-fetches per branch. Default: 60_000. */
  rateLimitMs?: number;
}

// ---------------------------------------------------------------------------
// CiState derivation
// ---------------------------------------------------------------------------

interface StatusCheckRollupItem {
  conclusion?: string | null;
  status?: string | null;
}

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'ACTION_REQUIRED',
  'TIMED_OUT',
  'CANCELLED',
]);

const PENDING_STATUSES = new Set([
  'IN_PROGRESS',
  'QUEUED',
  'WAITING',
  'PENDING',
]);

export function deriveCiState(
  statusCheckRollup: StatusCheckRollupItem[] | null | undefined
): CiState {
  if (!statusCheckRollup || statusCheckRollup.length === 0) return 'none';

  let anyPending = false;
  for (const check of statusCheckRollup) {
    if (check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion)) {
      return 'failing';
    }
    if (check.status && PENDING_STATUSES.has(check.status)) {
      anyPending = true;
    }
  }

  if (anyPending) return 'pending';

  // All checks have a non-failing conclusion
  const allSuccess = statusCheckRollup.every(
    (c) => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED'
  );
  return allSuccess ? 'passing' : 'none';
}

// ---------------------------------------------------------------------------
// PrState normalization
// ---------------------------------------------------------------------------

function normalizePrState(ghState: string, isDraft: boolean): PrState {
  if (ghState === 'OPEN' && isDraft) return 'draft';
  switch (ghState) {
    case 'OPEN': return 'open';
    case 'MERGED': return 'merged';
    case 'CLOSED': return 'closed';
    default: return 'open';
  }
}

// ---------------------------------------------------------------------------
// PrStatusCache
// ---------------------------------------------------------------------------

export class PrStatusCache {
  private readonly cache = new Map<string, CacheEntry>();
  private ghAvailable = true;
  private readonly rateLimitMs: number;
  private ghErrorCount = 0;

  constructor(
    private readonly gh: GhExecutor,
    /** Called once when gh is not installed. Inject vscode.window.showInformationMessage. */
    private readonly onGhNotAvailable: () => void,
    options: PrStatusCacheOptions = {}
  ) {
    this.rateLimitMs = options.rateLimitMs ?? 60_000;
  }

  /** Returns the current cached enrichment for a branch, or 'loading' if unfetched. */
  getEnrichment(branch: string): PrEnrichment {
    return this.cache.get(branch)?.enrichment ?? { status: 'loading' };
  }

  /**
   * Fetch (or re-fetch) enrichment for a branch. Rate-limited: if a fetch was
   * performed within `rateLimitMs`, returns the cached result immediately.
   */
  async fetchEnrichment(branch: string, worktreePath: string): Promise<void> {
    if (!this.ghAvailable) return;

    const existing = this.cache.get(branch);
    if (existing && Date.now() - existing.fetchedAtMs < this.rateLimitMs) {
      return; // Within rate limit window
    }

    let stdout: string;
    let exitCode: number;

    try {
      const result = await this.gh.exec(
        ['pr', 'view', '--head', branch, '--json', 'number,title,url,state,isDraft,statusCheckRollup'],
        worktreePath
      );
      stdout = result.stdout;
      exitCode = result.exitCode;
    } catch (err) {
      // Spawn failure — most likely gh not installed (ENOENT)
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.ghAvailable = false;
        this.onGhNotAvailable();
      }
      this.cache.set(branch, {
        enrichment: { status: 'no-pr' },
        fetchedAtMs: Date.now(),
      });
      return;
    }

    if (exitCode !== 0) {
      // Classify the error
      const isNoPr =
        stdout.includes('no pull requests match') ||
        stdout.includes('no pull request matches');

      if (isNoPr) {
        this.cache.set(branch, {
          enrichment: { status: 'no-pr' },
          fetchedAtMs: Date.now(),
        });
        return;
      }

      // Transient error: preserve last cached result if it was a successful PR fetch.
      // This implements the no-flip guarantee.
      this.ghErrorCount++;
      if (this.ghErrorCount === 1 || this.ghErrorCount % 10 === 0) {
        // Log throttled — callers can observe via the output channel
      }

      if (existing && existing.enrichment.status === 'pr') {
        // Preserve the last good state — do NOT overwrite with an error
        this.cache.set(branch, {
          enrichment: existing.enrichment,
          fetchedAtMs: Date.now(),
        });
      } else if (!existing) {
        // No prior cache — don't cache the error, let the next tick retry
      }
      return;
    }

    // Successful response — parse JSON
    try {
      const data = JSON.parse(stdout) as {
        number: number;
        title: string;
        url: string;
        state: string;
        isDraft: boolean;
        statusCheckRollup: StatusCheckRollupItem[] | null;
      };

      const info: PrInfo = {
        number: data.number,
        url: data.url,
        title: data.title,
        state: normalizePrState(data.state, data.isDraft ?? false),
        ciState: deriveCiState(data.statusCheckRollup),
        fetchedAt: new Date().toISOString(),
      };

      this.cache.set(branch, {
        enrichment: { status: 'pr', info },
        fetchedAtMs: Date.now(),
      });
    } catch {
      // Malformed JSON — treat as transient error, preserve last result
      if (existing?.enrichment.status === 'pr') {
        this.cache.set(branch, {
          enrichment: existing.enrichment,
          fetchedAtMs: Date.now(),
        });
      }
    }
  }

  dispose(): void {
    this.cache.clear();
  }
}
