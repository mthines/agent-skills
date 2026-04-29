---
title: 'Control Flow — Guard Clauses & Linear Reading'
impact: HIGH
tags:
  - control-flow
  - guard-clauses
  - early-return
  - nesting
---

# Control Flow

Code is easier to understand when it reads top-to-bottom with minimal
branching. The reader's job is to track "what happens next?" — every level
of nesting and every long branch makes that harder.

## Guard Clauses (the most valuable refactor)

A guard clause is a check at the top of a function that exits early if a
precondition fails. They flatten the function and free the rest of the body
to assume the happy path.

### When to use

- Validating arguments
- Handling edge cases (empty, null, zero)
- Permission checks
- Feature flag short-circuits

### Pattern

```javascript
// Avoid: pyramid of doom
function transferFunds(from, to, amount) {
  if (from) {
    if (to) {
      if (amount > 0) {
        if (from.balance >= amount) {
          // ... actual logic, indented 4 levels deep
        }
      }
    }
  }
}

// Prefer: guards, then linear logic
function transferFunds(from, to, amount) {
  if (!from) throw new Error('source account required');
  if (!to) throw new Error('destination account required');
  if (amount <= 0) throw new Error('amount must be positive');
  if (from.balance < amount) throw new Error('insufficient funds');

  from.balance -= amount;
  to.balance += amount;
}
```

The second version: every guard is one self-contained line, each error is
specific, and the actual transfer is unindented and obvious.

## Drop `else` After `return` / `throw`

If a branch already exits the function, the `else` is redundant — and
removing it lets the alternative path live at the function's main
indentation level.

```javascript
// Awkward
function classify(score) {
  if (score >= 90) {
    return 'A';
  } else if (score >= 80) {
    return 'B';
  } else {
    return 'C';
  }
}

// Cleaner
function classify(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  return 'C';
}
```

## Cap Nesting at 2 Levels

Three nested levels of `if`/`for`/`while` is the practical ceiling for
human comprehension. Beyond that, extract a function or invert a condition.

### Strategies to flatten

1. **Extract the inner block** as a function with a name describing its
   purpose.
2. **Invert the outer condition** to a guard clause.
3. **Replace nested loops** with array methods (`map`, `filter`, `flatMap`)
   when the language supports them and the operation is clearly transform-
   shaped.
4. **Use `continue`** in loops to skip cases instead of nesting:
   ```javascript
   // Nested
   for (const item of items) {
     if (item.active) {
       if (item.value > threshold) {
         process(item);
       }
     }
   }
   // Flat
   for (const item of items) {
     if (!item.active) continue;
     if (item.value <= threshold) continue;
     process(item);
   }
   ```

## Replace Long `if/else if` Chains with Lookups

When branching dispatches on a value (not a condition), a map is clearer
than a chain.

```javascript
// Chain
function getDiscount(tier) {
  if (tier === 'gold') return 0.2;
  if (tier === 'silver') return 0.1;
  if (tier === 'bronze') return 0.05;
  return 0;
}

// Lookup
const DISCOUNT_BY_TIER = { gold: 0.2, silver: 0.1, bronze: 0.05 };
function getDiscount(tier) {
  return DISCOUNT_BY_TIER[tier] ?? 0;
}
```

The lookup version makes the data structure explicit and easy to extend
without touching control flow.

## Don't Over-Compress with Ternaries

Ternaries are great for one-line decisions. They are awful when nested.

```javascript
// Hard to read
const status = order.shipped ? (order.delivered ? 'done' : 'in-transit') : (order.paid ? 'pending' : 'draft');

// Easier
function statusOf(order) {
  if (!order.paid) return 'draft';
  if (!order.shipped) return 'pending';
  if (!order.delivered) return 'in-transit';
  return 'done';
}
```

## Keep Loop Bodies Short

If a loop body is more than ~10 lines, extract it. The reader shouldn't have
to track loop-state and per-iteration logic at the same time.

```javascript
// Avoid
for (const order of orders) {
  // 30 lines of validation, transformation, side effects, logging...
}

// Prefer
for (const order of orders) {
  finalizeOrder(order);
}

function finalizeOrder(order) {
  // ... the same 30 lines, now in a named function with one job
}
```

## Switch Statements

`switch` is fine — sometimes better than `if/else if` chains because it
signals "we're branching on a value" — but:

- Always handle the default case (or assert exhaustiveness in typed
  languages).
- Put the most common cases first if order is observable (some compilers
  optimize this, but mostly it helps the reader).
- Keep each case body short. If a case needs more than ~5 lines, extract.
