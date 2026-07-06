import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  diagnoseTargetFromFilename,
  findDiagnoseReports,
  findLinkedArtifacts,
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

  it('returns empty when artifact dir exists but is empty', () => {
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

  it('returns checksPath when checks.yaml exists alongside plan.md', () => {
    const wt = setup({
      '.agent/feat/x/plan.md': '# plan',
      '.agent/feat/x/checks.yaml': '- id: AC-1\n  status: pending\n',
    });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.checksPath).toBe(path.join(wt, '.agent', 'feat', 'x', 'checks.yaml'));
    expect(result.planPath).toBeDefined();
  });

  it('leaves checksPath undefined when checks.yaml is absent', () => {
    const wt = setup({ '.agent/feat/x/plan.md': '# plan' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.checksPath).toBeUndefined();
  });

  it('treats checks.yaml alone as a valid linked artifact', () => {
    const wt = setup({ '.agent/feat/x/checks.yaml': '- id: AC-1\n  status: pending\n' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.checksPath).toBe(path.join(wt, '.agent', 'feat', 'x', 'checks.yaml'));
    expect(result.artifactDir).toBe(path.join(wt, '.agent', 'feat', 'x'));
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

  it('does NOT match diagnose.md without a target suffix', () => {
    const wt = setup({ '.agent/feat/x/diagnose.md': '# plain' });
    const result = findLinkedArtifacts(wt, 'feat/x', ['.agent']);
    expect(result.diagnosePaths).toBeUndefined();
    expect(result.artifactDir).toBeUndefined();
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

  it('returns true when any artifact path is set', () => {
    expect(hasLinkedArtifacts({ planPath: '/tmp/plan.md' })).toBe(true);
    expect(hasLinkedArtifacts({ taskPath: '/tmp/task.md' })).toBe(true);
    expect(hasLinkedArtifacts({ walkthroughPath: '/tmp/walk.md' })).toBe(true);
    expect(hasLinkedArtifacts({ checksPath: '/tmp/checks.yaml' })).toBe(true);
  });
});
