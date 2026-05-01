---
name: aw-create-plan
description: >
  Create a comprehensive implementation plan artifact (plan.md) in `.agent/{branch}/`
  from the current conversation context. Captures all Phase 0-1 discussion into a
  structured, self-contained document that enables context recovery and session
  handoff. Use after planning is complete and confidence gate passes.
  Triggers on create plan, generate plan, write plan artifact.
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
---

# Create Plan Artifact

Generate `.agent/{branch-name}/plan.md` — the single source of truth for autonomous execution.

**A new Claude session MUST be able to execute from this plan alone without the original conversation.**

---

## Prerequisites

Before invoking this skill:

1. Phase 0 (Validation) must be complete — requirements confirmed with user
2. Phase 1 (Planning) must be complete — codebase analyzed, decisions made
3. Confidence gate should have passed (90%+ on plan mode)
4. A worktree must exist — plan.md is created INSIDE the worktree, never on main

---

## Procedure

### Step 1: Determine file location

Run this command to get the artifact path — do NOT guess the branch name:

```bash
BRANCH=$(git branch --show-current) && mkdir -p ".agent/${BRANCH}" && echo ".agent/${BRANCH}/plan.md"
```

Use the output as the file path. **Do NOT hardcode or guess the branch name.**

### Step 2: Write plan.md

Create the file at the path from Step 1 using the EXACT template structure below. **Every section is MANDATORY.** Fill each section from the Phase 0-1 conversation context.

### Step 3: Validate completeness

After writing, verify against the checklist at the bottom of this skill. If any item fails, fix it immediately.

---

## Template

**All timestamps MUST use full ISO 8601 with time: `YYYY-MM-DDTHH:MM:SSZ`**

```markdown
---
created: { TIMESTAMP }
branch: { BRANCH }
task: { TASK_DESCRIPTION }
complexity: { LOW | MEDIUM | HIGH }
status: approved
approved: true
---

# Plan: {TASK_DESCRIPTION}

## Summary

<!-- What, why, and definition of "done" in 2-3 sentences -->

## Background & Context

<!-- Why is this needed? What problem does it solve? Include history and motivation
     from Phase 0 discussion. Write so a reader with zero prior context understands
     the full "why". -->

## Requirements

<!-- ALL requirements from Phase 0. Tag each one. Include non-functional requirements
     (performance, compatibility, security) inline. -->

1. {requirement} — [user-stated | inferred]

### Out of Scope

<!-- Items discussed but explicitly excluded, with reason. Prevents scope creep. -->

1. {item} — {reason}

## Decisions

<!-- Every decision from Phase 0-1, including rejected alternatives and rationale.
     Critical for context recovery — a new session needs to know WHY, not just WHAT. -->

| Decision | Alternatives Rejected | Rationale |
| -------- | --------------------- | --------- |

## Technical Approach

<!-- Architecture, data flow, integration points. Specific enough for a new session
     to implement without the original conversation. -->

### Patterns to Follow

<!-- Existing codebase patterns to match. Reference specific files as examples. -->

### Edge Cases

| Edge Case | Handling |
| --------- | -------- |

### API / Interfaces

<!-- Type signatures, function signatures, config shapes. Omit section if N/A. -->

## Acceptance Criteria

<!-- Concrete, testable pass/fail conditions. This is what "done" means.
     Phase 4 testing gates against these. Each criterion must be verifiable —
     "user can do X", "command Y returns Z", "file W contains line that
     matches /pattern/". Avoid vague criteria like "looks right" or "works
     well". -->

- [ ] {Concrete, testable criterion 1}
- [ ] {Concrete, testable criterion 2}
- [ ] {...}

## Implementation Order

<!-- Ordered steps for Phase 3 execution. Each step should be atomic and verifiable.
     Enables context recovery if interrupted mid-implementation. -->

1. {step}

## File Changes

<!-- ALL files: create, modify, or delete. Include docs. -->

| Action | File   | Change                  | Reason |
| ------ | ------ | ----------------------- | ------ |
| create | {path} | {purpose / key exports} | {why}  |
| modify | {path} | {specific changes}      | {why}  |

## Tests

<!-- Specific test cases, not categories. Each row is a concrete test. -->

| Type        | Test Case      | File   | Validates  |
| ----------- | -------------- | ------ | ---------- |
| unit        | {case}         | {file} | {behavior} |
| integration |                |        |            |
| manual      | {step-by-step} |        |            |

## Dependencies

<!-- "None" or list with versions. Mark new additions with [new]. -->

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |

## Verification

<!-- Commands to run. Determine from package.json, Makefile, or project config. -->

- **After editing**: {fast check: type-check or compile}
- **Before PR**: {full suite: build + test + lint}

## Progress Log

<!-- Append-only. Updated at phase transitions and key milestones. -->

- [{TIMESTAMP}] Phase 1: Plan created
- [{TIMESTAMP}] Phase 2: Worktree created at {branch}
```

---

## Validation Checklist

After writing plan.md, verify ALL of the following. **Fix any failures immediately.**

- [ ] **File location**: Path from `git branch --show-current` — inside the worktree (NOT on main)
- [ ] **Frontmatter complete**: created, branch, task, complexity, status, approved — all filled
- [ ] **Timestamps**: All timestamps use ISO 8601 with time (`YYYY-MM-DDTHH:MM:SSZ`)
- [ ] **Summary**: Concise what/why/done definition (2-3 sentences)
- [ ] **Background & Context**: Full motivation — a stranger understands the "why"
- [ ] **Requirements**: Every requirement tagged `[user-stated]` or `[inferred]`
- [ ] **Out of Scope**: At least considered (can be "None discussed")
- [ ] **Decisions**: Every decision includes rejected alternatives and rationale
- [ ] **Technical Approach**: Specific enough to implement without conversation context
- [ ] **Patterns to Follow**: References actual files in the codebase
- [ ] **Acceptance Criteria**: At least one concrete, testable pass/fail condition. Each is verifiable (not "looks right" / "works well").
- [ ] **Implementation Order**: Numbered, atomic, verifiable steps
- [ ] **File Changes**: Every file listed with action, path, change description, and reason
- [ ] **Tests**: Specific test cases (not just "unit tests for X")
- [ ] **Verification commands**: Both after-edit and before-PR commands identified
- [ ] **Progress Log**: Initialized with Phase 1 entry
- [ ] **Self-contained**: A new Claude session can execute from this plan alone

---

## Common Failures

| Failure                              | Fix                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- |
| Sparse sections ("TBD", "see above") | Fill from conversation context — every section must be self-contained |
| Missing decisions rationale          | Add "Alternatives Rejected" and "Rationale" for each decision         |
| Vague implementation steps           | Make each step atomic: "Add X to file Y" not "implement feature"      |
| No file paths in Patterns            | Reference specific existing files, not abstract descriptions          |
| Requirements not tagged              | Add `[user-stated]` or `[inferred]` to every requirement              |
| Timestamps missing time component    | Use `2026-03-07T14:30:00Z` not `2026-03-07`                           |
