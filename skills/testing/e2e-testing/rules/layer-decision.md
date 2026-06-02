---
title: Layer Decision — Unit, Component, Integration, or E2E
impact: HIGH
tags:
  - testing-pyramid
  - layer-selection
  - unit
  - component
  - integration
  - e2e
---

# Layer Decision

Pick the lowest layer that can prove the behaviour.
E2E is expensive — slow runs, slow feedback, and high token cost when
agents drive it.
Defer to lower layers wherever the same property can be asserted.

## Decision flow

Walk these in order.
The first match wins.

| # | Question                                                                        | Pick                                  |
| - | ------------------------------------------------------------------------------- | ------------------------------------- |
| 1 | Can the property be asserted with a pure function call and no DOM?              | **Unit** — defer to [`tdd`](../../../quality/tdd/SKILL.md). |
| 2 | Does the bug live in a single component's render or interaction logic?          | **Component** — Vitest + RTL or Playwright component test. |
| 3 | Does the bug live in the seam between two services (API + DB, FE + BFF)?        | **Integration** — Vitest with a real DB / MSW. |
| 4 | Does the bug only repro through navigation, auth, or real network?              | **E2E** — this skill.                 |
| 5 | Is the flow a critical revenue or auth path?                                    | **E2E** — this skill, even if 1–3 also catch it. |

## Why E2E is not the default

Three concrete cost factors:

- A single E2E run touches the whole app stack — DB, network, browser.
  Wall-clock time scales with the slowest dependency.
- Healer cycles burn tokens against the accessibility tree of the live page.
  A 50-node form can produce a multi-thousand-token snapshot per attempt.
- Every E2E test is a potential flake.
  Flake budget is finite — spend it on flows that genuinely need it.

## Concrete examples

### Use unit (not E2E)

```ts
// Pure logic — no DOM, no router, no network.
expect(formatPriceCents(1234, 'USD')).toBe('$12.34');
```

### Use component (not E2E)

```tsx
// Single-component render + interaction. No router, no auth, no API.
render(<PasswordInput />);
await user.type(screen.getByLabel('Password'), 'short');
expect(screen.getByText(/at least 8 characters/i)).toBeVisible();
```

### Use integration (not E2E)

```ts
// Two seams: API handler + real DB.
await request(app).post('/api/orders').send(validOrder).expect(201);
const row = await db.orders.findFirst({ where: { id: ... } });
expect(row.status).toBe('pending');
```

### Use E2E (this skill)

```
Sign in → land on dashboard → create a new project →
verify the project shows in the sidebar after a hard refresh.
```

Why this is E2E-shaped:
multi-page navigation, auth state, and a refresh that exercises hydration.
None of the lower layers catch all three at once.

## Anti-patterns

- **Writing E2E for form-validation messages.**
  Use a component test — same assertion, 50× faster, no flake risk.
- **Writing E2E for pure formatters or selectors.**
  Use a unit test.
- **Skipping unit tests because the E2E exists.**
  The pyramid stays roughly 70/20/10 (unit/integration/E2E) for a reason —
  see [`references/pyramid-2026.md`](../references/pyramid-2026.md).
- **Adding a redundant E2E for a flow already covered.**
  Extend the existing spec instead.

## Cross-references

- Unit and component layer ownership: [`tdd`](../../../quality/tdd/SKILL.md).
- Pyramid math and the AI-generation caveat:
  [`references/pyramid-2026.md`](../references/pyramid-2026.md).
