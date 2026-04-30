/**
 * Agent Tasks VS Code Extension
 * Entry point — command registration, tree view setup, watcher wiring
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { AgentTasksProvider } from './providers/agent-tasks-provider';
import { ArtifactWatcher } from './watchers/artifact-watcher';
import { SessionsProvider, SessionItem } from './providers/sessions-provider';
import { SessionWatcher } from './watchers/session-watcher';

export function activate(context: vscode.ExtensionContext): void {
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
    sessionsProvider.refresh();
  });

  // Rebuild the watcher whenever the workspace folders change
  const workspaceFolderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    // Refresh provider first so sessionDirs is updated
    sessionsProvider.refresh();
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
  });

  // Deferred watcher rebuild: after the first tree render the sessionDirs
  // will be populated. We schedule this as a micro-task so it fires after
  // the tree view completes its first getChildren call.
  void Promise.resolve().then(() => {
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
  });

  const sessionsRefreshCmd = vscode.commands.registerCommand('agentTasks.sessions.refresh', () => {
    sessionsProvider.refresh();
    // Rebuild watchers in case new worktrees appeared
    sessionWatcher.rebuild(sessionsProvider.sessionDirs);
  });

  const openSessionCmd = vscode.commands.registerCommand(
    'agentTasks.sessions.openSession',
    async (item: SessionItem) => {
      if (!item?.session?.filePath) return;

      const openWith = vscode.workspace
        .getConfiguration('agentTasks.sessions')
        .get<string>('openWith', 'editor');

      if (openWith === 'resume') {
        const terminal = vscode.window.createTerminal('Claude Resume');
        terminal.show();
        terminal.sendText(`claude --resume ${item.session.sessionId}`);
      } else {
        // editor (default)
        const uri = vscode.Uri.file(item.session.filePath);
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch {
          // File may have been deleted — show a message
          vscode.window.showWarningMessage(`Could not open session file: ${item.session.filePath}`);
        }
      }
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
    openSessionCmd
  );
}

export function deactivate(): void {
  // Nothing to clean up — subscriptions handle disposal
}
