---
title: Quick Reference — Smell to Refactor
impact: HIGH
tags:
  - quick-reference
  - smells
  - refactor
---

# Quick Reference — Smell to Refactor

Lookup table of common smells and the refactor each one maps to.
Cite the recipe IDs (`R1` … `R20`) from
[`rules/refactor-recipes.md`](../rules/refactor-recipes.md) when reporting
findings.

## Contents

- [Readability and control flow](#readability-and-control-flow)
- [Naming and parameters](#naming-and-parameters)
- [Maintainability and duplication](#maintainability-and-duplication)
- [Schema-first validation](#schema-first-validation)
- [Abstraction levels and types](#abstraction-levels-and-types)
- [Testability and purity](#testability-and-purity)
- [Error handling and totality](#error-handling-and-totality)
- [Side effects and impurity at import](#side-effects-and-impurity-at-import)
- [Correctness — money, floats, async, resources](#correctness--money-floats-async-resources)
- [Collaboration and file shape](#collaboration-and-file-shape)

## Readability and control flow

| Smell | Refactor To | Why |
|---|---|---|
| Nested `if` (3+ levels) | Guard clauses + early return | Each indent adds mental load; flat is easier |
| Long function (50+ lines, multiple responsibilities) | Extract by intent, name by what not how | One function = one reason to change |
| `else` after `return`/`throw` | Drop the `else` | Linear flow beats branching |
| `if/else if` chain dispatching on a value | Lookup table or single source-of-truth record | Data structure beats control flow; easy to extend |
| Defensive checks for impossible states | Delete | Trust your callers; validate at boundaries |

## Naming and parameters

| Smell | Refactor To | Why |
|---|---|---|
| Cryptic name (`d`, `tmp`, `data`) | Domain noun (`priceDifference`, `pendingOrders`) | Names ARE documentation |
| Boolean parameter | Two named functions or an enum | `send(true, false, true)` is unreadable |
| Flag/option cluster (4+ params) | Object parameter or builder | Working memory holds ~4 chunks |
| Magic number/string | Named constant | Future-you will not remember what `7` meant |
| Comment explaining WHAT | Rename or extract function | Comments rot; names get refactored with code |
| Comment explaining WHY (non-obvious constraint) | Keep it | The one comment that earns its place |

## Maintainability and duplication

| Smell | Refactor To | Why |
|---|---|---|
| Parallel maps over the same union (`LABELS`, `COLORS`, `ICONS` keyed by `Status`) | One `Record<Status, { label, color, icon }>` (R1) | Adding a variant becomes one edit, not N |
| Reimplementing a helper that already exists | Search first; use the existing one | Two implementations drift; bugs get fixed in one copy only |
| Same constant (`MAX_RETRIES`, status strings) duplicated across files | Hoist to one shared module | One concept, one home |
| Adding a new variant requires editing 4+ files | Consolidate before adding the variant | Shotgun surgery compounds with every variant |

## Schema-first validation

| Smell | Refactor To | Why |
|---|---|---|
| Separate `type User = {...}` and `userSchema = z.object({...})` for the same shape | One schema; `type User = z.infer<typeof UserSchema>` (R6) | Two declarations drift; one cannot |
| Re-validating an already-parsed value deep in the stack | Parse once at the boundary; trust the type internally | Validation is a boundary concern, not a per-call concern |
| Splitting every nested object into its own sub-schema "for cleanliness" | Keep flat unless the sub-shape is reused or has its own boundary | Premature decomposition; over-engineering |

## Abstraction levels and types

| Smell | Refactor To | Why |
|---|---|---|
| Function mixes orchestration sentences with low-level mechanics | Extract by abstraction level (R16) | Readers stop at the level they care about |
| Runtime check enforcing "these two fields can't both be set" | Discriminated union (R15) | Compiler enforces the invariant; runtime check disappears |
| Raw `string` for `Email`, `UserId`, `OrderId` | Brand the type via the schema (R11) | Mixing IDs becomes a compile error |
| `any` or unjustified cast silencing the type checker | Schema parse, narrowed `unknown`, or `// because:` comment (R17) | Unjustified `any` is the shape most type bugs take |

## Testability and purity

| Smell | Refactor To | Why |
|---|---|---|
| Function calls `Date.now()` / `Math.random()` directly | Inject the clock / RNG (R9) | Pure functions are testable; impure functions are flaky |

## Error handling and totality

| Smell | Refactor To | Why |
|---|---|---|
| Function throws for "not found" or returns sentinels (`-1`, `""`) | Total-ise: return `null` or `Result<T, E>` (R10) | Total functions are testable exhaustively |
| Every error throws the same `Error` with a parsed message | Discriminated `AppError` union (R12) | Structured fields beat string parsing |

## Side effects and impurity at import

| Smell | Refactor To | Why |
|---|---|---|
| Importing a module triggers a side effect | Factory: `createX(...)` (R20) | Tests stop being accidentally integration tests |

## Correctness — money, floats, async, resources

| Smell | Refactor To | Why |
|---|---|---|
| Operation that may be retried is not safe to invoke twice | Idempotency key, upsert, or right HTTP method (R18) | Retries corrupt state otherwise |
| Money stored as `number` | Integer minor units or decimal library (R19) | Floats cannot represent decimal currency exactly |
| Floats compared with `===` | Compare with epsilon, or use integer ticks | `0.1 + 0.2 !== 0.3` |
| `await` in a `for` loop where `Promise.all` was meant | Choose serial or parallel consciously | Accidental serialisation is a perf bug |
| Every `open` without a paired `close` | `try/finally` or `using` | Resource leaks compound silently |

## Collaboration and file shape

| Smell | Refactor To | Why |
|---|---|---|
| New file does not match neighbouring files' patterns | Read 2–3 neighbours and mimic them | Outlier code forces context-switching for every reader |
| Refactor PR mixed with feature PR | Split into two PRs | Mixed PRs get rubber-stamped or rejected on the wrong grounds |
| Helpers at the top of the file, public function 200 lines down | Public surface first; helpers below in call order | Files read top to bottom |
| Reaching `a.b.c.d.method()` to act on `a` | Tell, don't ask: put the operation on `a` | Callers shouldn't walk private structure |
