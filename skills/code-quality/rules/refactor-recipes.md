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
