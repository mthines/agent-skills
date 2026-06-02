---
title: Flake Diagnosis — From symptom to race condition
impact: HIGH
tags:
  - flake
  - race-condition
  - root-cause
  - diff
---

# Flake Diagnosis

A "flaky" test is a test with a race. The trace records both sides of
the race — read it. If you cannot name the race, the diagnosis is not
done.

## The diagnosis loop

For each failing action / assertion:

1. **Identify the wait.** What was the test polling on? (Element
   visible, text equal, response received, URL matching, network idle.)
2. **Identify the producer.** What in the app makes the wait condition
   true? (A reducer, a fetch resolver, a router push, an animation
   end.)
3. **Identify the race.** What other event could fire before / after
   that breaks the producer? (A re-render, a navigation, a re-fetch, a
   timeout, a redirect.)
4. **Confirm with evidence.** Find the timestamp where the race
   manifests in the trace.
5. **Propose a fix that closes the race**, not one that hides it.

If at any step you cannot find the evidence, drop to the confidence
loop ([`confidence-loop.md`](./confidence-loop.md)).

## Common race shapes

See [`references/flake-patterns.md`](../references/flake-patterns.md)
for the full catalogue. The most common in practice:

| Pattern                        | Symptom in trace                                                      | Fix                                                     |
| ------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Premature actionability         | Click action loops on `not stable`                                    | Gate on the readiness signal, not just visibility       |
| Stale element / re-render       | Selector resolves, then `Element is not attached`                     | Re-resolve inside the action; use `getByRole` over CSS  |
| Network race                    | Action fires before request returns; UI in loading state              | `await page.waitForResponse` before action               |
| Dialog interception             | `Page.dialog` fires; subsequent action times out                      | `page.on('dialog', d => d.accept())` in `beforeEach`    |
| Hydration race (SSR)            | First click after `goto` hangs; later clicks are fast                  | Wait for a hydration marker (`data-hydrated`)           |
| Animation                       | Action loops on `not stable`; CSS `transition` in app                  | Disable animations in test (`addInitScript`)            |
| Service-worker cache            | Network requests vanish from later runs; UI shows stale data           | Bypass SW in test (`browser.newContext({serviceWorkers: 'block'})`) |
| Off-screen element              | Action loops on `not visible`                                          | `scrollIntoViewIfNeeded` first                          |
| Time-based UI                   | Same test fails at certain wall-clock times                            | Mock `Date.now`; use `page.clock`                       |
| Test isolation                  | First run passes; second fails (state leaked)                          | Per-test storage; reset DB/seed between tests           |
| Worker initialization           | `goto` hits `ERR_CONNECTION_REFUSED`                                   | Increase `webServer.timeout`; add health-check          |

## Diff-driven diagnosis (when given two traces)

If the user provided one passing and one failing trace:

1. Run [`scripts/trace-diff.mjs <pass> <fail>`](../scripts/trace-diff.mjs).
2. The first action where the action sequence diverges is the **fork
   point** — the race happens around it.
3. Compare network timing for the request closest to the fork point.
   In the passing run, the request finished before the action; in the
   failing run, it didn't (or the inverse).
4. The difference in timing **is** the race — name it explicitly:
   "request X completed in 80ms in pass / 4,200ms in fail; the click
   races against it; if X > 200ms the click hits an unmounted button."

## Map cause → file

Once you know the race, find the producer in app code:

1. Take the responsible URL / selector / event.
2. Grep the app for it (`getByRole('button', { name: 'Save' })` →
   grep for the button's text or aria-label).
3. Look for the readiness signal — a state setter, a fetch resolver,
   a router transition.
4. Quote `app-file:line` in the report.

If the responsible code is not in the test repo (e.g. a vendored
library), surface that and propose a **test-side workaround** instead.

## Examples

### Good — diagnosis

> **Race:** click on `getByRole('button', { name: 'Save' })` at
> `tests/save.spec.ts:42` happens before the form's `validate()` async
> resolves.
>
> **Evidence:** the button has `disabled={validating}` in
> `src/forms/SaveForm.tsx:60`; `validating` is set true on each
> keystroke and false on `validate()` resolution. The trace shows the
> last `fill()` at +4,800ms; `validate()` request fires at +4,820ms
> and returns at +5,160ms. The `click()` at +5,000ms hits the still-
> disabled button. Auto-wait then loops on "not enabled" until
> timeout.
>
> **Fix:** wait for a stable validation state — `await
> expect(saveBtn).toBeEnabled()` before `click`. Estimated saving:
> 30s on each timeout, plus eliminates the flake entirely.

### Bad — diagnosis

> The button is sometimes disabled. Add `waitForTimeout(2000)`.

Why bad: timeout-based waits are a non-fix that papers over the race
and reintroduces it the moment validation gets slower.

## Common mistakes

- **Calling it "non-deterministic" and stopping.** Every flake has a
  race; if you don't see it, you haven't read enough of the trace.
- **Recommending `waitForTimeout`.** It's a placeholder, not a fix.
  Always replace it with a condition-based wait.
- **Adding `test.retry` as the diagnosis.** Retries hide flakes; they
  do not fix them.
- **Stopping at the first plausible cause.** Confirm with a second
  signal (network, console, DOM snapshot) before finalising the
  diagnosis.
