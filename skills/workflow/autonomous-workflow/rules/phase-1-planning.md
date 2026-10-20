---
title: 'Phase 1: Task Intake & Planning'
impact: HIGH
tags:
  - planning
  - analysis
  - phase-1
  - brief-validation
---

# Phase 1: Task Intake & Planning

Deep codebase analysis and implementation planning. Phase 1 is **in-conversation
only** — `plan.md` is written in [Phase 2](./phase-2-worktree.md#plan-generation)
inside the worktree, never on the main branch.

> **Order of operations:** research (parallel `Explore` if complex) →
> optional execution-path trace → technical design (incl. Existing Code Survey
> for planned `create`s + executable checks drafting) →
> optional `critical(plan)` → brief validation → Phase 2.
>
> On Full, `aw` writes the brief per [`aw/rules/full-tier.md`](../aw/rules/full-tier.md) and spends minutes here, not an hour: name the files and entry points, then let the executor discover the rest.
> Read [`corrections.md`](./corrections.md) first — C1 and C2 shape the brief.

## Contents

- [Prerequisite Gate](#prerequisite-gate)
- [Core Principles](#core-principles)
- [Parallel Research](#parallel-research)
- [Step 1: Analyze Codebase](#step-1-analyze-codebase)
- [Complex Task Detection](#complex-task-detection)
- [Step 2: Draft Technical Design](#step-2-draft-technical-design)
  - [Existing Code Survey (anti-reinvention)](#existing-code-survey-anti-reinvention)
  - [Draft traceable, executable Acceptance Criteria](#2d-draft-traceable-executable-acceptance-criteria)
- [Spec Emission (UI tasks)](#spec-emission-ui-tasks)
- [Adversarial Pre-Mortem](#adversarial-pre-mortem)
- [Brief Validation](#brief-validation)
- [Brief Handoff](#brief-handoff)
- [Planning Checklist](#planning-checklist)
- [References](#references)

---

## Prerequisite Gate

Before any Phase 1 work, the [Phase 0](./phase-0-validation.md) MODE SELECTION
block must already be emitted and the user must have said "proceed".

| Tier      | Criteria                                        | Plan output                  | Brief validation |
| --------- | ----------------------------------------------- | ---------------------------- | ------------------ |
| **Full**  | complex / architectural / unfamiliar / 4+ files | `plan.md` required (Phase 2) | **Mandatory** (deterministic) |
| **Lite**  | 2–3 files AND simple                            | Brief mental plan only       | Skipped            |
| **Micro** | 1 file, purely mechanical                       | None                         | Skipped            |

The remainder of this rule covers Full Mode.
Lite and Micro skip to Phase 2 with a short mental plan (Micro: none).
Brief validation runs in **Full Mode only**, because its checks need a `plan.md` on disk; Lite's plan is inline and Micro has none.

---

## Core Principles

- **Understand before changing** — read existing code thoroughly.
- **Follow existing patterns** — consistency with the codebase wins.
- **Plan file changes precisely** — know exactly what to modify.
- **Validate deterministically** — the brief passes its [validation](#brief-validation) before dispatch.
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

Narrow-to-broad read over LoreKit (tag `loop::aw-lessons`) — project-bound
lessons for this repo, then universal lessons that follow the user everywhere:

```
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-lessons"], limit: 50 }   # no-op if memory.* not connected
memory.list { scope: "global",               tags: ["loop::aw-lessons"], limit: 50 }
```

1. Union the results. Match each lesson's **Applies when** line against the
   current task (file globs, task type, tech); consider full entries only for
   matches. Expired lessons do not come back — the store's TTL drops them.
   Scope-of-origin is not a match criterion; if a `repo::` and a `global` lesson
   conflict, `repo::` wins (closer scope) — log the conflict.
2. Treat each matching lesson's *"Do this instead"* as a **consideration**
   on the plan — apply it unless it conflicts with the user's stated intent or
   task-specific constraints. Record applied lessons in `plan.md` under
   `## Lessons applied`.
3. Lessons are **advisory**: they bias the plan, never silently change a gate,
   skip a phase, or override the user's intent. If a lesson conflicts with the
   user's intent, the user wins — surface the conflict.
4. **Promotion check:** if any matched lesson has `seen_count >= 3` (the store's
   column) or carries the `status::structural` tag, surface the one-line
   promotion suggestion from
   [`self-improvement-loop.md#lesson-promotion`](./self-improvement-loop.md#lesson-promotion).

Log:

```markdown
- [TIMESTAMP] Phase 1: lorekit(memory.list repo::{owner}/{repo} loop::aw-lessons) — M lessons matched
- [TIMESTAMP] Phase 1: lorekit(memory.list global loop::aw-lessons) — N lessons matched, applied as constraints
- [TIMESTAMP] Phase 1: lorekit — memory.* not connected, continuing
```

Disable by removing this invocation (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Scope Brief

**Anchor:** `scope-brief`

If Phase 0 Step 3a ran the [`interview`](../../../analysis/interview/SKILL.md)
companion, read the brief it wrote before drafting the design — do not re-derive
scope the interview already settled:

```
Read .agent/{branch}/brief.md
```

Seed the plan from it:

- `Restatement` + requirement bullets → `## Requirements` (carry the
  `[user-stated]` / `[inferred]` tags; brief validation checks coverage
  against them).
- `In scope` / `Out of scope (non-goals)` → the plan's scope boundaries.
- `Success criteria` → seed the Acceptance Criteria (Step 2d²).
- `Affected areas` → seed the Existing Code Survey.
- `Assumptions (advisory)` → carry forward; do not silently re-decide them.

If no brief exists (interview not run, or `--no-interview`), proceed from the
Phase 0 conversation as before — this section is a no-op without a brief.

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
complex / unfamiliar / deep), trace the end-to-end execution path of the code the
task touches before designing: entry point → each contract boundary → data flow →
exit, recording each hop as `file:line`.
Split the trace across the parallel `Explore` sub-agents when they run.

Log to the conversation and to `plan.md` Progress Log:

```markdown
- [TIMESTAMP] Phase 1: execution-path trace — ran (<N> hops, <M> contract boundaries)
```

Use the trace to refine the technical approach before drafting file-level changes.

---

## Step 2: Draft Technical Design

Be specific about what done looks like; leave the how to the executor.
Plan to follow neighbouring files' patterns and reuse existing helpers (the Existing Code Survey records the search).

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
(deterministic trigger: any `create` row). "Looked around" is not a search record.

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
[`aw-create-plan` template](../../aw-create-plan/SKILL.md#the-brief-core):

- Each criterion carries a unique `AC-{n}` ID and a `(covers: R{m})`
  annotation naming the requirement(s) it verifies. Every `[user-stated]`
  requirement must be covered — brief validation fails otherwise.
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

## Spec Emission (UI tasks)

**Anchor:** `spec-emission-anchor`

On Full, do **not** draft `specs.md` here: `aw-executor` writes it after the UI exists and runs it ([correction C5](./corrections.md#c5--a-ui-spec-is-written-against-the-built-ui-and-run)).
At planning time, run only the gate below and record the result in the brief; the rest of this section is the procedure the executor follows when it writes the specs.

Emit a `specs.md` file when the task touches a UI surface. `aw-tester` runs it in Phase 4, `ui-verify author` lifts it into the PR body, and `/verify` re-runs it on a local stack — one file, three runners.

### Gate: does the task touch a UI surface? (mechanical, not eyeballed)

Do **not** eyeball the plan draft. Run the same deterministic `is-ui-diff` gate
every other caller (`ui-verify author`, `create-pr`, `review-loop`) runs, so
the answer is identical no matter which surface asks. At planning time the files
are *planned*, not yet on disk, so pass the `## File changes` paths explicitly
with `--files` (the gate's `--base` git-diff mode is for post-implementation
callers):

```bash
# The planned paths, comma-separated, from the plan draft's File changes table.
node ~/.claude/skills/ui-verify/scripts/is-ui-diff.mjs \
  --files "src/components/Widget.tsx,src/api/widgets.ts"
```

**Reflect the repo's learned UI surface** when one exists — the gate cannot call
LoreKit itself, so read the surface record and forward it:

```text
memory.read { scope: "repo::{owner}/{repo}", key: "ui-verify-lessons::ui-surface" }
```

```bash
node ~/.claude/skills/ui-verify/scripts/is-ui-diff.mjs \
  --files "<planned paths>" --surface-json '<the record body>'
```

Read the final `UI_DIFF:` line. `yes` → emit `specs.md`. `no` → skip spec
emission entirely and log the skip below.

If the `ui-verify` skill is not installed (the script path does not resolve),
fall back to the inline heuristic — ANY planned file matching `*.tsx`, `*.jsx`,
`*.vue`, `*.svelte`, `*.css`, `*.scss`, or living under `/pages/`, `/app/`,
`/routes/`, `/layouts/`, `/components/` counts as UI — and log the degradation.

```markdown
- [TIMESTAMP] Phase 1: spec-emission — skipped (is-ui-diff: no UI files in plan)
- [TIMESTAMP] Phase 1: spec-emission — is-ui-diff not installed; used inline fallback heuristic
```

### Aw-Target prerequisite check — degrade, never halt

Check for a committed aw-target:

```bash
test -f .agents/aw/environments.yml && echo found
```

**If one exists, use it.** If its `auth.storage_state` file is older than 7
days, warn but continue:

```markdown
- [TIMESTAMP] Phase 1: spec-emission — auth state at {path} is {N} days old;
  consider re-running /verify setup to refresh before execution.
```

**If none exists, do NOT halt.** A missing aw-target is a cold-start, not a
blocker — waiting for an interactive `/verify setup` strands every fresh repo. Instead, degrade to an implicit defaults target
so specs are still authored and can run against a local dev server:

- Assume `base_url: http://localhost:3000`, `auth.strategy: none`, no fixtures.
- Emit the specs as normal against that assumption.
- Surface a one-line, non-blocking nudge (not a wait):

```markdown
- [TIMESTAMP] Phase 1: spec-emission — no aw-target found; assuming
  http://localhost:3000 (auth: none). Run /verify setup to pin base_url, auth, and
  fixtures for reliable runs.
```

The executor's Phase 4 spec verification resolves this same way: a committed
target wins; otherwise the localhost defaults apply and any spec that needs auth
or a fixture is reported `skipped` with its reason, never failed. Suggest
`/verify setup` once — never block on it, and never try to run it yourself (it is
interactive).

### What to emit

Write `specs.md` in the **intent format**: header `Format: intent`, fields per
[`templates/intent-spec.md.template`](../templates/intent-spec.md.template).
Intent is the shared contract with `ui-verify` and `/verify`; never write a
new `specs.md` in the WHEN/THEN grammar of
[`templates/specs.md.template`](../templates/specs.md.template), which stays a
runner format (compiled routes) and a read-only legacy input.

Guidelines for writing specs (with [C5](./corrections.md#c5--a-ui-spec-is-written-against-the-built-ui-and-run)):

- Write one spec per **user goal**, not per implementation step, titled with the
  criterion it proves: `## Spec 2: AC-2 — <user goal>`.
- `**Changed:**` names the control the diff adds; its step is `[must-follow]`.
- `**Expected:**` items are exact text, values, or counts on the changed target;
  a network outcome is `` `METHOD /path` returns NNN ``.
- Locators go under `**Hints:**` as `{role: ..., name: ...}`, grepped from the
  code, with the `file:line` beside them. Never CSS selectors.
- Placeholder syntax: `{dashboardId}` resolves from `aw-target.fixtures.references`.
  Use only references that exist in the aw-target file.
- Keep each spec to 3–6 steps.

### Spec file path

Write to `.agent/{branch}/specs.md` (alongside `plan.md`; on Full, in Phase 4 once the UI exists), never
on the main branch. The specs file is a planning artifact — it lives in
`.agent/` and is gitignored alongside `plan.md`.

Log:

```markdown
- [TIMESTAMP] Phase 1: spec-emission — {N} specs drafted (aw-target: {name},
  {critical-path-count} critical-path, {verify-only-count} verify-only)
- [TIMESTAMP] Phase 1: spec-emission — skipped (is-ui-diff: no UI files in plan)
- [TIMESTAMP] Phase 1: spec-emission — {N} specs drafted against localhost
  defaults (no aw-target; /verify setup suggested, not blocking)
```

---

## Adversarial Pre-Mortem

**Anchor:** `adversarial-pre-mortem`

**Opt-in only.** Run this step **only** when the user passed `--critical` to
the workflow. Otherwise report `companion: critical — skipped (trigger not met: --critical not passed)` — no auto-engage heuristics at this stage.

Purpose: surface plan defects that pass static rules but would fail under
adversarial review, and force exploration of at least one alternative design
before the brief is validated.

Run after the technical design and before brief validation:

```
Skill("critical", "plan")
```

Treat the output as follows:

- **Must-fix** items → plan defects. Update the technical approach (or
  `plan.md` if it has been drafted) to address them before brief
  validation runs.
- **Should-fix / Nice-to-have** items → log as plan notes; address only if
  they meaningfully improve the design.
- **Steelman alternative** → preserve verbatim under a `## Considered
  alternatives` section of the plan. This is the load-bearing differentiator
  vs. brief validation — record it even when the chosen
  approach wins.

`critical` is **advisory** — it does not gate. Brief validation remains the
only mandatory gate.

Log:

```markdown
- [TIMESTAMP] Phase 1: critical(plan) — applied (N must-fixes addressed, steelman recorded)
- [TIMESTAMP] Phase 1: critical(plan) — skipped (not installed)
- [TIMESTAMP] Phase 1: critical(plan) — skipped (trigger not met: --critical not passed)
```

Disable by removing the invocation here (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Brief Validation

**Anchor:** `brief-validation`

**Full Mode only.** Lite plans inline and Micro has no plan.
There is no LLM confidence score on the brief: the brief writer validates it deterministically, then hands it to one `aw-executor`.

Run the validation in [`aw/rules/full-tier.md`](../aw/rules/full-tier.md#step-1--brief-minutes) step 6 — six Core headings, the `AC-{n}` count equal to the `checks.yaml` count, `checks.lock` present, every `[user-stated]` requirement covered, no placeholder commands.
A failed validation is fixed in the brief and re-run, never waived.

Log:

```markdown
- [TIMESTAMP] Phase 1: brief validation — passed (6 Core headings, M ACs = M checks, sealed)
```

---

## Brief Handoff

This phase ends with brief validation.
The brief writer then prints the handoff message and dispatches the executor — see [`planner-executor-handoff.md`](./planner-executor-handoff.md) for the contract and message format.

---

## Planning Checklist

- [ ] `lorekit(memory.list loop::aw-lessons)` read narrow-to-broad (repo:: then global); matching lessons applied as constraints (anchor: `lessons-read`)
- [ ] Scope brief read from `.agent/{branch}/brief.md` if Phase 0 ran `interview`; plan seeded from it, not re-derived (anchor: `scope-brief`)
- [ ] Codebase analyzed (structure, patterns, stack) — dependency-graph localization (def/ref walk) before keyword sweep
- [ ] Parallel `Explore` sub-agents used if complexity triggered (anchor: `parallel-research`)
- [ ] Execution path traced if complexity triggered (anchor: `complex-task-detection`)
- [ ] Technical approach designed with specific file references
- [ ] Existing Code Survey completed for every planned `create` — searches recorded, verdicts assigned (anchor: `existing-code-survey`)
- [ ] Acceptance Criteria carry `AC-{n}` IDs + `(covers: R{m})` annotations; every `[user-stated]` requirement covered; EARS shape preferred; a runner sketched per criterion (anchor: `acceptance-criteria-drafting`)
- [ ] UI surface check: if plan touches UI files, aw-target exists OR user told to run `/verify setup`; `specs.md` drafted or skip logged (anchor: `spec-emission-anchor`)
- [ ] Brief validation passed (anchor: `brief-validation`)
- [ ] Companion invocations logged (will move to `plan.md` Progress Log in Phase 2)

**Phase 1 ends in conversation. The `plan.md` artifact is generated in
[Phase 2](./phase-2-worktree.md#plan-generation).**

---

## References

- Previous phase: [phase-0-validation](./phase-0-validation.md)
- Next phase: [phase-2-worktree](./phase-2-worktree.md)
- Companion registry: [companion-skills](./companion-skills.md)
- Corrections: [`corrections.md`](./corrections.md)
- Related skill: [`aw-create-plan`](../../aw-create-plan/SKILL.md)
- Related rule: [`phase-4-spec-verification.md`](./phase-4-spec-verification.md) — where specs.md is consumed
- Related rule: [`phase-4-testing.md#executable-checks-loop`](./phase-4-testing.md#executable-checks-loop) — where checks.yaml is consumed
- Research basis: [`references/planning-quality-research.md`](../references/planning-quality-research.md) — anti-reinvention, spec fidelity, clarify-or-abstain, executable checks
- Setup: `/verify setup` — writes `.agents/aw/`
- Template: [`templates/specs.md.template`](../templates/specs.md.template) — spec format reference
