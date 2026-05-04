/**
 * Unit tests for lib/plan-versions.ts.
 *
 * Uses real temporary directories to match the project's existing test
 * pattern (vitest + ESM cannot reliably mock `fs`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findPlanVersions } from './plan-versions';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-versions-test-'));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

describe('findPlanVersions', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
  });
  afterEach(() => rmTmp(tmp));

  it('returns empty when the directory does not exist', () => {
    expect(findPlanVersions(path.join(tmp, 'missing'))).toEqual([]);
  });

  it('returns empty when the directory is empty', () => {
    expect(findPlanVersions(tmp)).toEqual([]);
  });

  it('returns empty when the directory only contains plan.md', () => {
    touch(path.join(tmp, 'plan.md'));
    touch(path.join(tmp, 'task.md'));
    expect(findPlanVersions(tmp)).toEqual([]);
  });

  it('discovers a single plan.v1.md', () => {
    touch(path.join(tmp, 'plan.md'));
    touch(path.join(tmp, 'plan.v1.md'));
    const result = findPlanVersions(tmp);
    expect(result).toHaveLength(1);
    expect(result[0].version).toBe(1);
    expect(result[0].filePath).toBe(path.join(tmp, 'plan.v1.md'));
  });

  it('returns versions sorted ascending', () => {
    // Created out of order to confirm sort, not file-system enumeration order
    touch(path.join(tmp, 'plan.v3.md'));
    touch(path.join(tmp, 'plan.v1.md'));
    touch(path.join(tmp, 'plan.v2.md'));
    const result = findPlanVersions(tmp);
    expect(result.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('handles double-digit versions correctly (no lexicographic mishap)', () => {
    touch(path.join(tmp, 'plan.v9.md'));
    touch(path.join(tmp, 'plan.v10.md'));
    touch(path.join(tmp, 'plan.v11.md'));
    const result = findPlanVersions(tmp);
    expect(result.map((v) => v.version)).toEqual([9, 10, 11]);
  });

  it('ignores files that do not match the plan.vN.md pattern', () => {
    touch(path.join(tmp, 'plan.v1.md'));
    touch(path.join(tmp, 'plan.v2.md'));
    touch(path.join(tmp, 'plan.md'));
    touch(path.join(tmp, 'planv1.md')); // missing dot
    touch(path.join(tmp, 'plan.v.md')); // missing number
    touch(path.join(tmp, 'plan.v1.txt')); // wrong extension
    touch(path.join(tmp, 'walkthrough.md'));
    touch(path.join(tmp, 'plan.v0.md')); // zero is not a valid version
    const result = findPlanVersions(tmp);
    expect(result.map((v) => v.version)).toEqual([1, 2]);
  });

  it('skips directories named like plan versions', () => {
    // `readdirSync({ withFileTypes: true })` returns Dirent objects which
    // expose `isFile()` / `isDirectory()` without a separate stat call —
    // so directories that happen to match the version pattern are filtered
    // out at zero additional syscall cost.
    fs.mkdirSync(path.join(tmp, 'plan.v1.md'), { recursive: true });
    touch(path.join(tmp, 'plan.v2.md'));
    const result = findPlanVersions(tmp);
    expect(result.map((v) => v.version)).toEqual([2]);
  });

  it('returns absolute file paths', () => {
    touch(path.join(tmp, 'plan.v1.md'));
    const [v] = findPlanVersions(tmp);
    expect(path.isAbsolute(v.filePath)).toBe(true);
    expect(v.filePath).toBe(path.join(tmp, 'plan.v1.md'));
  });
});
