import { describe, it, expect } from 'vitest';
import { parseTaskMd, parsePlanMd, parseWalkthroughMd } from './markdown-parser';

describe('parseTaskMd', () => {
  describe('frontmatter parsing', () => {
    it('parses frontmatter correctly', () => {
      const content = `---
created: 2024-01-01
branch: feature/test
task: Implement feature X
---
# Task: Implement feature X
`;
      const result = parseTaskMd(content);
      expect(result.frontmatter.task).toBe('Implement feature X');
      expect(result.frontmatter.branch).toBe('feature/test');
      expect(result.frontmatter.created).toBe('2024-01-01');
    });

    it('extracts task name from title if not in frontmatter', () => {
      const content = `---
created: 2024-01-01
---
# Task: My Task From Title
`;
      const result = parseTaskMd(content);
      expect(result.frontmatter.task).toBe('My Task From Title');
    });

    it('handles content without frontmatter', () => {
      const content = `# Task: No Frontmatter Task

## Status
**Phase**: 1 (Planning)
`;
      const result = parseTaskMd(content);
      expect(result.frontmatter.task).toBe('No Frontmatter Task');
      expect(result.phase).toBe('1');
    });
  });

  describe('status section parsing', () => {
    it('extracts phase information with bold format', () => {
      const content = `---
task: Test
---
## Status
**Phase**: 3 (Implementation)
**Last Updated**: 2024-01-01
`;
      const result = parseTaskMd(content);
      expect(result.phase).toBe('3');
      expect(result.phaseName).toBe('Implementation');
    });

    it('extracts phase information with alternate format', () => {
      const content = `---
task: Test
---
## Status
Phase 6: Complete - PR Created!
`;
      const result = parseTaskMd(content);
      expect(result.phase).toBe('6');
      expect(result.phaseName).toBe('Complete - PR Created!');
    });

    it('handles missing status section', () => {
      const content = `---
task: Test
---
# Task: Test
`;
      const result = parseTaskMd(content);
      expect(result.phase).toBeUndefined();
      expect(result.phaseName).toBeUndefined();
    });
  });

  describe('checkbox item parsing', () => {
    it('parses checkbox items correctly', () => {
      // Using alternate section names that are known to work
      const content = `---
task: Test
---
## Completed Items
- [x] Done task

## In Progress
- [ ] Working task **IN PROGRESS**

## TODO
- [ ] Future task
`;
      const result = parseTaskMd(content);
      // Sections sorted: In Progress (priority 0), Completed Items (priority 1), TODO (priority 2)
      expect(result.taskSections).toHaveLength(3);

      const completed = result.taskSections.find((s) => s.heading === 'Completed Items');
      const current = result.taskSections.find((s) => s.heading === 'In Progress');
      const upcoming = result.taskSections.find((s) => s.heading === 'TODO');

      expect(completed?.items).toHaveLength(1);
      expect(completed?.items[0]).toEqual({ label: 'Done task', completed: true, inProgress: false, children: [] });
      expect(current?.items).toHaveLength(1);
      expect(current?.items[0]).toEqual({ label: 'Working task', completed: false, inProgress: true, children: [] });
      expect(upcoming?.items).toHaveLength(1);
      expect(upcoming?.items[0]).toEqual({ label: 'Future task', completed: false, inProgress: false, children: [] });
    });

    it('handles arrow-style in-progress marker', () => {
      const content = `---
task: Test
---
## In Progress
- [ ] Task <- **IN PROGRESS**

## TODO
- [ ] Next
`;
      const result = parseTaskMd(content);
      const current = result.taskSections.find((s) => s.heading === 'In Progress');
      expect(current?.items[0].inProgress).toBe(true);
    });

    it('handles nested checkbox items', () => {
      const content = `---
task: Test
---
## In Progress
- [ ] Main task
  - [ ] Sub task 1
  - [x] Sub task 2

## TODO
- [ ] Next
`;
      const result = parseTaskMd(content);
      const current = result.taskSections.find((s) => s.heading === 'In Progress');
      expect(current?.items).toHaveLength(1);
      expect(current?.items[0].label).toBe('Main task');
      expect(current?.items[0].children).toHaveLength(2);
      expect(current?.items[0].children[0].label).toBe('Sub task 1');
      expect(current?.items[0].children[0].completed).toBe(false);
      expect(current?.items[0].children[1].label).toBe('Sub task 2');
      expect(current?.items[0].children[1].completed).toBe(true);
    });

    it('parses multiple checkbox items in each section', () => {
      const content = `---
created: 2025-03-13
branch: feat/from-staged-flag
task: Add --from-staged flag to gw checkout
---

# Task: Add --from-staged flag to gw checkout

## Status

- **Phase**: 6 (PR Creation)
- **Last Updated**: 2025-03-13

## Completed

- [x] Phase 0: Validation - User confirmed requirements
- [x] Phase 1: Planning - Created plan.md
- [x] Phase 2: Worktree Setup - Created feat/from-staged-flag worktree
- [x] Implement git utilities for staged files (getStagedFiles, getStagedFileContent, copyStagedFiles)
- [x] Add --from-staged flag parsing to checkout.ts
- [x] Implement staged file copying in checkout flow
- [x] Update CLI help text
- [x] Update gw-tool README.md
- [x] Add VS Code command definition (package.json)
- [x] Implement VS Code command handler (extension.ts)
- [x] Add VS Code parser function (hasStagedFiles, createWorktreeFromStaged)
- [x] Run tests - all 245 tests pass
- [x] Run linters - both packages pass

## Current

- [ ] Create draft PR <- **IN PROGRESS**

## Upcoming

- [ ] Phase 7: Cleanup (after merge)

## Decisions Log

| Decision | Rationale | Phase |
| -------- | --------- | ----- |
| No --clean flag | Keep it simple, user can clean manually | 0 |
`;
      const result = parseTaskMd(content);

      // Should have 3 task sections: Current (0), Completed (1), Upcoming (2)
      expect(result.taskSections).toHaveLength(3);
      expect(result.taskSections[0].heading).toBe('Current');
      expect(result.taskSections[1].heading).toBe('Completed');
      expect(result.taskSections[2].heading).toBe('Upcoming');

      // Should have all 13 completed items
      const completed = result.taskSections[1];
      expect(completed.items).toHaveLength(13);
      expect(completed.items[0].label).toBe('Phase 0: Validation - User confirmed requirements');
      expect(completed.items[0].completed).toBe(true);
      expect(completed.items[12].label).toBe('Run linters - both packages pass');

      // Should have 1 current item (in progress)
      const current = result.taskSections[0];
      expect(current.items).toHaveLength(1);
      expect(current.items[0].label).toBe('Create draft PR');
      expect(current.items[0].inProgress).toBe(true);

      // Should have 1 upcoming item
      const upcoming = result.taskSections[2];
      expect(upcoming.items).toHaveLength(1);
      expect(upcoming.items[0].label).toBe('Phase 7: Cleanup (after merge)');
    });

    it('detects checkbox sections with unknown headings', () => {
      const content = `---
task: Test
---
## Checklist
- [ ] First item
- [x] Second item

## Open Questions (BLOCKING)
- [ ] Path mapping question

## Status
Phase 3: Implementation
`;
      const result = parseTaskMd(content);
      // Both checkbox sections detected; Status is a non-task section
      expect(result.taskSections).toHaveLength(2);
      expect(result.taskSections[0].heading).toBe('Checklist');
      expect(result.taskSections[0].items).toHaveLength(2);
      expect(result.taskSections[1].heading).toBe('Open Questions (BLOCKING)');
      expect(result.taskSections[1].items).toHaveLength(1);
    });

    it('sorts known headings before unknown headings', () => {
      const content = `---
task: Test
---
## My Custom Section
- [ ] Custom item

## Completed
- [x] Done item

## Current
- [ ] Active item
`;
      const result = parseTaskMd(content);
      // Current (0), Completed (1), then unknown in markdown order
      expect(result.taskSections[0].heading).toBe('Current');
      expect(result.taskSections[1].heading).toBe('Completed');
      expect(result.taskSections[2].heading).toBe('My Custom Section');
    });

    it('ignores sections without checkboxes', () => {
      const content = `---
task: Test
---
## Current
- [ ] Active task

## Some Notes
Just plain text, no checkboxes here.

## Another Section
- Regular bullet point
`;
      const result = parseTaskMd(content);
      expect(result.taskSections).toHaveLength(1);
      expect(result.taskSections[0].heading).toBe('Current');
    });
  });

  describe('decisions parsing', () => {
    it('handles empty decisions section', () => {
      const content = `---
task: Test
---
## Decisions Log
| Decision | Rationale | Phase |
|----------|-----------|-------|
`;
      const result = parseTaskMd(content);
      expect(result.decisions).toHaveLength(0);
    });
  });

  describe('blockers parsing', () => {
    it('treats "None" as empty blockers', () => {
      const content = `---
task: Test
---
## Blockers
None
`;
      const result = parseTaskMd(content);
      expect(result.blockers).toHaveLength(0);
    });

    it('parses single blocker', () => {
      const content = `---
task: Test
---
## Blockers
- Real blocker
`;
      const result = parseTaskMd(content);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toBe('Real blocker');
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = parseTaskMd('');
      expect(result.frontmatter).toEqual({});
      expect(result.taskSections).toEqual([]);
      expect(result.blockers).toEqual([]);
    });

    it('handles content with only frontmatter', () => {
      const content = `---
task: Just frontmatter
---
`;
      const result = parseTaskMd(content);
      expect(result.frontmatter.task).toBe('Just frontmatter');
    });
  });
});

describe('parsePlanMd', () => {
  describe('frontmatter parsing', () => {
    it('parses frontmatter correctly', () => {
      const content = `---
created: 2024-01-01
branch: feature/test
task: Implement feature
approved: true
---
# Plan
`;
      const result = parsePlanMd(content);
      expect(result.frontmatter.created).toBe('2024-01-01');
      expect(result.frontmatter.branch).toBe('feature/test');
      expect(result.frontmatter.task).toBe('Implement feature');
      expect(result.frontmatter.approved).toBe('true');
    });
  });

  describe('summary and goal parsing', () => {
    it('extracts summary from document', () => {
      const content = `---
task: Test
---
## Summary
Real summary content.
`;
      const result = parsePlanMd(content);
      expect(result.summary).toBe('Real summary content.');
    });
  });

  describe('files to create/modify parsing', () => {
    it('handles empty tables', () => {
      const content = `---
task: Test
---
## Files to Create
| File | Purpose |
|------|---------|

## Files to Modify
| File | Change |
|------|--------|
`;
      const result = parsePlanMd(content);
      expect(result.filesToCreate).toHaveLength(0);
      expect(result.filesToModify).toHaveLength(0);
    });
  });

  describe('complexity parsing', () => {
    it('extracts complexity section', () => {
      const content = `---
task: Test
---
## Estimated Complexity
Medium - requires changes to 5 files
`;
      const result = parsePlanMd(content);
      expect(result.complexity).toBe('Medium - requires changes to 5 files');
    });

    it('extracts complexity at end of file', () => {
      const content = `---
task: Test
---
## Estimated Complexity
Low complexity
`;
      const result = parsePlanMd(content);
      expect(result.complexity).toBe('Low complexity');
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = parsePlanMd('');
      expect(result.frontmatter).toEqual({});
      expect(result.filesToCreate).toEqual([]);
      expect(result.filesToModify).toEqual([]);
    });

    it('returns undefined for missing optional fields', () => {
      const content = `---
task: Test
---
`;
      const result = parsePlanMd(content);
      expect(result.summary).toBeUndefined();
      expect(result.goal).toBeUndefined();
      expect(result.complexity).toBeUndefined();
    });
  });
});

describe('parseWalkthroughMd', () => {
  describe('frontmatter parsing', () => {
    it('parses frontmatter correctly', () => {
      const content = `---
created: 2024-01-01
branch: feature/test
task: Implement feature
pr: "123"
---
# Walkthrough
`;
      const result = parseWalkthroughMd(content);
      expect(result.frontmatter.created).toBe('2024-01-01');
      expect(result.frontmatter.branch).toBe('feature/test');
      expect(result.frontmatter.pr).toBe('"123"');
    });
  });

  describe('quick reference parsing', () => {
    it('handles PR without hash', () => {
      const content = `---
task: Test
---
## Quick Reference
**PR**: 789
`;
      const result = parseWalkthroughMd(content);
      expect(result.pr).toBe('789');
    });
  });

  describe('files changed parsing', () => {
    it('handles empty files changed', () => {
      const content = `---
task: Test
---
## Files Changed
| File | Change | Purpose |
|------|--------|---------|
`;
      const result = parseWalkthroughMd(content);
      expect(result.filesChanged).toHaveLength(0);
    });
  });

  describe('summary parsing', () => {
    it('extracts summary section', () => {
      const content = `---
task: Test
---
## Summary
Implemented the feature with all tests passing.
`;
      const result = parseWalkthroughMd(content);
      expect(result.summary).toBe('Implemented the feature with all tests passing.');
    });

    it('extracts summary from document', () => {
      const content = `---
task: Test
---
## Summary
Real summary.
`;
      const result = parseWalkthroughMd(content);
      expect(result.summary).toBe('Real summary.');
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const result = parseWalkthroughMd('');
      expect(result.frontmatter).toEqual({});
      expect(result.filesChanged).toEqual([]);
    });

    it('handles missing quick reference fields', () => {
      const content = `---
task: Test
---
## Quick Reference
Nothing here.
`;
      const result = parseWalkthroughMd(content);
      expect(result.branch).toBeUndefined();
      expect(result.pr).toBeUndefined();
      expect(result.worktreePath).toBeUndefined();
    });
  });
});

describe('parseWorktreeListOutput', () => {
  // Testing the git worktree parser is already covered in git-worktree.test.ts
  it('is tested in git-worktree.test.ts', () => {
    expect(true).toBe(true);
  });
});
