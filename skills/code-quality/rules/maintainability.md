---
title: 'Maintainability — Reuse, Single Source of Truth, Locality of Change'
impact: HIGH
tags:
  - maintainability
  - reuse
  - dry
  - single-source-of-truth
  - shotgun-surgery
---

# Maintainability

Code is read many times and changed many times.
The cost of a feature is dominated by how many places you must touch — and remember to keep in sync — when something evolves.
This rule covers three levers that move that cost the most: reuse, single source of truth, and locality of change.

It sits in deliberate tension with `functions.md` ("avoid premature generalization") and the "DRY vs. clarity" default in `SKILL.md`.
The resolution is in **When to reuse vs. when to duplicate** below — read it before extracting or consolidating.

## 1. Reuse Before Creating

Before writing a helper, formatter, validator, type, constant, or hook, **search the codebase for one that already exists**.
A second implementation of the same concept is worse than no implementation at all: behaviour drifts, bugs get fixed in one copy and not the other, and the next reader does not know which one is canonical.

### The search-first procedure (authoring mode)

Run this before writing a new utility:

1. **Grep for the domain noun.**
   `formatCurrency`, `parseDate`, `slugify`, `userIdSchema`.
   Try the obvious name and one synonym.
2. **Grep for the operation shape.**
   If you are about to write `arr.reduce((acc, x) => ...)`, search for that reduce body — the project may have a `sumBy`, `groupBy`, or `keyBy` already.
3. **Look at neighbour files.**
   Files in the same module/package usually expose the helpers used in that domain.
   New code should look like its neighbours.
4. **Check the standard library and existing dependencies.**
   `Object.groupBy`, `structuredClone`, `Array.prototype.flatMap`, `Intl.NumberFormat`, lodash, date-fns, the framework's own utilities — do not reimplement what ships in the runtime or a dependency you already have.
5. **Only if nothing fits, write a new one — and put it where the next person will find it.**
   Co-locate with the existing utilities of the same domain.

### What to do when you find a near-match

| Situation | Action |
|---|---|
| Exact match | Use it. Do not write a parallel one. |
| Close match, your need is one parameter / option away | Extend the existing helper if the new option makes sense for all callers; otherwise compose around it. |
| Close match, but the existing helper is wrong (buggy, unclear, untyped) | Fix the existing helper and migrate callers. Do not add a "v2" alongside it. |
| Different domain, similar shape | Leave them separate. Two functions that happen to look alike are not duplication if they describe different concepts. |

### Anti-patterns

- **Parallel utilities with slightly different names**: `formatPrice`, `formatMoney`, `toCurrency`, `displayAmount` all in the same codebase.
  Pick one, delete the rest.
- **Re-deriving constants**: `MAX_RETRIES = 3` defined in five files.
  Hoist to one module.
- **Re-implementing a framework primitive**: writing your own debounce when the framework's hook is already imported elsewhere.

## 2. Single Source of Truth for Union-Type Data

When a union type (string literal union, enum, discriminated union, status set) has associated metadata — labels, icons, colours, permissions, sort order, default values — **store it in one record keyed by the union, not in N parallel maps**.

Parallel maps over the same union are the most common form of shotgun surgery: adding a new variant means hunting down every map and updating it, and the type system cannot tell you which ones you missed.

### Anti-pattern: parallel maps

```typescript
type OrderStatus = 'draft' | 'pending' | 'paid' | 'shipped' | 'delivered';

const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting payment',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  draft: 'gray',
  pending: 'yellow',
  paid: 'blue',
  shipped: 'purple',
  delivered: 'green',
};

const STATUS_ICONS: Record<OrderStatus, string> = {
  draft: 'pencil',
  pending: 'clock',
  paid: 'credit-card',
  shipped: 'truck',
  delivered: 'check',
};

const STATUS_IS_TERMINAL: Record<OrderStatus, boolean> = {
  draft: false,
  pending: false,
  paid: false,
  shipped: false,
  delivered: true,
};
```

Adding a new status (`'cancelled'`) means updating four maps in four locations.
Miss one and TypeScript will complain — but only if every map is `Record<OrderStatus, …>`; lose that constraint anywhere and the bug ships.

### Pattern: one record, structured value

```typescript
type OrderStatus = 'draft' | 'pending' | 'paid' | 'shipped' | 'delivered';

type OrderStatusMeta = {
  label: string;
  color: string;
  icon: string;
  isTerminal: boolean;
};

const ORDER_STATUS: Record<OrderStatus, OrderStatusMeta> = {
  draft:     { label: 'Draft',             color: 'gray',   icon: 'pencil',      isTerminal: false },
  pending:   { label: 'Awaiting payment',  color: 'yellow', icon: 'clock',       isTerminal: false },
  paid:      { label: 'Paid',              color: 'blue',   icon: 'credit-card', isTerminal: false },
  shipped:   { label: 'Shipped',           color: 'purple', icon: 'truck',       isTerminal: false },
  delivered: { label: 'Delivered',         color: 'green',  icon: 'check',       isTerminal: true  },
};
```

Adding `'cancelled'` is a single edit in a single place, and TypeScript's exhaustiveness check fails the build if any field is missing.
Accessors stay trivial: `ORDER_STATUS[status].label`.

### When to apply this consolidation

- The keys are the same union, **and**
- The maps are conceptually about *the same concept* (status, role, kind, type), **and**
- The values are independent metadata fields, not large unrelated payloads.

If two maps happen to share a key set but model different concepts (e.g., `USER_PERMISSIONS` and `USER_AVATAR_URLS` both keyed by user id), keep them separate — they are different domains that just happen to share an index.

### Functions over records

If the value depends on runtime data, replace `STATUS_X` lookup with a function that takes the structured record:

```typescript
function nextActionFor(order: Order): string | null {
  const meta = ORDER_STATUS[order.status];
  if (meta.isTerminal) return null;
  return order.paid ? 'Ship order' : 'Take payment';
}
```

The union still has one source of truth (`ORDER_STATUS`); the logic that *uses* it lives next to the type.

## 3. Locality of Change

The "shotgun surgery" smell: a single conceptual change forces edits in many unrelated files.
Maintainable code minimises the **change footprint** — the number of files and lines you must touch when a single concept evolves.

### The footprint test

Before merging a change, ask: **"If we add the next obvious variant of this concept, how many files do we have to edit, and is the type system going to catch us if we miss one?"**

| Footprint | Verdict |
|---|---|
| 1 file, type-checked | Excellent. Ship. |
| 2–3 files, type-checked | Acceptable, especially across architectural layers (schema, API, UI). |
| 4+ files, or any of them not type-checked | Refactor. Consolidate before adding the next variant. |

### Common shotgun-surgery shapes

- Parallel maps over a union (see section 2).
- Switch statements on the same union scattered across files instead of a single `match` co-located with the union.
- Constants duplicated in `frontend/`, `backend/`, and `shared/` instead of one shared module.
- Validation rules redeclared at every API endpoint instead of one schema reused.
- Feature flags read in many places instead of one capability-check function.

### Co-locate data with the operations on it

A union type and the metadata + functions that operate on it should live in the same file (or same small module).
A reader who lands on `OrderStatus` should not have to grep across the project to find what each status *means* and *does*.

```
order-status.ts
├── type OrderStatus
├── const ORDER_STATUS (the metadata record)
├── function isTerminal(status)
├── function nextStatus(status)
└── function statusLabel(status)
```

This is also where new variants get added, so the change footprint stays at one file.

## 4. When to Reuse vs. When to Duplicate

This is the rule that resolves the tension with `functions.md`'s "avoid premature generalization" and the "DRY vs. clarity" default.

### Reuse (consolidate, extract, or de-duplicate) when

- The same concept is represented in two places.
  Same domain noun, same business meaning.
- The two places must always change together to stay correct.
  If fixing a bug in one means fixing it in the other, they are one thing wearing two hats.
- The shared shape is over a closed set (a union type, an enum, a fixed schema).
  Closed sets benefit hugely from a single source of truth — the type system enforces completeness.
- A utility already exists.
  Reusing existing code is never "premature"; it is the cheap path.

### Duplicate (keep separate, do not extract) when

- Two pieces of code look alike but model different concepts.
  Coincidental similarity is not duplication.
- The shared abstraction would need 3+ flag/option parameters to satisfy both callers.
  That is a sign you are forcing two different things through one shape.
- You only have two examples and no third on the horizon.
  The "rule of three": wait for the third real caller before extracting a generic helper.
  Two slightly-different 5-line blocks beat one 12-line generic helper that takes flags.
- The duplication is in test code where each test is meant to read independently.

### The decision tree

```
Is there an existing utility that fits?
├── Yes → use it. Stop.
└── No
    ├── Is this the same concept appearing in 2+ places?
    │   ├── Yes, and they must change together → consolidate now.
    │   └── No → write the concrete version. Revisit when a 3rd caller appears.
    └── Are you tempted to add option flags to make a helper "flexible"?
        └── Stop. Write the concrete version. Generalise when a real second caller exists.
```

## 5. Quick Maintainability Heuristics

Apply these while writing or reviewing:

1. **One concept, one home.**
   A status, role, or feature flag has one canonical declaration; everything else imports it.
2. **Adding the next variant should be one edit.**
   If it is not, the structure is wrong — fix the structure before adding the variant.
3. **Imports tell a story.**
   A file that imports from ten unrelated modules is probably doing too much, or the modules are poorly factored.
4. **Match the patterns next door.**
   New code that looks like a stranger in its own folder forces every reader to context-switch.
5. **Prefer types that make illegal states unrepresentable** over runtime checks that detect them.
   The earliest place a bug can be caught is the cheapest place to fix it.
6. **Co-locate the "what" with the "how".**
   The type definition, its metadata, and its operations belong in one module — not scattered across `types/`, `constants/`, and `utils/`.

## What Maintainability Is Not

- **Maintainability is not maximum DRY.**
  Forced abstractions that only one or two callers use are anti-maintainability — they couple unrelated code together and grow flag parameters over time.
- **Maintainability is not "design for every future need".**
  Future-proofing for needs that never arrive is the opposite of maintainable: dead options become traps for the next reader.
- **Maintainability is not endless refactoring.**
  Stop when the change footprint is small and the next variant is obviously a one-file edit.
  Perfect is a moving target; "easy to change tomorrow" is the goal.
