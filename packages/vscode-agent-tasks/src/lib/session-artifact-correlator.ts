/**
 * Correlate a Claude Code session with the agent-task artifacts that live
 * under its worktree.
 *
 * Pure Node.js — no VS Code dependency — vitest-testable. The provider
 * layer feeds in `(worktreePath, branchName, configuredDirs)` and gets back
 * the absolute paths to whichever of `task.md`, `plan.md`, `walkthrough.md`,
 * `diagnose-*.md`, and any other `.md` files actually exist on disk under
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

/**
 * The set of well-known filenames that `findLinkedArtifacts` recognises and
 * surfaces in dedicated slots. Any `.md` file in the branch dir that does NOT
 * match one of these (and is not a `plan.v*.md` snapshot or `diagnose-*.md`
 * report) is collected as an "other" markdown file and surfaced at the bottom
 * of the artifact list in the Sessions panel.
 */
const KNOWN_ARTIFACT_FILENAMES = new Set(['task.md', 'plan.md', 'walkthrough.md']);

/**
 * Matches versioned plan snapshots (`plan.v1.md`, `plan.v2.md`, …) written by
 * `aw-create-plan`. These are shown in the Agent Tasks panel under a
 * "Previous Versions" group; they are excluded from the "other" markdown list
 * to avoid duplicate surfacing.
 */
const PLAN_VERSION_PATTERN = /^plan\.v\d+\.md$/;

export interface LinkedArtifacts {
  /** `<worktreePath>/<dir>/<branchName>` for the matching dir, when any artifact was found. */
  artifactDir?: string;
  taskPath?: string;
  planPath?: string;
  walkthroughPath?: string;
  /** Absolute paths to every `diagnose-*.md` report found in the branch dir, sorted by filename. */
  diagnosePaths?: string[];
  /**
   * Absolute paths to every other `.md` file in the branch dir that is not a
   * recognised artifact (`task.md`, `plan.md`, `walkthrough.md`), not a
   * versioned plan snapshot (`plan.v*.md`), and not a `diagnose-*.md` report.
   * Sorted by filename. Surfaced at the bottom of the artifact list so
   * known/recognised entries always appear first.
   */
  otherMarkdownPaths?: string[];
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

/**
 * Lists every `.md` file in `branchDir` that is not a known artifact
 * (`task.md`, `plan.md`, `walkthrough.md`), not a versioned plan snapshot
 * (`plan.v*.md`), and not a `diagnose-*.md` report. Sorted by filename.
 *
 * These are "other" markdown files — additional outputs that agents may write
 * (e.g. `specs.md`, `notes.md`) that the extension does not recognise
 * explicitly but still wants to surface so the user can open them from the
 * Sessions panel.
 */
export function findOtherMarkdownFiles(branchDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(branchDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    if (KNOWN_ARTIFACT_FILENAMES.has(entry.name)) continue;
    if (PLAN_VERSION_PATTERN.test(entry.name)) continue;
    if (DIAGNOSE_FILE_PATTERN.test(entry.name)) continue;
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
 * that contains at least one recognised artifact or other `.md` file.
 *
 * "Recognised" artifacts (surfaced first in the Sessions panel):
 *   `task.md`, `plan.md`, `walkthrough.md`, `diagnose-*.md`
 *
 * "Other" markdown files (surfaced last):
 *   any remaining `.md` file that is not a versioned plan snapshot (`plan.v*.md`)
 *
 * Returns `{}` when:
 *   - `worktreePath` or `branchName` is missing/empty
 *   - none of the candidate `<worktreePath>/<dir>/<branchName>/` directories
 *     exist or contain any `.md` artifacts
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
    const diagnosePaths = findDiagnoseReports(branchDir);
    const otherMarkdownPaths = findOtherMarkdownFiles(branchDir);

    const result: LinkedArtifacts = {};
    if (fs.existsSync(taskPath)) result.taskPath = taskPath;
    if (fs.existsSync(planPath)) result.planPath = planPath;
    if (fs.existsSync(walkthroughPath)) result.walkthroughPath = walkthroughPath;
    if (diagnosePaths.length > 0) result.diagnosePaths = diagnosePaths;
    if (otherMarkdownPaths.length > 0) result.otherMarkdownPaths = otherMarkdownPaths;

    if (
      result.taskPath ||
      result.planPath ||
      result.walkthroughPath ||
      result.diagnosePaths ||
      result.otherMarkdownPaths
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
      (links.diagnosePaths && links.diagnosePaths.length > 0) ||
      (links.otherMarkdownPaths && links.otherMarkdownPaths.length > 0)
  );
}
