---
title: Flake Patterns — A field guide
impact: HIGH
tags:
  - flake
  - patterns
  - races
  - reference
---

# Flake Patterns — A Field Guide

Concrete races seen in production E2E suites. Each entry has: a
**signal** in the trace, the **race**, and a **fix that closes the
race** (not a timeout).

> Use this as a lookup. Do not preload — load when Phase 3 needs a
> pattern.

---

## P1. Premature actionability (animation)

**Signal.** Action call log shows repeated `element is not stable —
waiting`. Action duration ~30s. App has CSS `transition` /
`animation` on the target.

**Race.** Element is visible and enabled, but mid-animation. Auto-wait
loops on `stable` until timeout.

**Fix.**

```ts
// playwright.config.ts — disable animations globally for E2E
use: { reducedMotion: 'reduce' }

// or per test
await page.addInitScript(() => {
  document.documentElement.style.setProperty('--animation-duration', '0ms');
});
```

---

## P2. Stale element (re-render)

**Signal.** Selector resolves at +100ms. Then `Element is not attached
to the DOM` after a re-render. Timeout follows.

**Race.** Component re-mounted between locator resolution and click.

**Fix.** Use `getByRole` / `getByTestId` (auto re-resolves) over CSS
strings; or wait for the upstream state-change event before clicking.

```ts
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
await page.getByRole('button', { name: 'Save' }).click();
```

---

## P3. Click before async validation completes

**Signal.** Click hangs on `not enabled`. App has `disabled={validating}`
on the button.

**Race.** Test types into a form and clicks Save before the validation
promise resolves and re-enables the button.

**Fix.** Wait for the enabled state explicitly:

```ts
await page.getByLabel('Email').fill('foo@bar.com');
await expect(saveBtn).toBeEnabled();
await saveBtn.click();
```

---

## P4. Network race (action fires before request returns)

**Signal.** Action timed out; correlated request still pending at
`after.endTime`. UI is in a loading state.

**Race.** Test depended on a fetch that hadn't resolved.

**Fix.** Wait for the response, not a timeout:

```ts
const respPromise = page.waitForResponse(r => r.url().includes('/api/session'));
await page.goto('/');
await respPromise;
```

---

## P5. Dialog interception

**Signal.** `Page.dialog` event in the trace. Subsequent action times
out (the page is blocked on an unhandled `confirm`).

**Fix.** Register a handler in `beforeEach`:

```ts
page.on('dialog', d => d.accept());
```

---

## P6. SSR hydration race

**Signal.** The first interactive action after `goto` hangs (~30s);
subsequent identical actions are fast.

**Race.** React hydration hasn't completed; event handlers aren't
attached.

**Fix.** Wait for a hydration marker:

```ts
await page.goto('/');
await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
```

If the app has no marker, add one in `_app.tsx` / root layout.

---

## P7. Service worker stale cache

**Signal.** Network requests for known endpoints disappear from the
trace on later runs. UI shows stale data.

**Race.** SW returned a cached response that doesn't reflect a recent
write.

**Fix.** Block service workers in test contexts:

```ts
const context = await browser.newContext({ serviceWorkers: 'block' });
```

---

## P8. Off-screen element

**Signal.** Action loops on `element is not visible` or
`outside of the viewport`.

**Fix.** `scrollIntoViewIfNeeded` first, or use a locator that
auto-scrolls (`click` does, but only if the element is in a
scrollable ancestor).

```ts
await el.scrollIntoViewIfNeeded();
await el.click();
```

---

## P9. Time-based UI (Date.now)

**Signal.** Same test fails at certain wall-clock times (midnight
boundary, daylight savings, weekend cron).

**Fix.** Mock the clock:

```ts
await page.clock.install({ time: new Date('2026-05-08T12:00:00Z') });
// then
await page.clock.runFor(60_000);
```

---

## P10. Test isolation (state leak)

**Signal.** Test passes when run alone; fails when run after sibling
tests. Or first run passes; second fails.

**Race.** Backend / localStorage state from a previous test bled in.

**Fix.** Per-test storage state and seed reset:

```ts
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async () => { await resetSeed(); });
```

---

## P11. Worker-init failure

**Signal.** First `goto` fails with `net::ERR_CONNECTION_REFUSED`.
Later runs in the same suite succeed.

**Race.** `webServer` in `playwright.config.ts` hadn't booted.

**Fix.** Increase `webServer.timeout`; add a health-check probe with
exponential backoff in CI before launching tests.

---

## P12. Strict-mode duplicate matches

**Signal.** `strict mode violation: locator resolved to N elements`.

**Fix.** Disambiguate the locator:

```ts
page.getByRole('button', { name: 'Save' }).first()      // explicit
page.getByRole('button', { name: 'Save', exact: true }) // exact match
page.getByTestId('save-primary')                         // dedicated testid
```

Avoid `nth=0` patterns for new tests — fragile to insertion.

---

## P13. Locale / formatting

**Signal.** `expect(...).toHaveText('1,234')` fails because the runner
locale formats as `1.234`.

**Fix.** Pin locale in context options:

```ts
use: { locale: 'en-US', timezoneId: 'UTC' }
```

---

## P14. Iframe-scoped action

**Signal.** Action targets `page.locator(...)` but element lives in an
iframe. Resolves to nothing.

**Fix.** Use `frameLocator`:

```ts
const frame = page.frameLocator('iframe[name="payment"]');
await frame.getByLabel('Card number').fill('4242...');
```

---

## P15. CI vs. local — viewport / DPI

**Signal.** Test passes locally, fails on CI. DOM snapshot shows a
different layout (mobile vs. desktop columns).

**Fix.** Pin `viewport` and `deviceScaleFactor` in
`playwright.config.ts`.

---

## P16. Authentication race in `beforeEach`

**Signal.** Many failing tests share a `beforeEach` that logs in. The
first action after login hangs.

**Race.** The login redirect hasn't completed before the next action.

**Fix.** Wait for the post-login URL or a stable readiness signal:

```ts
await expect(page).toHaveURL(/\/dashboard/);
```

---

## Anti-patterns to call out in reports

- `await page.waitForTimeout(N)` — placeholder; surface every
  occurrence in the report.
- `test.retry(N)` — hides flakes; do not propose as a fix.
- `try { ... } catch { ... }` around an action — swallows errors.
- `expect.poll(() => ..., { timeout: 30_000 })` for things Playwright
  could auto-wait on natively.
