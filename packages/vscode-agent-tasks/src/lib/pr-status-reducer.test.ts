/**
 * Unit tests for resolveDisplayStatus() pure helper.
 *
 * Tests the display status resolution logic that combines SessionStatus with
 * PrEnrichment to derive the final status shown in the tree view.
 */

import { describe, it, expect } from 'vitest';
import { resolveDisplayStatus } from './pr-status-reducer';
import type { PrEnrichment } from './pr-status-cache';
import type { SessionStatus } from '../parsers/session-jsonl-parser';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePrEnrichment(
  state: 'open' | 'merged' | 'closed' | 'draft',
  ciState: 'passing' | 'failing' | 'pending' | 'none' = 'none'
): PrEnrichment {
  return {
    status: 'pr',
    info: {
      number: 42,
      url: 'https://github.com/owner/repo/pull/42',
      title: 'feat: my feature',
      state,
      ciState,
      fetchedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: idle + PR state combinations
// ---------------------------------------------------------------------------

describe('resolveDisplayStatus — idle session with PR enrichment', () => {
  it('idle + open PR + passing CI → "pr-open"', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('open', 'passing'))
    ).toBe('pr-open');
  });

  it('idle + open PR + failing CI → "pr-ci-failing"', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('open', 'failing'))
    ).toBe('pr-ci-failing');
  });

  it('idle + open PR + pending CI → "pr-open" (pending does not override to failing)', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('open', 'pending'))
    ).toBe('pr-open');
  });

  it('idle + open PR + no CI → "pr-open"', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('open', 'none'))
    ).toBe('pr-open');
  });

  it('idle + merged PR → "pr-merged"', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('merged', 'passing'))
    ).toBe('pr-merged');
  });

  it('idle + closed PR → "pr-closed"', () => {
    expect(
      resolveDisplayStatus('idle', makePrEnrichment('closed', 'none'))
    ).toBe('pr-closed');
  });

  it('idle + no-pr → "idle" (falls through to session status)', () => {
    expect(
      resolveDisplayStatus('idle', { status: 'no-pr' })
    ).toBe('idle');
  });

  it('idle + loading PR → "idle" (falls through while loading)', () => {
    expect(
      resolveDisplayStatus('idle', { status: 'loading' })
    ).toBe('idle');
  });

  it('idle + error PR → "idle" (graceful degradation)', () => {
    expect(
      resolveDisplayStatus('idle', { status: 'error', reason: 'timeout' })
    ).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Tests: non-idle session status takes precedence over PR state
// ---------------------------------------------------------------------------

describe('resolveDisplayStatus — non-idle session status takes precedence', () => {
  it('"running" takes precedence over PR open state', () => {
    expect(
      resolveDisplayStatus('running', makePrEnrichment('open', 'passing'))
    ).toBe('running');
  });

  it('"needs-input" takes precedence over PR merged state', () => {
    expect(
      resolveDisplayStatus('needs-input', makePrEnrichment('merged', 'none'))
    ).toBe('needs-input');
  });

  it('"unread" takes precedence over PR state (no PR case)', () => {
    expect(
      resolveDisplayStatus('unread', { status: 'no-pr' })
    ).toBe('unread');
  });

  it('"unread" takes precedence even with an open PR', () => {
    expect(
      resolveDisplayStatus('unread', makePrEnrichment('open', 'passing'))
    ).toBe('unread');
  });

  it('"stalled" takes precedence over PR open state', () => {
    expect(
      resolveDisplayStatus('stalled', makePrEnrichment('open', 'failing'))
    ).toBe('stalled');
  });
});

// ---------------------------------------------------------------------------
// Tests: undefined PR enrichment
// ---------------------------------------------------------------------------

describe('resolveDisplayStatus — undefined PR enrichment', () => {
  it('returns session status when pr enrichment is undefined', () => {
    const statuses: SessionStatus[] = ['idle', 'running', 'needs-input', 'unread', 'stalled'];
    for (const s of statuses) {
      expect(resolveDisplayStatus(s, undefined)).toBe(s);
    }
  });
});
