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
import {
  ParsedDiagnose,
  ParsedPlan,
  ParsedTask,
  TaskItem,
  parseDiagnoseMd,
  parsePlanMd,
  parseTaskMd,
} from '../parsers/markdown-parser';
import { discoverWorktreePaths } from '../lib/worktree-discovery';
import { findPlanVersions, PlanVersionInfo } from '../lib/plan-versions';
import {
  collectOtherFilePathsForWorktree,
  diagnoseTargetFromFilename,
  findDiagnoseReports,
} from '../lib/session-artifact-correlator';
import {
  ChecksSummary,
  ParsedCheck,
  formatChecksRollup,
  parseChecksYaml,
  summarizeChecks,
} from '../parsers/checks-parser';

export type { PlanVersionInfo };
export { findPlanVersions };

export type AgentTasksScope = 'current' | 'all';

/**
 * Surfaced metadata for a single `diagnose-{target}.md` report. The target
 * skill is always present (derived from the filename); the rest is
 * best-effort from the report header and may be `undefined` when fields are
 * missing.
 */
export interface DiagnoseFileInfo {
  filePath: string;
  targetSkill: string;
  parsed: ParsedDiagnose;
}

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
 * Used by both AgentBranchItem and WorktreeFlatItem. When the branch carries
 * executable checks, a compact `✓ pass/total` rollup is appended so check
 * progress is glanceable without expanding the branch.
 */
function getBranchDescription(
  hasWalkthrough: boolean,
  task: ParsedTask | undefined,
  checksSummary?: ChecksSummary
): string {
  let base = '';
  if (hasWalkthrough) {
    base = 'completed';
  } else if (task?.phase && task.phaseName) {
    base = `Phase ${task.phase} · ${task.phaseName}`;
  } else if (task?.blockers && task.blockers.length > 0) {
    base = `${task.blockers.length} blocker${task.blockers.length !== 1 ? 's' : ''}`;
  }

  const rollup = checksSummary ? formatChecksRollup(checksSummary) : '';
  if (!rollup) return base;
  return base ? `${base} · ${rollup}` : rollup;
}

// ---------------------------------------------------------------------------
// Existing tree item types
// ---------------------------------------------------------------------------

export class AgentBranchItem extends vscode.TreeItem {
  /** Summary of `checks.yaml` statuses; undefined when the branch has no checks. */
  public readonly checksSummary: ChecksSummary | undefined;

  constructor(
    public readonly branchName: string,
    public readonly artifactDir: string,
    public readonly task: ParsedTask | undefined,
    public readonly plan: ParsedPlan | undefined,
    public readonly hasWalkthrough: boolean,
    public readonly diagnoses: DiagnoseFileInfo[] = [],
    public readonly checks: ParsedCheck[] = []
  ) {
    super(branchName, vscode.TreeItemCollapsibleState.Collapsed);

    this.checksSummary = checks.length > 0 ? summarizeChecks(checks) : undefined;
    this.contextValue = hasWalkthrough ? 'agentBranchCompleted' : 'agentBranch';
    this.description = getBranchDescription(hasWalkthrough, task, this.checksSummary);
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
      md.appendMarkdown('$(check) **Completed** - walkthrough available\n\n');
    }
    if (this.checksSummary) {
      const s = this.checksSummary;
      const extras: string[] = [];
      if (s.fail > 0) extras.push(`${s.fail} failing`);
      if (s.unsatisfiable > 0) extras.push(`${s.unsatisfiable} unsatisfiable`);
      md.appendMarkdown(
        `**Checks:** ${s.pass}/${s.total} passing${extras.length > 0 ? ` (${extras.join(', ')})` : ''}\n\n`
      );
    }
    if (this.diagnoses.length > 0) {
      const labels = this.diagnoses.map((d) => `\`${d.targetSkill}\``).join(', ');
      const noun = this.diagnoses.length === 1 ? 'Diagnose report' : 'Diagnose reports';
      md.appendMarkdown(`**${noun}:** ${labels}`);
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
    const branchDesc = getBranchDescription(branch.hasWalkthrough, branch.task, branch.checksSummary);
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

/**
 * One historical plan snapshot — `.agent/{branch}/plan.v{N}.md` —
 * surfaced as a leaf under the Plan node so reviewers can compare
 * iterations. Click opens the snapshot via `agentTasks.openMarkdown`.
 */
export class PlanVersionItem extends vscode.TreeItem {
  constructor(
    public readonly version: number,
    public readonly versionFilePath: string,
    public readonly isLatest: boolean
  ) {
    super(`v${version}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(isLatest ? 'circle-filled' : 'circle-outline');
    this.description = isLatest ? 'latest' : '';
    this.tooltip = new vscode.MarkdownString(
      isLatest
        ? `**plan.v${version}.md** — current snapshot (≡ \`plan.md\`)`
        : `**plan.v${version}.md** — earlier iteration`
    );
    this.contextValue = 'agentPlanVersion';
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Plan Version',
      arguments: [versionFilePath],
    };
  }
}

/**
 * Collapsible group node listing every `plan.v*.md` snapshot for a branch.
 * Only emitted when at least one versioned snapshot exists.
 *
 * Collapsed by default so the Plan node stays scannable; users opt in to
 * the history when they want it.
 */
export class PlanVersionsGroupItem extends vscode.TreeItem {
  constructor(public readonly versions: PlanVersionItem[]) {
    super('Previous Versions', vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('history');
    this.description = `${versions.length}`;
    this.tooltip = new vscode.MarkdownString(
      `**${versions.length}** plan snapshot${versions.length === 1 ? '' : 's'} on disk\n\n` +
        '`plan.md` always points at the latest. Earlier `plan.v*.md` files are immutable history.'
    );
    this.contextValue = 'agentPlanVersionsGroup';
  }
}

export class PlanSummaryItem extends vscode.TreeItem {
  constructor(
    public readonly plan: ParsedPlan,
    public readonly planFilePath: string,
    public readonly versions: PlanVersionInfo[] = []
  ) {
    super('Plan', vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('notebook');

    // Description: complexity + version count when there's history to show
    const parts: string[] = [];
    if (plan.complexity) parts.push(plan.complexity);
    if (versions.length > 0) {
      const latest = versions[versions.length - 1];
      parts.push(`v${latest.version}`);
    }
    this.description = parts.join(' · ');

    this.contextValue = 'agentPlanFile';
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
    this.contextValue = 'agentWalkthroughFile';
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Walkthrough',
      arguments: [walkthroughFilePath],
    };
  }
}

/**
 * Leaf node representing one check entry from `checks.yaml`. The icon maps
 * the check's status; the EARS criterion text carries the row description
 * (truncated) and the full contract lives in the tooltip. Click opens
 * `checks.yaml` (as a text document — never Markdown preview).
 */
export class CheckItem extends vscode.TreeItem {
  constructor(public readonly check: ParsedCheck, public readonly checksFilePath: string) {
    super(check.id, vscode.TreeItemCollapsibleState.None);

    this.iconPath = CheckItem.iconForStatus(check.status);
    const ears = check.ears ?? '';
    this.description = ears.length > 40 ? ears.slice(0, 40) + '…' : ears;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${check.id}** — _${check.status}_\n\n`);
    if (check.ears) md.appendMarkdown(`${check.ears}\n\n`);
    if (check.expect) md.appendMarkdown(`**Expect:** \`${check.expect}\`\n\n`);
    const meta: string[] = [];
    if (check.kind) meta.push(`kind: ${check.kind}`);
    if (check.requirement) meta.push(`covers: ${check.requirement}`);
    if (meta.length > 0) md.appendMarkdown(`_${meta.join(' · ')}_`);
    this.tooltip = md;

    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Checks',
      arguments: [checksFilePath],
    };
  }

  /**
   * Status → icon. Distinct glyph per status (not color-only — WCAG 1.4.1):
   *   pending       → circle-large-outline (default)
   *   pass          → pass (green)
   *   fail          → error (red) — normal mid-loop state, not an alarm
   *   unsatisfiable → warning (yellow) — the executor's escalation affordance
   */
  static iconForStatus(status: ParsedCheck['status']): vscode.ThemeIcon {
    switch (status) {
      case 'pass':
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
      case 'fail':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'unsatisfiable':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'pending':
      default:
        return new vscode.ThemeIcon('circle-large-outline');
    }
  }
}

/**
 * Collapsible group node for a branch's `checks.yaml` — the executable
 * acceptance-check ledger derived from the plan's Acceptance Criteria.
 * One `CheckItem` leaf per check. Read-only: check definitions are
 * executor-immutable and `status:` is executor-owned, so the tree offers
 * no mutation affordances and the file is excluded from standalone delete
 * (same reasoning as `plan.md` — see extension.ts `resolveTarget`).
 */
export class ChecksSummaryItem extends vscode.TreeItem {
  public readonly checkItems: CheckItem[];

  constructor(public readonly checksFilePath: string, public readonly checks: ParsedCheck[]) {
    super('Checks', vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('checklist');
    this.checkItems = checks.map((c) => new CheckItem(c, checksFilePath));

    const summary = summarizeChecks(checks);
    const parts: string[] = [formatChecksRollup(summary)];
    if (summary.unsatisfiable > 0) {
      parts.push(`${summary.unsatisfiable} unsatisfiable`);
    } else if (summary.fail > 0) {
      parts.push(`${summary.fail} fail`);
    }
    this.description = parts.filter(Boolean).join(' · ');

    this.tooltip = new vscode.MarkdownString(
      `**Executable acceptance checks** (\`checks.yaml\`)\n\n` +
        `${summary.pass}/${summary.total} passing · ${summary.pending} pending` +
        `${summary.fail > 0 ? ` · ${summary.fail} failing` : ''}` +
        `${summary.unsatisfiable > 0 ? ` · ${summary.unsatisfiable} unsatisfiable` : ''}\n\n` +
        `Statuses are flipped live by the executor's Phase 4 check loop. ` +
        `Check definitions are executor-immutable — this view is read-only.`
    );

    this.contextValue = 'agentChecksFile';
  }
}

/**
 * Leaf node representing one `diagnose-{target}.md` report produced by
 * `/create-skill diagnose <target>`. The label always includes the target
 * skill name (extracted from the filename) so multiple reports under the
 * same branch are distinguishable at a glance. When the report header
 * carries a failure class and / or confidence score, those summarise the
 * row via `description` and a richer tooltip.
 */
export class DiagnoseSummaryItem extends vscode.TreeItem {
  constructor(public readonly info: DiagnoseFileInfo) {
    super(`Diagnose: ${info.targetSkill}`, vscode.TreeItemCollapsibleState.None);

    const lowConfidence =
      info.parsed.applyStatus === 'disabled-low-confidence' ||
      (typeof info.parsed.confidence === 'number' && info.parsed.confidence < 90);

    this.iconPath = new vscode.ThemeIcon(
      'beaker',
      lowConfidence ? new vscode.ThemeColor('charts.yellow') : undefined
    );

    const parts: string[] = [];
    if (info.parsed.failureClass) parts.push(info.parsed.failureClass);
    if (typeof info.parsed.confidence === 'number') {
      parts.push(`${info.parsed.confidence}%`);
    }
    this.description = parts.join(' · ') || undefined;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Diagnose report:** \`${info.targetSkill}\`\n\n`);
    if (info.parsed.summary) {
      md.appendMarkdown(`${info.parsed.summary}\n\n`);
    }
    if (info.parsed.failureClass) {
      md.appendMarkdown(`**Failure class:** ${info.parsed.failureClass}\n\n`);
    }
    if (typeof info.parsed.confidence === 'number') {
      md.appendMarkdown(`**Confidence:** ${info.parsed.confidence}%\n\n`);
    }
    if (info.parsed.applyStatus) {
      md.appendMarkdown(`**Apply status:** ${info.parsed.applyStatus}`);
    }
    this.tooltip = md;

    this.contextValue = 'agentDiagnoseFile';
    this.command = {
      command: 'agentTasks.openMarkdown',
      title: 'Open Diagnose Report',
      arguments: [info.filePath],
    };
  }
}

// ---------------------------------------------------------------------------
// Tree item: OtherMarkdownFileItem
// ---------------------------------------------------------------------------

/**
 * Leaf node for an agent-created `.md` file that is not a recognised artifact
 * (`task.md`, `plan.md`, `walkthrough.md`, `diagnose-*.md`, `plan.v*.md`).
 *
 * Rendered at the BOTTOM of the worktree group, after all recognised branch
 * rows, so the well-known entries always appear first.
 *
 * Label: filename without extension (e.g. `specs`).
 * Description / tooltip: relative subdir path within the configured dir root
 * so `.agent/asdf/de.md` is distinguishable from `.agent/main/de.md`.
 * Click opens the file via `agentTasks.openMarkdown`.
 */
export class OtherMarkdownFileItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    /** Relative path from the configured dir root (e.g. `asdf/de.md`). */
    relPath: string
  ) {
    const filename = path.basename(filePath);
    const label = filename.endsWith('.md') ? filename.slice(0, -3) : filename;
    // Show the containing subdirectory in description for disambiguation.
    const relDir = path.dirname(relPath);
    const description = relDir && relDir !== '.' ? relDir : undefined;

    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('markdown');
    this.description = description;
    this.tooltip = new vscode.MarkdownString(
      `**${filename}**\n\n\`${relPath}\``
    );
    this.contextValue = 'otherMarkdownFile';
    this.command = {
      command: 'agentTasks.openOtherMarkdownFile',
      title: `Open ${filename}`,
      arguments: [{ filePath }],
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
  | OtherMarkdownFileItem
  | TaskGroupItem
  | TaskCheckboxItem
  | TasksSummaryItem
  | PlanSummaryItem
  | PlanVersionsGroupItem
  | PlanVersionItem
  | WalkthroughSummaryItem
  | ChecksSummaryItem
  | CheckItem
  | DiagnoseSummaryItem
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
      const diagnosePaths = findDiagnoseReports(branchDir);
      if (!hasTaskFile && !hasPlanFile && diagnosePaths.length === 0) continue;

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

      const checksPath = path.join(branchDir, 'checks.yaml');
      let checks: ParsedCheck[] = [];
      if (fs.existsSync(checksPath)) {
        try {
          checks = parseChecksYaml(fs.readFileSync(checksPath, 'utf-8')).checks;
          latestMtime = Math.max(latestMtime, fs.statSync(checksPath).mtimeMs);
        } catch {
          // ignore parse / stat errors — a malformed ledger renders nothing
        }
      }

      const diagnoses: DiagnoseFileInfo[] = [];
      for (const dp of diagnosePaths) {
        const targetSkill = diagnoseTargetFromFilename(path.basename(dp));
        if (!targetSkill) continue;
        let parsed: ParsedDiagnose = {};
        try {
          parsed = parseDiagnoseMd(fs.readFileSync(dp, 'utf-8'));
          latestMtime = Math.max(latestMtime, fs.statSync(dp).mtimeMs);
        } catch {
          // ignore parse / stat errors — still surface the file as a row
        }
        diagnoses.push({ filePath: dp, targetSkill, parsed });
      }

      const hasInProgress = task?.taskSections.some((s) => s.items.some((t) => t.inProgress)) ?? false;

      results.push({
        item: new AgentBranchItem(relPath, branchDir, task, plan, hasWalkthrough, diagnoses, checks),
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
 * Recursively find directories containing `task.md`, `plan.md`,
 * `walkthrough.md`, or any `diagnose-*.md` report. Returns relative paths
 * from `dir` — branches whose only artifact is a diagnose report still
 * surface (a user can run `/create-skill diagnose` against a branch that
 * never carried a plan or task).
 */
function findBranchDirs(dir: string, relativePath = ''): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Check if this directory itself has artifacts
    const hasArtifact = entries.some(
      (e) =>
        !e.isDirectory() &&
        (e.name === 'task.md' ||
          e.name === 'plan.md' ||
          e.name === 'walkthrough.md' ||
          /^diagnose-.+\.md$/.test(e.name))
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
 * Collect all "other" `.md` files under each configured artifact root for a
 * worktree, excluding paths already rendered as recognised branch artifacts.
 *
 * Returns `OtherMarkdownFileItem[]` sorted stably by absolute path.
 * Delegates to `collectOtherFilePathsForWorktree` (from `session-artifact-correlator`)
 * for the pure path-collection logic so the walk/exclusion logic has a single
 * source of truth.
 */
function collectOtherFilesForWorktree(
  worktreePath: string,
  configuredDirs: string[],
  branches: BranchItemWithMeta[]
): OtherMarkdownFileItem[] {
  // Build the exclusion set from all recognised artifact paths in the branches.
  const excluded = new Set<string>();
  for (const b of branches) {
    const { artifactDir } = b.item;
    for (const name of ['task.md', 'plan.md', 'walkthrough.md']) {
      excluded.add(path.join(artifactDir, name));
    }
    for (const d of b.item.diagnoses) {
      excluded.add(d.filePath);
    }
    // plan.v*.md — excluded by PLAN_VERSION_PATTERN inside the helper.
  }

  return collectOtherFilePathsForWorktree(worktreePath, configuredDirs, excluded).map(
    ({ absPath, relPath }) => new OtherMarkdownFileItem(absPath, relPath)
  );
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

    // Flattened worktree node (1-branch case): show branch artifacts, then other
    // markdown files that aren't recognized artifacts.
    if (element instanceof WorktreeFlatItem) {
      const branchChildren = this.getBranchChildren(element.branch);
      const otherFiles = this.getOtherFilesForWorktree(element.worktreePath);
      return [...branchChildren, ...otherFiles];
    }

    // Worktree group level: list branches for that worktree, then other files.
    if (element instanceof WorktreeArtifactGroupItem) {
      return this.getWorktreeChildren(element.worktreePath);
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

    // Plan level: show file lists + version history
    if (element instanceof PlanSummaryItem) {
      return this.getPlanChildren(element);
    }

    // Plan versions group: list each historical snapshot
    if (element instanceof PlanVersionsGroupItem) {
      return element.versions;
    }

    // Checks group: one leaf per executable acceptance check
    if (element instanceof ChecksSummaryItem) {
      return element.checkItems;
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
      // Flat list for current worktree only — branches first, then other files.
      const allItems = this.getWorktreeChildren(currentWorktree);

      // Empty-state: current has nothing but other worktrees do.
      if (allItems.length === 0 && allWorktrees.length > 1) {
        const configuredDirs = getConfiguredDirs();
        const otherCount = allWorktrees
          .filter((wt) => wt !== currentWorktree)
          .filter((wt) => {
            const branches = collectBranchesForWorktree(wt, configuredDirs);
            if (branches.length > 0) return true;
            return collectOtherFilesForWorktree(wt, configuredDirs, branches).length > 0;
          }).length;
        if (otherCount > 0) {
          return [new EmptyScopeItem(otherCount)];
        }
      }
      return allItems;
    }

    // scope === 'all': single-worktree stays flat; multi-worktree gets groups

    if (allWorktrees.length <= 1) {
      // Single worktree — flat list, no group wrapper; branches first, then
      // other markdown files.
      return this.getWorktreeChildren(currentWorktree);
    }

    // Multi-worktree: group by worktree, current first
    const configuredDirs = getConfiguredDirs();
    const groups: Array<{ wt: string; branches: BranchItemWithMeta[]; otherCount: number; mtime: number }> = [];

    for (const wt of allWorktrees) {
      const branches = collectBranchesForWorktree(wt, configuredDirs);
      const otherFiles = collectOtherFilesForWorktree(wt, configuredDirs, branches);
      const mtime = branches.reduce((max, b) => Math.max(max, b.mtime), 0);
      groups.push({ wt, branches, otherCount: otherFiles.length, mtime });
    }

    // Show current worktree even when empty; show others that have branches OR
    // other markdown files.
    const visibleGroups = groups.filter(
      (g) => g.wt === currentWorktree || g.branches.length > 0 || g.otherCount > 0
    );

    visibleGroups.sort((a, b) => {
      if (a.wt === currentWorktree) return -1;
      if (b.wt === currentWorktree) return 1;
      return b.mtime - a.mtime;
    });

    return visibleGroups.map((g) => {
      const isCurrent = g.wt === currentWorktree;
      // 1-branch case: flatten — skip the redundant AgentBranchItem level.
      // Other-markdown-only case (0 branches): also use the flat path so the
      // worktree expands to show the files directly without an extra level.
      if (g.branches.length === 1) {
        const sorted = sortBranchItems(g.branches);
        return new WorktreeFlatItem(g.wt, isCurrent, sorted[0].item);
      }
      if (g.branches.length === 0) {
        // Worktree has only other files — show as a group whose children are
        // those files; count = 0 branches is intentional.
        return new WorktreeArtifactGroupItem(g.wt, 0, isCurrent);
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

  /**
   * Compute the "other markdown file" rows for one worktree, excluding paths
   * that are already rendered as recognised branch artifacts.
   *
   * Delegates to the module-level `collectOtherFilesForWorktree` helper so the
   * walk/exclusion logic has a single source of truth.
   */
  private getOtherFilesForWorktree(worktreePath: string): OtherMarkdownFileItem[] {
    const configuredDirs = getConfiguredDirs();
    const branches = collectBranchesForWorktree(worktreePath, configuredDirs);
    return collectOtherFilesForWorktree(worktreePath, configuredDirs, branches);
  }

  /**
   * Return the full sorted child list for a worktree: recognised branch rows
   * first (sorted per `sortBranchItems`), then "other" markdown file rows
   * sorted stably by path.
   *
   * Used by both `getChildren(WorktreeArtifactGroupItem)` and the single-
   * worktree flat-list path in `getRootItems`.
   */
  private getWorktreeChildren(worktreePath: string): AgentTaskTreeItem[] {
    const branches = this.getBranchItemsForWorktree(worktreePath);
    const otherFiles = this.getOtherFilesForWorktree(worktreePath);
    return [...branches, ...otherFiles];
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
      const versions = findPlanVersions(branch.artifactDir);
      children.push(new PlanSummaryItem(branch.plan, planPath, versions));
    }

    // Checks — the plan's executable acceptance contract, statuses flipped
    // live by the executor's Phase 4 loop. Absent file → absent node.
    if (branch.checks.length > 0) {
      const checksPath = path.join(branch.artifactDir, 'checks.yaml');
      children.push(new ChecksSummaryItem(checksPath, branch.checks));
    }

    // Walkthrough
    if (branch.hasWalkthrough) {
      const wtPath = path.join(branch.artifactDir, 'walkthrough.md');
      children.push(new WalkthroughSummaryItem(wtPath));
    }

    // Diagnose reports — one row per `diagnose-{target}.md` produced by
    // `/create-skill diagnose <target>`. Multiple targets can coexist on
    // the same branch, each surfaces independently.
    for (const diagnose of branch.diagnoses) {
      children.push(new DiagnoseSummaryItem(diagnose));
    }

    return children;
  }

  private getPlanChildren(planSummary: PlanSummaryItem): AgentTaskTreeItem[] {
    const children: AgentTaskTreeItem[] = [];
    const plan = planSummary.plan;

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

    // Versioned snapshots — only show the group when at least one
    // `plan.v{N}.md` exists, so older artifact dirs created before
    // versioning was introduced render unchanged.
    if (planSummary.versions.length > 0) {
      const latestVersion = planSummary.versions[planSummary.versions.length - 1].version;
      const versionItems = planSummary.versions.map(
        (v) => new PlanVersionItem(v.version, v.filePath, v.version === latestVersion)
      );
      // Newest first so the most relevant snapshot is at the top of the
      // expanded list — mirrors the conventional commit-history reading
      // order ("what changed most recently?").
      versionItems.reverse();
      children.push(new PlanVersionsGroupItem(versionItems));
    }

    return children;
  }
}
