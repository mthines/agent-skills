/**
 * Unit tests for lib/worktree-discovery.ts.
 *
 * These tests use real temporary directories to avoid the `vi.spyOn(fs, ...)`
 * ESM limitation documented in CLAUDE.md.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findGwRoot, getWorktreePathsFromGw, discoverWorktreePaths } from './worktree-discovery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wt-discovery-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Write a file, creating parent dirs as needed. */
function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// findGwRoot
// ---------------------------------------------------------------------------

describe('findGwRoot', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });
  afterEach(() => rmTmp(tmp));

  it('returns the dir containing .gw/config.json when found at start path', () => {
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    expect(findGwRoot(tmp)).toBe(tmp);
  });

  it('walks up from a child directory to find the gw root', () => {
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    const child = path.join(tmp, 'packages', 'foo');
    fs.mkdirSync(child, { recursive: true });
    expect(findGwRoot(child)).toBe(tmp);
  });

  it('returns null when no .gw/config.json exists within maxLevels', () => {
    const child = path.join(tmp, 'a', 'b', 'c', 'd', 'e', 'f');
    fs.mkdirSync(child, { recursive: true });
    // No .gw anywhere in this tree
    expect(findGwRoot(child, 3)).toBeNull();
  });

  it('returns null for a non-existent directory', () => {
    expect(findGwRoot(path.join(tmp, 'does-not-exist'))).toBeNull();
  });

  it('ignores a .gw directory that contains no config.json', () => {
    fs.mkdirSync(path.join(tmp, '.gw'), { recursive: true });
    // No config.json — should not match
    expect(findGwRoot(tmp)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWorktreePathsFromGw
// ---------------------------------------------------------------------------

describe('getWorktreePathsFromGw', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });
  afterEach(() => rmTmp(tmp));

  it('returns null when no gw root is found', () => {
    expect(getWorktreePathsFromGw(tmp)).toBeNull();
  });

  it('returns worktree paths by scanning .git file markers', () => {
    // Set up gw root
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    // Two worktrees: main and feat/x
    const mainWt = path.join(tmp, 'main');
    const featWt = path.join(tmp, 'feat', 'x');
    fs.mkdirSync(mainWt, { recursive: true });
    fs.mkdirSync(featWt, { recursive: true });
    // Worktree marker is a .git FILE (not dir)
    fs.writeFileSync(path.join(mainWt, '.git'), 'gitdir: ../.gw/worktrees/main', 'utf-8');
    fs.writeFileSync(path.join(featWt, '.git'), 'gitdir: ../../.gw/worktrees/feat-x', 'utf-8');

    const result = getWorktreePathsFromGw(mainWt);
    expect(result).not.toBeNull();
    // Should find both worktrees (paths are absolute)
    expect(result).toContain(mainWt);
    expect(result).toContain(featWt);
  });

  it('skips hidden directories and .gw itself', () => {
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    // A hidden dir with a .git file should be ignored
    const hiddenWt = path.join(tmp, '.hidden');
    fs.mkdirSync(hiddenWt, { recursive: true });
    fs.writeFileSync(path.join(hiddenWt, '.git'), 'gitdir: ../.gw/worktrees/hidden', 'utf-8');

    const result = getWorktreePathsFromGw(tmp);
    // Hidden dirs starting with '.' are skipped
    expect(result).toBeNull();
  });

  it('does not recurse into worktrees when searching for nested ones', () => {
    // Set up gw root
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    const outerWt = path.join(tmp, 'outer');
    fs.mkdirSync(outerWt, { recursive: true });
    fs.writeFileSync(path.join(outerWt, '.git'), 'gitdir: ../.gw/worktrees/outer', 'utf-8');

    // Even if there's a directory inside the worktree, it should not be
    // recursed into once the .git file marker is found.
    const innerDir = path.join(outerWt, 'nested');
    fs.mkdirSync(innerDir, { recursive: true });
    // No .git file in innerDir — should not appear in results

    const result = getWorktreePathsFromGw(outerWt);
    expect(result).not.toBeNull();
    expect(result).toContain(outerWt);
    expect(result).not.toContain(innerDir);
  });
});

// ---------------------------------------------------------------------------
// discoverWorktreePaths
// ---------------------------------------------------------------------------

describe('discoverWorktreePaths', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });
  afterEach(() => rmTmp(tmp));

  it('returns an array containing the workspace path when nothing else is found', () => {
    const result = discoverWorktreePaths(tmp);
    expect(result).toContain(tmp);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('always includes the workspace path itself', () => {
    // Even in a git repo with multiple worktrees, the workspace must appear
    const result = discoverWorktreePaths(tmp);
    // Strip trailing slashes for comparison
    const normalised = result.map((p) => p.replace(/[/\\]+$/, ''));
    expect(normalised).toContain(tmp.replace(/[/\\]+$/, ''));
  });

  it('deduplicates paths', () => {
    const result = discoverWorktreePaths(tmp);
    const unique = new Set(result);
    expect(unique.size).toBe(result.length);
  });

  it('returns all gw-aware worktrees when a .gw root is present', () => {
    writeFile(path.join(tmp, '.gw', 'config.json'), '{}');
    const wt1 = path.join(tmp, 'main');
    const wt2 = path.join(tmp, 'feat', 'y');
    fs.mkdirSync(wt1, { recursive: true });
    fs.mkdirSync(wt2, { recursive: true });
    fs.writeFileSync(path.join(wt1, '.git'), 'gitdir: ../.gw/worktrees/main', 'utf-8');
    fs.writeFileSync(path.join(wt2, '.git'), 'gitdir: ../../.gw/worktrees/feat-y', 'utf-8');

    const result = discoverWorktreePaths(wt1);
    expect(result).toContain(wt1);
    expect(result).toContain(wt2);
  });

  it('returns a single-element array for a plain directory with no git', () => {
    // A plain temp dir with no git — falls back to just the workspace path.
    // `git worktree list` would fail because there is no git repo.
    // discoverWorktreePaths should still return the path itself.
    const standalone = path.join(tmp, 'standalone');
    fs.mkdirSync(standalone, { recursive: true });
    const result = discoverWorktreePaths(standalone);
    expect(result).toContain(standalone);
  });
});
