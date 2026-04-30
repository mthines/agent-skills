/**
 * File system watcher for agent artifact files
 * Watches for changes to task.md, plan.md, and walkthrough.md
 * Auto-opens walkthrough.md when created, refreshes views on changes
 *
 * Uses Node.js fs.watch instead of vscode.workspace.createFileSystemWatcher
 * because artifact dirs may live in the bare repo root which is outside the
 * VS Code workspace folder. VS Code file watchers are unreliable for paths
 * outside the workspace boundary.
 *
 * On Linux (where fs.watch recursive is unsupported), falls back to
 * VS Code file watchers as a best-effort approach.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ARTIFACT_FILES = new Set(['task.md', 'plan.md', 'walkthrough.md']);

/**
 * Returns the configured artifact directory names, falling back to the defaults
 * when the setting is empty or unset.
 */
function getConfiguredDirs(): string[] {
  const cfg = vscode.workspace.getConfiguration('agentTasks').get<string[]>('directories', []);
  return cfg.length > 0 ? cfg : ['.agent', '.gw'];
}

export class ArtifactWatcher implements vscode.Disposable {
  private fsWatchers: fs.FSWatcher[] = [];
  private vscodeWatchers: vscode.FileSystemWatcher[] = [];
  private knownWalkthroughs = new Set<string>();
  /** Per-file debounce timers so simultaneous changes to different files fire independently */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Small debounce to coalesce rapid writes to the same file (e.g. editor save) */
  private static DEBOUNCE_MS = 150;

  private _onArtifactChanged = new vscode.EventEmitter<string>();
  readonly onArtifactChanged = this._onArtifactChanged.event;

  constructor() {
    this.scanExistingWalkthroughs();
    this.setupWatchers();
  }

  private scanExistingWalkthroughs(): void {
    const artifactRoots = this.findArtifactRoots();
    for (const artifactRoot of artifactRoots) {
      this.scanWalkthroughsRecursive(artifactRoot);
    }
  }

  private scanWalkthroughsRecursive(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          if (entry.name === 'walkthrough.md') {
            this.knownWalkthroughs.add(path.join(dir, entry.name));
          }
          continue;
        }
        if (entry.name === '.git') continue;
        this.scanWalkthroughsRecursive(path.join(dir, entry.name));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Find ALL artifact directories relevant to the current workspace.
   * Iterates over configured directory names (default: ['.agent', '.gw']).
   * For each name:
   *   1. Walk up from workspace root to find matching directories.
   *   2. If name is '.gw', also read config.json to find the default branch
   *      worktree and check for a .gw/ inside it.
   * Results are deduplicated by realpath.
   */
  private findArtifactRoots(): string[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const dirs = getConfiguredDirs();
    const roots: string[] = [];
    const seen = new Set<string>();

    for (const dirName of dirs) {
      // Walk up from workspace collecting directories with this name
      let dir = workspacePath;
      for (let i = 0; i < 5; i++) {
        const artifactPath = path.join(dir, dirName);
        if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).isDirectory()) {
          const real = fs.realpathSync(artifactPath);
          if (!seen.has(real)) {
            seen.add(real);
            roots.push(artifactPath);
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      // For .gw only: also check the default branch worktree for a .gw/ directory
      if (dirName === '.gw') {
        for (const gwRoot of roots.filter((r) => path.basename(r) === '.gw')) {
          const configPath = path.join(gwRoot, 'config.json');
          try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const repoRoot: string | undefined = config.root;
            const defaultBranch: string | undefined = config.defaultBranch;
            if (!repoRoot || !defaultBranch) continue;

            const defaultWorktreeGw = path.join(repoRoot, defaultBranch, '.gw');
            if (fs.existsSync(defaultWorktreeGw) && fs.statSync(defaultWorktreeGw).isDirectory()) {
              const real = fs.realpathSync(defaultWorktreeGw);
              if (!seen.has(real)) {
                seen.add(real);
                roots.push(defaultWorktreeGw);
              }
            }
            break;
          } catch {
            // config.json missing or invalid
          }
        }
      }
    }

    return roots;
  }

  /**
   * Returns parent directories of each artifact root as watch bases for VS Code watchers.
   */
  private getWatchBases(): vscode.Uri[] {
    const artifactRoots = this.findArtifactRoots();
    if (artifactRoots.length === 0) {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return workspacePath ? [vscode.Uri.file(workspacePath)] : [];
    }
    return artifactRoots.map((artifactRoot) => vscode.Uri.file(path.dirname(artifactRoot)));
  }

  private setupWatchers(): void {
    const artifactRoots = this.findArtifactRoots();
    if (artifactRoots.length === 0) return;

    const platform = os.platform();
    if (platform === 'darwin' || platform === 'win32') {
      for (const artifactRoot of artifactRoots) {
        this.setupNativeWatcher(artifactRoot);
      }
    } else {
      this.setupVscodeWatchers();
    }
  }

  /**
   * Native fs.watch — watches the artifact directory directly, bypassing
   * VS Code's workspace-boundary limitation for file system watchers.
   */
  private setupNativeWatcher(artifactRoot: string): void {
    try {
      const watcher = fs.watch(artifactRoot, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const basename = path.basename(filename);

        if (ARTIFACT_FILES.has(basename)) {
          const fullPath = path.join(artifactRoot, filename);
          this.emitDebounced(fullPath, basename, eventType);
        } else {
          // Directory or non-artifact file change — could be a new branch dir
          this._onArtifactChanged.fire('directory');
        }
      });

      watcher.on('error', () => {
        // Silently ignore — watcher will stop but extension continues
      });

      this.fsWatchers.push(watcher);
    } catch {
      // If fs.watch fails for this root, fall back to VS Code watchers
      this.setupVscodeWatchers();
    }
  }

  /**
   * VS Code file watchers — fallback for Linux where fs.watch recursive
   * is unsupported. Less reliable for paths outside the workspace but
   * better than no watching at all.
   */
  private setupVscodeWatchers(): void {
    const patterns = ['**/task.md', '**/plan.md', '**/walkthrough.md'];
    const watchBases = this.getWatchBases();
    const dirs = getConfiguredDirs();

    for (const base of watchBases) {
      for (const dirName of dirs) {
        for (const pattern of patterns) {
          const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(base, `${dirName}/${pattern}`)
          );

          watcher.onDidChange((uri) => {
            const basename = path.basename(uri.fsPath);
            this.emitDebounced(uri.fsPath, basename, 'change');
          });
          watcher.onDidCreate((uri) => {
            const basename = path.basename(uri.fsPath);
            this.emitDebounced(uri.fsPath, basename, 'rename');
          });
          watcher.onDidDelete((uri) => {
            const basename = path.basename(uri.fsPath);
            this.onFileDeleted(uri.fsPath, basename);
          });

          this.vscodeWatchers.push(watcher);
        }

        // Watch for new branch directories
        const dirWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, `${dirName}/**`));
        dirWatcher.onDidCreate(() => this._onArtifactChanged.fire('directory'));
        dirWatcher.onDidDelete(() => this._onArtifactChanged.fire('directory'));
        this.vscodeWatchers.push(dirWatcher);
      }
    }
  }

  /**
   * Per-file debounce — coalesces rapid writes to the same file while
   * letting changes to different files fire independently.
   */
  private emitDebounced(fullPath: string, basename: string, eventType: string): void {
    const existing = this.debounceTimers.get(fullPath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(fullPath);

      if (eventType === 'rename') {
        // 'rename' means create or delete
        if (fs.existsSync(fullPath)) {
          this.onFileCreated(fullPath, basename);
        } else {
          this.onFileDeleted(fullPath, basename);
        }
      } else {
        // 'change' — file content modified
        this._onArtifactChanged.fire(basename);
      }
    }, ArtifactWatcher.DEBOUNCE_MS);

    this.debounceTimers.set(fullPath, timer);
  }

  private onFileCreated(fullPath: string, basename: string): void {
    this._onArtifactChanged.fire(basename);

    // Auto-open walkthrough when created
    if (basename === 'walkthrough.md' && !this.knownWalkthroughs.has(fullPath)) {
      this.knownWalkthroughs.add(fullPath);
      const autoOpen = vscode.workspace.getConfiguration('agentTasks').get<boolean>('autoOpenWalkthrough', true);
      if (autoOpen) {
        this.openWalkthrough(vscode.Uri.file(fullPath));
      }
    }
  }

  private onFileDeleted(fullPath: string, basename: string): void {
    this.knownWalkthroughs.delete(fullPath);
    this._onArtifactChanged.fire(basename);
  }

  private async openWalkthrough(uri: vscode.Uri): Promise<void> {
    try {
      const usePreview = vscode.workspace
        .getConfiguration('agentTasks')
        .get<boolean>('openMarkdownInPreview', true);
      if (usePreview) {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });
      }
      vscode.window.showInformationMessage(`Walkthrough generated: ${path.basename(path.dirname(uri.fsPath))}`);
    } catch {
      // ignore open errors
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const watcher of this.fsWatchers) {
      watcher.close();
    }
    for (const watcher of this.vscodeWatchers) {
      watcher.dispose();
    }
    this._onArtifactChanged.dispose();
  }
}
