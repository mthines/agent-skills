---
title: 'Architecture — Module Boundaries, Dependency Direction, Functional Core'
impact: HIGH
tags:
  - architecture
  - modules
  - functional-core
  - immutability
  - state
---

# Architecture

The shape of code at the file and module level determines how easy it is to find things, change things, and test things.
This rule covers the structural decisions that single-function-level guidance does not reach.

## Contents

- [1. Module Boundaries and Public Surface](#1-module-boundaries-and-public-surface)
- [2. Dependency Direction](#2-dependency-direction)
- [3. Functional Core, Imperative Shell](#3-functional-core-imperative-shell)
- [4. DTO ↔ Domain ↔ Persistence — Three Shapes, One per Boundary](#4-dto--domain--persistence--three-shapes-one-per-boundary)
- [5. Immutability Defaults](#5-immutability-defaults)
- [6. State Management Discipline](#6-state-management-discipline)
- [7. No Side-Effecting Imports](#7-no-side-effecting-imports)

## 1. Module Boundaries and Public Surface

Each module exposes a small, intentional public surface.
Internal helpers are not exported.
A module whose `index.ts` re-exports everything has no boundary — every internal change is a potential breaking change to consumers.

### Rules

- Default exports are `export`-private; promote to `export` only when a caller outside the module needs them.
- If a helper is needed in a sibling module, that is a signal: extract it to a shared utility module rather than reaching across.
- Avoid barrel files (`index.ts` re-exporting everything in the directory).
  They defeat tree-shaking, mask circular imports, and create the illusion of structure where there is none.
- Prefer explicit imports from the source file: `import { x } from './module/x'` over `import { x } from './module'`.

## 2. Dependency Direction

Dependencies point toward stable, abstract things — not toward concrete, volatile things.
Domain code does not import infrastructure; infrastructure imports domain.

```
        ┌────────────────┐
        │     Domain     │   pure types, business rules
        └────────▲───────┘
                 │ imports
        ┌────────┴───────┐
        │   Application  │   use cases, orchestration
        └────────▲───────┘
                 │ imports
        ┌────────┴───────┐
        │ Infrastructure │   DB, HTTP, queues, vendors
        └────────────────┘
```

Reading direction is bottom-up: infrastructure depends on application, application depends on domain, domain depends on nothing.

A circular import is a structural bug — split the shared piece into a third module instead of papering over with lazy `require` or dynamic `import()`.

## 3. Functional Core, Imperative Shell

Push pure decision logic into a core module that has no I/O, no time, no randomness.
Push side effects (DB, network, file system, time, randomness) to a thin shell at the edges.

### Why

- Pure code is the cheapest to test (no setup, no mocks).
- Pure code is the cheapest to reason about (no hidden state).
- Side-effecting code is unavoidable but should be small enough to verify by integration tests.

### Pattern

```typescript
// Core — pure, easy to test
function nextOrderState(current: OrderState, event: OrderEvent, now: Date): OrderState {
  // ...decisions only
}

// Shell — handles I/O around the pure call
async function handleOrderEvent(event: OrderEvent) {
  const current = await orderRepo.load(event.orderId);
  const next = nextOrderState(current, event, new Date());
  await orderRepo.save(next);
  await eventBus.publish({ type: 'OrderStateChanged', from: current.status, to: next.status });
}
```

The shell is dull glue; the interesting logic is testable without any infrastructure.

## 4. DTO ↔ Domain ↔ Persistence — Three Shapes, One per Boundary

A single concept usually has three runtime shapes:

| Shape | Lives at | Concerns |
|---|---|---|
| **DTO** | The wire (HTTP body, queue message, file format) | Validated by a schema; strings, ISO dates, snake_case |
| **Domain** | The runtime model | Rich types, value objects, invariants, branded primitives |
| **Persistence** | The storage row | Coupled to the database schema; nullable columns, FKs |

Map between them at the boundary; never let one leak into another's territory.

### Anti-pattern: leaking shapes

```typescript
// Wire DTO leaking into domain
function applyDiscount(user: { created_at: string; tier: string }) {
  if (Date.parse(user.created_at) < ...) /* ... */
}
```

`created_at: string` is a wire detail.
The domain should see `createdAt: Date` and `tier: UserTier`.

### Pattern

```typescript
// At the boundary
const user = UserSchema.parse(req.body).into Domain();   // map DTO → Domain
// ... internal code uses User (domain shape) only ...
return res.json(toDto(user));                             // map Domain → DTO at egress
```

Schemas (see `error-handling.md`) enforce the wire shape.
Domain types enforce the runtime shape.
Persistence types live next to the repository that owns the table.

## 5. Immutability Defaults

Mutation is allowed but never the default.

- `const` over `let`. `let` requires a reason and the reason is rarely "I will reassign later".
- `readonly` on public fields.
- Update via copy-on-write (`{ ...prev, status: 'paid' }`), not in-place mutation, when the value crosses a function boundary.
- Local mutation inside a single function body is fine and often clearer than functional acrobatics — but the value escaping the function should be immutable from the caller's perspective.

### Why this matters

Shared mutable state is the source of "spooky action at a distance" — code in one file changes behaviour in another file because they hold the same reference.
Immutability eliminates the bug class entirely.

## 6. State Management Discipline

State has an owner.
Every piece of mutable state belongs to one module that decides when it changes; everyone else reads.

### Rules

- Local state lives where it is used.
- Shared state has a single explicit owner (a store, a service, a context).
- A consumer that needs to mutate shared state asks the owner; it does not write directly.
- Module-scope `let` variables are global state in disguise — avoid.

### Spooky action test

If mutating an object in `featureA.ts` could change behaviour in `featureB.ts` you didn't expect, the design is wrong.
Either the state is shared and should have a single owner, or the modules should hold separate copies.

## 7. No Side-Effecting Imports

Importing a module must not cause anything to happen.
No network calls, no file writes, no registry pushes, no singleton creation, no top-level `await` that initialises a database.

### Why

Side-effecting imports make import order significant.
They turn unit tests into integration tests by accident.
They create initialisation hazards in tools (bundlers, type checkers, REPLs) that import modules speculatively.

### Pattern: export factories

```typescript
// Avoid — runs on import
export const db = new Database(process.env.DATABASE_URL!);

// Prefer — runs when the caller is ready
export function createDatabase(config: DbConfig): Database {
  return new Database(config.url);
}
```

The application's composition root (one place near the entry point) calls the factories and wires the graph.
Everywhere else imports types and pure functions.
