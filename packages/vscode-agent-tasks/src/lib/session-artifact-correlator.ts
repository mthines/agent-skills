/**
 * Correlate a Claude Code session with the agent-task artifacts that live
 * under its worktree.
 *
 * Pure Node.js — no VS Code dependency — vitest-testable. The provider
 * layer feeds in `(worktreePath, branchName, configuredDirs)` and gets back
 * the absolute paths to whichever of `task.md`, `plan.md`, `walkthrough.md`,
 * and `diagnose-*.md` actually exist on disk under
 * `<worktreePath>/<dir>/<branchName>/`.
 *
 * Correlation key: `(session.cwd → worktreePath, session.gitBranch → branchName)`.
 * `session.cwd` is bucketed to its longest matching worktree by the caller
 * before this is invoked, so siblings with overlapping name prefixes
 * (e.g. `foo` vs `foo-bar`) cannot cross-attribute.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Matches `diagnose-{target-skill}.md` reports written by
 * `/create-skill diagnose <target>`. One file per diagnosed target skill;
 * a branch can carry several.
 */
export const DIAGNOSE_FILE_PATTERN = /^diagnose-(.+)\.md$/;

export interface LinkedArtifacts {
  /** `<worktreePath>/<dir>/<branchName>` for the matching dir, when any artifact was found. */
  artifactDir?: string;
  taskPath?: string;
  planPath?: string;
  walkthroughPath?: string;
  /** Executable acceptance-check ledger (`checks.yaml`) written by aw-create-plan. */
  checksPath?: string;
  /** Absolute paths to every `diagnose-*.md` report found in the branch dir, sorted by filename. */
  diagnosePaths?: string[];
}

/** Lists every `diagnose-*.md` file in `branchDir`, sorted by filename (stable order). */
export function findDiagnoseReports(branchDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(branchDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!DIAGNOSE_FILE_PATTERN.test(entry.name)) continue;
    matches.push(path.join(branchDir, entry.name));
  }
  matches.sort();
  return matches;
}

/** Extracts the `{target}` capture from a `diagnose-{target}.md` filename, or `undefined` if it doesn't match. */
export function diagnoseTargetFromFilename(filename: string): string | undefined {
  const match = DIAGNOSE_FILE_PATTERN.exec(filename);
  return match ? match[1] : undefined;
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
    const checksPath = path.join(branchDir, 'checks.yaml');
    const diagnosePaths = findDiagnoseReports(branchDir);

    const result: LinkedArtifacts = {};
    if (fs.existsSync(taskPath)) result.taskPath = taskPath;
    if (fs.existsSync(planPath)) result.planPath = planPath;
    if (fs.existsSync(walkthroughPath)) result.walkthroughPath = walkthroughPath;
    if (fs.existsSync(checksPath)) result.checksPath = checksPath;
    if (diagnosePaths.length > 0) result.diagnosePaths = diagnosePaths;

    if (
      result.taskPath ||
      result.planPath ||
      result.walkthroughPath ||
      result.checksPath ||
      result.diagnosePaths
    ) {
      result.artifactDir = branchDir;
      return result;
    }
  }

  return {};
}

/** Returns true iff at least one artifact file path is set. */
export function hasLinkedArtifacts(links: LinkedArtifacts): boolean {
  return Boolean(
    links.taskPath ||
      links.planPath ||
      links.walkthroughPath ||
      links.checksPath ||
      (links.diagnosePaths && links.diagnosePaths.length > 0)
  );
}
