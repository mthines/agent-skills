/**
 * File system watcher for agent artifact files
 * Watches for changes to task.md, plan.md, and walkthrough.md
 * Auto-opens walkthrough.md and plan.md when created, refreshes views on changes
 *
 * Uses Node.js fs.watch instead of vscode.workspace.createFileSystemWatcher
 * because artifact dirs may live in the bare repo root which is outside the
 * VS Code workspace folder. VS Code file watchers are unreliable for paths
 * outside the workspace boundary.
 *
 * On Linux (where fs.watch recursive is unsupported), falls back to
 * VS Code file watchers as a best-effort approach.
 *
 * The watcher rebuilds its set of native watchers when:
 *   - the configured `agentTasks.directories` setting changes
 *   - a new artifact root (e.g. `.agent/`) appears that didn't exist at activation
 * This keeps the tree view in sync without requiring a manual refresh.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { discoverWorktreePaths } from '../lib/worktree-discovery';

const ARTIFACT_FILES = new Set(['task.md', 'plan.md', 'walkthrough.md']);

/**
 * Matches versioned plan snapshots — `plan.v1.md`, `plan.v2.md`, … —
 * written by the `aw-create-plan` skill alongside `plan.md`. Treated as
 * artifact events for refresh purposes, but never auto-opened (only
 * `plan.md` triggers `autoOpenPlan`).
 */
const PLAN_VERSION_PATTERN = /^plan\.v\d+\.md$/;

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
  /** Disposables tied to the lifetime of the watcher itself, not a single rebuild */
  private lifetimeDisposables: vscode.Disposable[] = [];
  private knownWalkthroughs = new Set<string>();
  private knownPlans = new Set<string>();
  /** Artifact roots covered by the current set of watchers */
  private watchedRoots = new Set<string>();
  /** Per-file debounce timers so simultaneous changes to different files fire independently */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Small debounce to coalesce rapid writes to the same file (e.g. editor save) */
  private static DEBOUNCE_MS = 150;
  /** Coalesces rapid worktree-discovery events into a single rebuild check */
  private worktreeCheckTimer: ReturnType<typeof setTimeout> | undefined;

  private _onArtifactChanged = new vscode.EventEmitter<string>();
  readonly onArtifactChanged = this._onArtifactChanged.event;

  constructor() {
    this.scanExistingArtifacts();
    this.setupWatchers();
    this.setupConfigListener();
  }

  private scanExistingArtifacts(): void {
    const artifactRoots = this.findArtifactRoots();
    for (const artifactRoot of artifactRoots) {
      this.scanArtifactsRecursive(artifactRoot);
    }
  }

  private scanArtifactsRecursive(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          if (entry.name === 'walkthrough.md') {
            this.knownWalkthroughs.add(path.join(dir, entry.name));
          } else if (entry.name === 'plan.md') {
            this.knownPlans.add(path.join(dir, entry.name));
          }
          continue;
        }
        if (entry.name === '.git') continue;
        this.scanArtifactsRecursive(path.join(dir, entry.name));
      }
    } catch {
      // ignore
    }
  }

  /**
   * Find ALL artifact directories relevant to the current workspace.
   *
   * Iterates over configured directory names (default: `['.agent', '.gw']`).
   * For each name:
   *   1. Walk up from the workspace root to find matching directories.
   *   2. If name is `.gw`, also read `config.json` to find the default branch
   *      worktree and check for a `.gw/` inside it.
   *   3. Enumerate `<worktreePath>/<dirName>/` for every sibling worktree
   *      returned by `discoverWorktreePaths()` so that artifacts created by
   *      the planner in a sibling worktree (e.g. `.agent/feat/x/plan.md`)
   *      are watched and trigger `autoOpenPlan`.
   *
   * Results are deduplicated by realpath.
   */
  private findArtifactRoots(): string[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const dirs = getConfiguredDirs();
    const roots: string[] = [];
    const seen = new Set<string>();

    const addRoot = (artifactPath: string) => {
      try {
        if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).isDirectory()) {
          const real = fs.realpathSync(artifactPath);
          if (!seen.has(real)) {
            seen.add(real);
            roots.push(artifactPath);
          }
        }
      } catch {
        // ignore stat/realpath errors
      }
    };

    for (const dirName of dirs) {
      // Walk up from workspace collecting directories with this name
      let dir = workspacePath;
      for (let i = 0; i < 5; i++) {
        addRoot(path.join(dir, dirName));
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
            addRoot(path.join(repoRoot, defaultBranch, '.gw'));
            break;
          } catch {
            // config.json missing or invalid
          }
        }
      }

      // Also watch configured artifact dirs inside every sibling worktree so
      // that `plan.md` / `walkthrough.md` created by a planner agent in a
      // sibling worktree triggers `autoOpenPlan` in this window.
      // `discoverWorktreePaths` is cached-free and fast (single git call).
      try {
        const worktreePaths = discoverWorktreePaths(workspacePath);
        for (const wt of worktreePaths) {
          // Skip the current workspace — already handled by the walk-up above
          if (wt === workspacePath) continue;
          addRoot(path.join(wt, dirName));
        }
      } catch {
        // discovery failure is non-fatal
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
    this.disposeWatchers();

    const artifactRoots = this.findArtifactRoots();
    this.watchedRoots = new Set(artifactRoots);

    const platform = os.platform();
    if (platform === 'darwin' || platform === 'win32') {
      for (const artifactRoot of artifactRoots) {
        this.setupNativeWatcher(artifactRoot);
      }
    } else {
      this.setupVscodeWatchers();
    }

    // Always watch the workspace root for the configured dir names so
    // newly-created `.agent/` or `.gw/` directories are picked up without
    // requiring the user to reload the window or hit refresh.
    this.setupRootDiscoveryWatcher();

    // Detect sibling worktrees that didn't exist at activation time (e.g.
    // created by `git worktree add` from autonomous-workflow) and `.agent`
    // / `.gw` directories materialising inside them after the fact. Without
    // this, artifacts written by a planner agent into a freshly-created
    // worktree would not surface in the panel until manual refresh.
    this.setupWorktreeDiscoveryWatchers();
  }

  /**
   * Listen for `agentTasks.directories` configuration changes and rebuild
   * the watcher set so the user's new dir names take effect immediately.
   */
  private setupConfigListener(): void {
    const sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('agentTasks.directories')) {
        this.rebuildWatchers();
      }
    });
    this.lifetimeDisposables.push(sub);
  }

  /**
   * Watches the workspace folder for the configured artifact directory names
   * appearing for the first time. When one shows up, rebuild watchers so the
   * native recursive watcher attaches to the new root.
   */
  private setupRootDiscoveryWatcher(): void {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return;

    const base = vscode.Uri.file(workspacePath);
    const dirs = getConfiguredDirs();

    for (const dirName of dirs) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, `${dirName}`),
        false, // don't ignore creates
        true, // ignore changes (we only care about appearance)
        false // don't ignore deletes
      );
      const onChange = () => {
        // Rebuild only if the set of artifact roots actually changed —
        // avoids redundant watcher churn on every save inside `.agent/`.
        const next = new Set(this.findArtifactRoots());
        if (!setsEqual(next, this.watchedRoots)) {
          this.rebuildWatchers();
        }
        this._onArtifactChanged.fire('directory');
      };
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      this.vscodeWatchers.push(watcher);
    }
  }

  /**
   * Rebuilds watchers in place — used when the configured dir names change
   * or a new artifact root appears after activation.
   */
  private rebuildWatchers(): void {
    this.scanExistingArtifacts();
    this.setupWatchers();
    this._onArtifactChanged.fire('directory');
  }

  /**
   * Watch every parent directory of every known worktree so that NEW
   * sibling worktrees (created via `git worktree add`, e.g. by an
   * autonomous-workflow planner) are detected the moment they appear, and
   * watch each known worktree's root so an `.agent/` or `.gw/` directory
   * appearing inside it after activation also triggers a rebuild.
   *
   * Without this, `findArtifactRoots()` only sees the worktrees that
   * existed when the watcher was first set up — any artifacts written to
   * a worktree that was created later would stay invisible until the user
   * manually refreshed or reloaded the window.
   *
   * Uses `fs.watch(..., { recursive: false })` which is supported on
   * macOS, Linux, and Windows for direct-child events. Errors are
   * silently ignored — best-effort enrichment, not a hard requirement.
   */
  private setupWorktreeDiscoveryWatchers(): void {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return;

    let worktreePaths: string[];
    try {
      worktreePaths = discoverWorktreePaths(workspacePath);
    } catch {
      return;
    }

    const dirs = getConfiguredDirs();
    const watchedPaths = new Set<string>();

    const addWatch = (target: string, isWorktreeRoot: boolean): void => {
      if (watchedPaths.has(target)) return;
      watchedPaths.add(target);
      try {
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return;
      } catch {
        return;
      }
      try {
        const watcher = fs.watch(target, { recursive: false }, (_eventType, filename) => {
          if (!filename) {
            this.scheduleWorktreeCheck();
            return;
          }
          if (isWorktreeRoot && !dirs.includes(filename.toString())) {
            // Inside a worktree, only react when the artifact dir name appears.
            return;
          }
          this.scheduleWorktreeCheck();
        });
        watcher.on('error', () => {
          // Silently ignore — watcher will stop but extension continues.
        });
        this.fsWatchers.push(watcher);
      } catch {
        // Path unavailable or platform-unsupported — ignore.
      }
    };

    for (const wt of worktreePaths) {
      // Watch the parent of each worktree so a new sibling appearing
      // (e.g. `agent-skills.git/feat/<new>`) is observed.
      addWatch(path.dirname(wt), false);
      // Watch the worktree's root so a freshly-created `.agent/` or
      // `.gw/` inside it also rebuilds. The workspace itself is already
      // covered by `setupRootDiscoveryWatcher`.
      if (wt !== workspacePath) addWatch(wt, true);
    }
  }

  /**
   * Coalesce rapid create/delete events from the worktree-discovery
   * watchers (often a burst when `git worktree add` materialises several
   * files in quick succession) into a single rebuild. The 250 ms window
   * is short enough to feel instantaneous but long enough to avoid
   * thrashing watcher state during a single command.
   */
  private scheduleWorktreeCheck(): void {
    if (this.worktreeCheckTimer) clearTimeout(this.worktreeCheckTimer);
    this.worktreeCheckTimer = setTimeout(() => {
      this.worktreeCheckTimer = undefined;
      const next = new Set(this.findArtifactRoots());
      if (!setsEqual(next, this.watchedRoots)) {
        this.rebuildWatchers();
      } else {
        // Even when the artifact-root set is unchanged, fire a directory
        // event so providers re-read `discoverWorktreePaths()` — the new
        // worktree may exist without an artifact dir yet, but the panels
        // still want to render its placeholder group.
        this._onArtifactChanged.fire('directory');
      }
    }, 250);
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
        } else if (PLAN_VERSION_PATTERN.test(basename)) {
          // A new or changed `plan.v{N}.md` snapshot — refresh the tree so
          // the Plan node's "Previous Versions" group reflects on-disk
          // history. We deliberately do NOT auto-open versioned snapshots:
          // the user opted in to versioning, not to a popup per iteration.
          this._onArtifactChanged.fire('plan.version');
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
    const patterns = ['**/task.md', '**/plan.md', '**/plan.v*.md', '**/walkthrough.md'];
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

    if (basename === 'walkthrough.md' && !this.knownWalkthroughs.has(fullPath)) {
      this.knownWalkthroughs.add(fullPath);
      const autoOpen = vscode.workspace.getConfiguration('agentTasks').get<boolean>('autoOpenWalkthrough', true);
      if (autoOpen) {
        this.openArtifact(vscode.Uri.file(fullPath), 'Walkthrough');
      }
      return;
    }

    if (basename === 'plan.md' && !this.knownPlans.has(fullPath)) {
      this.knownPlans.add(fullPath);
      const autoOpen = vscode.workspace.getConfiguration('agentTasks').get<boolean>('autoOpenPlan', true);
      if (autoOpen) {
        this.openArtifact(vscode.Uri.file(fullPath), 'Plan');
      }
    }
  }

  private onFileDeleted(fullPath: string, basename: string): void {
    this.knownWalkthroughs.delete(fullPath);
    this.knownPlans.delete(fullPath);
    this._onArtifactChanged.fire(basename);
  }

  private async openArtifact(uri: vscode.Uri, label: string): Promise<void> {
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
      vscode.window.showInformationMessage(`${label} generated: ${path.basename(path.dirname(uri.fsPath))}`);
    } catch {
      // ignore open errors
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this.fsWatchers) {
      watcher.close();
    }
    this.fsWatchers = [];
    for (const watcher of this.vscodeWatchers) {
      watcher.dispose();
    }
    this.vscodeWatchers = [];
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    if (this.worktreeCheckTimer) {
      clearTimeout(this.worktreeCheckTimer);
      this.worktreeCheckTimer = undefined;
    }
    this.disposeWatchers();
    for (const sub of this.lifetimeDisposables) {
      sub.dispose();
    }
    this.lifetimeDisposables = [];
    this._onArtifactChanged.dispose();
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}
