---
title: 'API Design — Function Signatures as a UI'
impact: HIGH
tags:
  - api-design
  - signatures
  - total-functions
  - error-types
  - tell-dont-ask
---

# API Design

A function signature is the UI for every caller — including future you and the agent reading this code in six months.
Bad ergonomics here cost callers forever; good ergonomics make the call site read like prose.

## 1. Parameter Order

Decidable rules:

- **Subject first.** The thing the function operates on goes before the things it operates with: `parseDate(input, options)`, not `parseDate(options, input)`.
- **Required before optional.** Optionals at the end so callers do not pass `undefined` placeholders.
- **Data before configuration.** `format(value, opts)`, not `format(opts, value)`.
- **Once you have 4+ parameters, switch to an options object.**
  See `functions.md` "Parameter Object Pattern".

## 2. Defaults at the Right Layer

A default belongs where the decision lives.

- A *business* default (e.g., "trial period is 14 days") lives in business code where the policy is owned.
- A *transport* default (e.g., "HTTP timeout is 5 s") lives in the transport layer, not at every call site.
- Avoid leaking transport details into call sites: `client.get(url, { timeout: 5000, retries: 3 })` repeated everywhere is a signal the wrapper does not own its own defaults.

## 3. Sync vs. Async Consistency

Within a module or family of related functions, all related operations should be synchronous or all asynchronous.
Do not mix.

- A function that is "sometimes async" — returns `T | Promise<T>` depending on whether a cache is warm — is a usability trap.
  Pick one shape and pay the (tiny) cost of the unnecessary `await`.
- If most callers await, the function is async.

## 4. Total Functions: Every Input Has a Defined Output

A *total* function is defined for every value of its input type.
Make functions total wherever practical.

### Pick one representation for "absent" per codebase

The four common representations are:

- `null`
- `undefined`
- An empty value (`""`, `[]`, `0`)
- An exception

Pick **one** for "the value may legitimately not exist" and use it everywhere.
Recommended default for TS/JS:

- `null` for "may not exist by design" (`getUserById` on a missing id).
- `undefined` for "not provided by the caller" (optional parameter).
- Never both for the same field.

### Do not throw for expected absence

```typescript
// Avoid — "not found" is a normal outcome
function getUser(id: string): User {
  const user = db.find(id);
  if (!user) throw new NotFoundError(id);
  return user;
}

// Prefer — caller decides what "not found" means
function getUser(id: string): User | null {
  return db.find(id) ?? null;
}
```

Throwing is reserved for **programmer errors** (an invariant is violated) and **unexpected I/O failures**.

### Sentinels lie

`-1` for "not found", `""` for "absent", `0` for "no result" — every sentinel collides with a real value the next caller will hit.
Use `null` / `undefined` / a `Result` type.

## 5. Designing the Error Type System

Errors are a type system, not a category of strings.
Design the error space the same way you design the success space.

### Discriminated error union

```typescript
type AppError =
  | { kind: 'not_found';   resource: string; id: string }
  | { kind: 'validation';  issues: ZodIssue[] }
  | { kind: 'conflict';    reason: string }
  | { kind: 'unauthorised'; subject: string };
```

Each variant carries the structured data the handler needs.
The `kind` discriminator drives exhaustive matching at every site that translates an error to an HTTP status, a UI message, or a retry decision.

### `Result<T, E>` for expected failures

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

async function chargeCard(req: ChargeRequest): Promise<Result<Charge, AppError>> {
  // ...
}
```

`Result` makes failure paths explicit at the call site.
`throw` makes them invisible.
For *expected* failure modes (validation, conflict, not found), use `Result`.
For *programmer errors* and *unexpected* I/O failures, throw.

### Preserve causes with `Error.cause`

```typescript
try { /* ... */ }
catch (e) {
  throw new ChargeFailedError('payment processor rejected', { cause: e });
}
```

`Error.cause` (ES2022) preserves the original stack and message through transformations.
Do not concatenate `e.message` into a new string and lose the original.

### Custom error classes

Per-category subclasses make `instanceof` narrowing trivial:

```typescript
class ValidationError extends Error { /* ... */ }
class NotFoundError extends Error { /* ... */ }

if (e instanceof ValidationError) return 400;
if (e instanceof NotFoundError) return 404;
```

## 6. Tell, Don't Ask (and Demeter-Light)

If you reach `a.b.c.d.method()` to do something, the operation belongs *on* `a` or `b`, not at the call site.

```typescript
// Avoid — caller walks into the object's internals
if (user.subscription.plan.tier.code === 'enterprise') { ... }

// Prefer — caller asks the object
if (user.isOnEnterprisePlan()) { ... }
```

### When the rule applies

- For **behaviour** (methods that act on the data), apply strictly.
- For **plain data records** (DTOs, configuration objects, rows from a query), walking the structure is fine — that is what records are for.

The test: am I asking the object to *make a decision*, or am I just reading a *value*?
Decisions belong on the object; values are public.

## 7. Reading Order Within a File

Files are read top to bottom.
Order the contents so a reader landing on the file can build understanding linearly.

- **Public surface first.**
  Exports the file is named for sit at the top.
  Helpers used by them sit below, in roughly the order they are first called.
- **Types and constants near their primary user.**
  A `Status` type defined two scrolls before its first use forces the reader to remember it.
- **One main concept per file.**
  If two equally-prominent exports exist, the file is two files.

### Anti-pattern: helpers-first

```typescript
function _formatPrice(...) { ... }
function _normaliseLineItem(...) { ... }
function _validateTotals(...) { ... }
// 200 lines later:
export function renderInvoice(...) { ... }
```

The reader has to read three helpers without context to discover the function the file actually exports.
Put `renderInvoice` at the top.
