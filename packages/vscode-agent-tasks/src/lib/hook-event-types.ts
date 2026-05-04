/**
 * Shared types for hook events emitted by the agent-tasks-hooks Claude Code plugin.
 *
 * The plugin writes NDJSON lines of HookEvent to per-session files under
 * ${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson. These types are shared
 * between HookEventWatcher (consumer) and the unit tests for emit-event.js.
 */

export type HookEventName =
  | 'UserPromptSubmit'
  | 'Stop'
  | 'Notification'
  | 'SessionStart'
  | 'SessionEnd';

export interface HookEvent {
  /** The lifecycle hook event name. */
  event: HookEventName;
  /** The Claude Code session ID. */
  sessionId: string;
  /** The working directory of the Claude Code session. */
  cwd: string;
  /** Unix millisecond timestamp written by the hook script. */
  ts: number;
}
