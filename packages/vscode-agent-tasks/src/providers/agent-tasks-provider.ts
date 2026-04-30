/**
 * TreeDataProvider for displaying agent task progress from artifact directories.
 *
 * Supports configurable directories (default: `.agent`, `.gw`) via the
 * `agentTasks.directories` setting.
 *
 * Tree structure:
 *   - Single worktree → flat list of AgentBranchItems
 *   - Multiple worktrees → WorktreeArtifactGroupItems (current first,
 *     marked), each containing AgentBranchItems
 *   - Multiple worktrees with exactly 1 branch → WorktreeFlatItem (skips
 *     the redundant branch level; Tasks/Plan/Walkthrough shown directly)
 *
 * Scope toggle (`agentTasks.scope`):
 *   - `"all"` (default) — show artifacts from every worktree, grouped
 *   - `"current"` — show only the current worktree, flat list
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseTaskMd, parsePlanMd, ParsedTask, ParsedPlan, TaskItem } from '../parsers/markdown-parser';
import { discoverWorktreePaths } from '../lib/worktree-discovery';

export type AgentTasksScope = 'current' | 'all';

/**
 * Returns the configured artifact directory names, falling back to the defaults
 * when the setting is empty or unset.
 */
function getConfiguredDirs(): string[] {
  const cfg = vscode.workspace.getConfiguration('agentTasks').get<string[]>('directories', []);
  return cfg.length > 0 ? cfg : ['.agent', '.gw'];
}

// ---------------------------------------------------------------------------
// Tree item: WorktreeArtifactGroupItem
// ---------------------------------------------------------------------------

/**
 * A collapsible group node representing one worktree in the Agent Tasks panel.
 *
 * Visual treatment mirrors WorktreeGroupItem in sessions-provider.ts:
 *   - current worktree → `circle-filled` (charts.blue), expanded by default,
 *     description `(current) · N branches`
 *   - other worktrees  → `git-branch` (default color), collapsed,
 *     description `N branches`
 *
 * Label is the last 1–2 path segments joined with `/`.
 * Full path lives in the tooltip.
 */
export class WorktreeArtifactGroupItem extends vscode.TreeItem {
  constructor(
    public readonly worktreePath: string,
    public readonly branchCount: number,
    public readonly isCurrent: boolean
  ) {
    const segments = worktreePath.split(path.sep).filter(Boolean);
    const label =
      segments.length >= 2
        ? segments.slice(-2).join('/')
        : segments[segments.length - 1] ?? worktreePath;

    super(
      label,
      isCurrent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.iconPath = isCurrent
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'))
      : new vscode.ThemeIcon('git-branch');

    const countLabel = `${branchCount} branch${branchCount !== 1 ? 'es' : ''}`;
    this.description = isCurrent ? `(current) · ${countLabel}` : countLabel;

    const md = new vscode.MarkdownString();
    if (isCurrent) md.appendMarkdown(`**Current worktree**\n\n`);
    md.appendMarkdown(`\`${worktreePath}\`\n\n${countLabel}`);
    this.tooltip = md;

    this.contextValue = isCurrent ? 'agentWorktreeGroupCurrent' : 'agentWorktreeGroup';
  }
}

// ---------------------------------------------------------------------------
// Tree item: EmptyScopeItem
// ---------------------------------------------------------------------------

/**
 * Placeholder shown when `agentTasks.scope` is `"current"` but the current
 * worktree has no artifacts while other worktrees do.
 *
 * A silent empty panel looks broken — this makes the filter state legible
 * and actionable.
 */
export class EmptyScopeItem extends vscode.TreeItem {
  constructor(otherWorktreeCount: number) {
    super('No artifacts in this worktree', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
    const noun = otherWorktreeCount === 1 ? 'worktree' : 'worktrees';
    this.description = `${otherWorktreeCount} in other ${noun} — switch filter`;
    this.tooltip = new vscode.MarkdownString(
      `The current worktree has no agent task artifacts.\n\n` +
        `**${otherWorktreeCount}** other ${noun} have artifacts. ` +
        `Use the filter icon in the panel header to switch to \`all\`.`
    );
    this.contextValue = 'agentTasksEmptyScope';
  }
}

// ---------------------------------------------------------------------------
// Shared branch icon + description helpers
// ---------------------------------------------------------------------------

/**
 * Returns the icon for a branch based on its artifact state.
 * Used by both AgentBranchItem and WorktreeFlatItem so the flattened
 * worktree node inherits the same visual signal as its single branch.
 */
function getBranchIcon(hasWalkthrough: boolean, task: ParsedTask | undefined): vscode.ThemeIcon {
  if (hasWalkthrough) {
    // Completed branches use dimmer icon (no color = default gray)
    return new vscode.ThemeIcon('pass-filled');
  }
  if (task?.blockers && task.blockers.length > 0) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
  }
  return new vscode.ThemeIcon('rocket', new vscode.ThemeColor('charts.blue'));
}

/**
 * Returns the short description string for a branch based on its artifact state.
 * Used by both AgentBranchItem and WorktreeFlatItem.
 */
function getBranchDescription(hasWalkthrough: boolean, task: ParsedTask | undefined): string {
  if (hasWalkthrough) return 'completed';
  if (task?.phase && task.phaseName) {
    return `Phase ${task.phase} · ${task.phaseName}`;
  }
  if (task?.blockers && task.blockers.length > 0) {
    return `${task.blockers.length} blocker${task.blockers.length !== 1 ? 's' : ''}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Existing tree item types
// ---------------------------------------------------------------------------

export class AgentBranchItem extends vscode.TreeItem {
  constructor(
    public readonly branchName: string,
    public readonly artifactDir: string,
    public readonly task: ParsedTask | undefined,
    public readonly plan: ParsedPlan | undefined,
    public readonly hasWalkthrough: boolean
  ) {
    super(branchName, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = hasWalkthrough ? 'agentBranchCompleted' : 'agentBranch';
    this.description = getBranchDescription(hasWalkthrough, task);
    this.tooltip = this.getTooltip();
    this.iconPath = getBranchIcon(hasWalkthrough, task);

    // No command — clicking expands/collapses. Child items open files.
  }

  private getTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Branch:** \`${this.branchName}\`\n\n`);
    if (this.task?.frontmatter.task) {
      md.appendMarkdown(`**Task:** ${this.task.frontmatter.task}\n\n`);
    }
    if (this.plan?.summary) {
      md.appendMarkdown(`**Plan:** ${this.plan.summary}\n\n`);
    }
    if (this.hasWalkthrough) {
      md.appendMarkdown('$(check) **Completed** - walkthrough available');
    }
    return md;
  }
}

// ---------------------------------------------------------------------------
// Tree item: WorktreeFlatItem
// ---------------------------------------------------------------------------

/**
 * A flattened worktree node used when a worktree contains exactly 1 branch.
 *
 * Instead of the user having to expand the worktree group and then the branch,
 * the worktree node IS the branch — expanding it shows Tasks/Plan/Walkthrough
 * directly. The branch's icon and description are inherited so the worktree
 * row carries the same visual signal (rocket/pass/warning) as its single branch.
 *
 * Label: last 1–2 path segments (same as WorktreeArtifactGroupItem)
 * Icon:  derived from branch state (getBranchIcon)
 * Description: composed from current-worktree status + branch state
 * Context value: `agentWorktreeFlat` / `agentWorktreeFlatCompleted`
 *   → drives the same inline Open Plan / Open Walkthrough actions as AgentBranchItem
 */
export class WorktreeFlatItem extends vscode.TreeItem {
  /** The single AgentBranchItem whose children this node delegates to. */
  public readonly branch: AgentBranchItem;

  constructor(
    public readonly worktreePath: string,
    public readonly isCurrent: boolean,
    branch: AgentBranchItem
  ) {
    const segments = worktreePath.split(path.sep).filter(Boolean);
    const label =
      segments.length >= 2
        ? segments.slice(-2).join('/')
        : segments[segments.length - 1] ?? worktreePath;

    super(
      label,
      isCurrent
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );

    this.branch = branch;

    // Icon mirrors the branch state, not the static worktree icon
    this.iconPath = getBranchIcon(branch.hasWalkthrough, branch.task);

    // Description: compose (current) prefix with branch state description
    const branchDesc = getBranchDescription(branch.hasWalkthrough, branch.task);
    if (isCurrent) {
      this.description = branchDesc ? `(current) · ${branchDesc}` : '(current)';
    } else {
      this.description = branchDesc || undefined;
    }

    // Context value drives the inline Open Plan / Open Walkthrough actions
    this.contextValue = branch.hasWalkthrough ? 'agentWorktreeFlatCompleted' : 'agentWorktreeFlat';

    const md = new vscode.MarkdownString();
    if (isCurrent) md.appendMarkdown(`**Current worktree** (1 branch)\n\n`);
    md.appendMarkdown(`\`${worktreePath}\`\n\n**Branch:** \`${branch.branchName}\``);
    if (branchDesc) md.appendMarkdown(`\n\n${branchDesc}`);
    this.tooltip = md;
  }
}

export class TaskGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly groupIcon: string,
    public readonly items: TaskCheckboxItem[],
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
    public readonly taskFilePath?: string
  ) {
    super(groupLabel, collapsibleState);
    this.iconPath = new vscode.ThemeIcon(groupIcon);
    this.description = `${items.length}`;

    if (taskFilePath) {
      this.command = {
        command: 'agentTasks.openMarkdown',
        title: 'Open Task',
        arguments: [taskFilePath],
      };
    }
  }
}

export class TaskCheckboxItem extends vscode.TreeItem {
  public readonly childItems: TaskCheckboxItem[];

  constructor(
    label: string,
    public readonly completed: boolean,
    public readonly inProgress: boolean,
    public readonly taskFilePath?: string,
    children: TaskCheckboxItem[] = []
  ) {
    super(label, children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    this.childItems = children;

    if (inProgress) {
      this.iconPath = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.blue'));
      this.description = 'in progress';
    } else if (completed) {
      this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-large-outline');
    }

    if (taskFilePath) {
      this.command = {
        command: 'agentTasks.openMarkdown',
        title: 'Open Task',
        arguments: [taskFilePath],
      };
    }
  }
}

export class TasksSummaryItem extends vscode.TreeItem {
  public readonly sectionGroups: TaskGroupItem[];

  constructor(
    public readonly sections: Array<{ heading: string; items: TaskCheckboxItem[] }>,
    public readonly blockerItems: BlockerItem[],
    public readonly taskFilePath: string
  ) {
    super('Tasks', vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('tasklist');

    // Build section groups with smart expand/collapse
    this.sectionGroups = sections.map((s) => {
      const allCompleted = s.items.length > 0 && s.items.every((i) => i.completed);
      return new TaskGroupItem(
        s.heading,
        allCompleted ? 'pass' : 'play',
        s.items,
        allCompleted ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        taskFilePath
      );
    });

    // Build summary description
    const allItems = sections.flatMap((s) => s.items);
    const inProgressTask = allItems.find((t) => t.inProgress);
    if (inProgressTask) {
      this.description = inProgressTask.label as string;
    } else {
      const completed = countItems(allItems, true);
      const total = countItems(allItems, false);
      this.description = `${completed} completed`;
      if (total > completed) {
        this.description = `${completed}/${total} completed`;
      }
    }

    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Task',
      arguments: [taskFilePath],
    };
  }
}

/** Recursively count items (and their children). If onlyCompleted, count only checked items. */
function countItems(items: TaskCheckboxItem[], onlyCompleted: boolean): number {
  let count = 0;
  for (const item of items) {
    if (!onlyCompleted || item.completed) count++;
    count += countItems(item.childItems, onlyCompleted);
  }
  return count;
}

export class PlanSummaryItem extends vscode.TreeItem {
  constructor(
    public readonly plan: ParsedPlan,
    public readonly planFilePath: string
  ) {
    super('Plan', vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('notebook');
    this.description = plan.complexity || '';
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Plan',
      arguments: [planFilePath],
    };
  }
}

export class WalkthroughSummaryItem extends vscode.TreeItem {
  constructor(public readonly walkthroughFilePath: string) {
    super('Walkthrough', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('book');
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Walkthrough',
      arguments: [walkthroughFilePath],
    };
  }
}

export class DecisionItem extends vscode.TreeItem {
  constructor(decision: string, rationale: string, phase: string, taskFilePath?: string) {
    super(decision, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('lightbulb');
    this.description = `Phase ${phase}`;
    this.tooltip = new vscode.MarkdownString(`**${decision}**\n\n${rationale}\n\n*Phase ${phase}*`);

    if (taskFilePath) {
      this.command = {
        command: 'agentTasks.openMarkdown',
        title: 'Open Task',
        arguments: [taskFilePath],
      };
    }
  }
}

export class BlockerItem extends vscode.TreeItem {
  constructor(blocker: string, taskFilePath?: string) {
    super(blocker, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));

    if (taskFilePath) {
      this.command = {
        command: 'agentTasks.openMarkdown',
        title: 'Open Task',
        arguments: [taskFilePath],
      };
    }
  }
}

type AgentTaskTreeItem =
  | WorktreeArtifactGroupItem
  | WorktreeFlatItem
  | EmptyScopeItem
  | AgentBranchItem
  | TaskGroupItem
  | TaskCheckboxItem
  | TasksSummaryItem
  | PlanSummaryItem
  | WalkthroughSummaryItem
  | DecisionItem
  | BlockerItem;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BranchItemWithMeta {
  item: AgentBranchItem;
  mtime: number;
  name: string;
  hasWalkthrough: boolean;
  hasInProgress: boolean;
  /** The worktree path this branch belongs to. */
  worktreePath: string;
}

/**
 * Scan a worktree for all artifact directories under each configured dir name.
 * Returns branch items for that worktree.
 */
function collectBranchesForWorktree(
  worktreePath: string,
  configuredDirs: string[]
): BranchItemWithMeta[] {
  const results: BranchItemWithMeta[] = [];

  for (const dirName of configuredDirs) {
    const artifactRoot = path.join(worktreePath, dirName);
    try {
      if (!fs.existsSync(artifactRoot) || !fs.statSync(artifactRoot).isDirectory()) continue;
    } catch {
      continue;
    }

    const branchRelPaths = findBranchDirs(artifactRoot);
    for (const relPath of branchRelPaths) {
      const branchDir = path.join(artifactRoot, relPath);
      const taskPath = path.join(branchDir, 'task.md');
      const planPath = path.join(branchDir, 'plan.md');
      const walkthroughPath = path.join(branchDir, 'walkthrough.md');

      const hasTaskFile = fs.existsSync(taskPath);
      const hasPlanFile = fs.existsSync(planPath);
      if (!hasTaskFile && !hasPlanFile) continue;

      let task: ParsedTask | undefined;
      let plan: ParsedPlan | undefined;
      let latestMtime = 0;

      if (hasTaskFile) {
        try {
          task = parseTaskMd(fs.readFileSync(taskPath, 'utf-8'));
          latestMtime = Math.max(latestMtime, fs.statSync(taskPath).mtimeMs);
        } catch {
          // ignore parse errors
        }
      }

      if (hasPlanFile) {
        try {
          plan = parsePlanMd(fs.readFileSync(planPath, 'utf-8'));
          latestMtime = Math.max(latestMtime, fs.statSync(planPath).mtimeMs);
        } catch {
          // ignore parse errors
        }
      }

      const hasWalkthrough = fs.existsSync(walkthroughPath);
      if (hasWalkthrough) {
        try {
          latestMtime = Math.max(latestMtime, fs.statSync(walkthroughPath).mtimeMs);
        } catch {
          // ignore stat errors
        }
      }

      const hasInProgress = task?.taskSections.some((s) => s.items.some((t) => t.inProgress)) ?? false;

      results.push({
        item: new AgentBranchItem(relPath, branchDir, task, plan, hasWalkthrough),
        mtime: latestMtime,
        name: relPath.toLowerCase(),
        hasWalkthrough,
        hasInProgress,
        worktreePath,
      });
    }
  }

  return results;
}

/**
 * Recursively find directories containing `task.md`, `plan.md`, or
 * `walkthrough.md`. Returns relative paths from `dir`.
 */
function findBranchDirs(dir: string, relativePath = ''): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check if this directory itself has artifacts
    const hasArtifact = entries.some(
      (e) => !e.isDirectory() && (e.name === 'task.md' || e.name === 'plan.md' || e.name === 'walkthrough.md')
    );
    if (hasArtifact && relativePath) {
      results.push(relativePath);
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git' || entry.name === 'config.json') continue;
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      results.push(...findBranchDirs(path.join(dir, entry.name), childRelative));
    }
  } catch {
    // directory unreadable
  }
  return results;
}

/**
 * Sort branch items by the configured sort settings.
 */
function sortBranchItems(items: BranchItemWithMeta[]): BranchItemWithMeta[] {
  const config = vscode.workspace.getConfiguration('agentTasks');
  const sortBy = config.get<string>('sortBy', 'date');
  const sortOrder = config.get<string>('sortOrder', 'desc');
  const isAsc = sortOrder === 'asc';

  return [...items].sort((a, b) => {
    let result = 0;
    switch (sortBy) {
      case 'name':
        result = a.name.localeCompare(b.name);
        break;
      case 'status': {
        const statusA = a.hasInProgress ? 2 : a.hasWalkthrough ? 0 : 1;
        const statusB = b.hasInProgress ? 2 : b.hasWalkthrough ? 0 : 1;
        result = statusB - statusA;
        break;
      }
      case 'date':
      default:
        result = b.mtime - a.mtime;
        break;
    }
    return isAsc ? -result : result;
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AgentTasksProvider implements vscode.TreeDataProvider<AgentTaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentTaskTreeItem): Promise<AgentTaskTreeItem[]> {
    // Root level: list worktree groups or branch directories
    if (!element) {
      return this.getRootItems();
    }

    // Flattened worktree node (1-branch case): delegate directly to branch children
    if (element instanceof WorktreeFlatItem) {
      return this.getBranchChildren(element.branch);
    }

    // Worktree group level: list branches for that worktree
    if (element instanceof WorktreeArtifactGroupItem) {
      return this.getBranchItemsForWorktree(element.worktreePath);
    }

    // Branch level: show task groups, plan, decisions, blockers
    if (element instanceof AgentBranchItem) {
      return this.getBranchChildren(element);
    }

    // Tasks summary level: show task groups (Current, Completed, Upcoming)
    if (element instanceof TasksSummaryItem) {
      return element.sectionGroups;
    }

    // Group level: show individual task items
    if (element instanceof TaskGroupItem) {
      return element.items;
    }

    // Checkbox level: show children if any
    if (element instanceof TaskCheckboxItem) {
      return element.childItems;
    }

    // Plan level: show file lists
    if (element instanceof PlanSummaryItem) {
      return this.getPlanChildren(element.plan);
    }

    return [];
  }

  private getRootItems(): AgentTaskTreeItem[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return [];

    const scope = vscode.workspace
      .getConfiguration('agentTasks')
      .get<AgentTasksScope>('scope', 'all');

    const allWorktrees = discoverWorktreePaths(workspacePath);

    // Identify the current worktree as the longest worktree path containing
    // the workspace path. Falls back to workspacePath.
    const sortedByLength = [...allWorktrees].sort((a, b) => b.length - a.length);
    const currentWorktree =
      sortedByLength.find(
        (wt) => workspacePath === wt || workspacePath.startsWith(wt + path.sep)
      ) ?? workspacePath;

    if (scope === 'current') {
      // Flat list for current worktree only
      const branches = this.getBranchItemsForWorktree(currentWorktree);

      // Empty-state: current has nothing but other worktrees do
      if (branches.length === 0 && allWorktrees.length > 1) {
        const configuredDirs = getConfiguredDirs();
        const otherCount = allWorktrees
          .filter((wt) => wt !== currentWorktree)
          .filter((wt) => collectBranchesForWorktree(wt, configuredDirs).length > 0).length;
        if (otherCount > 0) {
          return [new EmptyScopeItem(otherCount)];
        }
      }
      return branches;
    }

    // scope === 'all': single-worktree stays flat; multi-worktree gets groups

    if (allWorktrees.length <= 1) {
      // Single worktree — flat list, no group wrapper
      return this.getBranchItemsForWorktree(currentWorktree);
    }

    // Multi-worktree: group by worktree, current first
    const configuredDirs = getConfiguredDirs();
    const groups: Array<{ wt: string; branches: BranchItemWithMeta[]; mtime: number }> = [];

    for (const wt of allWorktrees) {
      const branches = collectBranchesForWorktree(wt, configuredDirs);
      const mtime = branches.reduce((max, b) => Math.max(max, b.mtime), 0);
      groups.push({ wt, branches, mtime });
    }

    // Show current worktree even when empty; hide others when empty
    const visibleGroups = groups.filter((g) => g.wt === currentWorktree || g.branches.length > 0);

    visibleGroups.sort((a, b) => {
      if (a.wt === currentWorktree) return -1;
      if (b.wt === currentWorktree) return 1;
      return b.mtime - a.mtime;
    });

    return visibleGroups.map((g) => {
      const isCurrent = g.wt === currentWorktree;
      // 1-branch case: flatten — skip the redundant AgentBranchItem level
      if (g.branches.length === 1) {
        const sorted = sortBranchItems(g.branches);
        return new WorktreeFlatItem(g.wt, isCurrent, sorted[0].item);
      }
      return new WorktreeArtifactGroupItem(g.wt, g.branches.length, isCurrent);
    });
  }

  /**
   * Return the sorted branch items for a single worktree, deduplicated by
   * `(worktreePath, relPath)` across all configured artifact directories.
   * Keeping the worktree in the key prevents collision when two worktrees
   * both write `.agent/feat/x/plan.md`.
   */
  private getBranchItemsForWorktree(worktreePath: string): AgentBranchItem[] {
    const configuredDirs = getConfiguredDirs();

    // Collect and deduplicate by (worktreePath, relPath) — same branch name
    // in different artifact dirs within the same worktree prefers the entry
    // with the most recent mtime.
    const itemsByKey = new Map<string, BranchItemWithMeta>();
    const candidates = collectBranchesForWorktree(worktreePath, configuredDirs);

    for (const candidate of candidates) {
      const key = `${candidate.worktreePath}::${candidate.item.branchName}`;
      const existing = itemsByKey.get(key);
      if (!existing || candidate.mtime > existing.mtime) {
        itemsByKey.set(key, candidate);
      }
    }

    return sortBranchItems(Array.from(itemsByKey.values())).map((i) => i.item);
  }

  private taskItemToCheckbox(t: TaskItem, taskFilePath: string): TaskCheckboxItem {
    const children = t.children.map((c) => this.taskItemToCheckbox(c, taskFilePath));
    return new TaskCheckboxItem(t.label, t.completed, t.inProgress, taskFilePath, children);
  }

  private getBranchChildren(branch: AgentBranchItem): AgentTaskTreeItem[] {
    const children: AgentTaskTreeItem[] = [];
    const task = branch.task;
    const taskFilePath = path.join(branch.artifactDir, 'task.md');

    if (task) {
      // Build checkbox items for each task section
      const sections = task.taskSections.map((s) => ({
        heading: s.heading,
        items: s.items.map((t) => this.taskItemToCheckbox(t, taskFilePath)),
      }));
      const blockerItems = task.blockers.map((b) => new BlockerItem(b, taskFilePath));

      // Add Tasks summary (groups all checkbox sections inside)
      if (sections.length > 0) {
        children.push(new TasksSummaryItem(sections, blockerItems, taskFilePath));
      }

      // Blockers shown at branch level for visibility
      if (task.blockers.length > 0) {
        children.push(
          new TaskGroupItem(
            'Blockers',
            'error',
            blockerItems as unknown as TaskCheckboxItem[],
            vscode.TreeItemCollapsibleState.Expanded,
            taskFilePath
          )
        );
      }

      // Decisions
      if (task.decisions.length > 0) {
        const decisionItems = task.decisions.map(
          (d) => new DecisionItem(d.decision, d.rationale, d.phase, taskFilePath)
        );
        children.push(
          new TaskGroupItem(
            'Decisions',
            'lightbulb',
            decisionItems as unknown as TaskCheckboxItem[],
            vscode.TreeItemCollapsibleState.Collapsed,
            taskFilePath
          )
        );
      }
    }

    // Plan
    if (branch.plan) {
      const planPath = path.join(branch.artifactDir, 'plan.md');
      children.push(new PlanSummaryItem(branch.plan, planPath));
    }

    // Walkthrough
    if (branch.hasWalkthrough) {
      const wtPath = path.join(branch.artifactDir, 'walkthrough.md');
      children.push(new WalkthroughSummaryItem(wtPath));
    }

    return children;
  }

  private getPlanChildren(plan: ParsedPlan): AgentTaskTreeItem[] {
    const children: AgentTaskTreeItem[] = [];

    if (plan.goal) {
      const goalItem = new vscode.TreeItem(plan.goal, vscode.TreeItemCollapsibleState.None);
      goalItem.iconPath = new vscode.ThemeIcon('target');
      children.push(goalItem as AgentTaskTreeItem);
    }

    for (const file of plan.filesToCreate) {
      const item = new vscode.TreeItem(file.file, vscode.TreeItemCollapsibleState.None);
      item.description = file.purpose;
      item.iconPath = new vscode.ThemeIcon('new-file', new vscode.ThemeColor('charts.green'));
      children.push(item as AgentTaskTreeItem);
    }

    for (const file of plan.filesToModify) {
      const item = new vscode.TreeItem(file.file, vscode.TreeItemCollapsibleState.None);
      item.description = file.change;
      item.iconPath = new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.yellow'));
      children.push(item as AgentTaskTreeItem);
    }

    return children;
  }
}
