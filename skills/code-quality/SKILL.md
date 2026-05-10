---
name: code-quality
description: >
  Language-agnostic skill for authoring and reviewing code with low
  cognitive complexity, readability, and long-term maintainability.
  Core rules cover guard clauses, early returns, single-responsibility
  functions, type-driven design (illegal states unrepresentable,
  branded primitives, discriminated unions), schema-first validation
  with type inference (Zod / Pydantic), single source of truth for
  union-type metadata, functional core + imperative shell, total
  functions, idempotency for retryable ops, money in minor units, and
  neighbour-pattern symmetry. Pairs with `tdd` for new code (drives
  RED-GREEN-REFACTOR; rules apply in GREEN/REFACTOR).

  Stack-specific extensions live under `rules/stacks/<stack>/` and
  load only when the code in front of you is in that stack:
  React (component composition with deep-namespace compound
  components, client data fetching with TanStack Query / SWR,
  autosave, app-wide offline + sync), Next.js (Route Handlers /
  Server Actions, shared Zod schemas inferred for FE + BE, OTel
  server-span wrap with semantic conventions — defers to
  /otel-instrumentation, /otel-semantic-conventions, and /ux). Easy
  to extend: drop a new subdirectory into `rules/stacks/` for any
  language or framework (Go, Python, Rails, etc.) — see
  `rules/stacks/README.md`.

  Use during PR review, after writing new code, the GREEN/REFACTOR
  phases of TDD, or when asked to "improve quality", "make this
  readable", "reduce complexity", "deduplicate", "clean this up", or
  "/code-quality". Citations and research grounding in
  `references/citations.md`.
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.4.0'
  workflow_type: advisory
  tags:
    - code-quality
    - cognitive-complexity
    - maintainability
    - single-source-of-truth
    - type-driven-design
    - functional-core
    - testability
    - idempotency
    - api-design
    - tdd-companion
    - language-agnostic
    - stack-extensions
    - react
    - react-components
    - compound-components
    - client-data-fetching
    - optimistic-updates
    - autosave
    - offline-first
    - conflict-resolution
    - mutation-queue
    - multi-tab
    - nextjs
    - server-endpoints
    - shared-schemas
    - telemetry
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

This skill applies in two modes:

1. **Authoring mode** — when writing new code (e.g., GREEN phase of TDD, new
   features). Apply principles inline so the first version already meets the
   bar.
2. **Review mode** — when refactoring, reviewing PRs, or being asked to
   "clean this up". Diagnose against the rules and propose targeted changes.

Detect the mode from context. If the user says "review" or "audit" or
references existing code, use review mode. Otherwise default to authoring
mode and apply principles silently while you write.

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

### Authoring Mode

While writing code, apply these in order of impact:

1. **Compose with the `tdd` skill for new code** — when authoring a new
   function, module, or behaviour from scratch, invoke the `tdd` skill
   (`Skill('tdd')`) to drive the implementation through a strict
   RED → GREEN → REFACTOR cycle. Apply the rules below in GREEN and
   REFACTOR. Skip the handoff for trivial edits (typos, config tweaks),
   refactors of existing code (no new behaviour), or when the user
   explicitly opts out. See `rules/testability.md` for the integration.
2. **Compose with the `ux` skill for UI files** — when authoring
   `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, or React Native screens,
   invoke the `ux` skill (`Skill('ux')`) for WCAG 2.2, semantic HTML,
   and platform guidelines (Apple HIG, Material Design 3). Accessibility
   lives in `ux`. The subset that affects E2E locator stability lives
   in `rules/testability.md` (UI Testability section). Skip only for
   non-UI files. When this skill is invoked under `autonomous-workflow`
   Phase 3, do **not** call `ux` from here — Phase 3 already invokes
   `ux` once at the right moment.
3. **Match the neighbours** — before writing a new file in an existing
   module, read 2–3 sibling files and mimic their structure (folder
   layout, error shape, import order, test style, naming convention).
   Outlier code forces every reader to context-switch. See
   `rules/collaboration.md` §1.
4. **Reuse before creating** — before writing a helper, type, constant,
   formatter, or hook, search the codebase for one that already exists.
   Grep the domain noun and a synonym; check neighbour files; check the
   standard library and existing dependencies. A second implementation of
   the same concept is worse than the first. See
   `rules/maintainability.md` §1.
5. **Naming first** — before writing the body, name the function and its
   parameters so they describe *what* it does and *what* it returns. If
   you can't name it crisply, the responsibility is unclear; rethink the
   boundary, not the implementation.
6. **Design the type before the body** — model the inputs and outputs so
   illegal states cannot be represented (discriminated unions, branded
   primitives, total return types, `Result<T, E>` for expected failures).
   The cheapest place to catch a bug is the place the bug cannot exist.
   See `rules/abstraction.md` §2 and `rules/api-design.md` §4–§5.
7. **Guard clauses up top** — handle errors, edge cases, and early-exit
   conditions at the start of the function. Reserve the indented body for
   the happy path.
8. **One job per function, one level of abstraction per body** — if you
   find yourself writing "and" in a docstring or mixing orchestration
   sentences with low-level mechanics, split. See
   `rules/abstraction.md` §1.
9. **Limit nesting to 2 levels** — beyond that, extract a helper or
   invert a condition.
10. **Keep parameter count low (≤3 ideally, ≤5 hard cap)** — past that,
    group into an object/struct.
11. **One source of truth for union-type metadata** — when a union has
    associated data (labels, colours, icons, flags), use one record keyed
    by the union with structured values, not N parallel maps. Adding a
    variant must be a single edit. See `rules/maintainability.md` §2.
12. **Push impurity outward** — keep decision logic pure; push I/O, time,
    randomness, and ID generation to the edges. Inject the clock / RNG /
    fetcher; do not call them directly from core logic. See
    `rules/architecture.md` §3 and `rules/correctness.md` §7.
13. **Defer *generic* abstraction, not reuse** — wait for a third real
    use case before extracting a flag-driven generic helper. Always reuse
    utilities that already exist, and always consolidate parallel maps
    over the same union the moment they appear — those are not
    "premature".

Cross-references: `rules/cognitive-complexity.md` and
`rules/control-flow.md` for 7 and 9; `rules/naming.md` for 5;
`rules/functions.md` for 8 and 10; `rules/maintainability.md` for 4, 11,
and 13; `rules/abstraction.md`, `rules/architecture.md`,
`rules/api-design.md`, `rules/correctness.md`, `rules/testability.md`,
`rules/collaboration.md`, and `rules/refactor-recipes.md` for the deeper
patterns.

### Review Mode

When asked to review or refactor:

1. **Read all of the target code first** — don't critique what you
   haven't read.
2. **Score by cognitive load, not style** — pick the function that took
   you the longest to understand, that's your highest-priority refactor.
3. **Score by change footprint** — for each new concept (a union, a
   constant, a piece of metadata), count how many files would need to
   change if a new variant were added. Anything beyond ~3 files, or
   that the type system cannot enforce, is a maintainability finding.
4. **Check for existing utilities** — grep for similar helpers,
   formatters, or constants that the new code could have reused instead
   of duplicating.
5. **Cite recipes by name** — use `rules/refactor-recipes.md` so reviews
   read as "apply R1 (Consolidate Parallel Maps)" rather than free-form
   prose.
6. **Suggest changes with the diff inline** — don't just say "this is
   complex"; show the before/after.
7. **Prioritize by impact** — fix the thing that hurts readers and
   future maintainers most, not the thing that's easiest to nitpick.
   Ignore stylistic preferences if a linter would catch them.
8. **Stop when good enough** — perfect is a moving target. If the
   function reads top-to-bottom, names match the domain, and the change
   footprint for the next variant is small, leave it.

Load `rules/review-checklist.md` for the structured review pass.

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

These principles will sometimes pull against each other. Defaults:

- **Readability vs. performance** → readability wins until a profile says
  otherwise.
- **DRY vs. clarity** → clarity wins **for code shapes that happen to look
  alike**: two slightly-different 5-line blocks beat one 12-line generic
  helper that takes flags. But DRY wins **for the same concept** —
  duplicated constants, parallel maps over the same union, and
  re-implementations of an existing utility must be consolidated. The test
  is *meaning*, not *appearance*: if the two pieces must always change
  together to stay correct, they are one thing; if they merely share a
  shape, they are two.
- **Reuse vs. premature abstraction** → reuse existing utilities always;
  extract a *new* generic helper only on the third real caller. See the
  decision tree in `rules/maintainability.md` §4.
- **Short name vs. clear name** → clear name. `userPendingApproval` beats
  `usr`.
- **Guard clause vs. single-return-style** → guard clauses, unless the
  language/team strongly enforces single-return (e.g., some functional
  styles).
- **Co-location vs. layered folders** → co-locate the type, its metadata,
  and the functions that operate on it. A reader who lands on a union
  should not have to grep across `types/`, `constants/`, and `utils/` to
  understand it.

---

## Output Contract

When invoked in review mode, structure findings as:

```
## Code Quality Review: [target]

### High Impact (fix these)
- [file:line] [issue] → [proposed change, citing recipe ID where applicable: R1, R6, etc.]

### Medium Impact (consider)
- [file:line] [issue] → [proposed change]

### Low Impact / Style (optional)
- [file:line] [issue]

### Maintainability findings
- [file:line] [duplicated concept / parallel maps / shotgun-surgery risk] → [proposed consolidation, e.g., R1 Consolidate Parallel Maps]
- [estimated change footprint for the next obvious variant: N files, type-checked? yes/no]

### Correctness findings (when relevant)
- [file:line] [idempotency / money / dates / determinism / async / resources]
- [proposed fix, citing recipe ID]

### Testability findings (when relevant)
- [file:line] [hard-to-test surface, missing injection, coupled to global state]
- [proposed fix, e.g., R9 Inject the Clock / RNG / IDs]

### What's already good
- [brief notes on what to preserve]
```

The Maintainability findings section is required when the reviewed code
introduces or extends union types, enums, shared constants, or new
utilities. Correctness and Testability sections are required when the
reviewed code involves retryable operations, money, dates, async I/O,
resource handles, or non-trivial pure logic. Skip them when not
applicable — do not manufacture findings to look thorough.

When invoked in authoring mode, just write the code (or hand off to the
`tdd` skill first for new code). Apply the principles silently. Don't
narrate every guard clause — the user will see clean code in the diff.
