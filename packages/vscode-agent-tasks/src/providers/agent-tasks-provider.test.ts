/**
 * Unit tests for the "other markdown file" discovery logic in agent-tasks-provider.
 *
 * Strategy: `agent-tasks-provider.ts` imports `vscode` (not available in vitest).
 * We test the exported pure helper `collectOtherFilePathsForWorktree`, which
 * contains all the path-collection logic with no VS Code dependency.
 *
 * Required coverage (per CLAUDE.md spec):
 *   1. A worktree with `.agent/asdf/de.md` and branch `main` surfaces `de.md`
 *      as an other-file row under that worktree.
 *   2. Recognised artifacts are NOT duplicated into the other-file list.
 *   3. A worktree whose ONLY content is an other `.md` file still shows that
 *      file (no false "empty" suppression).
 *   4. Ordering puts other files LAST — recognised branches are surfaced first,
 *      other files sort stably by path below them.
 *
 * TreeItem shape contract (cannot be tested in vitest due to vscode dependency):
 *   - `OtherMarkdownFileItem.contextValue` MUST be `'otherMarkdownFile'`.
 *   - `OtherMarkdownFileItem.command.command` MUST be `'agentTasks.openMarkdown'`.
 *   - `LinkedArtifactItem` instances created for `otherMarkdownPaths` in
 *     `sessions-provider.ts` MUST use `contextValueOverride = 'otherMarkdownFile'`.
 *   These constants enable the `view/item/context` menu entries in package.json
 *   to fire `agentTasks.openOtherMarkdownFile` on right-click in both trees.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { collectOtherFilePathsForWorktree } from '../lib/session-artifact-correlator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atp-test-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function setup(structure: Record<string, string>): string {
  const wt = fs.mkdtempSync(path.join(tmpRoot, 'wt-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(wt, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return wt;
}

// ---------------------------------------------------------------------------
// Scenario 1 — cross-subdirectory discovery
// A worktree with .agent/asdf/de.md and no recognized branch artifacts must
// surface de.md as an other-file row.
// ---------------------------------------------------------------------------

describe('collectOtherFilePathsForWorktree — cross-subdir discovery', () => {
  it('surfaces .agent/asdf/de.md when there are no recognized branches', () => {
    // Scenario matches the user report: branch is `main`, but the file lives
    // under an unrelated subdirectory `asdf`.
    const wt = setup({ '.agent/asdf/de.md': '# notes' });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(1);
    expect(result[0].absPath).toBe(path.join(wt, '.agent', 'asdf', 'de.md'));
    // relPath is relative to the configured dir root (.agent/).
    expect(result[0].relPath).toBe(path.join('asdf', 'de.md'));
  });

  it('surfaces files from multiple cross-branch subdirectories together', () => {
    const wt = setup({
      '.agent/asdf/de.md': '# de',
      '.agent/other-branch/notes.md': '# notes',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(2);
    // Sorted by absolute path — asdf comes before other-branch lexically.
    expect(result[0].absPath).toBe(path.join(wt, '.agent', 'asdf', 'de.md'));
    expect(result[1].absPath).toBe(path.join(wt, '.agent', 'other-branch', 'notes.md'));
  });

  it('returns relPath relative to the configured dir (not worktreePath)', () => {
    const wt = setup({ '.agent/main/specs.md': '# specs' });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result[0].relPath).toBe(path.join('main', 'specs.md'));
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — no duplication of recognised artifacts
// Files that are already rendered as known artifacts must NOT also appear in
// the other-file list.
// ---------------------------------------------------------------------------

describe('collectOtherFilePathsForWorktree — exclusion of recognised artifacts', () => {
  it('excludes task.md, plan.md, walkthrough.md by filename pattern', () => {
    // The helper uses `KNOWN_ARTIFACT_FILENAMES` internally — these are always
    // excluded regardless of directory, even without passing them in the set.
    const wt = setup({
      '.agent/main/task.md': '# task',
      '.agent/main/plan.md': '# plan',
      '.agent/main/walkthrough.md': '# walk',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(0);
  });

  it('excludes diagnose-*.md reports by filename pattern', () => {
    const wt = setup({
      '.agent/asdf/diagnose-fix-bug.md': '# diag',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(0);
  });

  it('excludes plan.v*.md snapshots by filename pattern', () => {
    const wt = setup({
      '.agent/asdf/plan.v1.md': '# snap',
      '.agent/asdf/plan.v2.md': '# snap2',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(0);
  });

  it('excludes paths explicitly passed in the caller-supplied exclusion set', () => {
    // This mirrors the provider: it passes the absolute paths of plan.md,
    // task.md etc. from each discovered branch into the exclusion set.
    const wt = setup({
      '.agent/main/plan.md': '# plan',
      '.agent/main/specs.md': '# specs',
      '.agent/asdf/de.md': '# de',
    });

    // Simulate the branch having surfaced plan.md as a recognised artifact.
    const planPath = path.join(wt, '.agent', 'main', 'plan.md');
    const excluded = new Set([planPath]);

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], excluded);

    // plan.md is excluded; specs.md and de.md are not.
    const absPaths = result.map((r) => r.absPath);
    expect(absPaths).not.toContain(planPath);
    expect(absPaths).toContain(path.join(wt, '.agent', 'main', 'specs.md'));
    expect(absPaths).toContain(path.join(wt, '.agent', 'asdf', 'de.md'));
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — other-only worktree is not suppressed
// A worktree whose ONLY content under the configured dir is an "other" .md
// file must still produce a result (no false "empty" / zero-count suppression).
// ---------------------------------------------------------------------------

describe('collectOtherFilePathsForWorktree — other-only worktree', () => {
  it('returns the file when the worktree has ONLY an other .md file', () => {
    // This is the canonical bug scenario: .agent/asdf/de.md with no task.md,
    // plan.md, walkthrough.md, or diagnose-*.md anywhere.
    const wt = setup({ '.agent/asdf/de.md': '# only file' });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(1);
    expect(result[0].absPath).toBe(path.join(wt, '.agent', 'asdf', 'de.md'));
  });

  it('returns empty array when the configured dir does not exist', () => {
    const wt = setup({});
    // No .agent/ directory at all — must not throw.
    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(0);
  });

  it('returns empty array when the configured dir is empty', () => {
    const wt = setup({});
    fs.mkdirSync(path.join(wt, '.agent'), { recursive: true });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — ordering: other files last, sorted stably by path
// Recognized branches always appear before other-file rows.  Within the
// other-file list itself, entries are sorted stably by absolute path.
// ---------------------------------------------------------------------------

describe('collectOtherFilePathsForWorktree — stable sort by path', () => {
  it('sorts other files by absolute path ascending', () => {
    const wt = setup({
      '.agent/zzz/notes.md': '# z',
      '.agent/aaa/b.md': '# b',
      '.agent/aaa/a.md': '# a',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent'], new Set());

    expect(result.map((r) => r.absPath)).toEqual([
      path.join(wt, '.agent', 'aaa', 'a.md'),
      path.join(wt, '.agent', 'aaa', 'b.md'),
      path.join(wt, '.agent', 'zzz', 'notes.md'),
    ]);
  });

  it('aggregates files from multiple configured dirs in sorted order', () => {
    const wt = setup({
      '.agent/asdf/b.md': '# b',
      '.gw/other/a.md': '# a',
    });

    const result = collectOtherFilePathsForWorktree(wt, ['.agent', '.gw'], new Set());

    // Both files surface; sorted by absolute path (which puts .agent before .gw
    // since '.' + 'a' < '.' + 'g').
    const absPaths = result.map((r) => r.absPath);
    expect(absPaths).toContain(path.join(wt, '.agent', 'asdf', 'b.md'));
    expect(absPaths).toContain(path.join(wt, '.gw', 'other', 'a.md'));
    // Both paths are present and the result is sorted.
    expect(absPaths).toEqual([...absPaths].sort());
  });
});
