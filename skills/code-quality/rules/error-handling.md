---
title: 'Error Handling — Trust Internally, Validate at Boundaries'
impact: HIGH
tags:
  - errors
  - validation
  - defensive-programming
---

# Error Handling

Defensive code that checks impossible states adds noise without adding
safety. The right approach is: validate strictly at system boundaries,
trust your own code internally, and let unexpected states surface as
errors instead of being silently swallowed.

## Where to Validate

### At Boundaries (always)

These are untrusted; validate everything:

- **User input** — form submissions, query strings, request bodies.
- **External APIs** — responses from third parties may be malformed,
  late, or missing fields.
- **File / database reads** — schemas drift, files corrupt.
- **CLI arguments** — typos, wrong types, missing required values.

Use schema validation (Zod, Pydantic, JSON Schema) at these boundaries
so the rest of the code can assume valid input.

### Inside the System (trust)

If a function is internal and only called by code you control, don't
re-validate. Defensive `if (!user) return null;` checks for values that
can't be null hide the real bug (the unexpected null) and clutter the
happy path.

```javascript
// Don't: defensive everywhere
function calculateTotal(order) {
  if (!order) return 0;
  if (!order.items) return 0;
  if (!Array.isArray(order.items)) return 0;
  return order.items.reduce((sum, item) => sum + (item?.price ?? 0), 0);
}

// Do: trust the contract, fail loudly if violated
function calculateTotal(order) {
  return order.items.reduce((sum, item) => sum + item.price, 0);
}
```

If `order` could legitimately be `null`, that's a guard at the entry
point — but only one, not five.

## Fail Fast and Loudly

When something is wrong, throw / return an error immediately. Don't:

- Silently swallow exceptions and continue.
- Log a warning and return a "default" that masks the failure.
- Wrap every function in `try/catch` "just in case."

Hidden errors corrupt downstream state and make debugging much harder.
A loud failure is easier to fix than a quiet one.

## Error Messages

Bad error messages waste hours. Good ones save them.

A useful error message includes:

1. **What failed** — be specific about the operation.
2. **Why it failed** — the underlying cause if known.
3. **What the caller can do** — if there's an actionable fix.
4. **Identifying context** — IDs, paths, values that help reproduce.

```javascript
// Useless
throw new Error('Validation failed');

// Useful
throw new Error(`Invalid order ${orderId}: total ${total} is negative`);
```

Don't leak secrets in error messages. PII, tokens, internal IPs — these
end up in logs.

## Error Types

When the language supports it, distinguish error categories so callers can
handle them differently:

- **User errors** (bad input) — return a helpful message; don't 500.
- **System errors** (DB down, disk full) — retry, alert, then surface.
- **Programming errors** (assertion violation) — crash; these are bugs to
  fix, not states to handle.

Custom error classes (`ValidationError`, `NotFoundError`,
`AuthorizationError`) make this explicit at call sites.

## Try/Catch Discipline

`try/catch` should be focused:

- **Catch only what you can handle.** If a `catch` block just rethrows or
  logs and rethrows, it shouldn't exist.
- **Catch specific exceptions, not everything.** `catch (e)` that swallows
  all errors is the most common bug shape — null pointer exceptions get
  caught alongside the legitimate ones.
- **Keep the try block small.** Wrap only the call that can fail, not 50
  lines of logic.

```javascript
// Avoid: catches too much
try {
  const user = await fetchUser(id);
  const profile = computeProfile(user);
  await saveProfile(profile);
} catch (e) {
  console.log('something failed');
}

// Better: catch only what each call can throw, handle distinctly
const user = await fetchUser(id);  // network errors propagate
const profile = computeProfile(user);  // pure, no try needed
try {
  await saveProfile(profile);
} catch (e) {
  if (e instanceof DuplicateError) return existingProfile(id);
  throw e;
}
```

## Null / Undefined Handling

In typed languages with optional types (TypeScript, Rust, Kotlin), use the
type system to make nullability explicit:

- `User | null` forces callers to handle the null case.
- `Option<User>` / `Result<User, Error>` make outcomes explicit.

Avoid the temptation to "fix" nullability by adding `?.` everywhere — that
just delays the error. If a value should never be null at this point,
assert it (`if (!user) throw new Error('user required')`) or use a
non-null assertion only with strong reasoning.

## Logging

Logs are not error handling. Logging an error and continuing is silently
swallowing it with extra steps. Either handle the error, propagate it, or
let it crash — but don't pretend logging is enough.

Log levels:

- **DEBUG**: developer-facing details, off in production.
- **INFO**: normal operation milestones.
- **WARN**: unusual but recoverable; investigate later.
- **ERROR**: real problems; alert / page if appropriate.

## Retries

Retry only when:

- The error is transient (network blip, rate limit).
- The operation is idempotent.
- You've capped the retries and added backoff.

Naive retry loops cause cascading failures during outages. Use
established patterns (exponential backoff with jitter, circuit breakers).
