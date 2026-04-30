/**
 * File system watcher for Claude Code session JSONL directories.
 *
 * Watches one or more `~/.claude/projects/<encoded-cwd>/` directories and
 * fires an `onSessionChanged` event when any `.jsonl` file is created,
 * modified, or deleted. The SessionsProvider listens to this event and calls
 * `refresh()`.
 *
 * Platform strategy (mirrors ArtifactWatcher):
 *   macOS / Windows — `fs.watch(dir, { recursive: false }, …)`.
 *     Non-recursive is sufficient: JSONL files are flat in the directory.
 *     The session dirs live outside the VS Code workspace boundary so we use
 *     native fs.watch rather than vscode.workspace.createFileSystemWatcher.
 *   Linux — `vscode.workspace.createFileSystemWatcher` as best-effort fallback
 *     (fs.watch recursive is unsupported on Linux; *.jsonl glob still fires for
 *     files inside the watched dir).
 *
 * Debounce: 500 ms. JSONL files are written continuously during active
 * sessions; a 500 ms window avoids thrashing the tree refresh while still
 * providing near-realtime updates.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';

export class SessionWatcher implements vscode.Disposable {
  private fsWatchers: fs.FSWatcher[] = [];
  private vscodeWatchers: vscode.FileSystemWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 500;

  private _onSessionChanged = new vscode.EventEmitter<void>();
  /** Fires (debounced) when any watched JSONL file changes. */
  readonly onSessionChanged = this._onSessionChanged.event;

  constructor(sessionDirs: string[] = []) {
    this.buildWatchers(sessionDirs);
  }

  /**
   * Replace the current set of watched directories with `newDirs`.
   * Called when the workspace changes (e.g. new worktree added).
   */
  rebuild(newDirs: string[]): void {
    this.disposeWatchers();
    this.buildWatchers(newDirs);
  }

  private buildWatchers(dirs: string[]): void {
    const platform = os.platform();
    for (const dir of dirs) {
      if (!dir) continue;
      if (platform === 'darwin' || platform === 'win32') {
        this.setupNativeWatcher(dir);
      } else {
        this.setupVscodeWatcher(dir);
      }
    }
  }

  private setupNativeWatcher(dir: string): void {
    // Create the directory if it doesn't exist so we can attach a watcher.
    // (Claude Code creates it on first session run; we want to watch even
    // before that so the first session appears without a manual refresh.)
    try {
      if (!fs.existsSync(dir)) {
        // Don't create it — just skip watching until it exists.
        // The provider will show an empty state which is correct.
        return;
      }

      const watcher = fs.watch(dir, { recursive: false }, (_eventType, filename) => {
        if (!filename) return;
        // Only react to .jsonl files
        if (!filename.endsWith('.jsonl')) return;
        this.emitDebounced(filename);
      });

      watcher.on('error', () => {
        // Silently ignore — watcher stops but extension keeps running
      });

      this.fsWatchers.push(watcher);
    } catch {
      // fs.watch failed (permissions, etc.) — fall back to VS Code watcher
      this.setupVscodeWatcher(dir);
    }
  }

  private setupVscodeWatcher(dir: string): void {
    try {
      const base = vscode.Uri.file(dir);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, '*.jsonl')
      );

      watcher.onDidChange(() => this.emitDebounced('change'));
      watcher.onDidCreate(() => this.emitDebounced('create'));
      watcher.onDidDelete(() => this.emitDebounced('delete'));

      this.vscodeWatchers.push(watcher);
    } catch {
      // If even VS Code watcher fails, silently degrade — live refresh
      // won't work but manual refresh still works.
    }
  }

  private emitDebounced(key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this._onSessionChanged.fire();
    }, SessionWatcher.DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  private disposeWatchers(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();

    for (const w of this.fsWatchers) w.close();
    this.fsWatchers = [];

    for (const w of this.vscodeWatchers) w.dispose();
    this.vscodeWatchers = [];
  }

  dispose(): void {
    this.disposeWatchers();
    this._onSessionChanged.dispose();
  }
}
