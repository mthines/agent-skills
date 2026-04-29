---
title: 'Cognitive Complexity — Measuring Mental Load'
impact: HIGH
tags:
  - cognitive-complexity
  - readability
  - sonar
---

# Cognitive Complexity

Cognitive complexity is SonarSource's metric for how hard code is to
*understand*, distinct from cyclomatic complexity (which only counts paths).
It penalizes the things that actually exhaust readers: nesting, breaks in
linear flow, and recursion.

## Why this metric, not cyclomatic

A `switch` with 20 cases has cyclomatic complexity 20 but reads top-to-bottom
in seconds. A function with a single triple-nested `if` has cyclomatic
complexity 3 but forces the reader to hold three conditions in memory
simultaneously. Cognitive complexity captures that asymmetry — and it
correlates with real-world maintenance pain better than path counting does.

## How to score (mentally)

Walk through the function and add to a running tally:

- **+1** for each break in linear flow: `if`, `else if`, `else`, ternary,
  `switch`, `for`, `while`, `do`, `catch`, `goto`, recursion entry.
- **+1 (extra) for each level of nesting**: a top-level `if` is +1, an
  `if` inside that is +2, an `if` inside that is +3, etc. The increment grows
  with depth — that's the whole point.
- **+1** for each non-trivial boolean operator sequence (`a && b && c` is +1;
  `a && b && (c || d)` is +2).
- **+0** for each `else`, `else if`, or `catch` if it's part of a structure
  already counted (avoids double-counting).

## Targets

- **≤ 5**: simple, easy to understand at a glance.
- **6–10**: acceptable, but watch for growth.
- **11–15**: refactor when convenient.
- **> 15**: refactor now. SonarQube's default threshold flags at 15 and that's
  a reasonable hard line.

These are per-function. A file with many low-complexity functions is fine.

## How to bring complexity down

In rough order of effectiveness:

1. **Extract nested blocks into named helpers.** The inner `if` block has a
   name — make that name a function. The outer function gets shorter and the
   helper has a single, named purpose.
2. **Invert conditions for early return** (guard clauses). Replace
   `if (valid) { ... long body ... } else { return error; }` with
   `if (!valid) return error; ... long body ...`.
3. **Replace nested branching with a lookup table or strategy map.** A
   five-branch `if/else if` chain on a string is usually a `Map` or an
   object literal in disguise.
4. **Combine boolean conditions** that share a return value. Multiple
   `if (X) return false; if (Y) return false;` can become `if (X || Y)
   return false;` — but only if the conditions are conceptually similar.
   If they represent distinct failure modes, keep them split for clarity.
5. **Replace flag arguments with separate functions.** `process(items, true,
   false)` is unreadable. `processOrAbort(items)` and `processSilently(items)`
   are obvious.

## What NOT to do

- **Don't reduce complexity by deleting cases.** If the logic genuinely needs
  to handle 8 conditions, it needs to handle 8 conditions; just structure
  them so each is locally simple.
- **Don't extract a helper just to game the metric.** A helper called
  `_doStuff` that's invoked once and exists only to lower the parent's score
  has made things worse, not better.
- **Don't chase a target score.** The goal is human readability; the score is
  a proxy. If a function reads cleanly at score 12, leave it.

## Example walkthrough

```javascript
// Score: ~8 (high)
function processOrder(order) {
  if (order) {
    if (order.items && order.items.length > 0) {
      if (order.user.isActive) {
        for (const item of order.items) {
          if (item.inStock) {
            // process item
          } else {
            log('out of stock');
          }
        }
      } else {
        throw new Error('inactive user');
      }
    } else {
      throw new Error('empty order');
    }
  } else {
    throw new Error('null order');
  }
}

// Score: ~3 (much better — same behavior, guard clauses + extraction)
function processOrder(order) {
  if (!order) throw new Error('null order');
  if (!order.items?.length) throw new Error('empty order');
  if (!order.user.isActive) throw new Error('inactive user');

  for (const item of order.items) {
    processItem(item);
  }
}

function processItem(item) {
  if (!item.inStock) {
    log('out of stock');
    return;
  }
  // process item
}
```

The behavior is identical. The second version reads top-to-bottom, each
guard is one line, and the per-item logic is named.
