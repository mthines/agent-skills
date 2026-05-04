/**
 * Path helpers for the agent-tasks-hooks Claude Code plugin data directory.
 *
 * The plugin data directory is derived from the plugin install identifier
 * `agent-tasks-hooks@agent-skills-plugins`. Claude Code converts this to a
 * filesystem-safe string by replacing non-[a-zA-Z0-9_-] characters with `-`,
 * yielding `agent-tasks-hooks-agent-skills-plugins`.
 *
 * Mirrors the getClaudeProjectsDir() pattern from session-jsonl-parser.ts:
 * derive from os.homedir() so the path is correct on all platforms without
 * requiring the extension to read Claude Code settings.json.
 */

import * as path from 'path';
import * as os from 'os';

const PLUGIN_DATA_DIR_ID = 'agent-tasks-hooks-agent-skills-plugins';

/**
 * Returns the root data directory for the agent-tasks-hooks plugin.
 * Equivalent to `${CLAUDE_PLUGIN_DATA}` when the plugin is installed with
 * `--scope user`.
 *
 * Example: ~/.claude/plugins/data/agent-tasks-hooks-agent-skills-plugins
 */
export function getPluginDataDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'data', PLUGIN_DATA_DIR_ID);
}

/**
 * Returns the path to the sentinel file written by the VS Code extension
 * when `agentTasks.hooks.enabled` is true.
 *
 * The hook script checks for this file before doing any work. Absence means
 * the extension is not installed, has been uninstalled, or the user opted out.
 */
export function getSentinelPath(): string {
  return path.join(getPluginDataDir(), 'sentinel');
}

/**
 * Returns the directory where per-session NDJSON event files are written.
 *
 * Files are named `<sessionId>.ndjson` and contain one HookEvent JSON object
 * per line.
 */
export function getHookEventsDir(): string {
  return path.join(getPluginDataDir(), 'events');
}
