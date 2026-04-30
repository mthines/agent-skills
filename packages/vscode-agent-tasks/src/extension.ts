/**
 * Agent Tasks VS Code Extension
 * Entry point — command registration, tree view setup, watcher wiring
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { AgentTasksProvider } from './providers/agent-tasks-provider';
import { ArtifactWatcher } from './watchers/artifact-watcher';
import { SessionsProvider, SessionItem } from './providers/sessions-provider';
import { SessionWatcher } from './watchers/session-watcher';
import { initLogger, log, logError } from './lib/logger';
import { parsePsOutput, findClaudeDescendant } from './lib/process-tree';
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

  // Create the file watcher and wire it to the provider
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
    if (item?.artifactDir) {
      const planPath = require('path').join(item.artifactDir, 'plan.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', planPath);
    }
  });

  const openTaskCmd = vscode.commands.registerCommand('agentTasks.openTask', async (item) => {
    if (item?.artifactDir) {
      const taskPath = require('path').join(item.artifactDir, 'task.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', taskPath);
    }
  });

  const openWalkthroughCmd = vscode.commands.registerCommand('agentTasks.openWalkthrough', async (item) => {
    if (item?.artifactDir) {
      const wtPath = require('path').join(item.artifactDir, 'walkthrough.md');
      await vscode.commands.executeCommand('agentTasks.openMarkdown', wtPath);
    }
  });

  // -------------------------------------------------------------------------
  // Sessions panel
  // -------------------------------------------------------------------------

  const sessionsProvider = new SessionsProvider();

  const sessionsView = vscode.window.createTreeView('agentSessionsExplorer', {
    treeDataProvider: sessionsProvider,
    showCollapseAll: true,
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

  const sessionsToggleScopeCmd = vscode.commands.registerCommand(
    'agentTasks.sessions.toggleScope',
    async () => {
      const cfg = vscode.workspace.getConfiguration('agentTasks.sessions');
      const current = cfg.get<string>('scope', 'all');
      const next = current === 'current' ? 'all' : 'current';
      log(`Command: sessions.toggleScope (${current} → ${next})`);
      await cfg.update('scope', next, vscode.ConfigurationTarget.Global);
      sessionsProvider.refresh();
      sessionWatcher.rebuild(sessionsProvider.sessionDirs);
      vscode.window.setStatusBarMessage(
        next === 'current'
          ? 'Sessions: showing current worktree only'
          : 'Sessions: showing all worktrees',
        2500
      );
    }
  );

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

  // React to scope config changes from settings UI (so the user doesn't have
  // to manually refresh after editing settings.json).
  const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('agentTasks.sessions.scope')) {
      sessionsProvider.refresh();
      sessionWatcher.rebuild(sessionsProvider.sessionDirs);
    }
  });

  // Map of sessionId → terminal currently running `claude --resume` for that
  // session in THIS window. Used so re-clicking a session focuses its existing
  // terminal tab instead of spawning a duplicate. Cross-window tracking is not
  // possible — VS Code's extension API is window-scoped.
  const sessionTerminals = new Map<string, vscode.Terminal>();

  const closeTerminalSub = vscode.window.onDidCloseTerminal((t) => {
    for (const [sid, term] of sessionTerminals) {
      if (term === t) {
        sessionTerminals.delete(sid);
        sessionsProvider.setTerminalOpen(sid, false);
        log(`Terminal closed for session ${sid.slice(0, 8)}`);
        break;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Terminal adoption helper
  // ---------------------------------------------------------------------------

  /**
   * One-shot process-tree scan. Tries to find a terminal already running
   * `claude --resume <sid>` among `vscode.window.terminals`.
   *
   * Returns the matching terminal, or `undefined` on any failure or no-match.
   * All errors are caught and logged; callers always fall through to spawn.
   */
  const tryAdoptTerminal = async (
    sid: string,
    terminals: readonly vscode.Terminal[]
  ): Promise<vscode.Terminal | undefined> => {
    try {
      const stdout = child_process.execSync('ps -A -o pid,ppid,command', { encoding: 'utf8' });
      const snapshot = parsePsOutput(stdout);

      for (const terminal of terminals) {
        let shellPid: number | undefined;
        try {
          shellPid = await terminal.processId;
        } catch {
          continue;
        }
        if (shellPid === undefined) continue;

        const match = findClaudeDescendant(shellPid, sid, snapshot);
        if (match !== undefined) {
          log(`tryAdoptTerminal: adopted terminal (shellPid=${shellPid}, claudePid=${match}, sid=${sid.slice(0, 8)})`);
          return terminal;
        }
      }
    } catch (err) {
      logError('tryAdoptTerminal: ps scan failed, falling through to spawn', err);
    }
    return undefined;
  };

  // Shared open-session logic used by both the tree-click command and the
  // find QuickPick. Reads the `openWith` setting once, then either resumes
  // or opens the JSONL.
  const openSession = async (session: SessionMetadata): Promise<void> => {
    const openWith = vscode.workspace
      .getConfiguration('agentTasks.sessions')
      .get<string>('openWith', 'resume');

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
      // `claude --resume <sid>` (e.g. one the user opened manually).
      // Runs only on click — never on refresh, watcher tick, or render.
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
  const newSessionCmd = vscode.commands.registerCommand(
    'agentTasks.sessions.newSession',
    () => {
      log('Command: sessions.newSession');
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      log(`Starting new Claude session (cwd=${cwd ?? '?'})`);
      const terminal = vscode.window.createTerminal({
        name: 'Claude · new session',
        cwd,
        iconPath: new vscode.ThemeIcon('comment-discussion'),
      });
      terminal.show();
      terminal.sendText('claude');
    }
  );

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
    newSessionCmd
  );
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle disposal
}
