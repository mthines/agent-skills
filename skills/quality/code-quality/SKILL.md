---
name: code-quality
description: >
  Language-agnostic authoring and review for low cognitive complexity and maintainability — guard clauses, type-driven design, schema-first validation, functional core — plus React / Next.js stack rules.
  Modes plan, authoring (default), review, simplify; triggers on "improve quality", "make this readable", "reduce complexity", "deduplicate", "clean this up", "/code-quality".
argument-hint: '[plan|review|simplify] [aggressive|dry-run|<path>]'
license: MIT
metadata:
  author: mthines
  version: '1.4.1'
  workflow_type: advisory
  tags:
    - code-quality
    - cognitive-complexity
    - maintainability
    - type-driven-design
    - functional-core
    - testability
    - tdd-companion
    - language-agnostic
    - react
    - nextjs
---

# Code Quality Skill

Write code that is easy to **review, understand, and change**.
Quality axes, in priority order:

1. **Readability** — a reader understands the code top-to-bottom on first pass.
2. **Maintainability** — the next variant of a concept is a one-file, one-edit change; existing utilities are reused; one concept has one canonical home.
3. **Pragmatic performance** — algorithmic wins by default, micro-optimizations only when a profiler points at them.

Why cognitive complexity is the target, and the reasoning behind each rule: [`references/critical-rules-rationale.md`](./references/critical-rules-rationale.md); sources: [`references/citations.md`](./references/citations.md).

## Contents

- [Modes](#modes)
- [The two tests](#the-two-tests)
- [Procedure](#procedure)
- [Rule Files](#rule-files)
- [Critical Rules (apply always)](#critical-rules-apply-always)
- [When Things Conflict](#when-things-conflict)
- [Output Contract](#output-contract)

## Modes

Detect the mode from the `$ARGUMENTS` first token: `plan` → plan mode; `code` or `review` → review mode; `simplify` → simplify mode; anything else (including no argument) → authoring mode.
An ad-hoc request to "review" or "audit" code also routes to review mode.

| Mode | Invocation | Does |
| --- | --- | --- |
| **Plan** | `Skill("code-quality", "plan")`, before code exists | Verifies a `plan.md` (or proposed approach) follows existing patterns and avoids design-time risks (premature parallel maps, missing branded primitives, untyped error paths, parameter creep, neighbour mismatch). Findings only, no edits. Used by `autonomous-workflow` Phase 1. Read [`rules/plan-mode.md`](./rules/plan-mode.md). |
| **Authoring** (default) | Writing new code — TDD GREEN, new features | Apply the rules inline so the first version meets the bar. |
| **Review** | `Skill("code-quality", "code")` or `Skill("code-quality", "review")` | Diagnose against the rules and propose targeted changes. Findings only, no edits. |
| **Simplify** | `Skill("code-quality", "simplify")`, after the feature is green | Runs the review pass, then **applies** Class M recipes ([`rules/refactor-recipes.md`](./rules/refactor-recipes.md#recipe-class--mechanical-vs-judgment)) one at a time behind `Skill("confidence", "code") ≥ 90 %` and a scoped fast-check, reverting on failure; Class J recipes stay proposals. Variants: `simplify aggressive` also auto-applies Medium-impact mechanical recipes; `simplify dry-run` reports without writing; `simplify <path>` scopes to a path instead of the diff. Read [`rules/simplify-mode.md`](./rules/simplify-mode.md). |

## The two tests

- **Readability:** can a reader understand this function top-to-bottom on one pass without backtracking? If they have to scroll, jump, or hold a stack of conditions in their head, fix it.
- **Maintainability:** if I add the next obvious variant of this concept, how many files do I edit, and will the type system catch a miss? One file with full type coverage is the bar; four hand-synchronised maps in four files is shotgun surgery — fix the structure before adding the variant (`rules/maintainability.md`).

## Procedure

Read [`rules/procedure.md`](./rules/procedure.md) for authoring (13-step checklist) and review (8-step pass).
Read [`rules/simplify-mode.md`](./rules/simplify-mode.md) for simplify (partition → confidence-gate → apply one recipe at a time → scoped fast-check → revert on failure → whole-suite verify at end).
Smell → refactor lookup, with recipe IDs: [`references/quick-reference.md`](./references/quick-reference.md) — read when choosing or naming a refactor.

## Rule Files

Load only the files relevant to the code in front of you; load a stack file only when the code is in that stack.

### Language-agnostic rules

| When the code involves... | Load |
|---|---|
| Conditionals, branching, nesting | `rules/control-flow.md` |
| Long or multi-purpose functions | `rules/functions.md` |
| Variable, function, class names | `rules/naming.md` |
| Comments, docstrings, doc | `rules/comments.md` |
| Performance concerns or hot paths | `rules/performance.md` |
| Error handling, validation, defensive code, schema-first validation (Zod / Pydantic), types inferred from schemas | `rules/error-handling.md` |
| Reviewing existing code | `rules/review-checklist.md` |
| Cognitive complexity scoring | `rules/cognitive-complexity.md` |
| Union types with associated data, parallel maps, duplicated constants, "where should this live", reuse decisions | `rules/maintainability.md` |
| Abstraction levels, type-driven design, illegal states, branded primitives, generics, `any`/cast discipline | `rules/abstraction.md` |
| Module boundaries, public surface, dependency direction, functional core / imperative shell, DTO ↔ domain ↔ persistence, immutability, side-effecting imports | `rules/architecture.md` |
| Function signatures, parameter ordering, total functions, modeling absence, error type system, tell-don't-ask, file reading order | `rules/api-design.md` |
| Idempotency, money / decimals / floats, dates and time, identifiers, encoding, determinism, assertions, async / concurrency, resource management | `rules/correctness.md` |
| Hard-to-test code, injecting clock / RNG / IDs, when to invoke `tdd`, UI components locatable by role / label without `data-testid` | `rules/testability.md` |
| PR scope, neighbour-pattern symmetry, migration & evolution, legacy code, diff hygiene | `rules/collaboration.md` |
| Naming a refactor in review output (R1 Consolidate Parallel Maps, R6 Replace Type Declaration with Inferred Type, etc.) | `rules/refactor-recipes.md` |
| Auto-applying mechanical refactors at end of feature | `rules/simplify-mode.md` |

### Stack-specific rules

Index, flagship smells, and how to add a stack: [`rules/stacks/README.md`](./rules/stacks/README.md).

| Stack | When the code involves... | Load |
|---|---|---|
| **React / Next.js** | Any UI file (`*.tsx`, `*.jsx`, React Native screens) — semantic HTML, ARIA, WCAG 2.2, focus order, contrast, Apple HIG, Material Design 3 | `Skill('ux')` (separate skill) |
| **React** | Splitting components, compound / namespace components (`Component.List.Item`, `Component.useComponent`), slots, RSC boundaries | `rules/stacks/react/components.md` |
| **React** | Client data fetching, server state, query caches and keys, optimistic updates, cache surgery, request waterfalls, TanStack Query / SWR, App Router prefetch, HydrationBoundary, dehydrate, initialData, per-request QueryClient | `rules/stacks/react/data-fetching.md` |
| **React** | Autosave forms, debounce + max-wait flush, on-blur / visibility / pagehide triggers, local draft buffer, ARIA-live status, ETag / `If-Match` conflicts, offline retry with idempotent PATCH (defers to `/ux` for form fundamentals) | `rules/stacks/react/autosave.md` |
| **React** | App-wide offline + sync, durable mutation queue / outbox in IndexedDB, Background Sync, TanStack Query `networkMode` + persistence + `resumePausedMutations`, idempotency keys, reconnection, conflict resolution, multi-tab (`navigator.locks` + `BroadcastChannel`) | `rules/stacks/react/offline-sync.md` |
| **Next.js** | Route Handlers / Server Actions, Zod boundary validation, shared FE + BE schemas, API error envelope, HTTP status mapping, auth + rate-limit ordering, request IDs, semconv handler spans (defers to `/otel-instrumentation` + `/otel-semantic-conventions`) | `rules/stacks/nextjs/endpoints.md` |

## Critical Rules (apply always)

1. **Linear flow beats branching.** Guards, then logic, then return; restructure an `if/else if/else` spanning 30 lines.
2. **Names carry the load.** Prefer an intent-revealing name over a short one; single letters only in tight, unambiguous scopes (loop indices, math formulas).
3. **Functions describe one thing.** If the honest name is `validateAndPersistAndNotifyUser`, it is three functions.
4. **Don't pre-build for futures that haven't arrived.** No configuration parameters, abstraction layers, or feature flags for hypothetical needs; refactor when the second case shows up.
5. **Comments explain WHY, never WHAT.** Keep comments for non-obvious constraints, subtle invariants, and "we tried X and it broke because Y"; otherwise rename or extract until the code says it.
6. **Optimize after measuring.** Until a profiler points at a hot path, prefer the readable version.
7. **Validate at boundaries, trust internally.** Validate user input, external API responses, and untrusted data at the edge; no defensive null checks for states that cannot occur internally.
8. **Reuse before creating.** Search the codebase for an existing helper, type, constant, or formatter before writing one; reusing existing code is never premature.
9. **One source of truth for union-type metadata.** Labels, colours, icons, flags, and defaults for a union live in one record keyed by the union with structured values, not N parallel maps; a new variant is one edit the type system checks.
10. **Minimise the change footprint.** Before adding a variant, ask how many places need editing and whether the compiler catches a miss; if "many" or "no", consolidate parallel maps, hoist duplicated constants, or co-locate data with its operations first (`rules/maintainability.md` §3).
11. **Make illegal states unrepresentable.** Discriminated unions for state machines, exhaustive `switch` with `assertNever`, branded primitives, refined types (`NonEmptyArray<T>`) instead of runtime guards (`rules/abstraction.md` §2).
12. **Pure core, impure shell.** Decision logic has no I/O, time, randomness, or global state; side effects live in a thin shell; inject the clock, RNG, fetcher, and ID generator (`rules/architecture.md` §3, `rules/correctness.md` §7).
13. **Total functions over throw-for-missing.** Return `null` for absent-by-design and `Result<T, E>` for expected failures; reserve `throw` for programmer errors and unexpected I/O failures; never return sentinels (`-1`, `""`, `0`) (`rules/api-design.md` §4).
14. **Test-first for new code.** For a new function, module, or behaviour, invoke `Skill('tdd')` for a strict RED → GREEN → REFACTOR cycle; apply this skill's rules silently in GREEN and explicitly in REFACTOR. Skip the handoff only for trivial edits, refactors of existing code, or when the user opts out (`rules/testability.md`).
15. **Pair with `ux` for UI files.** For files that render UI (`*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, React Native screens), invoke `Skill('ux')` for WCAG 2.2, semantic HTML, and platform guidelines — accessibility lives in `ux`. Apply the locator-stability subset of `rules/testability.md` (UI Testability). Skip for non-UI files or pure refactors that don't touch markup. Under `autonomous-workflow` Phase 3, `ux` runs at the phase level — do not double-invoke.

## When Things Conflict

Read [`rules/tradeoffs.md`](./rules/tradeoffs.md) when principles pull against each other (readability vs. performance, DRY vs. clarity, reuse vs. premature abstraction, short vs. clear naming, guard clause vs. single-return, co-location vs. layered folders).

## Output Contract

In review mode, structure findings as a `## Code Quality Review: [target]` block with High / Medium / Low impact sections, plus required Maintainability findings whenever the reviewed code introduces or extends union types, enums, shared constants, or utilities, and required Correctness / Testability findings whenever it involves retryable operations, money, dates, async I/O, resource handles, or non-trivial pure logic.
Read [`rules/output-contract.md`](./rules/output-contract.md) for the full template.

In authoring mode, write the code (or hand off to `tdd` first for new code) and apply the principles without narrating each one.
