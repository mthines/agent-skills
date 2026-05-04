/**
 * Agent Tasks VS Code Extension
 * Entry point — command registration, tree view setup, watcher wiring
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  AgentTasksProvider,
  AgentBranchItem,
  PlanSummaryItem,
  PlanVersionItem,
  WalkthroughSummaryItem,
  WorktreeFlatItem,
} from './providers/agent-tasks-provider';
import * as child_process from 'child_process';
import { ArtifactWatcher } from './watchers/artifact-watcher';
import { SessionsProvider, SessionItem } from './providers/sessions-provider';
import { SessionWatcher } from './watchers/session-watcher';
import { initLogger, log, logError } from './lib/logger';
import { parsePsOutput, findClaudeDescendant, claimPendingAdoption, type PendingAdoption } from './lib/process-tree';
import type { SessionMetadata } from './parsers/session-jsonl-parser';

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log('agent-tasks extension activated');
  // Create the tree data provider
  const agentTasksProvider = new AgentTasksProvider();

  // Register the tree view
  const agentTasksView = vscode.window.createTreeView('agentTasksExplorer', {
    treeDataProvider: agentTasksProvider,
    showCollapseAll: true,
  });

  // Create the file watcher. The Sessions panel also subscribes to it below
  // (after `sessionsProvider` is declared) so artifact create/delete updates
  // both trees — the Agent Tasks rows AND the Sessions correlation chevrons.
  const artifactWatcher = new ArtifactWatcher();
  artifactWatcher.onArtifactChanged(() => {
    agentTasksProvider.refresh();
  });

  // Register commands
  const refreshCmd = vscode.commands.registerCommand('agentTasks.refresh', () => {
    agentTasksProvider.refresh();
  });

  const sortCmd = vscode.commands.registerCommand('agentTasks.sort', async () => {
    const config = vscode.workspace.getConfiguration('agentTasks');
    const currentSortBy = config.get<string>('sortBy', 'date');
    const currentSortOrder = config.get<string>('sortOrder', 'desc');

    const sortByOptions: vscode.QuickPickItem[] = [
      { label: 'date', description: 'Sort by modification date', picked: currentSortBy === 'date' },
      { label: 'name', description: 'Sort by branch name', picked: currentSortBy === 'name' },
      { label: 'status', description: 'Sort by workflow status', picked: currentSortBy === 'status' },
    ];

    const sortByPick = await vscode.window.showQuickPick(sortByOptions, {
      placeHolder: 'Sort agent tasks by...',
    });
    if (!sortByPick) return;

    const sortOrderOptions: vscode.QuickPickItem[] = [
      { label: 'desc', description: 'Descending (newest/Z-A first)', picked: currentSortOrder === 'desc' },
      { label: 'asc', description: 'Ascending (oldest/A-Z first)', picked: currentSortOrder === 'asc' },
    ];

    const sortOrderPick = await vscode.window.showQuickPick(sortOrderOptions, {
      placeHolder: 'Sort order...',
    });
    if (!sortOrderPick) return;

    await config.update('sortBy', sortByPick.label, vscode.ConfigurationTarget.Global);
    await config.update('sortOrder', sortOrderPick.label, vscode.ConfigurationTarget.Global);
    agentTasksProvider.refresh();
  });

  const focusCmd = vscode.commands.registerCommand('agentTasks.focus', () => {
    vscode.commands.executeCommand('agentTasksExplorer.focus');
  });

  const openMarkdownCmd = vscode.commands.registerCommand('agentTasks.openMarkdown', async (filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return;
    }
    const uri = vscode.Uri.file(filePath);
    const usePreview = vscode.workspace.getConfiguration('agentTasks').get<boolean>('openMarkdownInPreview', true);
    if (usePreview) {
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  });

  const openPlanCmd = vscode.commands.registerCommand('agentTasks.openPlan', async (item) => {
    // WorktreeFlatItem wraps the branch — delegate to its artifactDir
    const resolved = item instanceof WorktreeFlatItem ? item.branch : item;
    if (resolved?.artifactDir) {
      const planPath = require('path').join(resolved.artifactDir, 'plan.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', planPath);
    }
  });

  const openTaskCmd = vscode.commands.registerCommand('agentTasks.openTask', async (item) => {
    const resolved = item instanceof WorktreeFlatItem ? item.branch : item;
    if (resolved?.artifactDir) {
      const taskPath = require('path').join(resolved.artifactDir, 'task.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', taskPath);
    }
  });

  const openWalkthroughCmd = vscode.commands.registerCommand('agentTasks.openWalkthrough', async (item) => {
    const resolved = item instanceof WorktreeFlatItem ? item.branch : item;
    if (resolved?.artifactDir) {
      const wtPath = require('path').join(resolved.artifactDir, 'walkthrough.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', wtPath);
    }
  });

  // ---------------------------------------------------------------------------
  // Right-click context-menu actions on Agent Tasks panel entries
  //
  // Resolves the on-disk target (file or directory) for any tree item that
  // represents real bytes — branch dirs, plan files, walkthrough files,
  // versioned plan snapshots — so the same set of commands (Reveal in
  // Finder/Explorer, Copy Path, Delete) works uniformly across every row.
  // ---------------------------------------------------------------------------

  interface ResolvedTarget {
    /** Absolute path to the file or directory the action operates on. */
    fsPath: string;
    /** Whether the path is a directory (Delete prompts differently for dirs). */
    isDirectory: boolean;
    /** Short label used in confirmation prompts and status messages. */
    label: string;
  }

  const resolveTarget = (item: unknown): ResolvedTarget | undefined => {
    if (item instanceof WorktreeFlatItem) {
      return {
        fsPath: item.branch.artifactDir,
        isDirectory: true,
        label: `branch artifacts for ${item.branch.branchName}`,
      };
    }
    if (item instanceof AgentBranchItem) {
      return {
        fsPath: item.artifactDir,
        isDirectory: true,
        label: `branch artifacts for ${item.branchName}`,
      };
    }
    if (item instanceof PlanSummaryItem) {
      return { fsPath: item.planFilePath, isDirectory: false, label: 'plan.md' };
    }
    if (item instanceof PlanVersionItem) {
      return {
        fsPath: item.versionFilePath,
        isDirectory: false,
        label: `plan.v${item.version}.md`,
      };
    }
    if (item instanceof WalkthroughSummaryItem) {
      return { fsPath: item.walkthroughFilePath, isDirectory: false, label: 'walkthrough.md' };
    }
    return undefined;
  };

  const revealInOSCmd = vscode.commands.registerCommand('agentTasks.revealInOS', async (item) => {
    const target = resolveTarget(item);
    if (!target) return;
    if (!fs.existsSync(target.fsPath)) {
      vscode.window.showWarningMessage(`Cannot reveal — ${target.label} no longer exists on disk.`);
      return;
    }
    // `revealFileInOS` is the built-in cross-platform reveal command
    // (Finder on macOS, Explorer on Windows, Files manager on Linux).
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target.fsPath));
  });

  const copyPathCmd = vscode.commands.registerCommand('agentTasks.copyPath', async (item) => {
    const target = resolveTarget(item);
    if (!target) return;
    await vscode.env.clipboard.writeText(target.fsPath);
    vscode.window.setStatusBarMessage(`Copied path: ${target.fsPath}`, 2500);
  });

  const deleteArtifactsCmd = vscode.commands.registerCommand('agentTasks.deleteArtifacts', async (item) => {
    const target = resolveTarget(item);
    if (!target) return;
    if (!fs.existsSync(target.fsPath)) {
      vscode.window.showWarningMessage(`${target.label} is already gone.`);
      agentTasksProvider.refresh();
      return;
    }

    // Different prose for directory vs file deletes — directories take a
    // whole branch's artifact history with them, which is irreversible
    // unless the user has the worktree under git (and `.agent/` is
    // typically gitignored). Make that explicit.
    const detail = target.isDirectory
      ? `This permanently removes the directory and every artifact inside it (plan.md, plan.v*.md, walkthrough.md, task.md). \`.agent/\` is usually gitignored, so this CANNOT be undone.`
      : `This permanently removes the file. ${target.label.startsWith('plan.v') ? 'Versioned plan snapshots are intended as immutable history — only delete one if you are certain it is no longer useful.' : 'This cannot be undone.'}`;

    const confirm = await vscode.window.showWarningMessage(
      `Delete ${target.label}?`,
      { modal: true, detail },
      'Delete'
    );
    if (confirm !== 'Delete') return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(target.fsPath), {
        recursive: target.isDirectory,
        useTrash: true,
      });
      vscode.window.setStatusBarMessage(`Deleted ${target.label}`, 2500);
    } catch (err) {
      logError(`deleteArtifacts: failed to delete ${target.fsPath}`, err);
      vscode.window.showErrorMessage(
        `Failed to delete ${target.label}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    agentTasksProvider.refresh();
  });

  // -------------------------------------------------------------------------
  // Sessions panel
  // -------------------------------------------------------------------------

  const sessionsProvider = new SessionsProvider();

  const sessionsView = vscode.window.createTreeView('agentSessionsExplorer', {
    treeDataProvider: sessionsProvider,
    showCollapseAll: true,
  });

  // Sessions panel correlates each session with its `(worktree, gitBranch)`
  // artifact dir. Refresh on artifact create/delete so chevrons and child
  // rows appear/disappear without waiting for a session-level event.
  artifactWatcher.onArtifactChanged(() => {
    sessionsProvider.refresh();
  });

  // Start watching the session dirs that the provider discovered on first render.
  // We need to trigger a first getChildren call to populate sessionDirs; we do
  // that lazily on the first onSessionChanged subscription by scheduling a
  // deferred rebuild below.
  const sessionWatcher = new SessionWatcher();

  sessionWatcher.onSessionChanged(() => {
    log('Session file changed → refreshing tree');
    sessionsProvider.refresh();
  });

  // Rebuild the watcher whenever the workspace folders change
  const workspaceFolderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    log('Workspace folders changed — refreshing sessions');
    sessionsProvider.refresh();
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
  });

  // Deferred watcher rebuild: after the first tree render the sessionDirs
  // will be populated. We schedule this as a micro-task so it fires after
  // the tree view completes its first getChildren call.
  void Promise.resolve().then(() => {
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
    log(`Initial sessions watcher attached: ${sessionsProvider.sessionDirs.length} dir(s)`);
  });

  const sessionsRefreshCmd = vscode.commands.registerCommand('agentTasks.sessions.refresh', () => {
    log('Command: sessions.refresh');
    sessionsProvider.refresh();
    // Rebuild watchers in case new worktrees appeared
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
    log(`Sessions watcher rebuilt: ${sessionsProvider.sessionDirs.length} dir(s)`);
  });

  const sessionsToggleScopeCmd = vscode.commands.registerCommand('agentTasks.sessions.toggleScope', async () => {
    const cfg = vscode.workspace.getConfiguration('agentTasks.sessions');
    const current = cfg.get<string>('scope', 'all');
    const next = current === 'current' ? 'all' : 'current';
    log(`Command: sessions.toggleScope (${current} → ${next})`);
    await cfg.update('scope', next, vscode.ConfigurationTarget.Global);
    sessionsProvider.refresh();
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
    vscode.window.setStatusBarMessage(
      next === 'current' ? 'Sessions: showing current worktree only' : 'Sessions: showing all worktrees',
      2500
    );
  });

  // Periodic refresh while the Sessions view is visible. Drives state-machine
  // transitions that aren't triggered by a file-watcher event — e.g. a
  // `running` session sliding to `stalled` after no writes for 30s, or
  // `needs-input` aging out of the Running section. 15s is a good balance
  // between feeling realtime and not burning cycles on a hidden panel.
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const startTick = () => {
    if (tickTimer) return;
    tickTimer = setInterval(() => sessionsProvider.refresh(), 15_000);
  };
  const stopTick = () => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
  if (sessionsView.visible) startTick();
  const visibilitySub = sessionsView.onDidChangeVisibility((e) => {
    if (e.visible) {
      sessionsProvider.refresh();
      startTick();
    } else {
      stopTick();
    }
  });

  const tickDisposable: vscode.Disposable = { dispose: stopTick };

  // -------------------------------------------------------------------------
  // Agent Tasks scope toggle
  // -------------------------------------------------------------------------

  const toggleScopeCmd = vscode.commands.registerCommand('agentTasks.toggleScope', async () => {
    const cfg = vscode.workspace.getConfiguration('agentTasks');
    const current = cfg.get<string>('scope', 'all');
    const next = current === 'current' ? 'all' : 'current';
    log(`Command: agentTasks.toggleScope (${current} → ${next})`);

    // Mirror the sessions toggle: use Global for single-folder, workspace
    // target for multi-root. For simplicity use Global (same as sessions).
    await cfg.update('scope', next, vscode.ConfigurationTarget.Global);
    agentTasksProvider.refresh();
    vscode.window.setStatusBarMessage(
      next === 'current' ? 'Agent Tasks: showing current worktree only' : 'Agent Tasks: showing all worktrees',
      2500
    );
  });

  // React to scope config changes from settings UI (so the user doesn't have
  // to manually refresh after editing settings.json).
  const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('agentTasks.sessions.scope')) {
      sessionsProvider.refresh();
      sessionWatcher.rebuild(sessionsProvider.sessionDirs);
    }
    if (e.affectsConfiguration('agentTasks.scope')) {
      agentTasksProvider.refresh();
    }
  });

  // Map of sessionId → terminal currently running `claude --resume` for that
  // session in THIS window. Used so re-clicking a session focuses its existing
  // terminal tab instead of spawning a duplicate. Cross-window tracking is not
  // possible — VS Code's extension API is window-scoped.
  const sessionTerminals = new Map<string, vscode.Terminal>();

  // ---------------------------------------------------------------------------
  // Pending-adoption queue — for the "+" new-session button
  //
  // When the user clicks "+" we know exactly which terminal was spawned. The
  // next new session JSONL that appears in the same cwd is deterministically
  // linked to that terminal via onDidDiscoverSession. This avoids the
  // now-deleted cwd-match slow-path that incorrectly adopted the WRONG session
  // when multiple bare-claude processes shared a cwd.
  // ---------------------------------------------------------------------------

  const PENDING_TTL_MS = 60_000; // 60 s — generous; claude can take a few seconds to write the first JSONL
  let pendingAdoptions: Array<PendingAdoption<vscode.Terminal>> = [];

  const closeTerminalSub = vscode.window.onDidCloseTerminal((t) => {
    // Clean up any pending adoption for this terminal.
    pendingAdoptions = pendingAdoptions.filter((p) => p.terminal !== t);

    for (const [sid, term] of sessionTerminals) {
      if (term === t) {
        sessionTerminals.delete(sid);
        sessionsProvider.setTerminalOpen(sid, false);
        log(`Terminal closed for session ${sid.slice(0, 8)}`);
        break;
      }
    }
  });

  // Subscribe to new sessions discovered by the provider. Attempt to claim a
  // pending adoption before falling through. This hook fires for every new
  // session ID that wasn't present on the previous refresh cycle.
  const discoverySub = sessionsProvider.onDidDiscoverSession((session) => {
    if (!session.cwd) return;
    const normalizedCwd = path.resolve(session.cwd);
    const result = claimPendingAdoption(pendingAdoptions, normalizedCwd, Date.now(), PENDING_TTL_MS);
    if (!result) return;

    pendingAdoptions = result.remaining;
    const { terminal } = result;
    const waited = Date.now() - (pendingAdoptions.find(() => true)?.spawnedAt ?? Date.now());
    log(
      `Pending adoption claimed: session ${session.sessionId.slice(0, 8)} ↔ terminal "${terminal.name}" (waited ~${waited}ms)`
    );
    sessionTerminals.set(session.sessionId, terminal);
    sessionsProvider.setTerminalOpen(session.sessionId, true);
    // Focus the already-open terminal so the user sees their new session.
    terminal.show(false);
  });

  // ---------------------------------------------------------------------------
  // Terminal adoption helper (argv fast-path only)
  // ---------------------------------------------------------------------------

  /**
   * One-shot process-tree scan using the argv fast-path only.
   *
   * Attempts to find a terminal already running `claude --resume <sid>` in
   * its process tree. This covers sessions that the extension spawned in a
   * prior window and lost tracking after a window reload.
   *
   * The cwd-match slow-path has been removed: it produced false-positive
   * matches when multiple bare-claude processes shared the same cwd (e.g.
   * multiple sessions in the same worktree), causing the wrong session to be
   * adopted. The pending-adoption queue (above) handles the "+" button case
   * deterministically.
   *
   * Returns the matching terminal, or `undefined` on failure or no-match.
   * All errors are caught and logged; callers always fall through to spawn.
   */
  const tryAdoptTerminal = async (
    sid: string,
    terminals: readonly vscode.Terminal[]
  ): Promise<vscode.Terminal | undefined> => {
    if (terminals.length === 0) return undefined;

    // ---- Snapshot ----
    let psRaw: string;
    try {
      psRaw = child_process.execSync('ps -A -o pid,ppid,command', {
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
      });
    } catch (err) {
      logError('tryAdoptTerminal: ps failed, falling through to spawn', err);
      return undefined;
    }
    const snapshot = parsePsOutput(psRaw);

    // ---- Resolve shell PIDs ----
    const shellByTerm = new Map<vscode.Terminal, number>();
    for (const t of terminals) {
      let pid: number | undefined;
      try {
        pid = await t.processId;
      } catch {
        continue;
      }
      if (typeof pid === 'number') shellByTerm.set(t, pid);
    }

    // ---- Fast-path: argv match ----
    for (const [t, shellPid] of shellByTerm) {
      const claudePid = findClaudeDescendant(shellPid, sid, snapshot);
      if (claudePid !== undefined) {
        log(
          `tryAdoptTerminal: argv-match adopted terminal (shellPid=${shellPid}, claudePid=${claudePid}, sid=${sid.slice(0, 8)})`
        );
        return t;
      }
    }

    return undefined;
  };

  // Shared open-session logic used by both the tree-click command and the
  // find QuickPick. Reads the `openWith` setting once, then either resumes
  // or opens the JSONL.
  const openSession = async (session: SessionMetadata): Promise<void> => {
    const openWith = vscode.workspace.getConfiguration('agentTasks.sessions').get<string>('openWith', 'resume');

    const sid = session.sessionId;
    log(`openSession (id=${sid.slice(0, 8)}, mode=${openWith})`);

    if (openWith === 'resume') {
      const existing = sessionTerminals.get(sid);
      if (existing && existing.exitStatus === undefined) {
        log(`Focusing existing terminal for session ${sid.slice(0, 8)}`);
        sessionsProvider.setTerminalOpen(sid, true);
        existing.show(false);
        return;
      }
      if (existing) sessionTerminals.delete(sid);

      // Attempt to adopt an existing terminal that is already running
      // `claude --resume <sid>` (argv fast-path only). Covers sessions
      // the extension itself spawned in a prior window and lost tracking.
      //
      // NOTE: The cwd-match slow-path has been deliberately removed.
      // Bare `claude` terminals (typed by the user, or started outside the
      // "+" flow) are NOT adoptable — clicking them spawns a fresh
      // `--resume` terminal. This is intentional: cwd is not unique across
      // sessions in the same worktree and produces false-positive adoption.
      const adopted = await tryAdoptTerminal(sid, vscode.window.terminals);
      if (adopted) {
        sessionTerminals.set(sid, adopted);
        sessionsProvider.setTerminalOpen(sid, true);
        adopted.show(false);
        return;
      }

      const branch = session.gitBranch ?? '?';
      const shortId = sid.slice(0, 8);
      const cwd = session.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      log(`Creating terminal for session ${shortId} (branch=${branch}, cwd=${cwd ?? '?'})`);

      const terminal = vscode.window.createTerminal({
        name: `Claude · ${branch} · ${shortId}`,
        cwd,
        iconPath: new vscode.ThemeIcon('comment-discussion'),
      });
      sessionTerminals.set(sid, terminal);
      sessionsProvider.setTerminalOpen(sid, true);
      terminal.show();
      terminal.sendText(`claude --resume ${sid}`);
    } else {
      const uri = vscode.Uri.file(session.filePath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        logError(`Failed to open session file ${session.filePath}`, err);
        vscode.window.showWarningMessage(`Could not open session file: ${session.filePath}`);
      }
    }
  };

  const openSessionCmd = vscode.commands.registerCommand(
    'agentTasks.sessions.openSession',
    async (item: SessionItem) => {
      if (!item?.session?.filePath) return;
      await openSession(item.session);
    }
  );

  const findSessionCmd = vscode.commands.registerCommand('agentTasks.sessions.find', async () => {
    log('Command: sessions.find');
    const sessions = sessionsProvider.getAllSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage('No Claude Code sessions found for this workspace.');
      return;
    }

    interface FindItem extends vscode.QuickPickItem {
      session: SessionMetadata;
    }

    const items: FindItem[] = sessions.map((s) => {
      const ageMs = Date.now() - s.mtime;
      const seconds = Math.floor(ageMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      let when: string;
      if (seconds < 60) when = 'now';
      else if (minutes < 60) when = `${minutes}m`;
      else if (hours < 24) when = `${hours}h`;
      else if (days < 7) when = `${days}d`;
      else {
        const d = new Date(s.mtime);
        when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      const branch = s.gitBranch ?? '?';
      const cwdShort = s.cwd ? s.cwd.replace(/^.+\/([^/]+\/[^/]+)$/, '$1') : '';
      return {
        label: s.title,
        description: when,
        detail: cwdShort ? `${branch} · ${cwdShort}` : branch,
        session: s,
      };
    });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Search ${sessions.length} sessions by message…`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    await openSession(picked.session);
  });

  // Feature 2: + button in panel title bar — start a new Claude session.
  // Before running `claude`, we push a PendingAdoption entry so that the
  // next new JSONL to appear in this cwd is deterministically linked to the
  // spawned terminal (claimed via onDidDiscoverSession).
  const newSessionCmd = vscode.commands.registerCommand('agentTasks.sessions.newSession', () => {
    log('Command: sessions.newSession');
    const rawCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cwd = rawCwd ? path.resolve(rawCwd) : undefined;
    log(`Starting new Claude session (cwd=${cwd ?? '?'})`);
    const terminal = vscode.window.createTerminal({
      name: 'Claude · new session',
      cwd,
      iconPath: new vscode.ThemeIcon('comment-discussion'),
    });

    if (cwd) {
      pendingAdoptions.push({ terminal, cwd, spawnedAt: Date.now() });
      log(`Pending adoption queued for cwd=${cwd} (queue length: ${pendingAdoptions.length})`);
    }

    terminal.show();
    terminal.sendText('claude');
  });

  context.subscriptions.push(
    agentTasksView,
    artifactWatcher,
    refreshCmd,
    sortCmd,
    focusCmd,
    openMarkdownCmd,
    openPlanCmd,
    openTaskCmd,
    openWalkthroughCmd,
    revealInOSCmd,
    copyPathCmd,
    deleteArtifactsCmd,
    toggleScopeCmd,
    // Sessions panel
    sessionsView,
    sessionWatcher,
    workspaceFolderSub,
    sessionsRefreshCmd,
    sessionsToggleScopeCmd,
    visibilitySub,
    tickDisposable,
    configSub,
    openSessionCmd,
    findSessionCmd,
    closeTerminalSub,
    discoverySub,
    newSessionCmd
  );
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle disposal
}
