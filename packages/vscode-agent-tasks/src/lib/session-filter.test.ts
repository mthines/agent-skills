/**
 * Tests for session-filter — covers the always-show rule, each filter axis,
 * and the describe/active helpers used by the provider layer.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SESSION_FILTER,
  applySessionFilter,
  describeFilter,
  isFilterActive,
  type FilterableSession,
  type SessionFilter,
} from './session-filter';
import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

const NOW = new Date('2026-05-06T14:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function session(
  status: SessionStatus,
  ageDays: number,
  prEnrichment?: PrEnrichment
): FilterableSession {
  return {
    status,
    mtime: NOW - ageDays * DAY_MS,
    prEnrichment,
  };
}

function makePr(state: 'open' | 'merged' | 'closed'): PrEnrichment {
  return {
    status: 'pr',
    info: {
      number: 1,
      url: 'https://example/1',
      title: 't',
      state,
      ciState: 'passing',
      fetchedAt: '2026-05-06T13:59:00Z',
    },
  };
}
const prOpen = makePr('open');
const prMerged = makePr('merged');
const prClosed = makePr('closed');
const noPr: PrEnrichment = { status: 'no-pr' };
const loading: PrEnrichment = { status: 'loading' };

describe('applySessionFilter — always-show rule', () => {
  it('never hides a running session, even if every filter would match', () => {
    const sessions = [session('running', 365, prMerged)];
    const result = applySessionFilter(
      sessions,
      {
        hideStaleAfterDays: 1,
        hideIdle: true,
        hidePrMergedClosed: true,
        onlyWithPr: true,
      },
      NOW
    );
    expect(result.visible).toHaveLength(1);
    expect(result.hiddenCount).toBe(0);
  });

  it('never hides a needs-input or unread session', () => {
    const sessions = [
      session('needs-input', 365),
      session('unread', 365),
    ];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 1, hideIdle: true },
      NOW
    );
    expect(result.visible).toHaveLength(2);
  });
});

describe('applySessionFilter — staleness', () => {
  it('hides sessions older than hideStaleAfterDays', () => {
    const sessions = [
      session('idle', 5),
      session('idle', 20),
      session('idle', 14.5),
    ];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 14 },
      NOW
    );
    expect(result.visible).toHaveLength(1);
    expect(result.hiddenCount).toBe(2);
    expect(result.hiddenByReason.stale).toBe(2);
  });

  it('hideStaleAfterDays=0 disables the rule', () => {
    const sessions = [session('idle', 999)];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0 },
      NOW
    );
    expect(result.visible).toHaveLength(1);
  });
});

describe('applySessionFilter — hideIdle', () => {
  it('hides idle sessions when enabled', () => {
    const sessions = [session('idle', 1), session('stalled', 1)];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0, hideIdle: true },
      NOW
    );
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.status).toBe('stalled');
    expect(result.hiddenByReason.idle).toBe(1);
  });
});

describe('applySessionFilter — hidePrMergedClosed', () => {
  it('hides merged and closed PRs', () => {
    const sessions = [
      session('idle', 1, prOpen),
      session('idle', 1, prMerged),
      session('idle', 1, prClosed),
    ];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0, hidePrMergedClosed: true },
      NOW
    );
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.prEnrichment).toBe(prOpen);
    expect(result.hiddenByReason['pr-merged-closed']).toBe(2);
  });

  it('does not hide sessions whose enrichment is loading or errored', () => {
    const sessions = [
      session('idle', 1, loading),
      session('idle', 1, { status: 'error', reason: 'transient' }),
    ];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0, hidePrMergedClosed: true },
      NOW
    );
    expect(result.visible).toHaveLength(2);
  });
});

describe('applySessionFilter — onlyWithPr', () => {
  it('hides sessions whose PR state is no-pr', () => {
    const sessions = [
      session('idle', 1, prOpen),
      session('idle', 1, noPr),
    ];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0, onlyWithPr: true },
      NOW
    );
    expect(result.visible).toHaveLength(1);
    expect(result.hiddenByReason['no-pr-required']).toBe(1);
  });

  it('does NOT hide sessions still loading PR enrichment (avoid flicker)', () => {
    const sessions = [session('idle', 1, loading)];
    const result = applySessionFilter(
      sessions,
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 0, onlyWithPr: true },
      NOW
    );
    expect(result.visible).toHaveLength(1);
  });
});

describe('isFilterActive', () => {
  it('returns false at defaults', () => {
    expect(isFilterActive(DEFAULT_SESSION_FILTER)).toBe(false);
  });

  it('returns true if any axis differs from default', () => {
    const variations: SessionFilter[] = [
      { ...DEFAULT_SESSION_FILTER, hideStaleAfterDays: 7 },
      { ...DEFAULT_SESSION_FILTER, hideIdle: true },
      { ...DEFAULT_SESSION_FILTER, hidePrMergedClosed: true },
      { ...DEFAULT_SESSION_FILTER, onlyWithPr: true },
    ];
    for (const f of variations) expect(isFilterActive(f)).toBe(true);
  });
});

describe('describeFilter', () => {
  it('returns undefined when nothing is hidden and filter is at defaults', () => {
    expect(describeFilter(DEFAULT_SESSION_FILTER, 0)).toBeUndefined();
  });

  it('summarises the active rules with hidden count', () => {
    const summary = describeFilter(
      { ...DEFAULT_SESSION_FILTER, hideIdle: true },
      3
    );
    expect(summary).toMatch(/Hiding 3 sessions/);
    expect(summary).toMatch(/older than 14d/);
    expect(summary).toMatch(/idle/);
  });

  it('uses singular "session" when exactly 1 is hidden', () => {
    const summary = describeFilter(DEFAULT_SESSION_FILTER, 1);
    expect(summary).toMatch(/Hiding 1 session\b/);
  });
});
