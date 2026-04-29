---
title: 'REFACTOR Phase — Improve Without Changing Behavior'
impact: HIGH
tags:
  - tdd
  - refactor
  - clean-code
---

# REFACTOR Phase

Evaluate and improve code quality while keeping all tests green.

This phase delegates the *what counts as quality* question to the
`code-quality` skill. Read `code-quality/SKILL.md` and the relevant rule
files (especially `cognitive-complexity.md`, `control-flow.md`,
`naming.md`, and `review-checklist.md`) to ground your refactoring
decisions in objective criteria — guard clauses, cognitive complexity
scoring, single-responsibility functions, intent-revealing names — rather
than personal taste.

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

### 3. Refactoring Moves (common patterns)

The `code-quality` skill catalogs these in detail; the highlights below are
the moves that come up most often in TDD's REFACTOR phase.

**Guard clause + early return** — replace nested conditions with a flat
guarded body. Almost always the highest-value first move because it
unflattens the function's main intent:

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


**Extract function** — when a block of code has a clear single purpose:
```
// Before
function processOrder(order) {
  if (!order.items.length) throw new Error('Empty order');
  if (order.total < 0) throw new Error('Invalid total');
  // ... submit logic
}

// After
function validateOrder(order) {
  if (!order.items.length) throw new Error('Empty order');
  if (order.total < 0) throw new Error('Invalid total');
}

function processOrder(order) {
  validateOrder(order);
  // ... submit logic
}
```

**Extract test fixture** — when 3+ tests share setup:
```
// Before: repeated in every test
const user = { id: '1', name: 'Alice', role: 'admin' };

// After: shared factory
function buildUser(overrides = {}) {
  return { id: '1', name: 'Alice', role: 'admin', ...overrides };
}
```

**Rename for clarity** — when a name doesn't communicate intent:
```
// Before
const d = calculateDiff(a, b);

// After
const priceDifference = calculatePriceDifference(originalPrice, discountedPrice);
```

**Simplify conditionals** — when logic is nested or hard to follow:
```
// Before
if (user) {
  if (user.isActive) {
    if (user.hasPermission('edit')) {
      return true;
    }
  }
}
return false;

// After
return user?.isActive && user?.hasPermission('edit') ?? false;
```

### 4. Run Full Suite

After all refactoring steps, run the complete relevant test suite one final time.

### 5. Report

Output:
```
REFACTOR: [brief description of what was improved] — all tests still passing.
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
