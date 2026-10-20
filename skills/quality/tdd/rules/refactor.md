---
title: 'REFACTOR Phase — Improve Without Changing Behavior'
impact: HIGH
tags:
  - tdd
  - refactor
  - clean-code
---

# REFACTOR Phase

## Contents

- [Decision: Refactor or Skip?](#decision-refactor-or-skip)
- [Procedure (when refactoring)](#procedure-when-refactoring)
- [Guardrails](#guardrails)

Evaluate and improve code quality while keeping all tests green.

Judge the GREEN output against this checklist:

- **Readability:** the function reads top-to-bottom in one pass; one level of abstraction per body.
- **Nesting:** no `if` nested beyond 2 levels; guard clauses and early returns instead.
- **Naming:** names describe intent (`pendingOrders`, not `arr2`); a function name needs no "and".
- **Duplication and reuse:** no 3+ near-identical lines; reuse an existing helper before writing a new one.
- **Neighbour patterns:** the code matches the structure and conventions of neighbouring files.

Ground refactoring decisions in objective criteria from these rules,
not personal taste.

---

## Decision: Refactor or Skip?

### Refactor when:
- Cognitive complexity score is over ~15 (deep nesting, long branching, dense boolean logic)
- A function nests beyond 2 levels — apply guard clauses or extract
- Clear duplication exists (3+ similar lines of code)
- Names are unclear or misleading
- A function does more than one thing — name fails the "no `and`" test
- Test code has duplicated setup that could be a shared fixture
- Code is hard to read top-to-bottom in one pass

### Skip when:
- Code is already clean and readable
- Changes would be purely cosmetic
- The implementation is minimal (1-5 lines)
- Refactoring would add abstraction for a single use case
- You're tempted to add "nice to have" features

**If in doubt, skip.** Premature abstraction is worse than duplication.

---

## Procedure (when refactoring)

### 1. Identify the Smell

Be specific about what you're improving:
- "extracting repeated validation into a shared helper"
- "renaming `data` to `orderItems` for clarity"
- "splitting `processOrder` into `validateOrder` and `submitOrder`"

### 2. Make ONE Change at a Time

Each refactoring step should be atomic:
1. Make the change
2. Run all tests
3. Confirm all pass
4. Move to next change (or finish)

Never batch multiple refactoring steps into one edit. If a test breaks, you need to know exactly which change caused it.

### 3. Refactoring Moves (name the move)

Name the move in commit messages and progress reports so it is unambiguous.

The moves that come up most often in TDD's REFACTOR phase:

- **Extract Guarded Function** — replace nested conditions with guard
  clauses at the top and an unindented happy path. Usually the highest-
  value first move.
- **Extract by Abstraction Level** — split when the body mixes
  orchestration sentences with low-level mechanics.
- **Replace Conditional with Lookup** — `if/else if` chains
  dispatching on a value become a record or `Map`.
- **Consolidate Parallel Maps** — multiple maps keyed by the same
  union collapse into one `Record<Union, { ...metadata }>`.
- **Replace Type Declaration with Inferred Type** — drop hand-written
  `type Foo = {...}` parallel to a Zod schema; use `z.infer<typeof FooSchema>`.
- **Total-ise the Function** — return `null` / `Result<T, E>` instead
  of throwing for "not found" or returning sentinel values.
- **Push Impurity Outward** — extract a pure core; keep I/O at the edges.
- **Inject the Clock / RNG / IDs** — for any function whose tests
  proved flaky or required real time / randomness.
- **Extract test fixture** — when 3+ tests share setup, replace with a
  factory like `buildUser(overrides)`.

Orientation example (Extract Guarded Function):

```javascript
// Before
function transfer(from, to, amount) {
  if (from && to) {
    if (amount > 0) {
      if (from.balance >= amount) {
        // do the transfer
      }
    }
  }
}

// After
function transfer(from, to, amount) {
  if (!from || !to) throw new Error('accounts required');
  if (amount <= 0) throw new Error('amount must be positive');
  if (from.balance < amount) throw new Error('insufficient funds');
  // do the transfer
}
```

### 4. Run Full Suite

After all refactoring steps, run the complete relevant test suite one final time.

### 5. Verify Test Provenance

Run the check in [`test-provenance.md`](./test-provenance.md) on every test file this cycle wrote or extended.
A `by-construction` finding means GREEN was a false pass: apply its fix, or go back to RED with the failing repro.

### 6. Report

Output, naming the moves applied:
```
REFACTOR: applied Extract Guarded Function (transfer) + Extract by Abstraction Level (reserveStock) — all tests still passing.
```
Or:
```
REFACTOR: skipped — code is clean.
```

---

## Guardrails

- NEVER change behavior during refactoring. If a test fails, your refactoring changed behavior — revert and try again.
- NEVER add new tests during refactoring. New behavior = new RED phase.
- NEVER add new functionality during refactoring. "While I'm here..." is how scope creep starts.
- Refactoring should take less time than RED + GREEN combined. If it's taking longer, you're doing too much.
