---
title: 'Correctness — Bug-Class Hotspots'
impact: HIGH
tags:
  - correctness
  - idempotency
  - money
  - dates
  - determinism
  - async
  - resources
---

# Correctness

Categories of bugs that no general principle catches but that disproportionately ship.
Each section is short on theory and long on rules — these are the things to enforce, not debate.

## Contents

- [1. Idempotency](#1-idempotency)
- [2. Money — Never `number`](#2-money--never-number)
- [3. Floats: Equality Needs Epsilon](#3-floats-equality-needs-epsilon)
- [4. Dates and Time](#4-dates-and-time)
- [5. Identifiers](#5-identifiers)
- [6. Encoding](#6-encoding)
- [7. Determinism](#7-determinism)
- [8. Pre/Post Conditions, Invariants, Assertions](#8-prepost-conditions-invariants-assertions)
- [9. Async and Concurrency](#9-async-and-concurrency)
- [10. Resource Management](#10-resource-management)

## 1. Idempotency

Any operation that may be retried — HTTP POST, queue handler, RPC, file write, payment — must be safe to invoke twice.

### Rules

- **HTTP semantics.** PUT and DELETE are idempotent by spec; POST is not.
  If a POST creates, accept an `Idempotency-Key` header and dedupe server-side.
- **Queue handlers.** Dedupe by message ID before side-effecting.
  At-least-once delivery is the default in every real queue.
- **Create-or-return-existing beats create-then-409.**
  ```typescript
  // Avoid — the second retry crashes the caller
  await db.users.insert({ id, email });

  // Prefer — second call is a no-op
  await db.users.upsert({ id, email });
  ```
- **External calls** (payments, emails, webhooks) should carry an idempotency token the provider supports.
  If the provider does not, log enough to dedupe yourself.

### What is not idempotent

- "Increment counter by 1".
- "Append to log".
- "Send email" (without a dedupe key).

These need explicit dedupe layers if they sit behind a retryable boundary.

## 2. Money — Never `number`

Floating point cannot represent decimal currency exactly:

```typescript
0.1 + 0.2 === 0.3   // false
```

### Rules

- Store money as **integer minor units** (cents, satoshis) or use a decimal library (`big.js`, `decimal.js`, `Money` types).
- Only convert to a display string at the rendering boundary (`Intl.NumberFormat`).
- Rounding mode is a deliberate choice:
  - **Half-to-even (banker's rounding)** for accounting totals — avoids systemic bias.
  - **Half-up** for user-facing display.
  Do not use the default rounding for both.
- Currency is part of the type: `{ amount: 1500, currency: 'USD' }`, not bare numbers.
  Mixed-currency arithmetic is a bug — branded types prevent it (see `abstraction.md` §2).

## 3. Floats: Equality Needs Epsilon

```typescript
// Almost always wrong
if (a === b) { ... }

// For floats, use a tolerance
if (Math.abs(a - b) < EPS) { ... }
```

For exact comparisons (prices, scores, indices), convert to integers (basis points, ticks) and compare exactly.

## 4. Dates and Time

Date bugs ship constantly because `Date` is mutable, timezone-sensitive, and conflates instants with calendar dates.

### Rules

- **Store UTC, render in local.**
  The wire and the database hold UTC; the UI converts at render.
- **Distinguish instant from calendar date.**
  "When did the event happen?" is an instant.
  "What is the user's birthday?" is a calendar date with no time.
  Use different types (`Date` for instant; `LocalDate` / a string `YYYY-MM-DD` for calendar dates).
- **Durations are not dates.**
  `Duration` (an interval) and `Instant` (a moment) are different types.
  Adding two `Date`s is meaningless.
- **Do not mutate `Date` objects.**
  `setHours`, `setDate`, etc. mutate in place.
  Create new instances or use a date library (`date-fns`, `temporal`, `luxon`).
- **ISO 8601 on the wire**, rich types in domain code.
  Parse at the boundary, render at the egress.

## 5. Identifiers

IDs are opaque: they identify, they do not measure or order.

### Rules

- **Brand the type.**
  ```typescript
  type UserId = string & { readonly __brand: 'UserId' };
  ```
  Mixing `UserId` and `OrderId` becomes a compile error.
- **Do not infer business rules from sequential IDs.**
  "User 1000 was created before user 999" is true today and false tomorrow.
- **Prefer UUIDs / ULIDs / KSUIDs** over auto-increment for any ID exposed externally.
  Sequential IDs leak business volume and are guessable.

## 6. Encoding

Encoding bugs (XSS, double-encoding, mojibake) come from escaping at the wrong layer or not at all.

### Rules

- UTF-8 in, UTF-8 out, unless explicitly otherwise.
- **Escape at the layer that interprets**:
  - HTML escape at the renderer (the templating engine usually does this).
  - SQL parameterise at the query (never string-concatenate values into SQL).
  - URL-encode at URL construction.
  - Shell-escape never — use `spawn` with an argv array, not `exec` with a string.
- Do not pre-escape for downstream layers — they will escape again.

## 7. Determinism

A function that calls `Date.now()`, `Math.random()`, or reads `process.env` directly is not pure.
It cannot be tested deterministically.

### Inject the dependencies

```typescript
// Avoid — flaky test waiting to happen
function expiresAt(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

// Prefer — pure, trivially testable
function expiresAt(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
```

The same applies to:

- `Math.random()` → inject an RNG.
- ID generation → inject an `IdGenerator`.
- `process.env` reads → read once at the composition root, pass config in.

The shell at the edge resolves the real clock / RNG / env; the core sees parameters.
This pairs with `architecture.md` §3 (Functional Core, Imperative Shell).

## 8. Pre/Post Conditions, Invariants, Assertions

Use assertions to encode constraints the type system cannot:

```typescript
function dequeue<T>(q: Queue<T>): T {
  assert(q.length > 0, 'dequeue from empty queue');
  return q.items.shift()!;
}

function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
```

- Keep invariants on at runtime in non-perf-critical code.
- Strip them only after measuring that they are a bottleneck.
- Use `assertNever` in exhaustive switches; the compiler turns missed cases into build failures.

## 9. Async and Concurrency

### Serial vs. parallel `await`

```typescript
// Serial — each iteration waits
for (const id of ids) {
  await fetchUser(id);
}

// Parallel — all in flight at once
const users = await Promise.all(ids.map(fetchUser));
```

Pick one consciously.
A `for await` loop iterating I/O sequentially is almost always a performance bug.

### Cancellation

I/O that may outlive its caller (HTTP request, DB query, file read) accepts an `AbortSignal`.
Long-running handlers in a request should pass `req.signal` through so cancellation is observed.

### Race conditions

If two concurrent operations can interleave on the same state, you need a lock or an atomic operation.
"It probably will not happen" is a heisenbug waiting for production.

### `Promise.race` is dangerous when losers have side effects

Losing branches keep running.
Use `AbortController` to actually cancel them.

## 10. Resource Management

Every `open` has a `close`.
Leaked handles, connections, sockets, subscriptions, timers, and listeners compound until something falls over.

### Patterns

```typescript
// JS / TS — try/finally
const handle = await open(path);
try {
  await use(handle);
} finally {
  await handle.close();
}

// TS 5.2+ — `using`
{
  using handle = await openWithDispose(path);
  await use(handle);
}   // close runs automatically
```

### Common leaks to watch for

- Event listeners added in a setup function with no teardown.
- Timers (`setInterval`) without a paired `clearInterval`.
- DB transactions that bail out without rollback on error.
- Streaming responses that hold the connection open after the consumer disconnects.
- Subscriptions in long-lived contexts (workers, daemons) that accumulate per request.

For long-lived resources, prefer RAII-style wrappers that own the lifecycle.
