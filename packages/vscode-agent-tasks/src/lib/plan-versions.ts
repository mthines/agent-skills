/**
 * Plan-version discovery helpers.
 *
 * The `aw-create-plan` skill writes `plan.md` (latest pointer) plus an
 * immutable `plan.v{N}.md` snapshot on every invocation. This module is the
 * read-side decoder: given a branch directory, list the snapshots in version
 * order so the VS Code tree can render them.
 *
 * Pure Node.js — NO VS Code dependency, vitest-testable.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Discovered metadata about a `plan.v{N}.md` snapshot in a branch directory.
 * Sorted ascending by `version` so callers can pick the latest with
 * `versions[versions.length - 1]`.
 */
export interface PlanVersionInfo {
  version: number;
  filePath: string;
}

/**
 * List `plan.v{N}.md` snapshots in `branchDir`, sorted ascending by version.
 *
 * Returns `[]` when the directory cannot be read (e.g. it doesn't exist) or
 * contains no snapshots. Older artifact dirs created before plan versioning
 * was introduced — and dirs that only contain `plan.md` — both produce `[]`,
 * which keeps callers simple.
 */
export function findPlanVersions(branchDir: string): PlanVersionInfo[] {
  let entries: fs.Dirent[];
  try {
    // `withFileTypes: true` returns Dirent objects which carry the
    // file/directory bit without an extra `statSync` per entry — so we can
    // filter out directories whose names happen to match `plan.v*.md` at
    // zero additional syscall cost.
    entries = fs.readdirSync(branchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const versions: PlanVersionInfo[] = [];
  const re = /^plan\.v(\d+)\.md$/;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = re.exec(entry.name);
    if (!match) continue;
    const version = Number.parseInt(match[1], 10);
    if (!Number.isFinite(version) || version <= 0) continue;
    versions.push({ version, filePath: path.join(branchDir, entry.name) });
  }
  versions.sort((a, b) => a.version - b.version);
  return versions;
}
