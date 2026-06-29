import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  diagnoseTargetFromFilename,
  findDiagnoseReports,
  findLinkedArtifacts,
  findOtherMarkdownFiles,
  hasLinkedArtifacts,
} from './session-artifact-correlator';

describe('findLinkedArtifacts', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sac-test-'));
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

  it('returns empty when worktreePath is undefined', () => {
    expect(findLinkedArtifacts(undefined, 'feat/x', ['.agent'])).toEqual({});
  });

  it('returns empty when branchName is undefined', () => {
    const wt = setup({});
    expect(findLinkedArtifacts(wt, undefined, ['.agent'])).toEqual({});
  });

  it('returns empty when no artifact dirs exist', () => {
    const wt = setup({});
    expect(findLinkedArtifacts(wt, 'feat/x', ['.agent', '.gw'])).toEqual({});
  });

  it('returns empty when artifact dir exists but contains no .md files', () => {
    const wt = setup({});
    fs.mkdirSync(path.join(wt, '.agent', 'feat', 'x'), { recursive: true });
    expect(findLinkedArtifacts(wt, 'feat/x', ['.agent'])).toEqual({});
  });

  it('finds plan.md only', () => {
    const wt = setup({ '.agent/feat/x/plan.md': '# plan' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.planPath).toBe(path.join(wt, '.agent', 'feat', 'x', 'plan.md'));
    expect(result.taskPath).toBeUndefined();
    expect(result.walkthroughPath).toBeUndefined();
    expect(result.artifactDir).toBe(path.join(wt, '.agent', 'feat', 'x'));
  });

  it('finds all three artifact files', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/task.md': '# task',
      '.agent/feat/x/walkthrough.md': '# walk',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.taskPath).toBeDefined();
    expect(result.planPath).toBeDefined();
    expect(result.walkthroughPath).toBeDefined();
  });

  it('respects dir order — first dir with any artifact wins', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# agent plan',
      '.gw/feat/x/plan.md': '# gw plan',
    });
    const fromGwFirst = findLinkedArtifacts(wt, 'feat/x', ['.gw', '.agent']);
    expect(fromGwFirst.planPath).toBe(path.join(wt, '.gw', 'feat', 'x', 'plan.md'));

    const fromAgentFirst = findLinkedArtifacts(wt, 'feat/x', ['.agent', '.gw']);
    expect(fromAgentFirst.planPath).toBe(path.join(wt, '.agent', 'feat', 'x', 'plan.md'));
  });

  it('skips an empty branch dir and tries next configured dir', () => {
    const wt = setup({ '.gw/feat/x/plan.md': '# gw plan' });
    fs.mkdirSync(path.join(wt, '.agent', 'feat', 'x'), { recursive: true });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent', '.gw']);
    expect(result.planPath).toBe(path.join(wt, '.gw', 'feat', 'x', 'plan.md'));
  });

  it('handles nested branch names like feat/foo/bar', () => {
    const wt = setup({ '.agent/feat/foo/bar/plan.md': '# plan' });
    const result = findLinkedArtifacts(wt, 'feat/foo/bar', ['.agent']);
    expect(result.planPath).toBe(path.join(wt, '.agent', 'feat', 'foo', 'bar', 'plan.md'));
  });

  it('returns every diagnose-*.md report sorted by filename', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/diagnose-fix-bug.md': '# fix-bug diag',
      '.agent/feat/x/diagnose-autonomous-workflow.md': '# aw diag',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.diagnosePaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'diagnose-autonomous-workflow.md'),
      path.join(wt, '.agent', 'feat', 'x', 'diagnose-fix-bug.md'),
    ]);
  });

  it('treats a diagnose report alone as a valid linked artifact', () => {
    const wt = setup({ '.agent/feat/x/diagnose-fix-bug.md': '# diag' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.diagnosePaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'diagnose-fix-bug.md'),
    ]);
    expect(result.artifactDir).toBe(path.join(wt, '.agent', 'feat', 'x'));
    expect(result.planPath).toBeUndefined();
  });

  it('diagnose.md without a target suffix is not a diagnose report but IS an other markdown file', () => {
    const wt = setup({ '.agent/feat/x/diagnose.md': '# plain' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    // Not a diagnose report (pattern requires a non-empty target suffix).
    expect(result.diagnosePaths).toBeUndefined();
    // Is surfaced as an "other" markdown file — artifactDir is now set.
    expect(result.otherMarkdownPaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'diagnose.md'),
    ]);
    expect(result.artifactDir).toBe(path.join(wt, '.agent', 'feat', 'x'));
  });

  // -------------------------------------------------------------------------
  // otherMarkdownPaths — unknown .md files created by agents
  // -------------------------------------------------------------------------

  it('collects unknown .md files in otherMarkdownPaths', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/specs.md': '# specs',
      '.agent/feat/x/notes.md': '# notes',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.otherMarkdownPaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'notes.md'),
      path.join(wt, '.agent', 'feat', 'x', 'specs.md'),
    ]);
    // Known artifact still present.
    expect(result.planPath).toBeDefined();
  });

  it('treats other markdown files alone as valid linked artifacts', () => {
    const wt = setup({ '.agent/feat/x/specs.md': '# specs' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.otherMarkdownPaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'specs.md'),
    ]);
    expect(result.artifactDir).toBe(path.join(wt, '.agent', 'feat', 'x'));
    expect(result.planPath).toBeUndefined();
  });

  it('excludes plan.v*.md snapshots from otherMarkdownPaths', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/plan.v1.md': '# snap',
      '.agent/feat/x/plan.v2.md': '# snap2',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    // Snapshots must not appear in otherMarkdownPaths.
    expect(result.otherMarkdownPaths).toBeUndefined();
    expect(result.planPath).toBeDefined();
  });

  it('excludes task.md, plan.md, walkthrough.md, and diagnose-*.md from otherMarkdownPaths', () => {
    const wt = setup({
      '.agent/feat/x/task.md': '# task',
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/walkthrough.md': '# walk',
      '.agent/feat/x/diagnose-fix-bug.md': '# diag',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.otherMarkdownPaths).toBeUndefined();
  });

  it('otherMarkdownPaths sorted alphabetically by filename', () => {
    const wt = setup({
      '.agent/feat/x/zebra.md': '# z',
      '.agent/feat/x/alpha.md': '# a',
      '.agent/feat/x/middle.md': '# m',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.otherMarkdownPaths).toEqual([
      path.join(wt, '.agent', 'feat', 'x', 'alpha.md'),
      path.join(wt, '.agent', 'feat', 'x', 'middle.md'),
      path.join(wt, '.agent', 'feat', 'x', 'zebra.md'),
    ]);
  });
});

describe('findDiagnoseReports', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns [] for a missing directory', () => {
    expect(findDiagnoseReports(path.join(tmpRoot, 'nope'))).toEqual([]);
  });

  it('returns [] when no diagnose files exist', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
    fs.writeFileSync(path.join(dir, 'plan.md'), '# plan');
    expect(findDiagnoseReports(dir)).toEqual([]);
  });

  it('ignores subdirectories named diagnose-foo.md', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'subdir-'));
    fs.mkdirSync(path.join(dir, 'diagnose-fake.md'));
    expect(findDiagnoseReports(dir)).toEqual([]);
  });
});

describe('findOtherMarkdownFiles', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'other-md-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns [] for a missing directory', () => {
    expect(findOtherMarkdownFiles(path.join(tmpRoot, 'nope'))).toEqual([]);
  });

  it('returns [] for an empty directory', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
    expect(findOtherMarkdownFiles(dir)).toEqual([]);
  });

  it('returns [] when only known artifacts exist', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'known-'));
    fs.writeFileSync(path.join(dir, 'task.md'), '# task');
    fs.writeFileSync(path.join(dir, 'plan.md'), '# plan');
    fs.writeFileSync(path.join(dir, 'walkthrough.md'), '# walk');
    expect(findOtherMarkdownFiles(dir)).toEqual([]);
  });

  it('returns [] when only diagnose reports exist', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'diag-'));
    fs.writeFileSync(path.join(dir, 'diagnose-fix-bug.md'), '# diag');
    expect(findOtherMarkdownFiles(dir)).toEqual([]);
  });

  it('returns [] when only plan version snapshots exist', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'vers-'));
    fs.writeFileSync(path.join(dir, 'plan.v1.md'), '# v1');
    fs.writeFileSync(path.join(dir, 'plan.v42.md'), '# v42');
    expect(findOtherMarkdownFiles(dir)).toEqual([]);
  });

  it('returns unknown .md files sorted by filename', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'other-'));
    fs.writeFileSync(path.join(dir, 'specs.md'), '# specs');
    fs.writeFileSync(path.join(dir, 'notes.md'), '# notes');
    fs.writeFileSync(path.join(dir, 'alpha.md'), '# alpha');
    expect(findOtherMarkdownFiles(dir)).toEqual([
      path.join(dir, 'alpha.md'),
      path.join(dir, 'notes.md'),
      path.join(dir, 'specs.md'),
    ]);
  });

  it('ignores non-.md files', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'mixed-'));
    fs.writeFileSync(path.join(dir, 'notes.md'), '# notes');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'plain text');
    fs.writeFileSync(path.join(dir, 'script.sh'), '#!/bin/sh');
    expect(findOtherMarkdownFiles(dir)).toEqual([path.join(dir, 'notes.md')]);
  });

  it('ignores subdirectories even if named *.md', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'subdir-'));
    fs.mkdirSync(path.join(dir, 'fake.md'));
    expect(findOtherMarkdownFiles(dir)).toEqual([]);
  });

  it('does not double-count diagnose.md (no suffix) — treated as other', () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'bare-diagnose-'));
    fs.writeFileSync(path.join(dir, 'diagnose.md'), '# bare');
    // diagnose.md has no target suffix so it is not a diagnose report — it IS other.
    expect(findOtherMarkdownFiles(dir)).toEqual([path.join(dir, 'diagnose.md')]);
  });
});

describe('diagnoseTargetFromFilename', () => {
  it('extracts the target from a well-formed filename', () => {
    expect(diagnoseTargetFromFilename('diagnose-fix-bug.md')).toBe('fix-bug');
    expect(diagnoseTargetFromFilename('diagnose-autonomous-workflow.md')).toBe(
      'autonomous-workflow'
    );
  });

  it('returns undefined for non-matching filenames', () => {
    expect(diagnoseTargetFromFilename('plan.md')).toBeUndefined();
    expect(diagnoseTargetFromFilename('diagnose.md')).toBeUndefined();
    expect(diagnoseTargetFromFilename('diagnose-.md')).toBeUndefined();
  });
});

describe('hasLinkedArtifacts', () => {
  it('returns false for empty object', () => {
    expect(hasLinkedArtifacts({})).toBe(false);
  });

  it('returns false when only artifactDir is set', () => {
    expect(hasLinkedArtifacts({ artifactDir: '/tmp/foo' })).toBe(false);
  });

  it('returns true when any known artifact path is set', () => {
    expect(hasLinkedArtifacts({ planPath: '/tmp/plan.md' })).toBe(true);
    expect(hasLinkedArtifacts({ taskPath: '/tmp/task.md' })).toBe(true);
    expect(hasLinkedArtifacts({ walkthroughPath: '/tmp/walk.md' })).toBe(true);
  });

  it('returns true when otherMarkdownPaths is non-empty', () => {
    expect(hasLinkedArtifacts({ otherMarkdownPaths: ['/tmp/specs.md'] })).toBe(true);
  });

  it('returns false when otherMarkdownPaths is an empty array', () => {
    expect(hasLinkedArtifacts({ otherMarkdownPaths: [] })).toBe(false);
  });
});
