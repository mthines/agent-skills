---
title: 'Phase 1: Task Intake & Planning'
impact: HIGH
tags:
  - planning
  - analysis
  - phase-1
  - confidence-gate
---

# Phase 1: Task Intake & Planning

Deep codebase analysis and implementation planning. Phase 1 is **in-conversation
only** — `plan.md` is written in [Phase 2](./phase-2-worktree.md#plan-generation)
inside the worktree, never on the main branch.

> **Order of operations:** research (parallel `Explore` if complex) →
> optional `holistic-analysis` → technical design (incl. Existing Code Survey
> for planned `create`s + executable checks drafting) → `code-quality(plan)` →
> `confidence(plan)` gate → Phase 2.

## Contents

- [Prerequisite Gate](#prerequisite-gate)
- [Core Principles](#core-principles)
- [Parallel Research](#parallel-research)
- [Step 1: Analyze Codebase](#step-1-analyze-codebase)
- [Complex Task Detection](#complex-task-detection)
- [Step 2: Draft Technical Design](#step-2-draft-technical-design)
  - [Existing Code Survey (anti-reinvention)](#existing-code-survey-anti-reinvention)
  - [Draft traceable, executable Acceptance Criteria](#2d-draft-traceable-executable-acceptance-criteria)
- [Design Quality](#design-quality)
- [Spec Emission (UI tasks)](#spec-emission-ui-tasks)
- [Confidence Gate](#confidence-gate)
- [Planner-Executor Handoff](#planner-executor-handoff)
- [Planning Checklist](#planning-checklist)
- [References](#references)

---

## Prerequisite Gate

Before any Phase 1 work, the [Phase 0](./phase-0-validation.md) MODE SELECTION
block must already be emitted and the user must have said "proceed".

| Tier      | Criteria                                        | Plan output                  | `confidence(plan)` |
| --------- | ----------------------------------------------- | ---------------------------- | ------------------ |
| **Full**  | complex / architectural / unfamiliar / 4+ files | `plan.md` required (Phase 2) | **Mandatory — cannot be disabled** |
| **Lite**  | 2–3 files AND simple                            | Brief mental plan only       | Skipped            |
| **Micro** | 1 file, purely mechanical                       | None                         | Skipped            |

The remainder of this rule covers Full Mode.
Lite and Micro skip to Phase 2 with a short mental plan (Micro: none).
`confidence(plan)` is mandatory in **Full Mode only** — it is the workflow's one non-removable companion, and its deterministic rule checks require a `plan.md` on disk.
Lite Mode's plan is inline (no `plan.md`), so the gate's deterministic checks are unsatisfiable and the gate is skipped; Micro skips all quality companions.

---

## Core Principles

- **Understand before changing** — read existing code thoroughly.
- **Follow existing patterns** — consistency with the codebase wins.
- **Plan file changes precisely** — know exactly what to modify.
- **Self-validate** — the `confidence(plan)` gate is mandatory.
- **Capture everything from Phase 0** — every decision, requirement, rejected
  alternative, edge case, and rationale must end up in `plan.md`.
- **Write for a future reader** — assume zero context from the original
  conversation.

---

## Lessons Read

**Anchor:** `lessons-read`

Before research, load the workflow's accumulated lessons so prior mistakes bias
the plan. This is the **fast tier** of the self-improvement loop — full contract
in [`self-improvement-loop.md`](./self-improvement-loop.md#fast-tier--read-lessons).

Two-tier fan-out — universal lessons from `home` always, project-shared from
the cwd repo when the team has opted in:

```
Skill("persistent-memory", "read aw-lessons --tier home")     # skips silently if not installed
if [ -f memory/aw-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read aw-lessons --tier project-shared")
fi
```

1. Union the two INDEXes. Match each lesson's `trigger-context` against the
   current task (file globs, task type, tech). Load full entries only for
   matches (progressive disclosure). Tier-of-origin is not a match criterion;
   if a `home` and a `project-shared` lesson conflict, project-shared wins
   (closer scope) — log the conflict.
2. Treat each matching lesson's *"What to do next time"* as a **consideration**
   on the plan — apply it unless it conflicts with the user's stated intent or
   task-specific constraints. Record applied lessons in `plan.md` under
   `## Lessons applied`.
3. Lessons are **advisory**: they bias the plan, never silently change a gate,
   skip a phase, or override the user's intent. If a lesson conflicts with the
   user's intent, the user wins — surface the conflict.
4. **Promotion check:** if any matched lesson has `seen_count >= 3` or
   `status: structural`, surface the one-line promotion suggestion from
   [`self-improvement-loop.md#lesson-promotion`](./self-improvement-loop.md#lesson-promotion).

Log:

```markdown
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier home) — N lessons matched, applied as constraints
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier project-shared) — M lessons matched (project opted in)
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons --tier project-shared) — not opted in (no memory/aw-lessons/), skipping
- [TIMESTAMP] Phase 1: persistent-memory(read aw-lessons) — not available, continuing
```

Disable by removing this invocation (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Parallel Research

**Anchor:** `parallel-research`

Use parallel `Explore` sub-agents when **any** of the following holds:

| Trigger                        | Detection                                     |
| ------------------------------ | --------------------------------------------- |
| 5+ files likely touched        | From Phase 0 scope estimate                   |
| 2+ packages involved           | `nx show projects --affected` or path guess   |
| User flagged complex/unfamiliar| Phrases like "complex", "unfamiliar", "deep"  |

### Fan-out pattern

Dispatch one sub-agent per concern in a single message. Suggested split:

| Sub-agent       | Scope                                                     |
| --------------- | --------------------------------------------------------- |
| Per-package     | One agent per affected package — read entry points, types |
| Past PRs        | `gh pr list` + `gh pr view` for related historical work   |
| Docs            | `README.md`, `CLAUDE.md`, `skills/*/SKILL.md`, `.claude/` |

Each sub-agent returns: relevant file paths, key functions, conventions to
follow, gotchas. Synthesize their reports into the planning context.

```bash
# Example dispatch concern-list (logical, not literal)
# Explore: package gw-tool — entry points, types, command pattern
# Explore: package autonomous-workflow-agent — phase rules, companion invocation
# Explore: past PRs — gh pr list --search "worktree" --limit 10
# Explore: docs — CLAUDE.md, skills/<relevant-skill>/SKILL.md
```

For simple tasks (under the trigger thresholds), do sequential research using
`Glob`, `Grep`, `Read` directly — sub-agent overhead isn't worth it.

---

## Step 1: Analyze Codebase

**Project structure**

- Identify relevant directories / modules
- Map dependencies between components
- Locate configuration files

Tools: `nx_workspace`, `nx_project_details`, `Glob`.

**Existing patterns**

- Find similar features already implemented
- Study code style and naming conventions
- Understand error handling
- Review testing patterns

Tools: `Grep`, `Read`.

**Localize by the dependency graph first, keywords second.** Graph-guided
localization measurably beats flat keyword/embedding retrieval for finding
where relevant code already lives (see
[`references/planning-quality-research.md#41-codebase-grounded-planning-anti-reinvention`](../references/planning-quality-research.md#41-codebase-grounded-planning-anti-reinvention)).
Concretely, in this order:

1. **Definitions** — `Grep` for the symbol/concept's definition sites
   (`function <name>`, `class <name>`, `export`), not just occurrences.
2. **References** — from each definition, follow its callers and imports
   (grep the symbol across the repo; read the importing files).
3. **Coarse graph** — in a monorepo, `nx graph` / `nx show projects --affected`
   (or the equivalent) bounds which packages participate before any file-level
   search.
4. **Keyword sweep last** — free-text grep only to catch what the def/ref walk
   missed.

The def/ref walk is what feeds the
[Existing Code Survey](#existing-code-survey-anti-reinvention) below — record
the searches as you run them.

**Technology stack**

- Framework version and features
- Build tools and configuration
- Testing framework and conventions

---

## Complex Task Detection

**Anchor:** `complex-task-detection`

If the task triggers complexity (5+ files, 2+ packages, OR user calls it
complex / unfamiliar / deep), invoke the `holistic-analysis` companion to trace
the end-to-end execution path before designing.

```
Skill("holistic-analysis")     # skips silently if not installed
```

Log to the conversation and to `plan.md` Progress Log:

```markdown
- [TIMESTAMP] Phase 1: holistic-analysis() — invoked
- [TIMESTAMP] Phase 1: holistic-analysis() — not available, continuing
```

Use the holistic findings to refine the technical approach before drafting
file-level changes. Disable this step by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Step 2: Draft Technical Design

Be specific. The design feeds `code-quality(plan)` next, then `confidence(plan)`.

### 2a. Capture Phase 0 context

Capture context broadly *in conversation* now — it is cheap and you may need it.
What actually gets written to `plan.md` is tiered by `aw-create-plan`: the Core
sections (requirements, decisions, acceptance criteria, implementation order,
file changes, verification) are always persisted; the Extended sections below
(background, edge cases, API, patterns) are persisted only when their
`Include when` trigger holds. Gather all of it; let `aw-create-plan` decide what
to persist.

Transfer the relevant Phase 0 discussion into the in-conversation plan draft (the
`aw-create-plan` skill will write it to disk in Phase 2):

- **Background & context** — why this change is needed
- **Every requirement** — explicit and implicit
- **Every decision** — what was decided, alternatives considered, why
- **Out-of-scope items** — what was discussed but excluded
- **Edge cases** — every case identified + agreed handling

### 2b. Document the technical approach

- **Architecture / design** — component interactions, data flow, integration points
- **Patterns to follow** — reference specific existing files as examples
- **API / interface design** — actual type signatures, function signatures, config shapes
- **Implementation order** — numbered sequence for Phase 3

### 2c. Detail file changes

Use one consolidated table:

```markdown
| Action | File                | Change                 | Reason             |
| ------ | ------------------- | ---------------------- | ------------------ |
| create | path/to/new-file.ts | Purpose / key exports  | Why needed         |
| modify | path/to/existing.ts | Specific modifications | Why this change    |
| modify | README.md           | Add feature docs       | User-facing change |
```

### Existing Code Survey (anti-reinvention)

**Anchor:** `existing-code-survey`

For **every `create` row** that introduces a new function / module / component,
run a reuse search and record the verdict — before the design is locked in.
LLM agents measurably re-implement existing functionality as **semantic
clones** (textually different, functionally equivalent), and downstream review
is documented *not* to catch them — so the gate lives here, at plan time
(evidence in [`references/planning-quality-research.md#41`](../references/planning-quality-research.md#41-codebase-grounded-planning-anti-reinvention)).

For each planned new unit:

1. **Search by responsibility, not name.** Grep 2–3 phrasings of what the unit
   *does* (e.g. for a `formatCurrency` helper: `format`, `currency`, `Intl`,
   `money`), plus the def/ref walk from Step 1.
2. **Judge overlap functionally.** A candidate with a different name and shape
   but the same responsibility is a match — name/text similarity is explicitly
   the wrong signal for this.
3. **Record the verdict:**

| Verdict     | Meaning                                            | Requirement                                     |
| ----------- | -------------------------------------------------- | ----------------------------------------------- |
| `EXTEND`    | Add capability to the existing unit — don't create | Update the File Changes row: modify, not create |
| `WRAP`      | Compose/adapt the existing unit                    | New unit delegates; no duplicated logic         |
| `BUILD NEW` | Nothing suitable exists                            | Valid ONLY with the empty-returning searches recorded |

The survey lands in `plan.md` as the `## Existing Code Survey` Extended section
(deterministic trigger: any `create` row — `confidence(plan)` rule #10 fails a
plan that creates without surveying). Search quality is scored by the gate's
Completeness dimension: "looked around" is not a search record.

### 2d. Define testing strategy with specific cases

```markdown
| Type        | Test Case              | File              | Validates          |
| ----------- | ---------------------- | ----------------- | ------------------ |
| unit        | handles empty input    | processor.spec.ts | Returns default    |
| unit        | rejects invalid config | config.spec.ts    | Throws ConfigError |
| integration | end-to-end flow        | feature.e2e.ts    | Full pipeline      |
| manual      | toggle and verify      | —                 | Visual check       |
```

### 2d². Draft traceable, executable Acceptance Criteria

**Anchor:** `acceptance-criteria-drafting`

Acceptance Criteria follow the format contract in the
[`aw-create-plan` template](../../aw-create-plan/SKILL.md#template):

- Each criterion carries a unique `AC-{n}` ID and a `(covers: R{m})`
  annotation naming the requirement(s) it verifies. Every `[user-stated]`
  requirement must be covered — `confidence(plan)` rule #9 fails otherwise.
- **Prefer the EARS trigger→response shape**: "When `<trigger>`, the system
  shall `<observable response>`" (`While` / `If…then` / `Where` variants for
  state, unwanted-behavior, and feature-scoped criteria). The fixed shape is
  what makes a criterion machine-checkable: trigger → check precondition,
  shall-response → check assertion.
- For each criterion, sketch **how a machine verifies it** — a command, an
  HTTP call + expected status, a grep. These sketches become the `checks.yaml`
  entries `aw-create-plan` writes in Phase 2 (one per `AC-{n}`; rule #11 keeps
  them in sync). A criterion with no conceivable runner is either rewritten or
  explicitly marked as a `judge` check (rubric-scored, never gates alone).

### 2e. Define verification commands

| When           | Command (example)                                  |
| -------------- | -------------------------------------------------- |
| After edit     | `npx tsc --noEmit`, `go vet ./...`, `nx run X:check` |
| Before PR      | `nx run-many -t test build lint`, `pnpm test`        |

Check `package.json`, `Makefile`, `nx.json`, or project config to determine the
right commands.

### 2f. Document risks with mitigations

```markdown
| Risk                | Likelihood | Impact | Mitigation              |
| ------------------- | ---------- | ------ | ----------------------- |
| Breaking API change | LOW        | HIGH   | Add deprecation warning |
```

---

## Design Quality

**Anchor:** `design-quality`

After drafting the technical approach but **before** the confidence gate,
invoke `code-quality` in `plan` mode. Purpose: shape the design toward
low-complexity structures **before** writing code (early returns,
single-responsibility, naming, function size). Cheaper than refactoring later.

```
Skill("code-quality", "plan")     # skips silently if not installed
```

Apply suggestions to the design. Log:

```markdown
- [TIMESTAMP] Phase 1: code-quality(plan) — applied (N suggestions integrated)
- [TIMESTAMP] Phase 1: code-quality(plan) — not available, continuing
```

Disable by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Spec Emission (UI tasks)

**Anchor:** `spec-emission-anchor`

After the technical approach is drafted but **before** the confidence gate,
emit a `specs.md` file when the task touches a UI surface. This is the
planning-time deliverable that `aw-tester` consumes in Phase 4.

### Heuristic: does the task touch a UI surface?

Check the `## File changes` table in the in-conversation plan draft. If ANY
planned file matches these patterns, emit `specs.md`:

- `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`
- `*.css`, `*.module.css`, `*.scss`
- Files in `/pages/`, `/app/`, `/routes/`, `/layouts/`, `/components/`

If zero files match, skip spec emission entirely and log:

```markdown
- [TIMESTAMP] Phase 1: spec-emission — skipped (no UI files in plan)
```

### Aw-Target prerequisite check

Before emitting specs, verify an aw-target exists:

```bash
ls .claude/aw-targets/*.yml 2>/dev/null | head -1
```

If no aw-target file exists, **halt and tell the user**:

```
This task touches UI files. Spec-driven verification requires an aw-target.
Run /aw-setup to scaffold .claude/aw-targets/local.yml before proceeding.
This is a one-time setup (~2 minutes). The planner will pause here.

After /aw-setup completes, reply "continue" and the planner will resume.
```

Wait for the user to confirm `/aw-setup` is done. Do NOT auto-scaffold.
Do NOT attempt to run `/aw-setup` yourself — it is interactive and requires
user input. If the aw-target's `auth.storage_state` file is older than 7 days,
warn but do not halt:

```markdown
- [TIMESTAMP] Phase 1: spec-emission — auth state at {path} is {N} days old;
  consider re-running /aw-setup to refresh before execution.
```

### What to emit

Write `specs.md` alongside `plan.md`. Follow the format in
[`templates/specs.md.template`](../templates/specs.md.template).

Guidelines for the planner when writing specs:

- Write one spec per **user goal**, not per implementation step.
- Prefer `verify-only` for refactors and small UI fixes (most specs).
- Use `critical-path` only for acceptance criteria that must be permanently
  regression-tested (major new flows, core user journeys).
- Locator descriptors: `{role: ..., name: ...}` preferred. Never CSS selectors.
- Keep spec flow steps to 3–6 steps. Long flows should be broken into
  `continues-from` chains.
- Placeholder syntax: `{dashboardId}` resolves from `aw-target.fixtures.references`.
  Use only references that exist in the aw-target file.
- Network assertions: include only when the AC explicitly requires a specific
  HTTP status or response shape.

### Spec file path

Write to `.agent/{branch}/specs.md` in Phase 2 (alongside `plan.md`), never
on the main branch. The specs file is a planning artifact — it lives in
`.agent/` and is gitignored alongside `plan.md`.

Log:

```markdown
- [TIMESTAMP] Phase 1: spec-emission — {N} specs drafted (aw-target: {name},
  {critical-path-count} critical-path, {verify-only-count} verify-only)
- [TIMESTAMP] Phase 1: spec-emission — skipped (no UI files in plan)
- [TIMESTAMP] Phase 1: spec-emission — halted (no aw-target; user told to run /aw-setup)
```

---

## Adversarial Pre-Mortem

**Anchor:** `adversarial-pre-mortem`

**Opt-in only.** Run this step **only** when the user passed `--critical` to
the workflow. Skip silently otherwise — no auto-engage heuristics at this stage.

Purpose: surface plan defects that pass static rules but would fail under
adversarial review, and force exploration of at least one alternative design
before the confidence gate locks the plan in.

Run between `code-quality(plan)` and `confidence(plan)`:

```
Skill("critical", "plan")
```

Treat the output as follows:

- **Must-fix** items → plan defects. Update the technical approach (or
  `plan.md` if it has been drafted) to address them before the confidence
  gate runs.
- **Should-fix / Nice-to-have** items → log as plan notes; address only if
  they meaningfully improve the design.
- **Steelman alternative** → preserve verbatim under a `## Considered
  alternatives` section of the plan. This is the load-bearing differentiator
  vs. `code-quality` and `confidence` — record it even when the chosen
  approach wins.

`critical` is **advisory** — it does not gate. `confidence(plan)` remains the
only mandatory gate. Never bypass confidence on the strength of a clean
adversarial pass.

Log:

```markdown
- [TIMESTAMP] Phase 1: critical(plan) — applied (N must-fixes addressed, steelman recorded)
- [TIMESTAMP] Phase 1: critical(plan) — not available, continuing
- [TIMESTAMP] Phase 1: critical(plan) — skipped (no --critical flag)
```

Disable by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Confidence Gate

**Anchor:** `confidence-gate`

**MANDATORY in Full Mode only. Cannot be disabled there.**
Lite Mode skips this gate — its plan is inline and the gate's deterministic rules require a `plan.md`.
Micro skips all quality companions, this one included.

After design is finalized and `code-quality(plan)` suggestions are applied,
run the plan-confidence gate:

```
Skill("confidence", "plan")
```

| Score   | Action                                                         |
| ------- | -------------------------------------------------------------- |
| ≥ 90%   | Proceed to Phase 2                                             |
| < 90%   | Up to 2 iterations: more research / analysis / evidence, then re-run |
| < 90% after 2 iterations | Present findings to user; ask whether to proceed or refine further |

Log every confidence run to `plan.md` Progress Log:

```markdown
- [TIMESTAMP] Phase 1: confidence(plan) — 92% (passed gate)
- [TIMESTAMP] Phase 1: confidence(plan) — 84% (iteration 1, gathering more evidence)
- [TIMESTAMP] Phase 1: confidence(plan) — 88% (iteration 2, asking user)
```

**Do NOT proceed to Phase 2 until the confidence gate passes or the user
explicitly approves a lower score.**

---

## Planner-Executor Handoff

This phase ends with the confidence gate. After `plan.md` is gated, the
planner agent stops at the end of Phase 2 and hands off to the executor — see
[`planner-executor-handoff.md`](./planner-executor-handoff.md) for the
contract and message format.

---

## Planning Checklist

- [ ] `persistent-memory(read aw-lessons --tier home)` invoked; matching lessons applied as constraints (anchor: `lessons-read`)
- [ ] Codebase analyzed (structure, patterns, stack) — dependency-graph localization (def/ref walk) before keyword sweep
- [ ] Parallel `Explore` sub-agents used if complexity triggered (anchor: `parallel-research`)
- [ ] `holistic-analysis` invoked if complexity triggered (anchor: `complex-task-detection`)
- [ ] Technical approach designed with specific file references
- [ ] Existing Code Survey completed for every planned `create` — searches recorded, verdicts assigned (anchor: `existing-code-survey`)
- [ ] Acceptance Criteria carry `AC-{n}` IDs + `(covers: R{m})` annotations; every `[user-stated]` requirement covered; EARS shape preferred; a runner sketched per criterion (anchor: `acceptance-criteria-drafting`)
- [ ] `code-quality(plan)` invoked and design refined (anchor: `design-quality`)
- [ ] UI surface check: if plan touches UI files, aw-target exists OR user told to run `/aw-setup`; `specs.md` drafted or skip logged (anchor: `spec-emission-anchor`)
- [ ] `confidence(plan)` ≥ 90% OR user-approved (anchor: `confidence-gate`)
- [ ] Companion invocations logged (will move to `plan.md` Progress Log in Phase 2)

**Phase 1 ends in conversation. The `plan.md` artifact is generated in
[Phase 2](./phase-2-worktree.md#plan-generation).**

---

## References

- Previous phase: [phase-0-validation](./phase-0-validation.md)
- Next phase: [phase-2-worktree](./phase-2-worktree.md)
- Companion registry: [companion-skills](./companion-skills.md)
- Related skill: [`confidence`](../../../quality/confidence/SKILL.md)
- Related skill: [`code-quality`](../../../quality/code-quality/SKILL.md)
- Related skill: [`holistic-analysis`](../../../analysis/holistic-analysis/SKILL.md)
- Related skill: [`aw-create-plan`](../../aw-create-plan/SKILL.md)
- Related rule: [`phase-4-spec-verification.md`](./phase-4-spec-verification.md) — where specs.md is consumed
- Related rule: [`phase-4-testing.md#executable-checks-loop`](./phase-4-testing.md#executable-checks-loop) — where checks.yaml is consumed
- Research basis: [`references/planning-quality-research.md`](../references/planning-quality-research.md) — anti-reinvention, spec fidelity, clarify-or-abstain, executable checks
- Setup skill: [`aw-setup/SKILL.md`](../aw-setup/SKILL.md) — aw-target scaffolding
- Template: [`templates/specs.md.template`](../templates/specs.md.template) — spec format reference
