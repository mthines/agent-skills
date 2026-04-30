/**
 * Correlate a Claude Code session with the agent-task artifacts that live
 * under its worktree.
 *
 * Pure Node.js — no VS Code dependency — vitest-testable. The provider
 * layer feeds in `(worktreePath, branchName, configuredDirs)` and gets back
 * the absolute paths to whichever of `task.md`, `plan.md`, and
 * `walkthrough.md` actually exist on disk under
 * `<worktreePath>/<dir>/<branchName>/`.
 *
 * Correlation key: `(session.cwd → worktreePath, session.gitBranch → branchName)`.
 * `session.cwd` is bucketed to its longest matching worktree by the caller
 * before this is invoked, so siblings with overlapping name prefixes
 * (e.g. `foo` vs `foo-bar`) cannot cross-attribute.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LinkedArtifacts {
  /** `<worktreePath>/<dir>/<branchName>` for the matching dir, when any artifact was found. */
  artifactDir?: string;
  taskPath?: string;
  planPath?: string;
  walkthroughPath?: string;
}

/**
 * Find artifact files associated with a session via its `(worktree, branch)`
 * pair. Iterates `configuredDirs` in order and returns the first directory
 * that contains at least one of `task.md`, `plan.md`, or `walkthrough.md`.
 *
 * Returns `{}` when:
 *   - `worktreePath` or `branchName` is missing/empty
 *   - none of the candidate `<worktreePath>/<dir>/<branchName>/` directories
 *     exist or contain artifacts
 */
export function findLinkedArtifacts(
  worktreePath: string | undefined,
  branchName: string | undefined,
  configuredDirs: string[]
): LinkedArtifacts {
  if (!worktreePath || !branchName) return {};

  for (const dir of configuredDirs) {
    const branchDir = path.join(worktreePath, dir, branchName);
    let isDir = false;
    try {
      isDir = fs.statSync(branchDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const taskPath = path.join(branchDir, 'task.md');
    const planPath = path.join(branchDir, 'plan.md');
    const walkthroughPath = path.join(branchDir, 'walkthrough.md');

    const result: LinkedArtifacts = {};
    if (fs.existsSync(taskPath)) result.taskPath = taskPath;
    if (fs.existsSync(planPath)) result.planPath = planPath;
    if (fs.existsSync(walkthroughPath)) result.walkthroughPath = walkthroughPath;

    if (result.taskPath || result.planPath || result.walkthroughPath) {
      result.artifactDir = branchDir;
      return result;
    }
  }

  return {};
}

/** Returns true iff at least one artifact file path is set. */
export function hasLinkedArtifacts(links: LinkedArtifacts): boolean {
  return Boolean(links.taskPath || links.planPath || links.walkthroughPath);
}
