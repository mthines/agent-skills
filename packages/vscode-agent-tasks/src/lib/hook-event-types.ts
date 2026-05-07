/**
 * Shared types for hook events emitted by the agent-tasks-hooks Claude Code plugin.
 *
 * The plugin writes NDJSON lines of HookEvent to per-session files under
 * ${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson. These types are shared
 * between HookEventWatcher (consumer) and the unit tests for emit-event.js.
 *
 * Schema versions:
 *   v1 (plugin >= 0.2.0) — five lifecycle events: UserPromptSubmit, Stop,
 *       Notification, SessionStart, SessionEnd. schemaVersion may be absent
 *       for events written by pre-0.2.0 builds (backwards compat).
 *   v2 (plugin >= 0.3.0) — two sub-agent events: SubagentDispatch (emitted on
 *       PreToolUse/Agent), SubagentFinished (emitted on SubagentStop). The
 *       five v1 event types are unchanged and continue to emit schemaVersion: 1.
 */

export type HookEventName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentDispatch'
  | 'SubagentFinished';

/**
 * A v1 lifecycle event.
 * schemaVersion is optional for backwards compatibility with pre-0.2.0 events
 * already on disk that were emitted before the field was added.
 */
export interface HookEventV1 {
  schemaVersion?: 1;
  event: Exclude<HookEventName, 'SubagentDispatch' | 'SubagentFinished'>;
  /** The Claude Code session ID. */
  sessionId: string;
  /** The working directory of the Claude Code session. */
  cwd: string;
  /** Unix millisecond timestamp written by the hook script. */
  ts: number;
}

/**
 * A v2 event emitted when a sub-agent is dispatched via the Agent tool.
 * Carries only allow-listed fields — never prompt content.
 */
export interface SubagentDispatchEvent {
  schemaVersion: 2;
  event: 'SubagentDispatch';
  /** The PARENT session ID (the session that invoked the Agent tool). */
  sessionId: string;
  cwd: string;
  ts: number;
  /** tool_use_id from the PreToolUse payload — correlator for the dispatch. */
  toolUseId: string;
  /** tool_input.subagent_type from the PreToolUse payload. */
  subagentType: string;
  /** tool_input.description from the PreToolUse payload. May be empty string. */
  description: string;
}

/**
 * A v2 event emitted when a sub-agent finishes (SubagentStop hook).
 * Does NOT carry toolUseId — the SubagentStop payload does not include it.
 * FIFO correlation by subagentType is used instead.
 */
export interface SubagentFinishedEvent {
  schemaVersion: 2;
  event: 'SubagentFinished';
  /** The PARENT session ID. */
  sessionId: string;
  cwd: string;
  ts: number;
  /** agent_type from the SubagentStop payload. */
  subagentType: string;
}

/** Discriminated union of all accepted hook event shapes. */
export type HookEvent = HookEventV1 | SubagentDispatchEvent | SubagentFinishedEvent;
