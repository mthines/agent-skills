---
name: aw-create-plan
description: >
  Create the plan artifact (plan.md + checks.yaml executable acceptance checks)
  in `.agent/{branch}/` from the current conversation context. Captures all
  Phase 0-1 discussion into a structured, self-contained document that enables
  context recovery and session handoff. On every invocation, writes plan.md and
  re-derives checks.yaml from the Acceptance Criteria; an immutable plan.vN.md
  snapshot is written only in opt-in snapshot mode (`Skill("aw-create-plan",
  "snapshot")`). Use after planning is complete and confidence gate passes —
  and again on every plan iteration (user-requested refinement or Phase 4
  auto-replan). Triggers on create plan, generate plan, write plan artifact,
  regenerate plan, iterate on plan.
license: MIT
disable-model-invocation: false
argument-hint: '[snapshot]'
metadata:
  author: mthines
  version: '2.2.0'
  workflow_type: advisory
---

# Create Plan Artifact

Generate `.agent/{branch-name}/plan.md` — the planner→executor handoff document — alongside `checks.yaml`, the executable acceptance checks derived from the Acceptance Criteria.

**A new Claude session MUST be able to execute from `plan.md` alone without the original conversation.**

**`plan.md` is a handoff artifact, not an exhaustive knowledge base.** Keep it lean (see the Core/Extended tiering in Step 2). `checks.yaml` is the **living contract** — it is re-derived on every iteration (statuses reset to `pending`) and self-validates against reality on every executor loop, so it does not go stale the way prose does. When something is unclear, prefer asking the still-running planner agent (or the user) over bloating the document to answer every future question.

## Snapshot mode (opt-in)

**By default this skill writes only `plan.md`** (overwritten in place each iteration; the `version:` frontmatter is the iteration counter). `.agent/` is gitignored per-developer scratch, so immutable `plan.vN.md` snapshot chains are **not** written by default — they are rarely re-read and cost a redundant write per iteration, with no measured effect on task success ([research §5.4](../autonomous-workflow/references/anthropic-architecture-research.md#54-what-is-not-evidence-backed)).

**Opt in to snapshots** with `Skill("aw-create-plan", "snapshot")` — then the skill also writes an immutable `plan.v{N}.md` alongside `plan.md` (`plan.v1.md`, `plan.v2.md`, … as history) for a durable audit trail of the plan's evolution. Everything below marked **(snapshot mode)** applies only then.

### How the mode arg is read (disambiguation)

The arg slot is overloaded — some callers pass a short mode flag, others a whole plan body. Resolve it before anything else: **snapshot mode is on iff the trimmed arg is exactly `snapshot` or `--snapshot`** (case-insensitive, a single bare token). **Every other arg — empty, or a multi-line `plan.md` body — is default mode (no snapshot).** In particular, orchestrators like [`/fix-bug`](../fix-bug/rules/autonomous-handoff.md) pass the whole plan body here (`Skill("aw-create-plan", "<full plan.md body>")`), which is default mode by design — the fast lane opts out of snapshots anyway.

---

## Prerequisites

Before invoking this skill:

1. Phase 0 (Validation) must be complete — requirements confirmed with user
2. Phase 1 (Planning) must be complete — codebase analyzed, decisions made
3. Confidence gate should have passed (90%+ on plan mode)
4. A worktree must exist — plan.md is created INSIDE the worktree, never on main

---

## Procedure

### Step 1: Determine target paths (and next version, snapshot mode only)

First resolve the mode per [How the mode arg is read](#how-the-mode-arg-is-read-disambiguation)
above. Set `SNAPSHOT=1` only when the trimmed arg is exactly `snapshot` /
`--snapshot`; otherwise leave it unset. Then compute the artifact directory and
the files this skill will write — do NOT guess the branch name or the version:

```bash
# SNAPSHOT=1 only in snapshot mode (arg == "snapshot"/"--snapshot"); unset otherwise.
BRANCH=$(git branch --show-current)
DIR=".agent/${BRANCH}"
mkdir -p "${DIR}"
echo "DIR=${DIR}"
echo "LATEST=${DIR}/plan.md"
echo "CHECKS=${DIR}/checks.yaml"

# Snapshot mode ONLY — skip this block entirely in default mode so no
# plan.v{N}.md path is even computed (let alone written):
if [ -n "${SNAPSHOT:-}" ]; then
  NEXT=$(ls "${DIR}" 2>/dev/null \
    | sed -n 's/^plan\.v\([0-9][0-9]*\)\.md$/\1/p' \
    | sort -n | tail -1)
  NEXT=$(( ${NEXT:-0} + 1 ))
  echo "VERSION=${NEXT}"
  echo "VERSIONED=${DIR}/plan.v${NEXT}.md"
fi
```

| Output       | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `LATEST`     | The canonical plan: `.agent/{branch}/plan.md` (always written) |
| `CHECKS`     | The executable acceptance checks: `.agent/{branch}/checks.yaml` (always written) |
| `VERSION`    | **(snapshot mode)** The next version number (1 on first run, 2 on next, …) |
| `VERSIONED`  | **(snapshot mode)** The immutable snapshot path: `.agent/{branch}/plan.vN.md` |

**Do NOT hardcode or guess the branch name or the version number.**

### Step 2: Write `plan.md` (and the versioned snapshot in snapshot mode)

Render the plan content using the template structure below, then write it:

1. Write `${LATEST}` (`.agent/feat-x/plan.md`) — **always**.
2. **(snapshot mode only)** Also write `${VERSIONED}` (e.g. `.agent/feat-x/plan.v2.md`) with **byte-identical content** to `plan.md`.

In default (non-snapshot) mode, only `plan.md` is written — it is overwritten in place, and the `version:` frontmatter field still increments so the iteration counter is preserved without a separate file.

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

Readers (executor agent, VS Code extension, fresh sessions) always load
`plan.md`. **(snapshot mode)** `plan.md` is a byte-identical mirror of the
newest `plan.vN.md`, and earlier `plan.v*.md` files remain on disk as
immutable history — never edit or delete them.

> **Rationale.** In snapshot mode the versioned files give the user a complete
> audit trail of how the plan evolved (initial → user feedback → auto-replan →
> …) without forcing readers to learn a versioning convention; `plan.md`
> always works. Snapshot mode is opt-in because that audit trail is rarely
> re-read and `.agent/` is gitignored scratch (see [Snapshot mode](#snapshot-mode-opt-in)).

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
write must name the version explicitly so the trail is legible. In default
mode the version is the `version:` frontmatter value it bumped to; in snapshot
mode it names the `plan.vN.md` file:

```markdown
- [{TIMESTAMP}] Phase 1: plan v1 created (initial plan)
- [{TIMESTAMP}] Phase 1: plan v2 created (iteration — user requested broader scope)
- [{TIMESTAMP}] Phase 4: plan v3 created (auto-replan after holistic-analysis)
```

**(snapshot mode)** The same Progress Log lives in **all** versions — newer
versions carry the full history of older versions plus their own new entry.
This keeps each `plan.vN.md` file self-contained.

### Step 4: Validate completeness

After writing, verify against the checklist at the bottom of this skill. If any item fails, fix the offending file(s) immediately — in snapshot mode `plan.md` and `plan.vN.md` stay byte-identical, and `checks.yaml` IDs stay in sync with the plan's Acceptance Criteria.

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

After writing, verify ALL of the following. **Fix any failures immediately.**

- [ ] **File location**: File(s) inside the worktree at `.agent/{branch}/` (NOT on main)
- [ ] **plan.md written**: `.agent/{branch}/plan.md` exists and is complete
- [ ] **(snapshot mode) Snapshot valid**: `plan.vN.md` written byte-identical to `plan.md`; `N` is exactly one above the highest existing `plan.v*.md` (1 on first run); pre-existing snapshots untouched
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
- [ ] **Progress Log**: Carries the full prior history plus a new entry for this write (naming `plan.v{N}.md` in snapshot mode, or the `version:` it bumped to otherwise)

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
| Snapshot mishandled | Snapshots are opt-in (`snapshot` arg) — never write `plan.vN.md` in default mode; in snapshot mode keep `plan.md` mirroring the newest `plan.vN.md`, and never edit a snapshot or reuse a version number (re-run Step 1) |
| ACs without `AC-{n}` IDs or `covers:` annotations | Add both — rule #9 fails on an uncovered `[user-stated]` requirement |
| `create` rows but no Existing Code Survey | Run the reuse searches, add the section — rule #10 fails otherwise |
| Forgot `checks.yaml` (or IDs drifted from plan) | Re-run Step 2b — one entry per `AC-{n}`, IDs in sync (rule #11)   |
| `checks.yaml` full of `kind: judge` entries | Rework criteria toward EARS trigger→response so deterministic runners exist |
