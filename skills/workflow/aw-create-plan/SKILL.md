---
name: aw-create-plan
description: >
  Create a comprehensive implementation plan artifact (plan.md + versioned
  plan.vN.md snapshot + checks.yaml executable acceptance checks) in
  `.agent/{branch}/` from the current conversation context. Captures all
  Phase 0-1 discussion into a structured, self-contained document that enables
  context recovery and session handoff. On every invocation, writes the next
  plan.vN.md snapshot, updates plan.md to match, and re-derives checks.yaml
  from the Acceptance Criteria. Use after planning is complete and confidence
  gate passes — and again on every plan iteration (user-requested refinement
  or Phase 4 auto-replan). Triggers on create plan, generate plan, write plan
  artifact, regenerate plan, iterate on plan.
license: MIT
disable-model-invocation: false
metadata:
  author: mthines
  version: '2.1.0'
  workflow_type: advisory
---

# Create Plan Artifact

Generate `.agent/{branch-name}/plan.md` — the single source of truth for autonomous execution — alongside an immutable `plan.vN.md` snapshot of the same content and a `checks.yaml` of executable acceptance checks derived from the Acceptance Criteria.

**A new Claude session MUST be able to execute from `plan.md` alone without the original conversation.**

**Every plan iteration produces a new `plan.vN.md` snapshot.** `plan.md` always points at the latest version; `plan.v1.md`, `plan.v2.md`, … are immutable history. `checks.yaml` is re-derived on every iteration (statuses reset to `pending`); it is not versioned.

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
echo "CHECKS=${DIR}/checks.yaml"
```

Four things are determined here:

| Output       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `VERSION`    | The next version number (1 on first run, 2 on next, …)     |
| `VERSIONED`  | The immutable snapshot path: `.agent/{branch}/plan.vN.md`  |
| `LATEST`     | The canonical "latest" pointer: `.agent/{branch}/plan.md`  |
| `CHECKS`     | The executable acceptance checks: `.agent/{branch}/checks.yaml` |

**Do NOT hardcode or guess the branch name or the version number.**

### Step 2: Write the versioned snapshot AND the latest pointer

Render the plan content using the template structure below, then write **both**
files with **identical content**:

1. Write `${VERSIONED}` (e.g. `.agent/feat-x/plan.v2.md`).
2. Write `${LATEST}` (`.agent/feat-x/plan.md`).

**The template has two tiers — emit them differently:**

| Tier         | Sections                                                                                          | Rule                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Core**     | TL;DR, Requirements, Decisions, Acceptance Criteria, Implementation Order, File Changes, Verification, Progress Log | **Always emit.** These are what the executor reads cold and the `confidence(plan)` gate checks. |
| **Extended** | Background & Context, Technical Approach, Patterns to Follow, Edge Cases, API / Interfaces, Existing Code Survey, Tests, Dependencies, Risks | **Emit only when the section's `Include when` trigger holds.** Omit the whole section otherwise — do not write an empty heading or "N/A". (Existing Code Survey has a *deterministic* trigger — any `create` row in File Changes — and its absence when the trigger holds fails `confidence(plan)` rule #10.) |

**Why two tiers.** Forcing every section on every task is the
over-detailed-upfront-plan failure mode: the empirical evidence is that
reasoning/planning length has a point of diminishing — then *negative* —
returns, and that as-needed decomposition beats fixed maximal decomposition
(see [`../autonomous-workflow/references/anthropic-architecture-research.md`](../autonomous-workflow/references/anthropic-architecture-research.md#5-empirical-evidence-on-plan-artifacts)).
The Core tier carries the parts with measured value (the sprint-contract
Acceptance Criteria, the decisions a cold session would otherwise re-derive,
the scope-bounding File Changes, the done-check Verification). The Extended
tier earns its tokens only when the task is complex enough to need it.

`plan.md` is a mirror of the newest `plan.vN.md`. Readers (executor agent,
VS Code extension, fresh sessions) load `plan.md`. Earlier `plan.v*.md` files
remain on disk as immutable history — never edit or delete them.

> **Rationale.** Versioned snapshots give the user a complete audit trail of
> how the plan evolved (initial → user feedback → auto-replan → …) without
> forcing readers to learn a versioning convention; `plan.md` always works.

### Step 2b: Derive `checks.yaml` from the Acceptance Criteria

**Anchor:** `checks-yaml`

Write `${CHECKS}` — one entry per `AC-{n}` in the plan's Acceptance Criteria.
This is the **executable acceptance artifact**: the executor's Phase 4 loop runs
these checks and gates on them mechanically instead of judging "criteria met"
holistically (see [`phase-4-testing.md#executable-checks-loop`](../autonomous-workflow/rules/phase-4-testing.md#executable-checks-loop)).

```yaml
# .agent/{branch}/checks.yaml — executable acceptance criteria.
# Derived from plan.md Acceptance Criteria by aw-create-plan. Re-derived
# (statuses reset to pending) on every plan iteration.
# EXECUTOR CONTRACT: only `status:` may be flipped freely. `run:`/`setup:`
# may be amended ONLY with a check-run-amended Progress Log entry.
# `id:`, `requirement:`, `ears:`, `expect:` are IMMUTABLE to the executor.
- id: AC-1
  requirement: R1                # positional requirement this check covers
  ears: "When the token is expired, GET /me shall return 401"
  kind: command                  # command | grep | judge
  setup: "seed an expired token via test fixture"   # or "none"
  run: "curl -s -o /dev/null -w '%{http_code}' localhost:3000/me -H 'Authorization: Bearer $EXPIRED'"
  expect: "401"
  status: pending                # pending | pass | fail | unsatisfiable
```

Authoring rules:

1. **One entry per `AC-{n}`** — same IDs as the plan. No orphans in either
   direction (`confidence(plan)` rule #11 checks the sync).
2. **Pin the contract, not the implementation.** `ears` and `expect` are exact;
   `run` is a first draft the executor may finalize against the real code
   (logged). Do not write full test bodies here — that re-introduces the
   cascading-error failure mode ([research §4.4c](../autonomous-workflow/references/planning-quality-research.md#44-executable-plan-artifacts-and-verifier-driven-loops)).
3. **Prefer deterministic kinds.** `command` (exit code / stdout comparison) and
   `grep` (file-content assertion) before `judge`. Use `kind: judge` ONLY for
   criteria with no cheap runner (visual, copy tone) — the executor resolves it
   with a rubric-scored LLM judgment, and a judge check never gates alone.
4. **No placeholder braces** in `run:` — same non-template rule as the plan's
   Verification commands.

Skip writing `checks.yaml` only when the caller explicitly authors a plan
outside the autonomous-workflow Full tier (e.g. `/fix-bug` fast-lane, whose
CEGIS repro contract already fills this role) — its Acceptance Criteria carry
no `AC-{n}` IDs, which is the marker that opts a plan out of rule #11.

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

After writing, verify against the checklist at the bottom of this skill. If any item fails, fix the offending file(s) immediately — `plan.md` and `plan.vN.md` stay byte-identical, and `checks.yaml` IDs stay in sync with the plan's Acceptance Criteria.

---

## Template

**All timestamps MUST use full ISO 8601 with time: `YYYY-MM-DDTHH:MM:SSZ`**

```markdown
---
created: { TIMESTAMP }
version: { N }
branch: { BRANCH }
task: { TASK_DESCRIPTION }
complexity: { LOW | MEDIUM | HIGH }
status: approved
approved: true
---

<!-- `version:` is `1` on the initial write and incremented by `1` on every
     re-write of `plan.md` (user-edit iteration, auto-replan, or any other
     trigger). Read the existing `version:` value before writing and bump it. -->

# Plan: {TASK_DESCRIPTION}

## TL;DR

<!-- **Human review surface — read this first to verify direction before
     approving the plan.** 3-5 sentences covering:

     1. WHAT is being changed (one sentence)
     2. WHY (the problem this solves — one sentence)
     3. HOW (the technical approach — one sentence; this is the
        direction-agreement surface)
     4. DONE when (definition of done — one sentence)

     Technical but brief. A reader should be able to agree or push back on
     the general direction in under 60 seconds of reading. The rest of the
     plan justifies and details this TL;DR. -->

## Background & Context

<!-- EXTENDED — Include when: the "why" is NOT already obvious from the TL;DR, OR
     the task touches an unfamiliar domain / historical context a cold reader needs.
     For a self-evident change, omit this section entirely — the TL;DR carries the why.

     When included: why is this needed? What problem does it solve? Include history
     and motivation from Phase 0 discussion. Write so a reader with zero prior
     context understands the full "why". -->

## Requirements

<!-- ALL requirements from Phase 0. Tag each one. Include non-functional requirements
     (performance, compatibility, security) inline.

     Requirements are implicitly numbered by list position: the first item is R1,
     the second R2, … (Out of Scope items are NOT numbered). Acceptance Criteria
     reference these R-numbers via `(covers: R{n})` — that is the traceability
     contract confidence(plan) rule #9 checks. -->

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

<!-- EXTENDED — Include when: the task is architectural or spans 3+ components /
     packages, OR the approach is non-obvious from the Decisions + Implementation
     Order. For a localized change whose approach is self-evident, omit this section.

     Keep it high-level: architecture, data flow, integration points — NOT function
     bodies or inline error handling. Pinning granular implementation detail upfront
     is what makes planner mistakes cascade into the executor; leave those to the
     executor at implementation time. -->

### Architecture Diagram

<!-- **Optional — include only for complex flows.** Mermaid only (renders in VS
     Code Markdown preview and GitHub). Include this subsection when the task
     touches:

     - 3+ components or packages, OR
     - A state machine or data-flow change, OR
     - A before/after migration / architectural refactor.

     Pick the right diagram kind:
     - `flowchart` for data flow or control flow
     - `sequenceDiagram` for cross-component call sequences
     - `stateDiagram-v2` for state transitions

     **Omit this subsection entirely for simple single-file changes** — boxes
     and arrows on trivial tasks burn tokens without aiding review.

     Example shape:

     ```mermaid
     flowchart LR
       A[Planner] -->|plan.md| B[Executor]
       B --> C{tests pass?}
       C -->|yes| D[PR]
       C -->|no| E[stuck-loop]
     ```
-->

### Patterns to Follow

<!-- EXTENDED — Include when: the change must match a non-obvious existing
     convention a cold session would otherwise miss. Reference specific files as
     examples. Omit when the executor can infer conventions from the files it edits. -->

### Edge Cases

<!-- EXTENDED — Include when: there are non-trivial edge / error cases the
     Acceptance Criteria do not already pin down. Omit for straightforward changes. -->

| Edge Case | Handling |
| --------- | -------- |

### API / Interfaces

<!-- EXTENDED — Include when: the task defines or changes a public interface, type
     signature, or config shape that the executor must implement exactly. Omit if N/A. -->

## Acceptance Criteria

<!-- Concrete, testable pass/fail conditions. This is what "done" means.
     Phase 4 testing gates against these. Avoid vague criteria like "looks
     right" or "works well".

     Format contract (checked by confidence(plan) rules #9/#11):
     - Each criterion carries a unique `AC-{n}` ID and a `(covers: R{m})`
       annotation naming the requirement(s) it verifies (comma-separate for
       multiple: `covers: R1, R3`). Every [user-stated] requirement MUST be
       covered by at least one criterion.
     - PREFER the EARS trigger→response shape — "When <trigger>, the system
       shall <observable response>" (also While/If-then/Where variants). The
       trigger becomes the check's precondition and the shall-response its
       assertion, which is what makes the criterion executable in checks.yaml.
       Criteria that genuinely don't fit trigger→response (visual direction,
       copy tone) keep the ID + covers annotation and use prose; they become
       `kind: judge` checks. -->

- [ ] AC-1 (covers: R1) — When {trigger}, the system shall {observable response}.
- [ ] AC-2 (covers: R2) — {concrete, testable criterion}
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

## Existing Code Survey

<!-- EXTENDED — Include when: the File Changes table has ≥ 1 `create` row that
     introduces a new function / module / component. Omit for modification-only
     plans. This is the anti-reinvention gate: agents measurably re-implement
     existing functionality as semantic clones that review does not catch, so
     the reuse search happens at plan time and is recorded here
     (confidence(plan) rule #10 checks presence when create rows exist).

     One row per planned NEW unit. The "Searched for" column must list the
     concrete searches run (grep terms, def/ref lookups) — a BUILD NEW verdict
     is valid ONLY when it shows the searches that came back empty.
     Verdicts: EXTEND (add to the existing unit instead of creating),
     WRAP (compose the existing unit), BUILD NEW (nothing suitable exists). -->

| Planned new unit | Searched for | Closest existing match | Verdict | Rationale |
| ---------------- | ------------ | ---------------------- | ------- | --------- |
| {new fn/module}  | {searches run} | {path:symbol or none} | {EXTEND \| WRAP \| BUILD NEW} | {why} |

## Tests

<!-- EXTENDED — Include when: test design is non-obvious beyond what the Acceptance
     Criteria + Verification commands already imply (e.g. specific fixtures, edge-case
     cases, or a non-default test strategy). Omit when the Acceptance Criteria already
     define what "tested" means. Specific test cases, not categories — each row is a
     concrete test. -->

| Type        | Test Case      | File   | Validates  |
| ----------- | -------------- | ------ | ---------- |
| unit        | {case}         | {file} | {behavior} |
| integration |                |        |            |
| manual      | {step-by-step} |        |            |

## Dependencies

<!-- EXTENDED — Include when: the task adds, removes, or upgrades a dependency.
     List with versions; mark new additions with [new]. Omit when no dependency
     changes — do not write "None". -->

## Risks

<!-- EXTENDED — Include when: complexity is HIGH, the change is a migration, or any
     operation is irreversible / hard to roll back. Omit for low-risk localized
     changes. -->

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
- [ ] **Frontmatter complete**: created, version, branch, task, complexity, status, approved — all filled
- [ ] **Version field**: `version:` is present in frontmatter and is a positive integer; on a fresh plan it is `1`; on every re-write of `plan.md` it is exactly one greater than the previous value
- [ ] **Timestamps**: All timestamps use ISO 8601 with time (`YYYY-MM-DDTHH:MM:SSZ`)
**Core sections — ALWAYS present:**

- [ ] **TL;DR**: 3-5 sentences covering what / why / approach (HOW) / done. Frames the section as the human-review surface. Direction can be agreed/disagreed in under 60 seconds.
- [ ] **Requirements**: Every requirement tagged `[user-stated]` or `[inferred]`
- [ ] **Decisions**: Every decision includes rejected alternatives and rationale
- [ ] **Acceptance Criteria**: At least one concrete, testable pass/fail condition. Each is verifiable (not "looks right" / "works well"). Each carries a unique `AC-{n}` ID and a `(covers: R{m})` annotation; every `[user-stated]` requirement is covered by at least one criterion (rule #9). EARS trigger→response shape preferred.
- [ ] **Implementation Order**: Numbered, atomic, verifiable steps
- [ ] **File Changes**: Every file listed with action, path, change description, and reason
- [ ] **Verification commands**: Both after-edit and before-PR commands identified
- [ ] **Progress Log**: Carries the full prior history plus a new entry naming `plan.v{N}.md`

**Executable checks artifact:**

- [ ] **checks.yaml written**: one entry per `AC-{n}`, IDs in sync with the plan (rule #11); deterministic `kind` preferred; `judge` used only where no cheap runner exists; no placeholder braces in `run:`; all statuses `pending`

**Extended sections — validate ONLY if the section is present** (each is omitted when its `Include when` trigger does not hold; an omitted Extended section is not a failure):

- [ ] **Background & Context**: if present, a stranger understands the full "why"
- [ ] **Existing Code Survey**: present whenever File Changes has a `create` row (deterministic trigger — rule #10); every row lists the concrete searches run; `BUILD NEW` verdicts show searches that returned nothing
- [ ] **Technical Approach**: if present, specific enough to implement without conversation context, and stays high-level (no pinned function bodies)
- [ ] **Architecture Diagram**: if the task is multi-component / state-flow / migration, a Mermaid `flowchart` / `sequenceDiagram` / `stateDiagram-v2` is included under `## Technical Approach`
- [ ] **Patterns to Follow**: if present, references actual files in the codebase
- [ ] **Edge Cases**: if present, each has a concrete handling
- [ ] **API / Interfaces**: if present, signatures / config shapes are concrete
- [ ] **Tests**: if present, specific test cases (not just "unit tests for X")
- [ ] **Dependencies**: present only when a dependency changed; versions listed, new ones marked `[new]`
- [ ] **Risks**: if present, each has likelihood / impact / mitigation

**Always:**

- [ ] **Self-contained**: A new Claude session can execute from `plan.md` alone

---

## Common Failures

| Failure                              | Fix                                                                   |
| ------------------------------------ | --------------------------------------------------------------------- |
| Sparse sections ("TBD", "see above") | Fill from conversation context — every section you DO emit must be self-contained |
| Empty Extended heading or "N/A" body | Omit the Extended section entirely — Extended sections are include-or-omit, never stubbed |
| Missing decisions rationale          | Add "Alternatives Rejected" and "Rationale" for each decision         |
| Vague implementation steps           | Make each step atomic: "Add X to file Y" not "implement feature"      |
| No file paths in Patterns            | Reference specific existing files, not abstract descriptions          |
| Requirements not tagged              | Add `[user-stated]` or `[inferred]` to every requirement              |
| Timestamps missing time component    | Use `2026-03-07T14:30:00Z` not `2026-03-07`                           |
| Wrote only `plan.md`, no `plan.vN.md` | Re-run Step 1 to compute `N`, then write the snapshot too           |
| Wrote `plan.vN.md` but forgot to update `plan.md` | Copy the new snapshot's content over `plan.md`            |
| Edited an existing `plan.vN.md`      | Restore from git (or re-derive from history); snapshots are immutable |
| Reused a version number              | Re-run Step 1; older snapshots must never be overwritten              |
| ACs without `AC-{n}` IDs or `covers:` annotations | Add both — rule #9 fails on an uncovered `[user-stated]` requirement |
| `create` rows but no Existing Code Survey | Run the reuse searches, add the section — rule #10 fails otherwise |
| Forgot `checks.yaml` (or IDs drifted from plan) | Re-run Step 2b — one entry per `AC-{n}`, IDs in sync (rule #11)   |
| `checks.yaml` full of `kind: judge` entries | Rework criteria toward EARS trigger→response so deterministic runners exist |
