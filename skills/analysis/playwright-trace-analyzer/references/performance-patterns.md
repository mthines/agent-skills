---
title: Performance Patterns — E2E suite slowness
impact: MEDIUM
tags:
  - performance
  - e2e
  - suite-time
  - patterns
---

# Performance Patterns — E2E Suite Slowness

When the failure mode is "slow but passing" — long suite wall-clock,
not a single timeout — these are the levers ranked by typical impact.

## L1. Reuse storage state instead of UI login

**Symptom.** Every test runs login through the UI in `beforeEach`
(~2–4s × N tests).

**Fix.** Run login once in `globalSetup`, save to a `storageState.json`,
and load in subsequent tests:

```ts
// globalSetup.ts
const ctx = await browser.newContext();
await ctx.request.post('/api/login', { data: { ... } });
await ctx.storageState({ path: 'storageState.json' });

// playwright.config.ts
use: { storageState: 'storageState.json' }
```

**Typical saving.** 2–4s × N tests.

## L2. Seed via API, not UI

**Symptom.** Tests create their fixtures by clicking through forms.

**Fix.** Use `page.request` (or `request` fixture) to POST seed data
directly. Reserve UI traversal for the assertion target.

**Typical saving.** 5–20s per test.

## L3. Replace `networkidle` waits

**Symptom.** Many `await page.waitForLoadState('networkidle')` calls
each adding 500ms+.

**Fix.** Wait for a specific signal — a request, a heading, a
testid-marked container. `networkidle` is conservative and overpays.

**Typical saving.** 200–800ms per call.

## L4. Parallelism via `fullyParallel`

**Symptom.** Tests are serial within a file.

**Fix.** `fullyParallel: true` in config; mark non-isolatable tests
with `test.describe.serial(...)` only where strictly needed.

**Typical saving.** Up to a per-file factor of N (workers).

## L5. Trim the trace footprint

**Symptom.** Default `trace: 'on'` adds 30%+ overhead per test.

**Fix.** Use `trace: 'on-first-retry'` (default since 1.30) so traces
only record on retry.

**Typical saving.** 30%+ off green-path runs.

## L6. Cap per-test duration with `test.slow`

**Symptom.** A few tests blow the global budget.

**Fix.** Mark them `test.slow()` so they get 3× the timeout, and
isolate them in their own shard. Don't increase the global timeout
for everyone.

## L7. Disable images / fonts in tests that don't assert on them

**Symptom.** A page loads 4MB of media before each test.

**Fix.**

```ts
await page.route('**/*.{png,jpg,jpeg,webp,woff2}', r => r.abort());
```

Use sparingly — visible regression tests need the assets.

## L8. Skip animations and transitions

**Symptom.** Many actions wait the full animation duration.

**Fix.**

```ts
use: { reducedMotion: 'reduce' }
```

Plus a global `* { animation: none !important; transition: none !important; }`
stylesheet injected via `addInitScript`.

## L9. Shard CI runs

**Symptom.** Single-runner total time dominates CI feedback.

**Fix.** GitHub Actions matrix with `--shard=$i/$N`; merge reports.

## L10. Cache `node_modules` and Playwright browsers

**Symptom.** CI spends 60s+ on `npx playwright install`.

**Fix.** Cache `~/.cache/ms-playwright` keyed on the Playwright
version in `package.json`.

## Anti-patterns

- **Blanket `expect.toHaveScreenshot` everywhere.** Each call rewinds
  + paints + diffs. Use only for visual regression suites.
- **Global `setTimeout` in app code "to make tests easier"**. Inverts
  the relationship — fix the test instead.
- **Running prod build in CI just for E2E.** Use the dev server with
  fast HMR off; only run prod build for the visual regression suite.
