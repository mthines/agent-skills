/**
 * TreeDataProvider for displaying agent task progress from artifact directories
 * Supports configurable directories (default: .agent, .gw) via agentTasks.directories setting
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseTaskMd, parsePlanMd, ParsedTask, ParsedPlan, TaskItem } from '../parsers/markdown-parser';

/**
 * Returns the configured artifact directory names, falling back to the defaults
 * when the setting is empty or unset.
 */
function getConfiguredDirs(): string[] {
  const cfg = vscode.workspace.getConfiguration('agentTasks').get<string[]>('directories', []);
  return cfg.length > 0 ? cfg : ['.agent', '.gw'];
}

// -- Tree Item Types --

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
    this.description = this.getDescription();
    this.tooltip = this.getTooltip();
    this.iconPath = this.getIcon();

    // No command — clicking expands/collapses. Child items open files.
  }

  private getDescription(): string {
    if (this.hasWalkthrough) return 'completed';
    if (this.task?.phase && this.task.phaseName) {
      return `Phase ${this.task.phase} · ${this.task.phaseName}`;
    }
    return '';
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

  private getIcon(): vscode.ThemeIcon {
    if (this.hasWalkthrough) {
      // Completed branches use dimmer icon (no color = default gray)
      return new vscode.ThemeIcon('pass-filled');
    }
    if (this.task?.blockers && this.task.blockers.length > 0) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    }
    return new vscode.ThemeIcon('rocket', new vscode.ThemeColor('charts.blue'));
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
  | AgentBranchItem
  | TaskGroupItem
  | TaskCheckboxItem
  | TasksSummaryItem
  | PlanSummaryItem
  | WalkthroughSummaryItem
  | DecisionItem
  | BlockerItem;

// -- Provider --

export class AgentTasksProvider implements vscode.TreeDataProvider<AgentTaskTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTaskTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private artifactRoots: string[];

  constructor() {
    this.artifactRoots = this.findArtifactRoots();
  }

  refresh(): void {
    this.artifactRoots = this.findArtifactRoots();
    this._onDidChangeTreeData.fire();
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
    const dirs = getConfiguredDirs();
    const roots: string[] = [];
    const seen = new Set<string>();

    for (const dirName of dirs) {
      this.collectRoots(dirName, roots, seen);
      if (dirName === '.gw') {
        this.addDefaultWorktreeRoot(roots, seen);
      }
    }

    return roots;
  }

  /**
   * Walk up from workspace root (up to 5 levels) collecting directories
   * matching dirName. Results are added to roots, deduped by seen.
   */
  private collectRoots(dirName: string, roots: string[], seen: Set<string>): void {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return;

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
  }

  /**
   * Read .gw/config.json to find the default branch, resolve its worktree
   * path, and add its .gw/ directory to roots if it exists and isn't
   * already included.
   * Only called when dirName === '.gw' (gw-specific bare-repo convention).
   */
  private addDefaultWorktreeRoot(roots: string[], seen: Set<string>): void {
    for (const artifactRoot of roots) {
      const configPath = path.join(artifactRoot, 'config.json');
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
        return; // config found, done
      } catch {
        // config.json missing or invalid, try next root
      }
    }
  }

  getTreeItem(element: AgentTaskTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentTaskTreeItem): Promise<AgentTaskTreeItem[]> {
    if (this.artifactRoots.length === 0) {
      return [];
    }

    // Root level: list branch directories
    if (!element) {
      return this.getBranchItems();
    }

    // Branch level: show task groups, plan, decisions, blockers
    if (element instanceof AgentBranchItem) {
      return this.getBranchChildren(element);
    }

    // Tasks summary level: show task groups (Current, Completed, Upcoming)
    if (element instanceof TasksSummaryItem) {
      return this.getTasksSummaryChildren(element);
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

  /**
   * Recursively find directories containing task.md, plan.md, or walkthrough.md.
   * Returns paths relative to artifactRoot for each leaf directory with artifacts.
   */
  private findBranchDirs(dir: string, relativePath = ''): string[] {
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
        results.push(...this.findBranchDirs(path.join(dir, entry.name), childRelative));
      }
    } catch {
      // directory unreadable
    }
    return results;
  }

  private getBranchItems(): AgentBranchItem[] {
    if (this.artifactRoots.length === 0) return [];

    interface BranchItemWithMeta {
      item: AgentBranchItem;
      mtime: number;
      name: string;
      hasWalkthrough: boolean;
      hasInProgress: boolean;
    }

    // Collect branches from all artifact roots, deduplicating by relPath
    // (prefer the entry with the most recent mtime when duplicates exist)
    const itemsByRelPath = new Map<string, BranchItemWithMeta>();

    for (const artifactRoot of this.artifactRoots) {
      const branchRelPaths = this.findBranchDirs(artifactRoot);

      for (const relPath of branchRelPaths) {
        const branchDir = path.join(artifactRoot, relPath);
        const taskPath = path.join(branchDir, 'task.md');
        const planPath = path.join(branchDir, 'plan.md');
        const walkthroughPath = path.join(branchDir, 'walkthrough.md');

        const hasTaskFile = fs.existsSync(taskPath);
        const hasPlanFile = fs.existsSync(planPath);
        if (!hasTaskFile && !hasPlanFile) {
          continue;
        }

        let task: ParsedTask | undefined;
        let plan: ParsedPlan | undefined;
        let latestMtime = 0;

        if (hasTaskFile) {
          try {
            task = parseTaskMd(fs.readFileSync(taskPath, 'utf-8'));
            const stat = fs.statSync(taskPath);
            latestMtime = Math.max(latestMtime, stat.mtimeMs);
          } catch {
            // ignore parse errors
          }
        }

        if (hasPlanFile) {
          try {
            plan = parsePlanMd(fs.readFileSync(planPath, 'utf-8'));
            const stat = fs.statSync(planPath);
            latestMtime = Math.max(latestMtime, stat.mtimeMs);
          } catch {
            // ignore parse errors
          }
        }

        const hasWalkthrough = fs.existsSync(walkthroughPath);
        if (hasWalkthrough) {
          try {
            const stat = fs.statSync(walkthroughPath);
            latestMtime = Math.max(latestMtime, stat.mtimeMs);
          } catch {
            // ignore stat errors
          }
        }

        const hasInProgress = task?.taskSections.some((s) => s.items.some((t) => t.inProgress)) ?? false;

        const candidate: BranchItemWithMeta = {
          item: new AgentBranchItem(relPath, branchDir, task, plan, hasWalkthrough),
          mtime: latestMtime,
          name: relPath.toLowerCase(),
          hasWalkthrough,
          hasInProgress,
        };

        // Deduplicate: keep the entry with the most recent mtime
        const existing = itemsByRelPath.get(relPath);
        if (!existing || candidate.mtime > existing.mtime) {
          itemsByRelPath.set(relPath, candidate);
        }
      }
    }

    const items = Array.from(itemsByRelPath.values());

    // Get sort settings from configuration
    const config = vscode.workspace.getConfiguration('agentTasks');
    const sortBy = config.get<string>('sortBy', 'date');
    const sortOrder = config.get<string>('sortOrder', 'desc');
    const isAsc = sortOrder === 'asc';

    // Sort based on settings
    items.sort((a, b) => {
      let result = 0;

      switch (sortBy) {
        case 'name':
          result = a.name.localeCompare(b.name);
          break;
        case 'status': {
          // Status priority: in-progress > active (not completed) > completed
          const statusA = a.hasInProgress ? 2 : a.hasWalkthrough ? 0 : 1;
          const statusB = b.hasInProgress ? 2 : b.hasWalkthrough ? 0 : 1;
          result = statusB - statusA; // Higher priority first by default (desc)
          break;
        }
        case 'date':
        default:
          result = b.mtime - a.mtime; // Newer first by default (desc)
          break;
      }

      return isAsc ? -result : result;
    });

    return items.map((i) => i.item);
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

  private getTasksSummaryChildren(summary: TasksSummaryItem): AgentTaskTreeItem[] {
    return summary.sectionGroups;
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
