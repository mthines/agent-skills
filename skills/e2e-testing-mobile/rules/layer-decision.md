---
title: Layer Decision — Unit, Component, Web E2E, or Mobile E2E
impact: HIGH
tags:
  - testing-pyramid
  - layer-selection
  - jest
  - react-native-testing-library
  - maestro
  - detox
---

# Layer Decision

Pick the lowest layer that can prove the behaviour.
Mobile E2E is the **most expensive** test you can write — it requires
a build, a simulator or device, and a flow runner that walks the OS
accessibility tree.
Defer to lower layers wherever the same property can be asserted.

This rule is the mobile counterpart to the web
[`e2e-testing` layer-decision rule](../../e2e-testing/rules/layer-decision.md).
The shape is the same; the layer ownership differs because the tooling
stack differs.

## Decision flow

Walk these in order.
The first match wins.

| # | Question                                                                              | Pick                                                                  |
| - | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1 | Can the property be asserted with a pure function call and no view?                   | **Unit** — defer to [`tdd`](../../tdd/SKILL.md) (Jest).               |
| 2 | Does the bug live in a single component's render or interaction?                      | **Component** — Jest + React Native Testing Library (RNTL).          |
| 3 | Does the bug live in the seam between two services (API + DB, FE + BFF)?              | **Integration** — Jest with MSW or Supertest, plus a real DB.        |
| 4 | Is the flow browser-only or pure web?                                                 | **Web E2E** — defer to [`e2e-testing`](../../e2e-testing/SKILL.md).  |
| 5 | Does the flow live entirely inside a WebView in a hybrid RN app?                      | **Web E2E** for the WebView; pair with this skill for native chrome. |
| 6 | Does the bug only repro through native navigation, deep links, push, or permissions?  | **Mobile E2E** — this skill (Maestro).                                |
| 7 | Is the flow a critical revenue or auth path on mobile?                                | **Mobile E2E** — this skill, even if 1–3 also catch it.               |

## Why mobile E2E is not the default

Five concrete cost factors:

- A single Maestro run requires a build artefact (`.apk` or `.app`) —
  the EAS build profile is the rate-limit, not the flow runtime.
- Simulator boot times dominate on local iteration.
- The flake budget is finite; spend it on flows that genuinely need it.
- Maestro Cloud minutes are billed per-flow-second.
- Healer cycles read the OS accessibility tree, not just the JS tree —
  pages with deeply nested native lists produce large snapshots.

## Concrete examples

### Use unit (not E2E)

```ts
// Pure logic — no view, no nav, no network.
expect(formatCurrency(1234, 'USD')).toBe('$12.34');
```

### Use component (not E2E)

```tsx
// Single-component render + interaction. No nav, no auth, no API.
import { render, screen, fireEvent } from '@testing-library/react-native';

render(<PasswordInput />);
fireEvent.changeText(screen.getByLabelText('Password'), 'short');
expect(screen.getByText(/at least 8 characters/i)).toBeOnTheScreen();
```

### Use integration (not E2E)

```ts
// Two seams: API handler + real DB.
await request(app).post('/api/orders').send(validOrder).expect(201);
const row = await db.orders.findFirst({ where: { id: ... } });
expect(row.status).toBe('pending');
```

### Use mobile E2E (this skill)

```yaml
# Sign in → land on home → start a workout → background app → resume →
# verify the timer kept counting and the sensor reading is fresh.
appId: com.example.fit
---
- launchApp
- tapOn:
    id: 'sign-in-button'
- runFlow: ../shared/sign-in.yaml
- tapOn:
    id: 'start-workout'
- pressKey: 'Home'
- launchApp:
    clearState: false
- assertVisible:
    id: 'timer'
- assertNotVisible:
    text: 'Stale reading'
```

Why this is mobile-E2E-shaped: native backgrounding, sensor lifecycle,
and timer hydration after process resumption.
None of the lower layers catch all three at once.

### Use web E2E (defer to `e2e-testing`)

A login flow on `app.example.com` that has no native shell.
Use Playwright Test Agents.

### Hybrid app — split the work

A hybrid RN app where the checkout step is rendered inside a WebView
hosting `https://checkout.example.com`:

- Native chrome (open app → tap "Buy" → WebView opens) → Maestro flow.
- Inside the WebView (form fill, 3DS, success page) → Playwright via
  [`e2e-testing`](../../e2e-testing/SKILL.md), attached to the
  Android WebView debug interface or iOS simulator Safari.

The two flows run sequentially, not nested.

## Anti-patterns

- **Writing E2E for form-validation messages.**
  Use a component test with RNTL — same assertion, 50× faster, no flake risk.
- **Writing E2E for pure formatters or selectors.**
  Use a unit test.
- **Skipping unit tests because the E2E exists.**
  Mobile pyramid stays roughly 70/20/10 (unit / component / E2E) for a
  reason — see
  [`references/pyramid-mobile.md`](../references/pyramid-mobile.md).
- **Adding a redundant E2E for a flow already covered.**
  Extend the existing `.maestro/<flow>.yaml` instead.
- **Picking Maestro for a browser-only flow.**
  Defer to [`e2e-testing`](../../e2e-testing/SKILL.md).

## Cross-references

- Unit and component layer ownership: [`tdd`](../../tdd/SKILL.md).
- Web E2E layer ownership: [`e2e-testing`](../../e2e-testing/SKILL.md).
- Pyramid math:
  [`references/pyramid-mobile.md`](../references/pyramid-mobile.md).
- Detox legacy notes:
  [`references/detox-legacy.md`](../references/detox-legacy.md).
