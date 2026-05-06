/**
 * SessionActivityDecorationProvider — adds a small coloured dot badge next to
 * Sessions panel rows whose status is active. Lets us drop the pinned
 * "Running" group while keeping a clear at-a-glance signal for which rows
 * are mid-flight, waiting on you, or unread.
 *
 * The provider keys decorations off a synthetic `agent-session://<sessionId>`
 * URI scheme. SessionItem sets that URI on every leaf row; we look up the
 * status in a Map injected by SessionsProvider on each refresh.
 *
 * Colouring: VS Code's FileDecoration.color tints BOTH the badge AND the
 * row's label text — that bleeds the activity colour onto every word in the
 * row and makes the panel visually shouty. To get a coloured dot WITHOUT
 * recolouring the label, we use coloured emoji glyphs as the badge text
 * (intrinsic colour, no `color` field). The label stays in the theme's
 * default foreground.
 *
 *   running     → ⚪ (white circle)  — agent working, no action needed
 *   needs-input → 🟡                — waiting on you, act now
 *   unread      → 🔵                — finished while you were away, review
 *   stalled     → 🟠                — stuck, investigate
 *
 * Idle sessions get no decoration — that's the default state.
 */

import * as vscode from 'vscode';
import type { SessionStatus } from '../parsers/session-jsonl-parser';

export const SESSION_URI_SCHEME = 'agent-session';

export function sessionUri(sessionId: string): vscode.Uri {
  return vscode.Uri.parse(`${SESSION_URI_SCHEME}:///${sessionId}`);
}

interface ActivityBadge {
  /** Single emoji glyph — its colour is intrinsic to the codepoint. */
  badge: string;
  tooltip: string;
}

const ACTIVITY: Partial<Record<SessionStatus, ActivityBadge>> = {
  running: { badge: '⚪', tooltip: 'Running' },
  'needs-input': { badge: '🟡', tooltip: 'Waiting for input' },
  unread: { badge: '🔵', tooltip: 'Unread' },
  stalled: { badge: '🟠', tooltip: 'Stalled' },
};

export class SessionActivityDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** Latest map of `sessionId → SessionStatus`. Replaced wholesale on refresh. */
  private statuses = new Map<string, SessionStatus>();

  /**
   * Replace the status map and notify VS Code so it re-queries the affected
   * rows. Called by SessionsProvider after every `buildRootItems()`.
   */
  setStatuses(next: Map<string, SessionStatus>): void {
    const changedIds = new Set<string>();
    for (const id of this.statuses.keys()) changedIds.add(id);
    for (const id of next.keys()) changedIds.add(id);
    this.statuses = next;
    if (changedIds.size === 0) return;
    const uris = Array.from(changedIds, (id) => sessionUri(id));
    this._onDidChange.fire(uris);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SESSION_URI_SCHEME) return undefined;
    const sessionId = uri.path.replace(/^\//, '');
    const status = this.statuses.get(sessionId);
    if (!status) return undefined;
    const cfg = ACTIVITY[status];
    if (!cfg) return undefined;
    return {
      badge: cfg.badge,
      tooltip: cfg.tooltip,
      // Don't propagate to parent — only the row itself gets the dot.
      // Deliberately no `color` — VS Code would tint the row label text
      // and we want only the badge glyph to carry colour (via emoji).
      propagate: false,
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
