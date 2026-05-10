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

## Contents

- [Where to Validate](#where-to-validate)
- [Schema-First Validation (Parse, Don't Validate)](#schema-first-validation-parse-dont-validate)
- [Fail Fast and Loudly](#fail-fast-and-loudly)
- [Error Messages](#error-messages)
- [Error Types](#error-types)
- [Try/Catch Discipline](#trycatch-discipline)
- [Null / Undefined Handling](#null--undefined-handling)
- [Logging](#logging)
- [Retries](#retries)

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
See `Schema-First Validation` below for the recommended pattern.

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

## Schema-First Validation (Parse, Don't Validate)

Define **one** schema for each external shape, then **infer the type from
the schema**. The schema is the single source of truth for both the
runtime check and the static type — the two cannot drift because there is
only one declaration.

This is the typed-language counterpart to the Single Source of Truth
pattern in `maintainability.md` §2: one source, two consumers (the type
checker and the runtime parser).

The TypeScript-with-Zod recipe below applies almost identically to
Pydantic (Python), valibot/ArkType (TS), and Ecto changesets (Elixir) —
the principle is what matters, not the library.

### Pattern

```typescript
import { z } from 'zod';

// 1. Define the schema once, at module scope.
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  createdAt: z.coerce.date(),
});

// 2. Infer the type from the schema. Do NOT also declare `type User = {...}`
//    — that creates two declarations that will drift.
export type User = z.infer<typeof UserSchema>;

// 3. Parse at the boundary. After this line, the value is typed as `User`
//    and the rest of the code can trust it.
export function loadUser(raw: unknown): User {
  return UserSchema.parse(raw);
}
```

After `parse`, every internal function takes `User` and never re-validates.
The defensive null checks in the previous section become unnecessary
because the type system has already proven the shape.

### Anti-pattern: separate type and schema

```typescript
// Avoid: two declarations of the same shape — they will drift
type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
};

const userSchema = z.object({
  id: z.string(),       // missing .uuid() — drift
  email: z.string(),    // missing .email() — drift
  displayName: z.string(),
  // missing createdAt entirely — drift
});
```

This is the most common drift bug in TypeScript codebases. The type says
one thing, the validator checks another, and bugs ship through the gap.

### Modular Composition (when, and only when, it pays)

Schemas compose, so reusable sub-shapes can become their own schemas:

```typescript
export const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  countryCode: z.string().length(2),
});
export type Address = z.infer<typeof AddressSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema,
});
```

`AddressSchema` is now the single source of truth for what an address is.
Both fields share the validation, both share the inferred type, and a
new field added to addresses propagates to every consumer in one edit.

### When to split out a sub-schema

Split only when at least one of these is true:

- The sub-shape is **reused** across two or more parent schemas (the
  rule of three: be willing to extract on the second real use).
- The sub-shape has **its own boundary** — its own API endpoint, its own
  form, its own DB table — where it must be validated in isolation.
- The sub-shape is independently **versioned or evolved** (e.g., shared
  with another service).
- A **partial slice** of the parent must be parsed on its own (e.g.,
  PATCH endpoints accepting just `AddressSchema.partial()`).

### When NOT to split — keep it inline

Default to a flat, inline schema. Do not split when:

- The sub-shape exists in exactly one parent and has no separate boundary.
- The split would only "feel cleaner" — that is over-engineering.
  A 30-line nested `z.object` is fine if the shape is used once.
- The split would create a sub-schema with the same name suffix as its
  parent (`UserMetadataSchema` used only inside `UserSchema`) — that is a
  naming smell signalling the abstraction has no second consumer.

The same trade-off as the maintainability decision tree: **wait for a real
second consumer before extracting a sub-schema**.

### `parse` vs. `safeParse`

- **`parse(input)`** throws on invalid data. Use this when invalid input
  is a programming bug or an upstream system contract violation —
  internal API boundaries, config files you control, deserialised state.
- **`safeParse(input)`** returns `{ success, data | error }`. Use this for
  user-facing input where you need to render the error back to the user
  (forms, public APIs, CLI arguments).

```typescript
// Public API — return structured errors
const result = UserSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ errors: result.error.flatten() });
}
const user = result.data;

// Internal trusted boundary — throw is fine
const config = ConfigSchema.parse(loadConfigFile());
```

### Refinements and Branded Types

When a primitive carries a constraint that the type `string` cannot
express (a UUID, a non-empty trimmed string, a valid email), bake it
into the schema once and brand the type so it cannot be confused with a
raw string at call sites.

```typescript
export const EmailSchema = z.string().email().brand<'Email'>();
export type Email = z.infer<typeof EmailSchema>;

function sendWelcome(to: Email) { /* ... */ }

// Compile error — raw string cannot be passed where Email is required
sendWelcome('not-validated@example.com');

// OK — must go through the schema
sendWelcome(EmailSchema.parse('user@example.com'));
```

This pushes "is this validated?" from a runtime question to a compile-time
one, removing whole classes of "I forgot to validate" bugs.

### Schemas as Documentation

A schema doubles as a runtime-checkable spec for the shape. Prefer it to
a separate JSDoc/Markdown description that will rot. If an external
client needs the schema documented, generate it (`zod-to-openapi`,
`zod-to-json-schema`) — do not hand-maintain a second description.

### Common Mistakes

- **Defining the schema inside a request handler.** Schemas are constants;
  hoist to module scope so they are not rebuilt per request.
- **Using `z.any()` or `z.unknown()` to silence a type error.** That
  defeats the whole pattern. If a field's shape is not yet known, model
  the unknown explicitly (`z.record(z.unknown())`) and refine it as the
  contract clarifies.
- **Re-validating internally.** Once parsed at the boundary, the value is
  typed; do not call `UserSchema.parse(user)` again deeper in the stack.
- **Using `transform` to hide business logic.** `transform` is for shape
  normalisation (trim strings, coerce dates), not for computing derived
  domain values — those belong in named functions on the parsed type.

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
