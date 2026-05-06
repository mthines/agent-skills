/**
 * Tests for session-filter — covers categorisation of every (status × pr-state)
 * combination, the always-show rule, the inclusion-model semantics, and the
 * footer summary helper.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SESSION_FILTER,
  applySessionFilter,
  categorise,
  describeFilter,
  isFilterActive,
  type FilterableSession,
  type SessionFilter,
} from './session-filter';
import type { SessionStatus } from '../parsers/session-jsonl-parser';
import type { PrEnrichment } from './pr-status-cache';

function makePr(state: 'open' | 'merged' | 'closed' | 'draft'): PrEnrichment {
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
const prDraft = makePr('draft');
const prMerged = makePr('merged');
const prClosed = makePr('closed');
const noPr: PrEnrichment = { status: 'no-pr' };
const loading: PrEnrichment = { status: 'loading' };

function s(
  status: SessionStatus,
  prEnrichment?: PrEnrichment
): FilterableSession {
  return { status, mtime: 0, prEnrichment };
}

describe('categorise', () => {
  it('returns active for running, needs-input, unread', () => {
    expect(categorise(s('running'))).toBe('active');
    expect(categorise(s('needs-input'))).toBe('active');
    expect(categorise(s('unread'))).toBe('active');
  });

  it('returns stalled for stalled status', () => {
    expect(categorise(s('stalled'))).toBe('stalled');
  });

  it('returns open-pr for idle + open or draft PR', () => {
    expect(categorise(s('idle', prOpen))).toBe('open-pr');
    expect(categorise(s('idle', prDraft))).toBe('open-pr');
  });

  it('returns merged-closed-pr for idle + merged or closed PR', () => {
    expect(categorise(s('idle', prMerged))).toBe('merged-closed-pr');
    expect(categorise(s('idle', prClosed))).toBe('merged-closed-pr');
  });

  it('returns idle-no-pr for idle + no PR / loading / undefined', () => {
    expect(categorise(s('idle'))).toBe('idle-no-pr');
    expect(categorise(s('idle', noPr))).toBe('idle-no-pr');
    expect(categorise(s('idle', loading))).toBe('idle-no-pr');
  });
});

describe('applySessionFilter — defaults', () => {
  it('shows active sessions and idle sessions with open PRs by default', () => {
    const sessions = [
      s('running'),
      s('needs-input'),
      s('unread'),
      s('idle', prOpen),
      s('idle', prMerged), // hidden
      s('idle', noPr),     // hidden
      s('stalled'),        // hidden
    ];
    const result = applySessionFilter(sessions, DEFAULT_SESSION_FILTER);
    expect(result.visible).toHaveLength(4);
    expect(result.hiddenCount).toBe(3);
    expect(result.hiddenByCategory['merged-closed-pr']).toBe(1);
    expect(result.hiddenByCategory['idle-no-pr']).toBe(1);
    expect(result.hiddenByCategory.stalled).toBe(1);
  });
});

describe('applySessionFilter — showActive', () => {
  it('shows running, needs-input, unread when showActive=true', () => {
    const sessions = [s('running'), s('needs-input'), s('unread')];
    const result = applySessionFilter(sessions, DEFAULT_SESSION_FILTER);
    expect(result.visible).toHaveLength(3);
  });

  it('hides running, needs-input, unread when showActive=false', () => {
    const filter: SessionFilter = {
      showActive: false,
      showOpenPr: true,
      showMergedClosedPr: false,
      showIdleNoPr: false,
      showStalled: false,
    };
    const sessions = [s('running'), s('needs-input'), s('unread'), s('idle', prOpen)];
    const result = applySessionFilter(sessions, filter);
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.prEnrichment).toBe(prOpen);
    expect(result.hiddenByCategory.active).toBe(3);
  });
});

describe('applySessionFilter — single-purpose toggles', () => {
  it('showOpenPr controls only the open-pr bucket', () => {
    const sessions = [s('idle', prOpen), s('idle', prMerged), s('idle', noPr)];
    const both = applySessionFilter(sessions, {
      ...DEFAULT_SESSION_FILTER,
      showOpenPr: true,
    });
    expect(both.visible).toHaveLength(1);
    expect(both.visible[0]?.prEnrichment).toBe(prOpen);

    const none = applySessionFilter(sessions, {
      ...DEFAULT_SESSION_FILTER,
      showOpenPr: false,
    });
    expect(none.visible).toHaveLength(0);
  });

  it('showMergedClosedPr controls only the merged-closed bucket', () => {
    const sessions = [s('idle', prOpen), s('idle', prMerged), s('idle', prClosed)];
    const result = applySessionFilter(sessions, {
      showActive: true,
      showOpenPr: false,
      showMergedClosedPr: true,
      showIdleNoPr: false,
      showStalled: false,
    });
    expect(result.visible).toHaveLength(2);
    expect(result.visible.map((v) => v.prEnrichment)).toEqual([prMerged, prClosed]);
  });

  it('showIdleNoPr controls only the idle-no-pr bucket', () => {
    const sessions = [s('idle', prOpen), s('idle'), s('idle', loading)];
    const result = applySessionFilter(sessions, {
      showActive: true,
      showOpenPr: false,
      showMergedClosedPr: false,
      showIdleNoPr: true,
      showStalled: false,
    });
    expect(result.visible).toHaveLength(2);
  });

  it('showStalled controls only the stalled bucket', () => {
    const sessions = [s('stalled'), s('idle', prOpen), s('idle')];
    const result = applySessionFilter(sessions, {
      showActive: true,
      showOpenPr: false,
      showMergedClosedPr: false,
      showIdleNoPr: false,
      showStalled: true,
    });
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]?.status).toBe('stalled');
  });
});

describe('isFilterActive', () => {
  it('returns false at defaults', () => {
    expect(isFilterActive(DEFAULT_SESSION_FILTER)).toBe(false);
  });

  it('returns true when any flag deviates from defaults', () => {
    expect(isFilterActive({ ...DEFAULT_SESSION_FILTER, showActive: false })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_SESSION_FILTER, showOpenPr: false })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_SESSION_FILTER, showStalled: true })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_SESSION_FILTER, showMergedClosedPr: true })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_SESSION_FILTER, showIdleNoPr: true })).toBe(true);
  });
});

describe('describeFilter', () => {
  it('returns undefined when nothing is hidden', () => {
    const result = applySessionFilter([s('running')], DEFAULT_SESSION_FILTER);
    expect(describeFilter(result)).toBeUndefined();
  });

  it('lists every hidden bucket in user-readable terms', () => {
    const result = applySessionFilter(
      [s('idle', prMerged), s('idle'), s('stalled')],
      DEFAULT_SESSION_FILTER
    );
    const text = describeFilter(result);
    expect(text).toMatch(/Hiding 3 sessions/);
    expect(text).toMatch(/idle/);
    expect(text).toMatch(/merged\/closed PRs/);
    expect(text).toMatch(/stalled/);
  });

  it('uses singular wording for exactly one hidden session', () => {
    const result = applySessionFilter([s('stalled')], DEFAULT_SESSION_FILTER);
    expect(describeFilter(result)).toMatch(/Hiding 1 session\b/);
  });
});
