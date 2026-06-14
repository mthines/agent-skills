---
title: Playwright Detector
stack: playwright
tags:
  - playwright
  - e2e
  - browser
---

# Playwright Detector

Bootstrap template for projects using Playwright Test (`@playwright/test`).

## Detection signals

- `playwright.config.ts` or `playwright.config.js` in the project root
- `"@playwright/test"` in `package.json` devDependencies

## Surface starter template

```yaml
---
project-key: <normalised-git-remote-key>
stack: playwright
detect-command: pnpm exec playwright test
single-test-command: pnpm exec playwright test "{file}" --grep "{name}"
failure-parser: '^\s+\d+\)\s+\[.+?\]\s+›\s+(.+?)\s+›\s+(.+?)\s*$'
# group 1 = describe block / file context, group 2 = test name
cache-bust-flag:
---
# Notes
# For headed mode during diagnosis: add --headed
# For a specific browser: add --project=chromium (or firefox, webkit)
# For Nx monorepos: pnpm exec nx run <project>:e2e
# Playwright caches nothing by default; cache-bust-flag is not needed.
```

## Failure output format

```
  1) [chromium] › auth.spec.ts › Login › "redirects to dashboard after login"

    Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Sign in' }) resolved to 2 elements
    ...

  2) [chromium] › auth.spec.ts › Login › "shows error on bad credentials"
```

Parser captures the file context and test name from the `›`-delimited line.

Full failure header: `\d+\)\s+\[.+?\]\s+›\s+(.+\.spec\.[jt]s)\s+›`

## Single-test re-run

```bash
pnpm exec playwright test auth.spec.ts --grep "redirects to dashboard after login"
```

For trace-enabled debugging:
```bash
pnpm exec playwright test auth.spec.ts --grep "redirects to dashboard after login" --trace=on
```

## Common failure families

- **Locator drift** — element selector changed (`getByRole`, `getByText`, `getByLabel`).
  Check the locator against the current DOM — never derive from a screenshot.
- **Navigation timing** — page navigation completes after the assertion.
  Use `await page.waitForURL(...)` or `await expect(page).toHaveURL(...)`.
- **Parallel test interference** — shared state (DB, auth session) contaminated by a parallel worker.
  Use isolated test fixtures per worker.
- **Base URL mismatch** — `baseURL` in the config points at a server that isn't running.
  Confirm the dev server is started before the test run.
- **CI environment diff** — a resource (font, image, iframe) loads differently in CI.
  Use `--update-snapshots` only after reviewing the diff.

## Playwright-specific notes

Playwright E2E tests are inherently integration-heavy.
Before classifying a failure as `test-bug`, confirm the app is actually running
and producing the expected DOM structure.
Use `playwright show-trace trace.zip` to inspect the full interaction timeline.
