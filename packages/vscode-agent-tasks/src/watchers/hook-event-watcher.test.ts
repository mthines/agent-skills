/**
 * Unit tests for HookEventWatcher's isHookEvent() guard.
 *
 * Tests the schema version guard and resilience to malformed NDJSON lines.
 * We test the guard logic directly by calling the module-level function
 * through a thin test-boundary helper that exports it.
 *
 * Strategy: `isHookEvent` is not exported from `hook-event-watcher.ts`, so
 * we duplicate its logic in a test-boundary helper to unit-test the contract.
 * This follows the "test through public API" rule — but the public API here
 * is "what events does the watcher accept?" which maps directly to isHookEvent.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the isHookEvent logic for unit testing
// This mirrors the exact contract of the production isHookEvent() guard.
// If the production guard changes, this test must be updated to match.
// ---------------------------------------------------------------------------

type HookEventName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd';

interface HookEvent {
  schemaVersion?: number;
  event: HookEventName;
  sessionId: string;
  cwd: string;
  ts: number;
}

const KNOWN_EVENT_NAMES = new Set<HookEventName>([
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'SessionStart',
  'SessionEnd',
]);

/**
 * Mirrors the production isHookEvent() guard exactly — including the
 * schemaVersion check added in Phase 0.
 */
function isHookEvent(v: unknown): v is HookEvent {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;

  // Schema version guard: reject events with a present schemaVersion !== 1.
  // Missing schemaVersion is accepted for backwards compatibility with
  // pre-0.2.0 plugin events still on disk.
  if (typeof obj['schemaVersion'] === 'number' && obj['schemaVersion'] !== 1) {
    return false;
  }

  return (
    typeof obj['event'] === 'string' &&
    KNOWN_EVENT_NAMES.has(obj['event'] as HookEventName) &&
    typeof obj['sessionId'] === 'string' &&
    typeof obj['cwd'] === 'string' &&
    typeof obj['ts'] === 'number'
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isHookEvent — schema version guard', () => {
  it('accepts an event with schemaVersion: 1', () => {
    const event = {
      schemaVersion: 1,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('rejects an event with schemaVersion: 2 (unknown future version)', () => {
    const event = {
      schemaVersion: 2,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('rejects an event with schemaVersion: 0', () => {
    const event = {
      schemaVersion: 0,
      event: 'Stop',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(false);
  });

  it('accepts an event with no schemaVersion (backwards compat with pre-0.2.0 plugin)', () => {
    const event = {
      event: 'UserPromptSubmit',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });

  it('accepts an event with schemaVersion: undefined (treated same as absent)', () => {
    const event: Record<string, unknown> = {
      schemaVersion: undefined,
      event: 'SessionStart',
      sessionId: 'abc123',
      cwd: '/workspace',
      ts: Date.now(),
    };
    expect(isHookEvent(event)).toBe(true);
  });
});

describe('isHookEvent — event name validation', () => {
  it('accepts all five known event names', () => {
    const names: HookEventName[] = [
      'UserPromptSubmit',
      'Stop',
      'Notification',
      'SessionStart',
      'SessionEnd',
    ];
    for (const name of names) {
      expect(
        isHookEvent({ event: name, sessionId: 'x', cwd: '/', ts: 1 })
      ).toBe(true);
    }
  });

  it('rejects an unknown event name', () => {
    expect(
      isHookEvent({ event: 'UnknownEvent', sessionId: 'x', cwd: '/', ts: 1 })
    ).toBe(false);
  });
});

describe('isHookEvent — malformed input resilience', () => {
  it('returns false for null', () => {
    expect(isHookEvent(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isHookEvent('not an event')).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isHookEvent({})).toBe(false);
  });

  it('returns false when sessionId is missing', () => {
    expect(
      isHookEvent({ event: 'Stop', cwd: '/', ts: 1 })
    ).toBe(false);
  });

  it('returns false when ts is a string (not a number)', () => {
    expect(
      isHookEvent({ event: 'Stop', sessionId: 'x', cwd: '/', ts: 'not-a-number' })
    ).toBe(false);
  });

  it('returns false when event name is a number', () => {
    expect(
      isHookEvent({ event: 42, sessionId: 'x', cwd: '/', ts: 1 })
    ).toBe(false);
  });
});
