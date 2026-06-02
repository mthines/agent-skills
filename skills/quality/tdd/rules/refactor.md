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

This phase delegates the *what counts as quality* question to the
`code-quality` skill. **Invoke `Skill('code-quality')`** so its Review
Mode procedure runs against the GREEN output and returns structured
findings — rather than reading individual rule files yourself, which
misses the skill's procedure, output contract, and any rules added since
this file was written.

The skill covers (and routes to the relevant rule file):

- Cognitive complexity, control flow, guard clauses, naming, comments
- Functions and parameters; single level of abstraction per body
- Maintainability: reuse, single source of truth for union metadata,
  change footprint, co-location
- Schema-first validation with type inference (Zod / Pydantic / valibot)
- Type-driven design: illegal states unrepresentable, branded
  primitives, exhaustive matching, generics discipline, `any`/cast
  justification
- Architecture: module boundaries, dependency direction, functional
  core / imperative shell, DTO ↔ domain ↔ persistence, immutability
  defaults, no side-effecting imports
- API design: parameter ordering, total functions, error type design,
  tell-don't-ask, file reading order
- Correctness hotspots: idempotency, money, floats, dates,
  identifiers, encoding, determinism, async / concurrency, resources
- Testability: dependency injection of clock / RNG / IDs
- Collaboration: PR scope, neighbour-symmetry, migration discipline
- Refactor recipes catalog (R1–R20) — cite by ID in reports

Ground refactoring decisions in objective criteria from these rules,
not personal taste.

---

## Decision: Refactor or Skip?

### Refactor when:
- Cognitive complexity score is over ~15 (deep nesting, long branching, dense boolean logic — see `code-quality/rules/cognitive-complexity.md`)
- A function nests beyond 2 levels — apply guard clauses or extract (see `code-quality/rules/control-flow.md`)
- Clear duplication exists (3+ similar lines of code)
- Names are unclear or misleading (see `code-quality/rules/naming.md`)
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

### 3. Refactoring Moves (cite recipes by ID)

The detailed catalog lives in `code-quality/rules/refactor-recipes.md`.
Cite recipes by ID in commit messages and progress reports so the move is
unambiguous and the rationale is one click away.

The recipes that come up most often in TDD's REFACTOR phase:

- **R4 Extract Guarded Function** — replace nested conditions with guard
  clauses at the top and an unindented happy path. Usually the highest-
  value first move.
- **R16 Extract by Abstraction Level** — split when the body mixes
  orchestration sentences with low-level mechanics.
- **R3 Replace Conditional with Lookup** — `if/else if` chains
  dispatching on a value become a record or `Map`.
- **R1 Consolidate Parallel Maps** — multiple maps keyed by the same
  union collapse into one `Record<Union, { ...metadata }>`.
- **R6 Replace Type Declaration with Inferred Type** — drop hand-written
  `type Foo = {...}` parallel to a Zod schema; use `z.infer<typeof FooSchema>`.
- **R10 Total-ise the Function** — return `null` / `Result<T, E>` instead
  of throwing for "not found" or returning sentinel values.
- **R8 Push Impurity Outward** — extract a pure core; keep I/O at the edges.
- **R9 Inject the Clock / RNG / IDs** — for any function whose tests
  proved flaky or required real time / randomness.
- **Extract test fixture** — when 3+ tests share setup, replace with a
  factory like `buildUser(overrides)`.

Orientation example (R4 Extract Guarded Function):

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

For the full catalog and trigger / replacement / rationale of every
recipe, read `code-quality/rules/refactor-recipes.md`.

### 4. Run Full Suite

After all refactoring steps, run the complete relevant test suite one final time.

### 5. Verify Test Provenance

Before reporting, invoke the `test-provenance-guard` skill to confirm the test you wrote actually exercises the production module — not a private copy of the SUT defined inside the test file.

```
Skill("test-provenance-guard")
```

| Property                  | Value                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Runs in                   | REFACTOR phase, after step 4 (full suite green)                                    |
| Skips silently if missing | Yes — log one line and continue to step 6                                          |
| Disable                   | Remove this section if you accept the risk that GREEN may have been a false pass  |

The guard runs a static check (the test file imports the SUT and does not shadow its exported names) plus a mutation check (blanking the production function's body re-runs the test and expects failure). If either check fails, the test was passing by construction — the GREEN phase was a false positive. Treat the guard's output as the source of truth: if it self-heals (extracting inline logic to an export and rewriting callers), accept the patch; if it cannot, revert to RED with the failing repro and try again.

Catching tests-by-construction here — at the moment the test is written — is far cheaper than discovering them in PR review or post-merge.

### 6. Report

Output, citing the recipe IDs applied:
```
REFACTOR: applied R4 (guard clauses in transfer) + R16 (extracted reserveStock) — all tests still passing.
```
Or:
```
REFACTOR: skipped — code is clean.
```

Recipe IDs come from `code-quality/rules/refactor-recipes.md`.

---

## Guardrails

- NEVER change behavior during refactoring. If a test fails, your refactoring changed behavior — revert and try again.
- NEVER add new tests during refactoring. New behavior = new RED phase.
- NEVER add new functionality during refactoring. "While I'm here..." is how scope creep starts.
- Refactoring should take less time than RED + GREEN combined. If it's taking longer, you're doing too much.
