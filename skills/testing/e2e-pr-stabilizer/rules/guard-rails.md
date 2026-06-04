---
title: Guard rails — never weaken the suite
impact: HIGH
tags:
  - guard-rails
  - anti-patterns
  - test-integrity
---

# Guard rails — never weaken the suite

The stabilizer makes the suite **stronger**, not quieter.
Every entry below is a hard refusal: the skill never emits these edits and never silently lets them slip through.

## Forbidden edits

| Forbidden | Why | What to do instead |
|-----------|-----|--------------------|
| `test.skip(...)` | Hides a real failure from CI. | Diagnose the failing assertion; apply a fix-pattern from [`root-cause-and-fix.md`](./root-cause-and-fix.md). |
| `test.fixme(...)` | Disables the test indefinitely. | Surface as a `recommendation-only` entry in the report if the test is provably broken but app code is at fault. Never apply autonomously. |
| `test.only(...)` | Silently disables every other test. | Remove on sight. |
| `expect(...).toBeTruthy()` swap for a weaker matcher | Reduces assertion strength. | Keep the original assertion; fix the cause. |
| `page.waitForTimeout(N)` | Masks a race instead of resolving it. | Use `expect(locator).toBeVisible()` or `page.waitForResponse(...)`. |
| `page.waitForLoadState('networkidle')` | Brittle on apps with long-poll or streaming endpoints. The `playwright-test-healer` agent forbids it explicitly. | Wait for the specific resource the action depends on. |
| `{ force: true }` on `.click()` / `.fill()` | Bypasses Playwright's actionability checks. | Remove `force` and let auto-wait do its job. |
| `continue-on-error: true` in the workflow | Lets a red job report green. | Fix the underlying cause. |
| `--no-verify` on `git commit` | Skips pre-commit hooks (lint, format, type check). | Run the hooks; fix what they catch. |
| Removed `expect(...)` lines | Deletes the contract under test. | Keep the assertion; fix the cause. |
| Lower `timeout` on a passing assertion | Hides a slowdown rather than measuring it. | Leave default timeouts unless a span shows the median is healthy at a tighter bound. |
| Increased `retries` in `playwright.config.ts` | Trades flake visibility for green dashboards. | Reduce flakes by fixing them, not by retrying harder. |

## Forbidden meta-actions

- Pushing a fix **before** the local 3-consecutive-pass gate in Phase 6 has cleared (or before the 10-attempt budget marks the test `requires-human-judgment`).
- Pushing more than once per skill invocation — Phase 7 is a single push, single watch, single verdict event.
- Pushing a fix **without** re-pulling telemetry post-CI-run for the comparison against baseline.
- Closing the loop based on a single passing local run — three consecutive passes is the gate, not one.
- Closing the loop based on a single passing CI run when the baseline showed a < 100 % failure rate (a flake can pass once by chance).
- Committing a fix whose new locator(s) the static + live selector-existence checks could not find — see [`fix-validation.md`](./fix-validation.md).
- Re-drafting a fix after a selector-existence refusal without re-entering Phase 4 — repeated drafts without a new diagnosis just hallucinate different selectors.
- Editing product code (`src/`, `components/`, `apps/`) when the trace evidence points there — that becomes a recommendation, never an autonomous change.
- Running parallel iterations — local Phase 6 runs are sequential per test; Phase 7 is a single push and watch.

## Allowed edits with conditions

These are not forbidden, but require explicit evidence in the dossier:

| Edit | Required evidence |
|------|-------------------|
| Increase `timeout` on a specific `expect(locator).toBeVisible({ timeout: ... })` | A span showing median p95 wait time in healthy runs exceeds the default. Include the measured value in the commit message. |
| Add a `test.beforeEach` cleanup | A dossier marked `P4 — Stateful test contamination` with trace evidence that the failing action operates on pre-existing state. |
| Replace a `text=` locator with `getByRole(...)` | A trace showing the `text=` resolution itself failed (not the actionability afterwards). |
| Mock a flaky upstream API in `tests/e2e/src/lib/*` | A span showing > 5% failure rate on the dependency call across the last 7 days, **and** confirmation that the API is owned by another team. |

## Detection checklist

Before every commit, run this grep against the staged diff:

```bash
git diff --cached --unified=0 -- 'tests/e2e/**' '**/*.spec.ts' \
  | grep -nE '\.skip\(|\.fixme\(|\.only\(|waitForTimeout|networkidle|force:\s*true|continue-on-error|--no-verify'
```

A non-empty match aborts the commit.
Print the offending lines and re-enter Phase 5 — the fix needs a different pattern.

## Why these rules exist

E2E suites lose value silently.
Each weakened assertion looks innocuous on its own, but compounds into a suite that "passes" on broken software.
The stabilizer's job is to be *evidence-honest*: if the suite cannot tell pass from fail without a sleep, the fix is to make the suite better, never quieter.
