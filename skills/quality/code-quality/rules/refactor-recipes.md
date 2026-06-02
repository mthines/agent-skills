---
title: 'Refactor Recipes — Named, Citeable Refactors'
impact: MEDIUM
tags:
  - refactor
  - recipes
  - review
---

# Refactor Recipes

Named refactors so reviews can cite a recipe by ID instead of describing it from scratch.
"Apply R1 (Consolidate Parallel Maps)" is faster, more actionable, and less ambiguous than free-form prose.

## Contents

- How to use this catalog
- R1: Consolidate Parallel Maps
- R2: Hoist Shared Constant
- R3: Replace Conditional with Lookup
- R4: Extract Guarded Function
- R5: Co-locate Type with Operations
- R6: Replace Type Declaration with Inferred Type
- R7: Replace Validation with Schema
- R8: Push Impurity Outward
- R9: Inject the Clock / RNG / IDs
- R10: Total-ise the Function
- R11: Brand the Primitive
- R12: Discriminate the Error Union
- R13: Inline the Premature Sub-Schema
- R14: Replace Boolean Parameter with Two Functions
- R15: Lift Illegal State Out of the Type
- R16: Extract by Abstraction Level
- R17: Justify or Remove the `any`
- R18: Make the Operation Idempotent
- R19: Money to Minor Units
- R20: Factory over Side-Effecting Import
- R21: Replace Hand-Rolled Fetch with Query Hook
- R22: Add Optimistic Update with Rollback
- R23: Cache Surgery for CRUD
- R24: Hydrate Server-Prefetched Data into the Client Cache
- R25: Validate at the Route Boundary with a Shared Schema
- R26: Standardise the API Error Envelope
- R27: Span the Route Handler with Semconv Attributes
- R28: Replace Save Button with Debounced + Max-Wait Autosave
- R29: Add Local-First Draft Buffer
- R30: Detect Concurrent Edits with ETag / `If-Match`
- R31: Replace Ad-Hoc Retries with a Durable Mutation Queue
- R32: Coordinate Multi-Tab Sync with Web Locks + BroadcastChannel
- R33: Wire TanStack Query Offline Persistence
- R34: Replace Prop-Soup Component with Deep-Namespace Compound
- R35: Trim Verbose Comment
- Recipe Index by File

## How to use this catalog

In review output:

```
- src/orders/status.ts:12 — parallel maps over OrderStatus → apply R1
- src/billing/charge.ts:84 — function calls Date.now() directly → apply R9
- src/api/parse-user.ts:5 — hand-written type next to schema → apply R6
```

In authoring mode, recipes are reminders during the REFACTOR phase of TDD.

---

## R1: Consolidate Parallel Maps

**Trigger:** 2+ maps keyed by the same union (`STATUS_LABEL`, `STATUS_COLOR`, `STATUS_ICON`).
**Replace with:** one `Record<Union, { ...metadata }>`.
**Why:** Adding a variant becomes one edit, not N. The type system enforces completeness.
**See:** `maintainability.md` §2.

---

## R2: Hoist Shared Constant

**Trigger:** Same magic value (`MAX_RETRIES = 3`, `'2024-01-01'`, an env-var key) duplicated across files.
**Replace with:** One named constant in the module owning the concept.
**Why:** One concept, one home. Drift becomes impossible.
**See:** `maintainability.md` §3.

---

## R3: Replace Conditional with Lookup

**Trigger:** `if/else if` chain dispatching on a value rather than a condition.
**Replace with:** Lookup table or strategy map.
**Why:** Data structure beats control flow; extension is one line.
**See:** `control-flow.md`.

---

## R4: Extract Guarded Function

**Trigger:** Long function with multiple early-exit conditions buried in nesting.
**Replace with:** Guard clauses at the top, happy path unindented below.
**Why:** Linear flow beats branching.
**See:** `control-flow.md`.

---

## R5: Co-locate Type with Operations

**Trigger:** Type, its metadata, and its operations scattered across `types/`, `constants/`, `utils/`.
**Replace with:** One module owning the union, its metadata, and its operations.
**Why:** A reader who lands on the type sees its semantics without grepping.
**See:** `maintainability.md` §3.

---

## R6: Replace Type Declaration with Inferred Type

**Trigger:** Parallel `type Foo = {...}` and `fooSchema = z.object({...})` for the same shape.
**Replace with:** One schema; `type Foo = z.infer<typeof FooSchema>`.
**Why:** Two declarations drift; one cannot.
**See:** `error-handling.md` Schema-First Validation.

---

## R7: Replace Validation with Schema

**Trigger:** Hand-rolled `if (typeof x === 'string' && x.length > 0)` checks at boundaries.
**Replace with:** `Schema.parse(x)` once at the boundary.
**Why:** Schema is a runtime spec and the source of the type. Validation lives in one place.
**See:** `error-handling.md`.

---

## R8: Push Impurity Outward

**Trigger:** Function that does both computation and I/O.
**Replace with:** Pure compute function + caller that handles I/O.
**Why:** Pure code is testable for free; the shell stays thin.
**See:** `architecture.md` §3.

---

## R9: Inject the Clock / RNG / IDs

**Trigger:** Function calls `Date.now()`, `Math.random()`, or generates IDs internally; tests are flaky or rely on real time.
**Replace with:** Pass the clock / RNG / ID generator as a parameter or constructor argument.
**Why:** Determinism. Pure functions are testable; impure functions are flaky.
**See:** `correctness.md` §7, `testability.md`.

---

## R10: Total-ise the Function

**Trigger:** Function throws for "not found" or returns `-1` / `""` / `0` for "missing".
**Replace with:** Return `null` for absent-by-design or `Result<T, E>` for expected failures.
**Why:** Total functions are easier to test exhaustively and call sites become explicit.
**See:** `api-design.md` §4.

---

## R11: Brand the Primitive

**Trigger:** Raw `string` for `Email`, `UserId`, `Currency`, `OrderId`; the type system cannot catch mix-ups.
**Replace with:** Branded type via the validating schema (`z.string().uuid().brand<'UserId'>()`).
**Why:** Mixing IDs becomes a compile error, not a production bug.
**See:** `abstraction.md` §2, `error-handling.md` Branded Types.

---

## R12: Discriminate the Error Union

**Trigger:** Every error path throws the same `Error` with a different `message`; handlers parse messages to decide what to do.
**Replace with:** Discriminated `AppError` union with structured fields.
**Why:** Exhaustive matching at every error site; structured fields beat string parsing.
**See:** `api-design.md` §5.

---

## R13: Inline the Premature Sub-Schema

**Trigger:** `XxxMetadataSchema` used only inside `XxxSchema`; no second consumer.
**Replace with:** Inline back into the parent schema.
**Why:** Sub-schemas split only on real reuse, separate boundary, or independent partial parsing.
**See:** `error-handling.md` Modular Composition.

---

## R14: Replace Boolean Parameter with Two Functions

**Trigger:** `process(items, true, false)` — boolean flags at the call site are unreadable.
**Replace with:** Two named functions or an enum variant.
**Why:** Names tell the reader what `true` and `false` mean; flags do not.
**See:** `functions.md` Boolean Parameters.

---

## R15: Lift Illegal State Out of the Type

**Trigger:** Optional fields that should never both be missing or both be set; runtime checks enforce the invariant.
**Replace with:** Discriminated union that makes the illegal combination unrepresentable.
**Why:** The compiler enforces the invariant; runtime checks become unnecessary.
**See:** `abstraction.md` §2.

---

## R16: Extract by Abstraction Level

**Trigger:** Function body mixes orchestration sentences with low-level mechanics.
**Replace with:** Each level becomes its own named helper; the parent reads as orchestration only.
**Why:** Readers stop at the level they care about.
**See:** `abstraction.md` §1.

---

## R17: Justify or Remove the `any`

**Trigger:** `any` or unjustified cast (`as Foo`) silencing the type checker.
**Replace with:** A schema parse, a narrowed `unknown`, or — if the escape is genuinely needed — a `// because:` comment explaining why.
**Why:** Unjustified `any` is the shape most production type bugs take.
**See:** `abstraction.md` §4.

---

## R18: Make the Operation Idempotent

**Trigger:** Operation that may be retried (POST, queue handler) is not safe to invoke twice.
**Replace with:** Idempotency key + dedupe, or upsert, or the right HTTP method (PUT/DELETE).
**Why:** Retries are a fact of distributed systems; non-idempotent retryable operations corrupt state.
**See:** `correctness.md` §1.

---

## R19: Money to Minor Units

**Trigger:** Currency stored as a JavaScript `number`.
**Replace with:** Integer minor units (cents, satoshis) or a decimal library; currency tagged on the value.
**Why:** Floating point cannot represent decimal currency exactly; rounding errors compound.
**See:** `correctness.md` §2.

---

## R20: Factory over Side-Effecting Import

**Trigger:** Importing a module triggers a side effect (DB connection, registry push, singleton creation).
**Replace with:** Export `createX(...)`; the composition root calls it when ready.
**Why:** Import order stops being significant; tests are not accidentally integration tests.
**See:** `architecture.md` §7.

---

## R21: Replace Hand-Rolled Fetch with Query Hook

**Trigger:** `useEffect(() => { fetch(...).then(setData) }, [...])` for server data, or component-owned `loading` / `error` / `data` triplets in state.
**Replace with:** `useQuery({ queryKey, queryFn })` from TanStack Query / SWR / equivalent; delete the hand-rolled state.
**Why:** Hand-rolled fetching re-implements deduplication, retries, caching, and stale-time logic — and drifts. The library handles all of it once.
**See:** `stacks/react/data-fetching.md` §1.

---

## R22: Add Optimistic Update with Rollback

**Trigger:** Mutation that waits for the server before updating the UI (visible dead zone after click).
**Replace with:** `onMutate` cancels in-flight queries, snapshots the cache, applies the optimistic change, and returns a rollback context; `onError` restores the snapshot; `onSuccess` replaces with the server response; `onSettled` invalidates.
**Why:** Removes the 200–800 ms dead zone. The four-step pattern is mechanical — apply it to every mutation that the server is likely to accept.
**See:** `stacks/react/data-fetching.md` §4.

---

## R23: Cache Surgery for CRUD

**Trigger:** UI does not reflect a create / update / delete until the next manual refetch, or list and detail caches drift after a mutation.
**Replace with:** In `onMutate` (or `onSuccess`), `setQueryData` for the list cache (append on create, `map` on update, `filter` on delete) **and** the detail cache (`setQueryData` on create/update, `removeQueries` on delete). Use `setQueriesData` when the entity appears in multiple list variants.
**Why:** Lists and details share an entity but live in different cache entries; updating one without the other is the most common cause of "I deleted it but it came back" bugs.
**See:** `stacks/react/data-fetching.md` §5.

---

## R24: Hydrate Server-Prefetched Data into the Client Cache

**Trigger:** Next.js / Remix / TanStack Start app shows a client-side spinner on first paint even though the data could have been fetched on the server, or a server component `await`s a fetch and passes raw data to a client component that re-fetches it on mount.
**Replace with:** Per-request `QueryClient` factory branched on `isServer`; server component calls `void queryClient.prefetchQuery(...)` (no await) and wraps children in `<HydrationBoundary state={dehydrate(queryClient)}>`; client components read with `useSuspenseQuery` (or `useQuery`) under the **same query key**. For single-query, single-component cases, use `initialData` instead.
**Why:** First paint arrives populated, the client cache is warm, and `useQuery` skips the redundant fetch. `staleTime > 0` is required, otherwise the cache is stale on arrival and refetches anyway.
**See:** `stacks/react/data-fetching.md` §10.

---

## R25: Validate at the Route Boundary with a Shared Schema

**Trigger:** Route handler trusts `req.json()` / `req.formData()` / search params without validation, **or** the request type and Zod schema are declared separately, **or** schemas live next to the handler and the client cannot import them.
**Replace with:** One schema module (`shared/schemas/<entity>.ts` or a `packages/contracts/` workspace package) defining `Entity`, `CreateEntityInput`, `UpdateEntityInput`, `EntityResponse`, with `z.infer` exporting the matching types. Server uses `safeParse` at the top of the handler; client form / fetcher imports the same schemas (and types) for `react-hook-form` + `zodResolver` and request typing.
**Why:** Adding a field is one edit; both stacks pick it up on the next type-check. The form, the fetcher, and the handler share one contract — no drift between "what the form accepts" and "what the API accepts". Combine with R6 (Replace Type Declaration with Inferred Type) and R11 (Brand the Primitive) for ID safety.
**See:** `stacks/nextjs/endpoints.md` §2 and §3.

---

## R26: Standardise the API Error Envelope

**Trigger:** Each route returns a different error JSON shape, raw `Error.message` leaks to the client, or the client renders errors with bespoke per-route handling.
**Replace with:** One `ApiErrorBody` schema (`{ error: { code, message, issues?, requestId? } }`), one `toErrorResponse(err, requestId)` mapper from a discriminated `AppError` union (R12) to HTTP status, and a `withApi` wrapper that catches, maps, attaches `requestId`, and returns the envelope. Every route uses `withApi`.
**Why:** Clients render errors with one component; logs index errors with one query; stack traces and SQL stay in logs (not responses). The mapper is the single place HTTP status decisions live.
**See:** `stacks/nextjs/endpoints.md` §4.

---

## R27: Span the Route Handler with Semconv Attributes

**Trigger:** Route handler has no telemetry, span name uses the concrete URL (high cardinality), span status `ERROR` is set on 4xx responses, attribute names are custom (`statusCode`, `userId`), or PII / tokens / raw bodies appear in span attributes.
**Replace with:** Wrap handlers in `withApi` (or equivalent) that opens a `SpanKind.SERVER` span named `${method} ${routeTemplate}`, sets semconv attributes (`http.request.method`, `http.route`, `url.path`, `http.response.status_code`, `user.id`), `recordException` only on 5xx / unhandled exceptions, and never stamps PII. Defer to `/otel-instrumentation` (`rules/sdks/nextjs.md`, `rules/spans.md`, `rules/sensitive-data.md`) and `/otel-semantic-conventions` for the deep guidance.
**Why:** `http.route` is low-cardinality so dashboards work; semconv names mean cross-service queries match; sensitive data stays out of traces.
**See:** `stacks/nextjs/endpoints.md` §7.

---

## R28: Replace Save Button with Debounced + Max-Wait Autosave

**Trigger:** Form requires an explicit Save click for content that should feel like a document (notes, settings, drafts), or the existing autosave saves on every keystroke, or pure throttle starves heavy typists.
**Replace with:** A scheduler with **debounce** (~1000 ms) **+ max-wait flush** (~5 s) **+ on-blur** of any field **+ on `visibilitychange` / `pagehide`** (use `navigator.sendBeacon` or `fetch keepalive` for the last-gasp save). Never disable inputs while saving.
**Why:** Pure debounce starves heavy typists; pure throttle wastes idle requests. Debounce + max-wait + blur covers both kinds of users and survives navigation.
**See:** `stacks/react/autosave.md` §2 and §3.

---

## R29: Add Local-First Draft Buffer

**Trigger:** Tab crash, network blink, or laptop sleep loses unsaved form work because the only persistence is the in-flight server save.
**Replace with:** Write to `localStorage` (or IndexedDB for larger / structured documents) on every change synchronously, then schedule the debounced server save. On mount, hydrate from local and compare timestamps with the server; clear the local draft only after the server confirms it stored the same value.
**Why:** Local-first is the survival layer when anything between the user and the server fails. Clearing the local draft only after server confirmation prevents stale server responses from wiping fresher local edits.
**See:** `stacks/react/autosave.md` §4.

---

## R30: Detect Concurrent Edits with ETag / `If-Match`

**Trigger:** Two tabs / two devices autosave the same record and one silently overwrites the other, or the server endpoint accepts every PATCH unconditionally.
**Replace with:** Server returns `ETag: "v<n>"` on GET, requires `If-Match: "v<n>"` on PATCH/PUT, and returns `412 Precondition Failed` when versions diverge. Client on 412 stops scheduling, refetches, and prompts the user "edited elsewhere — Reload / Keep mine" rather than merging silently. If headers cannot be controlled, embed `version: number` on the entity with the same semantics.
**Why:** Last-write-wins silently destroys data. Optimistic concurrency control surfaces the conflict at the moment it happens, when the user can decide.
**See:** `stacks/react/autosave.md` §6.

---

## R31: Replace Ad-Hoc Retries with a Durable Mutation Queue

**Trigger:** Mutations that fail on poor networks are lost on reload, retry logic is duplicated across components, or in-memory retry loops disappear when the user closes the tab mid-edit.
**Replace with:** An outbox pattern — every mutation is recorded as a queue entry in IndexedDB (`{ id, type, payload, entityId, ifMatch, attempts, status }`) before the network call; the queue is replayed in enqueue order per entity on reconnect; entries are deleted only on server confirmation. Pair every entry with an `Idempotency-Key` (R18) so replays do not duplicate.
**Why:** Local-first persistence is the survival layer; idempotency keeps replays safe; ordered replay per entity preserves user intent. Without this, "we lost the edit you made on the train" is a recurring bug.
**See:** `stacks/react/offline-sync.md` §2 and §5.

---

## R32: Coordinate Multi-Tab Sync with Web Locks + BroadcastChannel

**Trigger:** Two tabs both replay the mutation queue and double-write, every tab independently polls the same endpoint, or cache updates in one tab don't reach the others.
**Replace with:** Single-writer leader election via `navigator.locks.request('sync-leader', { mode: 'exclusive' }, ...)` so only one tab drives the queue; settled mutations fan out via `BroadcastChannel` so other tabs `setQueryData` without a refetch. Fallback to `broadcast-channel` / `tab-election` libraries only on environments without Web Locks.
**Why:** Multi-tab is the default — coordinate or corrupt. The pattern also drops API calls dramatically when users keep many tabs open.
**See:** `stacks/react/offline-sync.md` §8.

---

## R33: Wire TanStack Query Offline Persistence

**Trigger:** TanStack Query app loses paused mutations on reload, no `networkMode` configuration, or `resumePausedMutations` is never called on reconnect.
**Replace with:** Set `networkMode: 'offlineFirst'` on the `QueryClient`; install `@tanstack/react-query-persist-client` with an IndexedDB persister and a version `buster`; register a default `mutationFn` on the `MutationCache` so rehydrated mutations have behaviour; call `void queryClient.resumePausedMutations()` from a `window.online` handler and surface failures from the resolved promise.
**Why:** Persistence + replay is the canonical TanStack Query offline path. Without the default `mutationFn`, rehydrated mutations are silent no-ops; without `resumePausedMutations` they sit forever.
**See:** `stacks/react/offline-sync.md` §4.

---

## R34: Replace Prop-Soup Component with Deep-Namespace Compound

**Trigger:** A React component has 6+ props (especially booleans) controlling visual variations, the parent and its sub-parts are flat sibling exports (`<TabsList>`, `<TabsTrigger>`, `<TabsPanel>`), or external callers need imperative `ref`-handles to control internal state.
**Replace with:** A compound component with **deep dot-notation namespacing** that mirrors the visual hierarchy (`Combobox.Content.List.Item`), shared state via React Context with a memoised value and a `useXContext` guard, and a namespaced control hook (`Combobox.useCombobox`) that returns a memoised controller. `Object.assign` the sub-parts onto the root so the whole API ships under one import.
**Why:** One import covers the whole family; the JSX makes the hierarchy explicit; consumers gain flexible composition without prop bloat; the namespaced hook makes external control discoverable from the same import. Compound + Context replaces prop drilling and per-mode boolean flags.
**See:** `stacks/react/components.md` §3 and §4.

---

## R35: Trim Verbose Comment

**Trigger:** A comment is multi-sentence, paragraph-style, or longer than the code it describes; restates the WHAT the code already says; introduces an obvious function with a friendly preamble; bullet-lists multiple concerns above one function; or references the current task / PR / ticket.
**Replace with:** Walk the decision tree, in order, and stop at the first that fits:
  1. **Pure WHAT (restates the code)** → delete.
  2. **Mostly WHAT with one WHY sentence buried inside** → cut the WHAT, keep one line of WHY.
  3. **Genuine WHY but verbose** → rewrite as one line, lead with the constraint or surprise, drop the preamble.
  4. **Public API documentation that grew an essay** → convert to a docstring on the function; keep one-sentence summary + params/returns/throws; move rationale to a linked design doc or ADR.
  5. **Multiple distinct concerns in bullets above one function** → split the function. The bullets become function names; the comment disappears.
  6. **References the PR / ticket / task** → delete (git blame and the PR description are authoritative).

No hard length cap — a rare comment legitimately needs a paragraph (subtle invariant, hard-won workaround). Keep those; rewrite everything else to one line.
**Why:** Verbose comments accrete faster than they decay. They restate code, drift from it, lull readers into trusting stale narration, and crowd the diff on every unrelated change. The reader can read the code — comments must add what code can't: the WHY, the constraint, the surprise. Brevity preserves the signal that *this comment is worth reading*.
**See:** [`comments.md` § Brevity — Trim to the WHY](./comments.md#brevity--trim-to-the-why).

---

## Recipe Index by File

| File | Recipes |
|---|---|
| `maintainability.md` | R1, R2, R5 |
| `error-handling.md` | R6, R7, R11, R12, R13 |
| `architecture.md` | R8, R20 |
| `correctness.md` | R9, R18, R19 |
| `api-design.md` | R10, R12 |
| `abstraction.md` | R11, R15, R16, R17 |
| `control-flow.md` | R3, R4 |
| `functions.md` | R14 |
| `testability.md` | R9 |
| `stacks/react/data-fetching.md` | R21, R22, R23, R24 |
| `stacks/nextjs/endpoints.md` | R25, R26, R27 |
| `stacks/react/autosave.md` | R28, R29, R30 |
| `stacks/react/offline-sync.md` | R31, R32, R33 |
| `stacks/react/components.md` | R34 |
| `comments.md` | R35 |
