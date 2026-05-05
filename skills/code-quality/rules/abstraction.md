---
title: 'Abstraction — Levels, Types, Generics, Escape Hatches'
impact: HIGH
tags:
  - abstraction
  - type-driven-design
  - generics
  - any
---

# Abstraction

Abstractions earn their keep when they make code easier to understand and easier to change.
Premature, mis-levelled, or over-generic abstractions make code harder.
This rule covers the four abstraction decisions that come up while writing code: levels within a function, the type system as a design surface, generics, and type escape hatches.

## 1. One Level of Abstraction Per Function

A function should mix instructions at one level of detail.
A body that goes "validate the order, then notify the user, then `for (let i = 0; i < items.length; i++)`" forces the reader to context-switch from orchestration to mechanics inside one mental frame.

### Heuristic

Read the function aloud.
If some lines sound like sentences ("validate the order", "send the receipt") and others sound like mechanics ("increment the counter", "iterate the array"), they belong in different functions.

### Anti-pattern

```typescript
async function processOrder(order: Order) {
  if (!order.items?.length) throw new Error('empty order');
  await db.beginTransaction();
  for (let i = 0; i < order.items.length; i++) {
    const item = order.items[i];
    const stock = await db.query('SELECT qty FROM stock WHERE id = ?', [item.id]);
    if (stock.qty < item.qty) throw new Error(`out of stock: ${item.id}`);
    await db.query('UPDATE stock SET qty = qty - ? WHERE id = ?', [item.qty, item.id]);
  }
  await sendgrid.send({ to: order.user.email, template: 'order-confirmation', data: order });
  await db.commit();
}
```

The function reads at three levels at once: business orchestration, SQL mechanics, and email transport detail.

### Pattern

```typescript
async function processOrder(order: Order) {
  guardNonEmpty(order);
  await withTransaction(async () => {
    await reserveStock(order.items);
    await sendConfirmation(order);
  });
}
```

Each helper lives at one level.
The reader who wants the high-level story stops at `processOrder`; the reader debugging stock subtraction goes straight to `reserveStock` and stays there.

## 2. Type-Driven Design — Make Illegal States Unrepresentable

The cheapest place to catch a bug is the place the bug cannot exist.
Lift constraints into the type system so the compiler enforces them; runtime checks become unnecessary.

### Discriminated unions for state machines

```typescript
type Order =
  | { status: 'draft';     items: Item[] }
  | { status: 'submitted'; items: Item[]; submittedAt: Date }
  | { status: 'paid';      items: Item[]; submittedAt: Date; paidAt: Date }
  | { status: 'shipped';   items: Item[]; submittedAt: Date; paidAt: Date; trackingId: string };
```

`order.trackingId` is unreachable on a `'draft'` order — the type system enforces "you cannot read a tracking id off an unshipped order".
No runtime guard is needed.

### Exhaustive matching with `assertNever`

```typescript
function label(order: Order): string {
  switch (order.status) {
    case 'draft':     return 'Draft';
    case 'submitted': return 'Awaiting payment';
    case 'paid':      return 'Paid';
    case 'shipped':   return `Shipped — ${order.trackingId}`;
    default:          return assertNever(order);
  }
}

function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
```

Adding a new status the compiler immediately fails the build at every `switch` until each is updated — `assertNever` turns "missed a case" from a bug class into a compile error.

### Branded primitives

A raw `string` cannot tell `Email`, `UserId`, and `OrderId` apart.
Brand the type at the validating boundary so the compiler does:

```typescript
const EmailSchema = z.string().email().brand<'Email'>();
type Email = z.infer<typeof EmailSchema>;

function sendWelcome(to: Email) { /* ... */ }

sendWelcome('not-validated@x.com');                  // compile error
sendWelcome(EmailSchema.parse('user@example.com'));  // ok
```

See `error-handling.md` Schema-First Validation for the broader pattern.

### Refined types beat runtime guards

```typescript
type NonEmptyArray<T> = readonly [T, ...T[]];

function head<T>(xs: NonEmptyArray<T>): T {
  return xs[0];   // no runtime check needed; the type proves length ≥ 1
}
```

If the input cannot be empty, encode it.
The "empty array" branch never has to be written.

## 3. Generics — Parameterise Behaviour, Not Data Shapes

Generic code is justified when **the same algorithm operates over different types**.
Adding type parameters to make a function look "flexible" without a real second caller is the type-level version of premature abstraction.

### When to be generic

```typescript
// Justified — same algorithm, many T
function keyBy<T, K extends string>(items: T[], pick: (t: T) => K): Record<K, T> {
  const out = {} as Record<K, T>;
  for (const item of items) out[pick(item)] = item;
  return out;
}
```

### When not to be generic

```typescript
// Not justified — one concrete type
function logUser<T extends { id: string; email: string }>(user: T): void {
  console.log(user.id, user.email);
}

// Better — say what you mean
function logUser(user: User): void {
  console.log(user.id, user.email);
}
```

### Conditional types are write-only

`type X<T> = T extends Foo ? T extends Bar ? ... : ... : ...` is unreadable in six months.
If you need it, leave a comment explaining the shape and a test pinning the inferred result.
Most domain code does not need conditional types.

## 4. Type Escape Hatches: `any`, `unknown`, and Casts

Every codebase needs escape hatches at FFI boundaries, parser internals, and dynamic-shape glue.
The discipline is making escapes deliberate, not accidental.

### `unknown` is the safe escape

`unknown` says "I do not know the shape; force me to narrow before use".
Use it freely at boundaries; pair with a schema parse to widen safely.

### `any` is a smell

`any` silences the type checker.
Every `any` carries a one-line `// because:` comment justifying the escape.
Without justification, the next reader cannot tell whether the `any` is load-bearing or a leftover.

```typescript
// because: third-party SDK ships no types and the shape is documented in the README
const handle = (sdk as any).createHandle({ ... });
```

### Casts (`as Foo`) follow the same rule

A cast asserts a fact the checker cannot prove.
Justify it, or replace it with a parse:

```typescript
// Avoid
const user = JSON.parse(raw) as User;

// Prefer — actually verifies the shape
const user = UserSchema.parse(JSON.parse(raw));
```

### Legitimate uses of `any` / casts

- Generic infrastructure where the type really is "anything the caller passes" (and the caller has its own typing).
- Parser internals that produce typed values from untyped input.
- IPC / FFI / postMessage boundaries that the language cannot type.

### What never justifies `any` / a cast

- "It made the type error go away".
- "TypeScript was being annoying".
- "I will fix it later".

These are the `any`s that ship bugs.
