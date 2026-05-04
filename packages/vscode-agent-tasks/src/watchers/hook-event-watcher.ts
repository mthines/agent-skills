/**
 * File-system watcher for the agent-tasks-hooks plugin NDJSON event files.
 *
 * Watches ${CLAUDE_PLUGIN_DATA}/events/ for *.ndjson file changes and fires
 * an `onHookEvent` VS Code event for each new parsed HookEvent line.
 *
 * Platform strategy (mirrors SessionWatcher):
 *   macOS / Windows — fs.watch(dir, { recursive: false }, …).
 *   Linux           — vscode.workspace.createFileSystemWatcher as best-effort
 *                     fallback (fs.watch recursive is unsupported on Linux).
 *
 * Debounce: 30ms (tighter than SessionWatcher's 50ms — hook events are
 * single atomic appends, not rolling JSONL bursts).
 *
 * Offset tracking: each NDJSON file is read from the last-seen byte offset
 * rather than re-reading the full file on every change. This keeps the
 * watcher O(new-bytes) rather than O(file-size).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getHookEventsDir } from '../lib/plugin-data-path';
import type { HookEvent, HookEventName } from '../lib/hook-event-types';
import { log, logError } from '../lib/logger';

const KNOWN_EVENT_NAMES = new Set<HookEventName>([
  'UserPromptSubmit',
  'Stop',
  'Notification',
  'SessionStart',
  'SessionEnd',
] satisfies HookEventName[]);

function isHookEvent(v: unknown): v is HookEvent {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj['event'] === 'string' &&
    KNOWN_EVENT_NAMES.has(obj['event']) &&
    typeof obj['sessionId'] === 'string' &&
    typeof obj['cwd'] === 'string' &&
    typeof obj['ts'] === 'number'
  );
}

export class HookEventWatcher implements vscode.Disposable {
  private fsWatcher: fs.FSWatcher | undefined;
  private vscodeWatcher: vscode.FileSystemWatcher | undefined;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Per-file byte offsets so we only read new lines on each change. */
  private fileOffsets = new Map<string, number>();

  private static readonly DEBOUNCE_MS = 30;

  private readonly _onHookEvent = new vscode.EventEmitter<HookEvent>();
  /** Fires for each new HookEvent parsed from a watched NDJSON file. */
  readonly onHookEvent: vscode.Event<HookEvent> = this._onHookEvent.event;

  constructor() {
    this.start();
  }

  private start(): void {
    const eventsDir = getHookEventsDir();

    // Lazy-create the events directory. If the plugin is not installed yet,
    // this directory won't exist — create it so we can attach a watcher
    // immediately. The watcher will fire once the hook script creates files.
    try {
      fs.mkdirSync(eventsDir, { recursive: true });
    } catch {
      // Permission error or other failure — watcher setup will handle it below
    }

    const platform = os.platform();
    if (platform === 'darwin' || platform === 'win32') {
      this.setupNativeWatcher(eventsDir);
    } else {
      this.setupVscodeWatcher(eventsDir);
    }
  }

  private setupNativeWatcher(eventsDir: string): void {
    try {
      const watcher = fs.watch(eventsDir, { recursive: false }, (_eventType, filename) => {
        if (!filename) return;
        if (!filename.endsWith('.ndjson')) return;
        this.scheduleRead(path.join(eventsDir, filename), filename);
      });

      watcher.on('error', (err) => {
        logError('HookEventWatcher: fs.watch error', err);
      });

      this.fsWatcher = watcher;
    } catch (err) {
      logError('HookEventWatcher: failed to set up native watcher, falling back', err);
      this.setupVscodeWatcher(eventsDir);
    }
  }

  private setupVscodeWatcher(eventsDir: string): void {
    try {
      const base = vscode.Uri.file(eventsDir);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, '*.ndjson')
      );

      const onChanged = (uri: vscode.Uri) => {
        const filename = path.basename(uri.fsPath);
        this.scheduleRead(uri.fsPath, filename);
      };

      watcher.onDidChange(onChanged);
      watcher.onDidCreate(onChanged);

      this.vscodeWatcher = watcher;
    } catch (err) {
      logError('HookEventWatcher: failed to set up VS Code watcher', err);
    }
  }

  private scheduleRead(filePath: string, key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.readNewLines(filePath);
    }, HookEventWatcher.DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  private readNewLines(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;

      const offset = this.fileOffsets.get(filePath) ?? 0;

      // File was truncated (rotation) — reset offset to 0
      const readOffset = fileSize < offset ? 0 : offset;

      if (readOffset >= fileSize) {
        return; // No new bytes
      }

      const fd = fs.openSync(filePath, 'r');
      const length = fileSize - readOffset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, readOffset);
      fs.closeSync(fd);

      this.fileOffsets.set(filePath, fileSize);

      const chunk = buf.toString('utf8');
      const lines = chunk.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (isHookEvent(parsed)) {
            log(`HookEventWatcher: ${parsed.event} for session ${parsed.sessionId.slice(0, 8)}`);
            this._onHookEvent.fire(parsed);
          }
        } catch {
          // Malformed JSON line — skip
        }
      }
    } catch (err) {
      // File may have been deleted or is temporarily unreadable — silently skip
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logError('HookEventWatcher: error reading new lines', err);
      }
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();

    this.fsWatcher?.close();
    this.fsWatcher = undefined;

    this.vscodeWatcher?.dispose();
    this.vscodeWatcher = undefined;

    this._onHookEvent.dispose();
  }
}

// Re-export HookEventName so callers can import from this file
export type { HookEventName };
