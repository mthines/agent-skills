/**
 * Correlate a Claude Code session with the agent-task artifacts that live
 * under its worktree.
 *
 * Pure Node.js — no VS Code dependency — vitest-testable. The provider
 * layer feeds in `(worktreePath, branchName, configuredDirs)` and gets back
 * the absolute paths to whichever of `task.md`, `plan.md`, `walkthrough.md`,
 * `diagnose-*.md`, and any other `.md` files actually exist on disk.
 *
 * Known artifacts (`task.md`, `plan.md`, `walkthrough.md`, `diagnose-*.md`)
 * are scoped to `<worktreePath>/<dir>/<branchName>/`.
 *
 * "Other" markdown files (`otherMarkdownPaths`) are discovered repo-wide —
 * any `.md` file found anywhere under `<worktreePath>/<dir>/` (recursively,
 * any subdirectory) that is not a known artifact, plan snapshot, or diagnose
 * report is surfaced. This lets files like `.agent/asdf/de.md` appear in the
 * Sessions panel even when `asdf` is not the current branch name.
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
   * Absolute paths to every `.md` file found anywhere under the configured
   * agent dir (e.g. `.agent/`) that is not a recognised artifact
   * (`task.md`, `plan.md`, `walkthrough.md`), not a versioned plan snapshot
   * (`plan.v*.md`), and not a `diagnose-*.md` report.
   * Discovery is repo-wide (all subdirectories, recursively) — not limited to
   * the branch-named subdirectory — so files like `.agent/asdf/de.md` are
   * surfaced even when the current branch is `main`.
   * Sorted by absolute path. Surfaced at the bottom of the artifact list so
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

/**
 * Maximum directory depth for the repo-wide other-markdown scan.
 * Prevents runaway recursion on pathological or deeply-nested trees.
 */
const MAX_OTHER_MD_DEPTH = 10;

/**
 * Recursively collects every `.md` file under `rootDir` that is not a known
 * artifact, plan snapshot, or diagnose report — and whose absolute path is not
 * in `excludedPaths`.
 *
 * Used by `findLinkedArtifacts` to surface "other" markdown files from ALL
 * subdirectories of a configured agent dir (e.g. `.agent/asdf/de.md` when the
 * current branch is `main`), not just the branch-named subdirectory.
 *
 * Gracefully returns `[]` if `rootDir` does not exist or cannot be read.
 * Caps recursion at `MAX_OTHER_MD_DEPTH` to guard against pathological trees.
 */
export function collectOtherMarkdownFilesRecursively(
  rootDir: string,
  excludedPaths: ReadonlySet<string>,
  depth = 0
): string[] {
  if (depth > MAX_OTHER_MD_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...collectOtherMarkdownFilesRecursively(fullPath, excludedPaths, depth + 1));
    } else if (entry.isFile()) {
      if (!entry.name.endsWith('.md')) continue;
      if (KNOWN_ARTIFACT_FILENAMES.has(entry.name)) continue;
      if (PLAN_VERSION_PATTERN.test(entry.name)) continue;
      if (DIAGNOSE_FILE_PATTERN.test(entry.name)) continue;
      if (excludedPaths.has(fullPath)) continue;
      matches.push(fullPath);
    }
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
 *   → scoped to `<worktreePath>/<dir>/<branchName>/`
 *
 * "Other" markdown files (surfaced last):
 *   any `.md` file found anywhere under `<worktreePath>/<dir>/` (recursively)
 *   that is not a known artifact, plan snapshot, or diagnose report.
 *   This includes files under subdirectories whose name is NOT the current
 *   branch (e.g. `.agent/asdf/de.md` when the branch is `main`).
 *
 * Returns `{}` when:
 *   - `worktreePath` or `branchName` is missing/empty
 *   - none of the configured dirs contain any recognised artifact or other `.md` file
 */
export function findLinkedArtifacts(
  worktreePath: string | undefined,
  branchName: string | undefined,
  configuredDirs: string[]
): LinkedArtifacts {
  if (!worktreePath || !branchName) return {};

  for (const dir of configuredDirs) {
    const agentDirRoot = path.join(worktreePath, dir);
    const branchDir = path.join(agentDirRoot, branchName);

    // Resolve known (branch-scoped) artifacts first.
    const result: LinkedArtifacts = {};
    let branchDirExists = false;
    try {
      branchDirExists = fs.statSync(branchDir).isDirectory();
    } catch {
      // branchDir absent — still scan agentDirRoot for other-markdown files below.
    }

    if (branchDirExists) {
      const taskPath = path.join(branchDir, 'task.md');
      const planPath = path.join(branchDir, 'plan.md');
      const walkthroughPath = path.join(branchDir, 'walkthrough.md');
      const diagnosePaths = findDiagnoseReports(branchDir);
      if (fs.existsSync(taskPath)) result.taskPath = taskPath;
      if (fs.existsSync(planPath)) result.planPath = planPath;
      if (fs.existsSync(walkthroughPath)) result.walkthroughPath = walkthroughPath;
      if (diagnosePaths.length > 0) result.diagnosePaths = diagnosePaths;
    }

    // Build the exclusion set: absolute paths already covered by known-artifact slots.
    // Files in this set must not appear a second time in otherMarkdownPaths.
    const excludedPaths = new Set<string>([
      ...(result.taskPath ? [result.taskPath] : []),
      ...(result.planPath ? [result.planPath] : []),
      ...(result.walkthroughPath ? [result.walkthroughPath] : []),
      ...(result.diagnosePaths ?? []),
    ]);

    // Scan all subdirectories under the configured dir root for other markdown files.
    const otherMarkdownPaths = collectOtherMarkdownFilesRecursively(agentDirRoot, excludedPaths);
    if (otherMarkdownPaths.length > 0) result.otherMarkdownPaths = otherMarkdownPaths;

    if (
      result.taskPath ||
      result.planPath ||
      result.walkthroughPath ||
      result.diagnosePaths ||
      result.otherMarkdownPaths
    ) {
      // artifactDir points at the branch-scoped dir when it exists; otherwise
      // at the configured dir root (the closest meaningful anchor we have).
      result.artifactDir = branchDirExists ? branchDir : agentDirRoot;
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
