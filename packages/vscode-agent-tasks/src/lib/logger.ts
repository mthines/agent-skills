/**
 * Output-channel logger for the Agent Tasks extension.
 *
 * Channel name: `mthines.agent-tasks` (mirrors the `gw` extension's logger
 * pattern but namespaced by publisher.id so users can find it under
 * View → Output → mthines.agent-tasks).
 */

import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function ts(): string {
  return new Date().toLocaleTimeString();
}

/** Initialise the output channel. Idempotent — safe to call multiple times. */
export function initLogger(context: vscode.ExtensionContext): void {
  if (channel) return;
  channel = vscode.window.createOutputChannel('mthines.agent-tasks');
  context.subscriptions.push(channel);
  log('Logger initialised');
}

/** Append a timestamped line to the output channel. No-op if not initialised. */
export function log(message: string): void {
  channel?.appendLine(`[${ts()}] ${message}`);
}

/**
 * Log an error with optional context. Renders the error message and stack on
 * a separate line for grep-ability in the channel.
 */
export function logError(message: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  channel?.appendLine(`[${ts()}] ERROR ${message}: ${msg}`);
  if (err instanceof Error && err.stack) {
    channel?.appendLine(err.stack);
  }
}
