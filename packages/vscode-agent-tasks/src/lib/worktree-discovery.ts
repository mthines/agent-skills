/**
 * Shared worktree discovery helpers.
 *
 * These helpers are used by both the Sessions panel and the Agent Tasks
 * panel to enumerate all worktrees belonging to the current repository.
 * They are pure Node.js (no VS Code API) so they can be unit-tested with
 * vitest.
 *
 * Priority order for discovery:
 *   1. gw root + sibling worktrees (gw-aware, walks `.gw/config.json`)
 *   2. `git worktree list --porcelain` fallback
 *   3. Just the workspace path (single-worktree / non-git)
 */

import * as path from 'path';
import * as fs from 'fs';
import * as child_process from 'child_process';

/**
 * Walk up from `startPath` up to `maxLevels` looking for a `.gw/config.json`.
 * Returns the directory containing `.gw/` (the gw root) or null.
 * We use the directory itself rather than any `root` field because real gw
 * configs don't always store `root`.
 */
export function findGwRoot(startPath: string, maxLevels = 5): string | null {
  let dir = startPath;
  for (let i = 0; i < maxLevels; i++) {
    const configPath = path.join(dir, '.gw', 'config.json');
    try {
      if (fs.statSync(configPath).isFile()) return dir;
    } catch {
      // not found, continue
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Enumerate worktree paths under a gw root by scanning subdirectories that
 * contain a `.git` *file* (worktree marker) — not a `.git` directory which
 * would be the bare repo itself.
 * Recurses one level for the `feat/<branch>` convention.
 */
export function getWorktreePathsFromGw(workspacePath: string): string[] | null {
  const root = findGwRoot(workspacePath);
  if (!root) return null;

  const paths: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.gw' || entry.name.startsWith('.')) continue;
      const sub = path.join(dir, entry.name);
      const gitPath = path.join(sub, '.git');
      try {
        const stat = fs.statSync(gitPath);
        if (stat.isFile()) {
          paths.push(sub);
          continue; // don't recurse into a worktree
        }
      } catch {
        // no .git here; recurse to find nested worktrees (e.g. feat/x)
      }
      visit(sub, depth + 1);
    }
  };

  visit(root, 0);
  return paths.length > 0 ? paths : null;
}

/**
 * Enumerate worktree paths via `git worktree list --porcelain`.
 * Returns null if the command fails (not a git repo, git missing, etc.).
 */
export function getWorktreePathsFromGit(workspacePath: string): string[] | null {
  try {
    const output = child_process.execSync('git worktree list --porcelain', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 3000,
    });

    const paths: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length).trim());
      }
    }
    return paths.length > 0 ? paths : null;
  } catch {
    return null;
  }
}

/**
 * Return the deduplicated list of worktree paths for the workspace.
 * Always includes the workspace path itself.
 *
 * Priority:
 *   1. gw root + sibling worktrees (gw-aware)
 *   2. `git worktree list --porcelain` fallback
 *   3. Just the workspace path (single-worktree / non-git)
 */
export function discoverWorktreePaths(workspacePath: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  const add = (p: string) => {
    const normalised = p.replace(/[/\\]+$/, '');
    if (!seen.has(normalised)) {
      seen.add(normalised);
      paths.push(normalised);
    }
  };

  const gwPaths = getWorktreePathsFromGw(workspacePath);
  if (gwPaths) {
    for (const p of gwPaths) add(p);
    add(workspacePath);
    return paths;
  }

  const gitPaths = getWorktreePathsFromGit(workspacePath);
  if (gitPaths) {
    for (const p of gitPaths) add(p);
    add(workspacePath);
    return paths;
  }

  add(workspacePath);
  return paths;
}
