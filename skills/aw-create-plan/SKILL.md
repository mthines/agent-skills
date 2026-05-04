---
name: aw-create-plan
description: >
  Create a comprehensive implementation plan artifact (plan.md + versioned
  plan.vN.md snapshot) in `.agent/{branch}/` from the current conversation
  context. Captures all Phase 0-1 discussion into a structured, self-contained
  document that enables context recovery and session handoff. On every
  invocation, writes the next plan.vN.md snapshot and updates plan.md to match.
  Use after planning is complete and confidence gate passes — and again on
  every plan iteration (user-requested refinement or Phase 4 auto-replan).
  Triggers on create plan, generate plan, write plan artifact, regenerate plan,
  iterate on plan.
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
---

# Create Plan Artifact

Generate `.agent/{branch-name}/plan.md` — the single source of truth for autonomous execution — alongside an immutable `plan.vN.md` snapshot of the same content.

**A new Claude session MUST be able to execute from `plan.md` alone without the original conversation.**

**Every plan iteration produces a new `plan.vN.md` snapshot.** `plan.md` always points at the latest version; `plan.v1.md`, `plan.v2.md`, … are immutable history.

---

## Prerequisites

Before invoking this skill:

1. Phase 0 (Validation) must be complete — requirements confirmed with user
2. Phase 1 (Planning) must be complete — codebase analyzed, decisions made
3. Confidence gate should have passed (90%+ on plan mode)
4. A worktree must exist — plan.md is created INSIDE the worktree, never on main

---

## Procedure

### Step 1: Determine target paths and next version

Run this command to compute the artifact directory, the next version number,
and the two files this skill will write — do NOT guess the branch name or the
version:

```bash
BRANCH=$(git branch --show-current)
DIR=".agent/${BRANCH}"
mkdir -p "${DIR}"
NEXT=$(ls "${DIR}" 2>/dev/null \
  | sed -n 's/^plan\.v\([0-9][0-9]*\)\.md$/\1/p' \
  | sort -n | tail -1)
NEXT=$(( ${NEXT:-0} + 1 ))
echo "DIR=${DIR}"
echo "VERSION=${NEXT}"
echo "VERSIONED=${DIR}/plan.v${NEXT}.md"
echo "LATEST=${DIR}/plan.md"
```

Three things are determined here:

| Output       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `VERSION`    | The next version number (1 on first run, 2 on next, …)     |
| `VERSIONED`  | The immutable snapshot path: `.agent/{branch}/plan.vN.md`  |
| `LATEST`     | The canonical "latest" pointer: `.agent/{branch}/plan.md`  |

**Do NOT hardcode or guess the branch name or the version number.**

### Step 2: Write the versioned snapshot AND the latest pointer

Render the plan content using the EXACT template structure below — **every
section is MANDATORY** — then write **both** files with **identical content**:

1. Write `${VERSIONED}` (e.g. `.agent/feat-x/plan.v2.md`).
2. Write `${LATEST}` (`.agent/feat-x/plan.md`).

`plan.md` is a mirror of the newest `plan.vN.md`. Readers (executor agent,
VS Code extension, fresh sessions) load `plan.md`. Earlier `plan.v*.md` files
remain on disk as immutable history — never edit or delete them.

> **Rationale.** Versioned snapshots give the user a complete audit trail of
> how the plan evolved (initial → user feedback → auto-replan → …) without
> forcing readers to learn a versioning convention; `plan.md` always works.

### Step 3: Append a Progress Log entry referencing this version

In the `## Progress Log` section of the plan content, the entry for *this*
write must name the version explicitly so the trail is legible:

```markdown
- [{TIMESTAMP}] Phase 1: plan.v1.md created (initial plan)
- [{TIMESTAMP}] Phase 1: plan.v2.md created (iteration — user requested broader scope)
- [{TIMESTAMP}] Phase 4: plan.v3.md created (auto-replan after holistic-analysis)
```

The same Progress Log lives in **all** versions — newer versions carry the
full history of older versions plus their own new entry. This keeps each
`plan.vN.md` file self-contained.

### Step 4: Validate completeness

After writing, verify against the checklist at the bottom of this skill. If any item fails, fix **both** files immediately and keep them in sync.

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

<!-- Append-only. Carries the full history across plan versions. The entry
     for this write MUST name the version that was just produced. -->

- [{TIMESTAMP}] Phase 1: plan.v{N}.md created — {reason: initial | user-iteration | auto-replan}
- [{TIMESTAMP}] Phase 2: Worktree created at {branch}
```

---

## Validation Checklist

After writing both files, verify ALL of the following. **Fix any failures immediately.**

- [ ] **File location**: Both files inside the worktree at `.agent/{branch}/` (NOT on main)
- [ ] **Two files written**: `plan.vN.md` (immutable snapshot) AND `plan.md` (latest pointer)
- [ ] **Identical content**: `plan.md` and `plan.vN.md` have byte-identical bodies (the canonical "latest == newest snapshot" invariant)
- [ ] **Version monotonic**: `N` is exactly one greater than the highest existing `plan.v*.md` (or 1 on first run)
- [ ] **Older versions untouched**: Pre-existing `plan.v1.md`, `plan.v2.md`, … were not edited or deleted
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
- [ ] **Progress Log**: Carries the full prior history plus a new entry naming `plan.v{N}.md`
- [ ] **Self-contained**: A new Claude session can execute from `plan.md` alone

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
| Wrote only `plan.md`, no `plan.vN.md` | Re-run Step 1 to compute `N`, then write the snapshot too           |
| Wrote `plan.vN.md` but forgot to update `plan.md` | Copy the new snapshot's content over `plan.md`            |
| Edited an existing `plan.vN.md`      | Restore from git (or re-derive from history); snapshots are immutable |
| Reused a version number              | Re-run Step 1; older snapshots must never be overwritten              |
