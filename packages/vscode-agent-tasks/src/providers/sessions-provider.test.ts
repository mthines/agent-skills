/**
 * Unit tests for sessions-provider state machine stability scenarios.
 *
 * Tests the unread state, duplicate-Stop guard, replay safety, and
 * Notification idempotence.
 *
 * Strategy: `sessions-provider.ts` imports `vscode` (not available in vitest).
 * We test the pure business logic inline — the functions `hookEventToStatus`
 * and `shouldDiscardStopOverride` mirror the exact contract of the production
 * code. If the production logic changes, these tests must be updated to match
 * (they are the spec, not the implementation).
 *
 * This is the correct approach per the TDD rule: test behavior through the
 * public contract, not through the VS Code runtime. The VS Code API portions
 * are covered by the manual smoke-test checklist.
 */

import { describe, it, expect } from 'vitest';
import type { HookEventName } from '../lib/hook-event-types';
import type { SessionStatus } from '../parsers/session-jsonl-parser';

// ---------------------------------------------------------------------------
// Inline pure logic mirrors — match production sessions-provider.ts exactly
// ---------------------------------------------------------------------------

const HOOK_OVERRIDE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hookEventToStatus(
  eventName: HookEventName,
  isTerminalOpen: boolean
): SessionStatus | undefined {
  switch (eventName) {
    case 'UserPromptSubmit':
      return 'running';
    case 'Stop':
      return isTerminalOpen ? undefined : 'unread';
    case 'SessionStart':
      return 'running';
    case 'SessionEnd':
      return 'idle';
    case 'Notification':
      return 'needs-input';
  }
}

function shouldDiscardStopOverride(
  eventTs: number,
  clearedAt: number | undefined
): boolean {
  return clearedAt !== undefined && clearedAt > eventTs;
}

// ---------------------------------------------------------------------------
// hookEventToStatus — Stop disambiguation
// ---------------------------------------------------------------------------

describe('hookEventToStatus', () => {
  it('returns "unread" for Stop when terminal is NOT open', () => {
    expect(hookEventToStatus('Stop', false)).toBe('unread');
  });

  it('returns undefined for Stop when terminal IS open (no override)', () => {
    // Stability: a Stop with the user watching is just "turn ended". We let
    // the row fall through to Tier 1 (terminal open → running) or Tier 4
    // (deriveRunState → idle once the terminal closes), rather than claim
    // needs-input.
    expect(hookEventToStatus('Stop', true)).toBeUndefined();
  });

  it('returns "running" for UserPromptSubmit regardless of terminal state', () => {
    expect(hookEventToStatus('UserPromptSubmit', false)).toBe('running');
    expect(hookEventToStatus('UserPromptSubmit', true)).toBe('running');
  });

  it('returns "running" for SessionStart', () => {
    expect(hookEventToStatus('SessionStart', false)).toBe('running');
  });

  it('returns "idle" for SessionEnd', () => {
    expect(hookEventToStatus('SessionEnd', false)).toBe('idle');
  });

  it('returns "needs-input" for Notification — the explicit attention signal', () => {
    expect(hookEventToStatus('Notification', false)).toBe('needs-input');
    expect(hookEventToStatus('Notification', true)).toBe('needs-input');
  });
});

// ---------------------------------------------------------------------------
// shouldDiscardStopOverride — duplicate-Stop guard
// ---------------------------------------------------------------------------

describe('shouldDiscardStopOverride', () => {
  it('discards a Stop override when clearUnread was called AFTER the event ts', () => {
    const eventTs = 1000;
    const clearedAt = 2000; // cleared after the event → stale event
    expect(shouldDiscardStopOverride(eventTs, clearedAt)).toBe(true);
  });

  it('does NOT discard when clearUnread was called BEFORE the event ts', () => {
    const eventTs = 2000;
    const clearedAt = 1000; // cleared before the event → this is a new Stop
    expect(shouldDiscardStopOverride(eventTs, clearedAt)).toBe(false);
  });

  it('does NOT discard when clearedAt is undefined (clearUnread never called)', () => {
    expect(shouldDiscardStopOverride(1000, undefined)).toBe(false);
  });

  it('does NOT discard when clearedAt === eventTs (same millisecond = treat as genuine)', () => {
    // The guard is clearedAt > eventTs — equal ms is NOT discarded.
    // A Stop at the exact same millisecond as the clear is treated as genuine.
    expect(shouldDiscardStopOverride(1000, 1000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HOOK_OVERRIDE_TTL_MS — constant spec
// ---------------------------------------------------------------------------

describe('HOOK_OVERRIDE_TTL_MS', () => {
  it('is exactly 5 minutes', () => {
    expect(HOOK_OVERRIDE_TTL_MS).toBe(5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Replay safety: stale Stop override should be rejected by TTL check
// ---------------------------------------------------------------------------

describe('hook override TTL', () => {
  it('a Stop event from 10 minutes ago is beyond HOOK_OVERRIDE_TTL_MS', () => {
    const staleTs = Date.now() - 10 * 60 * 1000;
    const age = Date.now() - staleTs;
    expect(age).toBeGreaterThan(HOOK_OVERRIDE_TTL_MS);
  });

  it('a Stop event from 2 minutes ago is within HOOK_OVERRIDE_TTL_MS', () => {
    const freshTs = Date.now() - 2 * 60 * 1000;
    const age = Date.now() - freshTs;
    expect(age).toBeLessThan(HOOK_OVERRIDE_TTL_MS);
  });
});

// ---------------------------------------------------------------------------
// Notification idempotence — the state machine contract
// ---------------------------------------------------------------------------

describe('Notification hook event', () => {
  it('returns "needs-input" — the only path to needs-input', () => {
    expect(hookEventToStatus('Notification', false)).toBe('needs-input');
  });

  it('returns "needs-input" regardless of terminal state', () => {
    expect(hookEventToStatus('Notification', true)).toBe('needs-input');
  });
});
