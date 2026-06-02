---
name: code-quality
description: >
  Language-agnostic skill for authoring and reviewing code with low
  cognitive complexity, readability, and long-term maintainability.
  Covers guard clauses, single-responsibility functions, type-driven
  design (illegal states unrepresentable, branded primitives,
  discriminated unions), schema-first validation, single source of
  truth for union metadata, functional core + imperative shell,
  idempotency, and neighbour-pattern symmetry. Pairs with `tdd` for
  new code (rules apply in GREEN/REFACTOR). Stack-specific extensions
  live under `rules/stacks/<stack>/` (React, Next.js today; drop a
  subdirectory for any other language or framework). Use during PR
  review, after writing new code, in TDD GREEN/REFACTOR, or when
  asked to "improve quality", "make this readable", "reduce
  complexity", "deduplicate", "clean this up", or "/code-quality".
license: MIT
metadata:
  author: mthines
  version: '1.4.0'
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

Write code that is easy to **review, understand, and change**. Optimize for the
next developer's mental load before optimizing for machine performance, because
readable code is cheaper to change, debug, and trust — and most performance
wins come from algorithmic choices and profiling, not micro-optimizations.

The three quality axes this skill targets, in priority order:

1. **Readability** — a reader understands the code top-to-bottom on first pass.
2. **Maintainability** — the next variant of a concept is a one-file, one-edit
   change; existing utilities are reused rather than re-invented; one concept
   has one canonical home.
3. **Pragmatic performance** — algorithmic wins by default, micro-optimizations
   only when a profiler points at them.

This skill applies in three modes:

1. **Plan mode** — invoked with `Skill("code-quality", "plan")`, before any code is written. Reads a `plan.md` (or proposed approach) and the existing codebase, and verifies the plan's structure follows the existing patterns and avoids predictable design-time risks (premature parallel maps, missing branded primitives, untyped error paths, parameter creep, neighbour mismatch). Returns findings only — no code edits. Used by `autonomous-workflow` Phase 1. See [`rules/plan-mode.md`](./rules/plan-mode.md).
2. **Authoring mode** — when writing new code (e.g., GREEN phase of TDD, new features). Apply principles inline so the first version already meets the bar. Default mode when no argument is passed.
3. **Review mode** — invoked with `Skill("code-quality", "code")` or `Skill("code-quality", "review")`, after code is written. When refactoring, reviewing PRs, or being asked to "clean this up". Diagnose against the rules and propose targeted changes.

Detect the mode from the `$ARGUMENTS` first token: `plan` → plan mode; `code` or `review` → review mode; anything else (including no argument) → authoring mode. The legacy convention "user said review or audit" still routes to review mode for ad-hoc invocations.

---

## The Core Bet

Cognitive complexity — how hard code is to understand — is the single best
proxy for long-term maintainability. SonarSource's research showed that
cyclomatic complexity (path counting) misses what actually hurts humans:
nesting, broken linear flow, and decisions that compound. So the rules below
target cognitive load, not theoretical complexity scores. Full citations
(SonarSource, Clean Code, Knuth, Alexis King, Gary Bernhardt) and the
research grounding for each rule live in
[`references/citations.md`](./references/citations.md).

When in doubt, the heuristic is: **can a reader understand this function
top-to-bottom on one pass without backtracking?** If yes, ship it. If they
have to scroll, jump, or hold a stack of conditions in their head, fix it.

The maintainability counterpart: **if I add the next obvious variant of this
concept, how many files do I have to edit, and will the type system catch me
if I miss one?** One file with full type coverage is excellent; four
hand-synchronised maps in four files is shotgun surgery — fix the structure
before adding the variant. See `rules/maintainability.md`.

---

## Quick Reference (load these patterns into working memory)

| Smell | Refactor To | Why |
|---|---|---|
| Nested `if` (3+ levels) | Guard clauses + early return | Each indent adds mental load; flat is easier |
| Long function (50+ lines, multiple responsibilities) | Extract by intent, name by what not how | One function = one reason to change |
| Cryptic name (`d`, `tmp`, `data`) | Domain noun (`priceDifference`, `pendingOrders`) | Names ARE documentation |
| Boolean parameter | Two named functions or an enum | `send(true, false, true)` is unreadable |
| Comment explaining WHAT | Rename or extract function | Comments rot; names get refactored with code |
| Comment explaining WHY (non-obvious constraint) | Keep it | The one comment that earns its place |
| Defensive checks for impossible states | Delete | Trust your callers; validate at boundaries |
| Flag/option cluster (4+ params) | Object parameter or builder | Working memory holds ~4 chunks |
| `else` after `return`/`throw` | Drop the `else` | Linear flow beats branching |
| Magic number/string | Named constant | Future-you will not remember what `7` meant |
| Parallel maps over the same union (`LABELS`, `COLORS`, `ICONS` keyed by `Status`) | One `Record<Status, { label, color, icon }>` | Adding a variant becomes one edit, not N |
| Reimplementing a helper that already exists | Search first; use the existing one | Two implementations drift; bugs get fixed in one copy only |
| `if/else if` chain dispatching on a value | Lookup table or single source-of-truth record | Data structure beats control flow; easy to extend |
| Same constant (`MAX_RETRIES`, status strings) duplicated across files | Hoist to one shared module | One concept, one home |
| Adding a new variant requires editing 4+ files | Consolidate before adding the variant | Shotgun surgery compounds with every variant |
| Separate `type User = {...}` and `userSchema = z.object({...})` for the same shape | One schema; `type User = z.infer<typeof UserSchema>` | Two declarations drift; one cannot |
| Re-validating an already-parsed value deep in the stack | Parse once at the boundary; trust the type internally | Validation is a boundary concern, not a per-call concern |
| Splitting every nested object into its own sub-schema "for cleanliness" | Keep flat unless the sub-shape is reused or has its own boundary | Premature decomposition; over-engineering |
| Function mixes orchestration sentences with low-level mechanics | Extract by abstraction level (R16) | Readers stop at the level they care about |
| Runtime check enforcing "these two fields can't both be set" | Discriminated union (R15) | Compiler enforces the invariant; runtime check disappears |
| Raw `string` for `Email`, `UserId`, `OrderId` | Brand the type via the schema (R11) | Mixing IDs becomes a compile error |
| `any` or unjustified cast silencing the type checker | Schema parse, narrowed `unknown`, or `// because:` comment (R17) | Unjustified `any` is the shape most type bugs take |
| Function calls `Date.now()` / `Math.random()` directly | Inject the clock / RNG (R9) | Pure functions are testable; impure functions are flaky |
| Function throws for "not found" or returns sentinels (`-1`, `""`) | Total-ise: return `null` or `Result<T, E>` (R10) | Total functions are testable exhaustively |
| Every error throws the same `Error` with a parsed message | Discriminated `AppError` union (R12) | Structured fields beat string parsing |
| Importing a module triggers a side effect | Factory: `createX(...)` (R20) | Tests stop being accidentally integration tests |
| Operation that may be retried is not safe to invoke twice | Idempotency key, upsert, or right HTTP method (R18) | Retries corrupt state otherwise |
| Money stored as `number` | Integer minor units or decimal library (R19) | Floats cannot represent decimal currency exactly |
| Floats compared with `===` | Compare with epsilon, or use integer ticks | `0.1 + 0.2 !== 0.3` |
| `await` in a `for` loop where `Promise.all` was meant | Choose serial or parallel consciously | Accidental serialisation is a perf bug |
| Every `open` without a paired `close` | `try/finally` or `using` | Resource leaks compound silently |
| New file does not match neighbouring files' patterns | Read 2–3 neighbours and mimic them | Outlier code forces context-switching for every reader |
| Refactor PR mixed with feature PR | Split into two PRs | Mixed PRs get rubber-stamped or rejected on the wrong grounds |
| Helpers at the top of the file, public function 200 lines down | Public surface first; helpers below in call order | Files read top to bottom |
| Reaching `a.b.c.d.method()` to act on `a` | Tell, don't ask: put the operation on `a` | Callers shouldn't walk private structure |

### Stack-flagship patterns

A few of the highest-leverage stack-specific rules. Each rule file under
`rules/stacks/` carries its own Common Mistakes section — load the file
when working in that stack.

| Smell | Refactor To | Where |
|---|---|---|
| React component with 6+ props (especially booleans) controlling visual variations | Compound component with deep dot-notation (`Combobox.Content.List.Item`) + namespaced control hook (`Combobox.useCombobox`); shared state via Context | `stacks/react/components.md` |
| `useEffect(() => { fetch(...).then(setData) }, [id])` for server data | `useQuery({ queryKey, queryFn })` (TanStack Query / SWR) | `stacks/react/data-fetching.md` |
| Mutation waits for the server before updating the UI | Optimistic update in `onMutate`, rollback in `onError`, invalidate in `onSettled` | `stacks/react/data-fetching.md` |
| Form saves on every keystroke | Debounce ~1000 ms + max-wait ~5 s flush + on-blur + on-visibility-hidden; never block input | `stacks/react/autosave.md` |
| Two tabs autosave the same record and one silently overwrites the other | ETag + `If-Match`; on 412 surface "edited elsewhere — Reload / Keep mine" | `stacks/react/autosave.md` |
| Mutations lost on reload, ad-hoc retries scattered across components | Durable mutation queue in IndexedDB + idempotency key per entry; multi-tab single-writer via `navigator.locks` | `stacks/react/offline-sync.md` |
| Route handler trusts `req.json()` body without validation | `safeParse` with a shared Zod schema (FE + BE import the same module); one error envelope mapped from a discriminated `AppError` union | `stacks/nextjs/endpoints.md` |

---

## Procedure

The skill operates in two modes — authoring (writing new code) and review (refactoring or auditing existing code). Detect the mode from context: if the user says "review" or "audit" or references existing code, use review mode. Otherwise default to authoring and apply principles silently while you write.

Load [`rules/procedure.md`](./rules/procedure.md) for the full mode procedures: the 13-step authoring checklist (compose with `tdd` and `ux`, naming-first, design-the-type-before-body, guard clauses, push impurity outward) and the 8-step review pass (cognitive-load scoring, change-footprint scoring, recipe citations).

---

## Rule Files

Load only what's relevant to the code in front of you. Reading every rule
file every time is wasted context. The skill is **language-agnostic at
its core** — the table below splits into framework-neutral rules and
stack-specific extensions. Load a stack file only when the code is in
that stack.

### Language-agnostic rules

| When the code involves... | Load |
|---|---|
| Conditionals, branching, nesting | `rules/control-flow.md` |
| Long or multi-purpose functions | `rules/functions.md` |
| Variable, function, class names | `rules/naming.md` |
| Comments, docstrings, doc | `rules/comments.md` |
| Performance concerns or hot paths | `rules/performance.md` |
| Error handling, validation, defensive code, schema-first validation, Zod / Pydantic, inferring types from schemas | `rules/error-handling.md` |
| Reviewing existing code | `rules/review-checklist.md` |
| Cognitive complexity scoring | `rules/cognitive-complexity.md` |
| Union types with associated data, parallel maps, duplicated constants, "where should this live", reuse decisions | `rules/maintainability.md` |
| Abstraction levels, type-driven design, illegal states unrepresentable, branded primitives, generics, `any`/cast discipline | `rules/abstraction.md` |
| Module boundaries, public surface, dependency direction, functional core / imperative shell, DTO ↔ domain ↔ persistence, immutability defaults, side-effecting imports | `rules/architecture.md` |
| Function signatures, parameter ordering, total functions, modeling absence, designing the error type system, tell-don't-ask, file reading order | `rules/api-design.md` |
| Idempotency, money / decimals / floats, dates and time, identifiers, encoding, determinism, assertions, async / concurrency, resource management | `rules/correctness.md` |
| Hard-to-test code, dependency injection of clock / RNG / IDs, when to invoke the `tdd` skill, UI components locatable by role / label without `data-testid` | `rules/testability.md` |
| PR scope, neighbour-pattern symmetry, migration & evolution, working with legacy code, diff hygiene | `rules/collaboration.md` |
| Naming a refactor in review output (R1 Consolidate Parallel Maps, R6 Replace Type Declaration with Inferred Type, etc.) | `rules/refactor-recipes.md` |

### Stack-specific rules

See `rules/stacks/README.md` for the index and the convention for adding
a new stack.

| Stack | When the code involves... | Load |
|---|---|---|
| **React / Next.js** | Any UI file (`*.tsx`, `*.jsx`, React Native screens) — semantic HTML, ARIA, WCAG 2.2 conformance, focus order, contrast, platform guidelines (Apple HIG, Material Design 3) | `Skill('ux')` (separate skill) |
| **React** | Splitting components, compound / namespace components (`Component.List.Item`, `Component.useComponent`), slots, RSC boundaries | `rules/stacks/react/components.md` |
| **React** | Client-side data fetching, server state, query caches, optimistic updates, cache surgery (create/update/delete), query keys, request waterfalls, TanStack Query / React Query / SWR, Next.js App Router prefetch, HydrationBoundary, dehydrate, initialData, per-request QueryClient | `rules/stacks/react/data-fetching.md` |
| **React** | Autosave forms, debounce + max-wait flush, on-blur / visibility / pagehide triggers, local-first draft buffer (localStorage / IndexedDB), status indicator with ARIA live regions, ETag / `If-Match` conflict detection, offline retry with idempotent PATCH (defers to `/ux` for form fundamentals) | `rules/stacks/react/autosave.md` |
| **React** | App-wide offline + sync, durable mutation queue / outbox in IndexedDB, foreground queue vs Background Sync, TanStack Query `networkMode` + persistence + `resumePausedMutations`, idempotency keys, reconnection flow, conflict resolution, multi-tab coordination (`navigator.locks` + `BroadcastChannel`) | `rules/stacks/react/offline-sync.md` |
| **Next.js** | Server endpoints, Route Handlers / Server Actions, Zod boundary validation, shared schemas / contracts (FE + BE), API error envelope, HTTP status mapping, auth + rate-limit ordering, request IDs, span the handler with semconv attributes (defers to `/otel-instrumentation` + `/otel-semantic-conventions` for depth) | `rules/stacks/nextjs/endpoints.md` |

---

## Critical Rules (apply always)

These are non-negotiable because they reflect human cognitive limits, not
style preferences.

### 1. Linear flow beats branching
A function that flows top-to-bottom — guards, then logic, then return — is
always easier than one with deep branching. If you have `if/else if/else`
spanning 30 lines, restructure.

### 2. Names carry the load
Code is read 10× more than it's written. A 30-character name that explains
intent saves more time than the keystrokes it costs to type. Conversely,
single-letter names are fine for tight scopes (loop indices, math
formulas) where the meaning is unambiguous from context.

### 3. Functions describe one thing
The function name should be a complete description of what it does. If the
honest name is `validateAndPersistAndNotifyUser`, you have three functions.

### 4. Don't pre-build for futures that haven't arrived
Configuration parameters, abstraction layers, and feature flags for
hypothetical needs all add cognitive load *today* with no benefit until the
hypothetical arrives — and most never do. Build for the case in front of
you; refactor when the second case shows up.

### 5. Comments explain WHY, never WHAT
A comment that restates the code is noise. A comment that captures a
non-obvious constraint, a subtle invariant, or "we tried X and it broke
because Y" is gold. If you're tempted to write a comment, first try to
rename or extract until the code says it itself.

### 6. Optimize after measuring
Knuth: "premature optimization is the root of all evil." Until a profiler
points at a hot path, prefer the readable version. Only ~3% of code drives
performance; the other 97% should be optimized for the human reader.

### 7. Validate at boundaries, trust internally
Validate user input, external API responses, and untrusted data at the
edge. Don't add defensive null checks throughout internal code — they hide
real bugs by silently swallowing impossible states. If a value can't be
null at this point in the code, don't pretend it can.

### 8. Reuse before creating
Before writing a helper, type, constant, or formatter, search the codebase
for one that already exists. A second implementation of the same concept
is worse than the first — behaviours drift, bugs get fixed in only one
copy, and the next reader does not know which one is canonical. Reusing
existing code is never premature.

### 9. One source of truth for union-type metadata
When a union or enum has associated data (labels, colours, icons, flags,
defaults), put it in one record keyed by the union with structured values
— not in N parallel maps. Adding a new variant must be a single edit, and
the type system must catch you if you miss a field. Four hand-synchronised
maps over `OrderStatus` are a bug waiting to ship.

### 10. Minimise the change footprint
A maintainable change touches few files, all type-checked. Before adding a
new variant of a concept, ask: "if I add the next one, how many places do
I need to edit, and will the compiler tell me if I miss one?" If the
answer is "many" or "no", restructure first — usually by consolidating
parallel maps, hoisting a duplicated constant, or co-locating data with
the operations on it. See `rules/maintainability.md` §3.

### 11. Make illegal states unrepresentable
The cheapest place to catch a bug is the place the bug cannot exist. Lift
constraints into the type system: discriminated unions for state machines,
exhaustive `switch` with `assertNever`, branded primitives, refined types
(`NonEmptyArray<T>`). Runtime guards that the type system could enforce
are noise that drifts. See `rules/abstraction.md` §2.

### 12. Pure core, impure shell
Decision logic is pure: no I/O, no time, no randomness, no global state.
Side effects live in a thin shell at the edges. Pure code is the cheapest
to test and reason about; impure code is unavoidable but should be small
enough to verify by integration tests. Inject the clock, RNG, fetcher,
and ID generator rather than calling them directly. See
`rules/architecture.md` §3 and `rules/correctness.md` §7.

### 13. Total functions over throw-for-missing
A function is total when every input has a defined output. Return `null`
for absent-by-design and `Result<T, E>` for expected failures; reserve
`throw` for programmer errors and unexpected I/O failures. Sentinels
(`-1`, `""`, `0`) lie — every sentinel collides with a real value the
next caller will hit. See `rules/api-design.md` §4.

### 14. Test-first for new code
When authoring a new function, module, or behaviour, invoke the `tdd`
skill (`Skill('tdd')`) to drive the implementation through a strict
RED → GREEN → REFACTOR cycle. Apply the rules in this skill silently in
GREEN; apply them explicitly in REFACTOR. Skip the handoff only for
trivial edits, refactors of existing code, or when the user opts out.
See `rules/testability.md`.

### 15. Pair with `ux` for UI files
When authoring or reviewing files that render UI (`*.tsx`, `*.jsx`,
`*.vue`, `*.svelte`, React Native screens), invoke the `ux` skill
(`Skill('ux')`) for the WCAG 2.2, semantic HTML, and platform-guideline
pass. Accessibility lives in `ux`, not here — this skill defers. Apply
the locator-stability subset from `rules/testability.md` (UI Testability
section) so accessible names also serve E2E test stability. Skip only
for non-UI files or pure refactors that don't touch markup. When
invoked under `autonomous-workflow` Phase 3, `ux` runs there directly —
do not double-invoke; rely on the phase-level call.

---

## When Things Conflict

When principles pull against each other, load [`rules/tradeoffs.md`](./rules/tradeoffs.md) for the tiebreakers (readability vs. performance, DRY vs. clarity, reuse vs. premature abstraction, short vs. clear naming, guard clause vs. single-return, co-location vs. layered folders).

---

## Output Contract

In review mode, structure findings as a `## Code Quality Review: [target]` block with sections for High / Medium / Low impact, plus required Maintainability findings whenever the reviewed code introduces or extends union types, enums, shared constants, or utilities, and required Correctness / Testability findings whenever it involves retryable operations, money, dates, async I/O, resource handles, or non-trivial pure logic. Load [`rules/output-contract.md`](./rules/output-contract.md) for the full template.

In authoring mode, just write the code (or hand off to `tdd` first for new code). Apply the principles silently. Don't narrate every guard clause — the user sees clean code in the diff.
