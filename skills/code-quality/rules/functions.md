---
title: 'Functions — Single Responsibility & Size'
impact: HIGH
tags:
  - functions
  - srp
  - extract-method
---

# Functions

A function is a unit of thought. The smaller and more focused, the easier
it is to understand, name, test, and reuse.

## The Single-Responsibility Heuristic

A function should have *one reason to change*. Practically, you can test
this with a few prompts:

- Can you describe what the function does in a single sentence without "and"?
- Does the function name accurately and completely describe its body?
- If a requirement changes, are all the affected lines in this function (and
  not in three others)?

If any answer is "no," split the function.

## Size Targets

There's no magic line count, but as guidance:

- **5–20 lines**: a sweet spot for most functions.
- **20–50 lines**: getting long; check whether sub-tasks could be extracted.
- **> 50 lines**: almost certainly doing too much. Look for natural seams
  (initialization, validation, transformation, persistence) and extract.

The exception: long functions that are essentially a linear sequence of
steps with no branching (e.g., a deployment script) can stay as one
readable narrative. The cost of extraction would be losing the linear
story.

## Parameters

- **0–2 parameters**: ideal.
- **3 parameters**: usually fine if all three are obviously related.
- **4 parameters**: starting to hurt; consider grouping into an object.
- **5+ parameters**: refactor. Either the function is doing too much, or
  the parameters represent a thing that deserves a name.

### Boolean Parameters Are Almost Always Wrong

```javascript
// Unreadable at the call site
sendEmail(user, true, false, true);

// Clear
sendWelcomeEmail(user);
sendUrgentEmail(user);
```

If a function's behavior depends on a boolean, it's two functions wearing a
trench coat. Split them. Names tell the reader more than `true`/`false` ever
will.

### Parameter Object Pattern

When parameters genuinely belong together, group them:

```javascript
// Avoid
function createUser(firstName, lastName, email, role, department, manager) { ... }

// Prefer
function createUser({ firstName, lastName, email, role, department, manager }) { ... }
```

Bonus: named arguments at the call site eliminate the "wait, was email
the third or fourth?" lookup.

## Return Values

- **Return early** for guard cases (see `control-flow.md`).
- **Return one type** consistently. A function that returns `User` on
  success and `false` on failure forces every caller to type-check.
- **Don't return mutable shared state**. Either return a fresh object or
  document the contract explicitly.
- **Avoid output parameters** (mutating a parameter as a way to return
  data). Return values are clearer.

## Side Effects

Functions either:

- **Compute** something (pure, returns a value, no observable effect).
- **Act** (writes to disk, sends a network request, mutates state).
- **Both** (computes a value and acts) — try to avoid; split into a
  computation and an action.

Pure functions are vastly easier to test, reason about, and parallelize.
Push impurity to the edges of the system; keep the core pure.

## Extract Method: When to Pull Out a Helper

Extract when:

- A block of code has a distinct purpose that you could *name*. The name
  becomes the function name; the block becomes the body.
- A block is repeated in 2–3 places (rule of three: extract on the third).
- A long function has natural sub-steps that obscure each other.

Don't extract when:

- The block is one line that you'd just be wrapping (`function getId(user)
  { return user.id; }` adds noise).
- The block is used once and the inline version reads clearly.
- The extracted function would need 5+ parameters to function — that's a
  signal the abstraction is wrong.

## Avoid Premature Generalization

A common trap: writing a "flexible" function that takes options/flags so it
can handle hypothetical future cases. The result is usually a function with
a confusing API and zero second user.

```javascript
// Premature: handles cases that don't exist yet
function fetchData(url, { method = 'GET', timeout, retries, cache, transform, fallback } = {}) {
  // 80 lines branching on every option
}

// Concrete: each function does one real thing
function fetchUser(id) { ... }
function fetchOrders(userId) { ... }
```

Wait until you have 3+ real callers with overlapping needs before
generalizing. Code is cheaper to refactor than to predict.

## Functions That Take Functions

Higher-order functions (`map`, `filter`, callbacks, decorators) are
powerful but obscure control flow. Use them when:

- The transformation is a natural shape (`map`/`filter`/`reduce` on a
  collection).
- The pattern is well-known in the language (e.g., middleware in Express,
  hooks in React).

Avoid when:

- A simple loop would be clearer.
- The callback has 5 parameters and three nesting levels (you've just
  moved the complexity, not removed it).
