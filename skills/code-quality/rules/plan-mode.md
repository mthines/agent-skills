---
title: Plan Mode — Review the Plan Before Code Is Written
impact: HIGH
tags:
  - plan-mode
  - planning
  - neighbour-pattern
  - design-time-risks
---

# Plan Mode

Invoked with `Skill("code-quality", "plan")`. Reads a `plan.md` (or a proposed approach in chat), reads the relevant slice of the existing codebase, and reports design-time risks **before any code is written**.

The two questions plan mode answers:

1. **Does the plan follow the existing code structure?** A plan that introduces a new module shape, a new error pattern, or a new naming convention when the codebase already has one is a maintainability risk on day one.
2. **Is the plan well-structured on its own merits?** Even setting neighbours aside, does the plan avoid the predictable design-time mistakes (premature parallel maps, missing branded primitives, untyped error paths, parameter creep, schema-type drift)?

Plan mode does **not** edit code. It does **not** rewrite the plan. It returns findings the planner integrates before handing off to implementation.

## Inputs

| Input | Source | Required? |
|---|---|---|
| Proposed plan | `.agent/{branch}/plan.md` (autonomous-workflow Full Mode) or the planning text in chat | Yes |
| `## File Changes` table | Within plan.md (autonomous-workflow convention) | Yes |
| Repository root | Current working directory | Yes |

If `plan.md` is missing, ask the user where the plan lives or for the proposed approach inline. Do not infer a plan from chat history alone — the surface for the review must be explicit.

## Procedure

Run the four passes in order. Each pass is independent — collect findings across all four before reporting.

### Pass 1 — Neighbour-pattern match

For every entry in the plan's `## File Changes` table:

1. **For each `create` row**: read 2–3 sibling files in the target directory (the *neighbours*). Compare the proposed file's planned shape to the neighbours' actual shape on these axes:
   - **Folder layout** (where do imports come from, where do types live, where do tests live)
   - **Module shape** (default export vs named exports; class vs functional; hook naming)
   - **Error shape** (how do neighbours model and surface errors)
   - **Import order** (the convention the file linter or repo enforces)
   - **Test style** (filename suffix, test runner, fixture pattern)
   - **Naming convention** (camelCase vs kebab-case for filenames; verbNounSuffix patterns)

2. **For each `modify` row**: read the file that will be changed and at least one sibling. Compare the proposed change to the file's existing patterns. Flag mismatches.

3. **Output a finding** for each axis the plan diverges from the neighbours, with one of:
   - The neighbour cited (`apps/web/src/components/Button.tsx` uses default export; the plan proposes a named export — mismatch)
   - The codebase convention named (the repo enforces kebab-case filenames; the plan proposes `MyComponent.tsx`)
   - A justified divergence accepted (the plan introduces a new pattern *intentionally*; document the reason in the plan's `## Decisions` table)

### Pass 2 — Design-time risk scan

Walk the plan's `## Technical Approach` and `## File Changes` sections looking for these predictable patterns. Each pattern below is a finding:

| Risk | What to look for in the plan | Why it matters |
|---|---|---|
| **Parallel maps over the same union** | Plan introduces a union (`type Status = 'pending' \| 'approved' \| ...`) and one or more separate maps (`LABELS`, `COLORS`, `ICONS`) keyed by it | Adding a status variant becomes N edits; type system can't catch missed maps. Consolidate into `Record<Status, { label, color, icon }>` from day one. See `maintainability.md` §2. |
| **Missing branded primitives** | Plan describes `string` parameters for IDs (`userId: string`, `orderId: string`) where the domain has multiple ID types | Mixing IDs is a common bug class. Brand them (`type UserId = string & { readonly __brand: 'UserId' }`). See `api-design.md` §5. |
| **Untyped or stringly-typed errors** | Plan throws `Error(...)` with parsed messages, or returns sentinel values (`-1`, `""`, `null` ambiguously) | Errors should be discriminated unions (`AppError`) or `Result<T, E>`. See `correctness.md` §3 and `api-design.md` §4. |
| **Parameter creep** | Plan describes a new function with 4+ parameters, or a function whose parameter list will grow | Group into an object/struct now. ≤3 ideal, ≤5 hard cap. See `functions.md`. |
| **Schema-type drift** | Plan introduces both a Zod / Pydantic / valibot schema AND a hand-written type for the same shape | Use `z.infer<typeof Schema>` (or equivalent). The two declarations will drift. See `error-handling.md` schema-first section. |
| **Defensive checks for impossible states** | Plan adds null checks or runtime validation for values the type system already proves cannot be null | Trust the types. Validate at boundaries, not throughout. |
| **Mixed abstraction levels** | A planned function description mixes "and" sentences ("validates the order AND submits it AND emits the event") | Split. One job per function. See `abstraction.md` §1. |
| **Side-effecting imports** | Plan introduces a new module that runs side effects at import time | Factory pattern (`createX(...)`). See `architecture.md` §3. |

For each pattern detected, cite the rule file the planner should consult, and propose the structural fix as a one-line plan-edit suggestion.

### Pass 3 — Reuse audit

For every helper, type, constant, formatter, or hook the plan introduces:

1. Grep the codebase for an existing utility with the same role (the noun, a synonym, or the verb it performs).
2. If a candidate exists, flag it as a reuse opportunity. The plan should either reuse the existing utility or document why the existing one is unsuitable in the plan's `## Decisions` table.

A second implementation of the same concept is worse than the first — both must change together to stay correct, and they will drift. Catching this at plan time is cheaper than catching it at PR review.

### Pass 4 — Stack alignment

If the plan touches a stack with rules under `code-quality/rules/stacks/<stack>/` (currently `react/`, `nextjs/`), load that stack's rules and run a stack-specific check:

- **React** — does the plan introduce a 6+-prop component with boolean variations? Should be a compound component. Does the plan use `useEffect(() => fetch(...).then(setData), [id])` for server data? Should be a query hook.
- **Next.js** — does the plan introduce a Server Action or Route Handler without a shared Zod schema for the request body? Does it skip OTel server-span wrapping?

Report a finding per stack-specific risk. Skip this pass when the plan touches no stack with extension rules.

## Output

Use this structure:

```
## Code Quality Plan Review

### Neighbour-pattern findings
- [planned file] vs [neighbour file] — [axis]: [the mismatch]
  Suggested fix: [one-line plan edit]

### Design-time risks
- [risk name from Pass 2 table] — [where in the plan]
  Why: [one line]
  Suggested fix: [structural change before implementation begins]
  Rule: [rule file to consult]

### Reuse opportunities
- [planned helper / type / constant] — existing: [path:line]
  Decision: reuse, OR document why a second implementation is needed in plan `## Decisions`

### Stack-specific findings (when relevant)
- [stack] — [finding]
  Rule: [rules/stacks/<stack>/<file>.md]

### Plan structure assessment
- Overall: [aligned with codebase / partially aligned / structurally divergent]
- Top 3 fixes (in priority order): [list]

### What the plan gets right
- [observations on what's already well-shaped — reinforce good patterns]
```

If the plan has zero findings, say so explicitly:

```
## Code Quality Plan Review
Plan-mode review: no findings. Plan aligns with codebase patterns and shows no design-time risks.
```

## Calibration

Plan mode is **structural**, not tactical. It reviews shape, not implementation choices.

| In-scope (plan mode finding) | Out-of-scope (review-mode finding, after code exists) |
|---|---|
| Plan introduces parallel maps over a union | Final code has a complex `if/else if` chain |
| Plan uses raw `string` for `UserId` | Final code's UserId variable is named badly |
| Plan introduces a 7-prop component | Final component's JSX is hard to read |
| Plan duplicates an existing utility | Final code uses too much defensive null-checking |
| Plan mismatches neighbour module shape | Final code has high cognitive complexity |

If a finding requires reading actual code (not the plan), defer it to review mode.

## Composition with `confidence(plan)`

`autonomous-workflow` Phase 1 already runs `confidence(plan)` on the plan after it's drafted. Plan mode is a **complement**, not a replacement: confidence(plan) checks the plan's *completeness and self-consistency* (file paths resolve, requirements are tagged, sections are populated). Plan mode checks the plan's *structural alignment with the codebase and design-time risk*. Both should pass before Phase 2.

When invoked from Phase 1, run plan mode first; surface findings; let the planner integrate them; then re-run confidence(plan). This avoids the failure mode where a confidently-rated plan is structurally misaligned with the codebase.

## When NOT to invoke

Skip plan mode for:

- Pure dependency bumps
- Test-only changes (no production code modification)
- Config-only changes (lint, formatter, CI)
- Trivial plan items (1-line constant tweaks)
- Bug-fix plans where the fix is structurally identical to the buggy code (e.g., null check addition at a single site)

For these, the plan-mode review pays for nothing it would not already catch in code review or `confidence(plan)`.
