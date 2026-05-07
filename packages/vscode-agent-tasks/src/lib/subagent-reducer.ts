/**
 * Pure reducer functions for sub-agent lifecycle management.
 *
 * No VS Code dependency — safe to unit-test with vitest.
 *
 * Design notes:
 *  - All functions return new arrays (immutable updates) so callers can
 *    detect changes via reference equality.
 *  - FIFO correlation: SubagentFinished has no toolUseId so we match the
 *    oldest running entry with the same subagentType.
 *  - Status roll-up: worst-child-wins — any running child propagates upward.
 */

export interface SubagentRecord {
  /** Correlator from SubagentDispatch. Synthetic (generated) when the dispatch was missed. */
  toolUseId: string;
  /** Agent type string (e.g. "general-purpose"). */
  subagentType: string;
  /** Display label — tool_input.description, falling back to subagentType. */
  description: string;
  /** Simplified 3-tier status. */
  status: 'running' | 'idle';
  /** Unix ms timestamp from the SubagentDispatch event. */
  spawnedAt: number;
  /** Unix ms timestamp from the SubagentFinished event. Absent while running. */
  finishedAt?: number;
}

/**
 * Apply a SubagentDispatch event to the sub-agent list for a session.
 * Returns a new array (immutable update) with the new record appended at the end.
 * Description falls back to subagentType when absent or empty.
 */
export function applySubagentDispatch(
  existing: SubagentRecord[],
  event: { toolUseId: string; subagentType: string; description: string; ts: number }
): SubagentRecord[] {
  const record: SubagentRecord = {
    toolUseId: event.toolUseId,
    subagentType: event.subagentType,
    description: event.description || event.subagentType,
    status: 'running',
    spawnedAt: event.ts,
  };
  return [...existing, record];
}

/**
 * Apply a SubagentFinished event to the sub-agent list.
 *
 * FIFO strategy: finds the oldest running record with matching subagentType
 * and marks it idle.
 * If none is found (e.g. the parent session was not open when dispatch fired),
 * appends a synthetic finished record so the UI can still reflect the
 * completion even without a paired dispatch.
 *
 * Returns a new array (immutable update).
 */
export function applySubagentFinished(
  existing: SubagentRecord[],
  event: { subagentType: string; ts: number }
): SubagentRecord[] {
  let matched = false;
  const updated = existing.map((r) => {
    if (!matched && r.status === 'running' && r.subagentType === event.subagentType) {
      matched = true;
      return { ...r, status: 'idle' as const, finishedAt: event.ts };
    }
    return r;
  });

  if (!matched) {
    // Synthetic finished record — dispatch event was missed (panel not open when sub-agent started).
    const synthetic: SubagentRecord = {
      toolUseId: `synthetic-${event.ts}`,
      subagentType: event.subagentType,
      description: event.subagentType,
      status: 'idle',
      spawnedAt: event.ts,
      finishedAt: event.ts,
    };
    return [...updated, synthetic];
  }

  return updated;
}

/**
 * Compute a parent session status roll-up from sub-agent records.
 *
 * Worst-child-wins precedence:
 *   any running child → 'running'
 *   otherwise         → 'idle'
 *
 * 'needs-input' is reserved for future per-child Notification support.
 * Returns 'idle' for an empty list.
 */
export function computeRollupStatus(records: SubagentRecord[]): 'running' | 'idle' {
  if (records.some((r) => r.status === 'running')) return 'running';
  return 'idle';
}
