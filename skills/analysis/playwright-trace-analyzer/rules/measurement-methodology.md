---
title: Measurement Methodology — Pick a Failure Mode and a Metric
impact: HIGH
tags:
  - measurement
  - failure-mode
  - metric-selection
  - baseline
---

# Measurement Methodology

Before extracting hotspots, name the failure mode and pick the metric
that matters. The same trace can be analysed many ways; the wrong frame
produces the wrong fix.

## Step 1 — Name the failure mode

Read the failing-action `after` event's `error` field. Match it to one
of these modes:

| Failure mode                  | Signal                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Action timeout**            | `error.name == "TimeoutError"` AND the action is `click` / `fill` / `waitFor*`               |
| **Assertion timeout**         | `error.name == "TimeoutError"` AND the action is `expect.toHaveText` / `toBeVisible` / etc. |
| **Navigation timeout**        | `error.name == "TimeoutError"` AND the action is `goto` / `waitForURL` / `waitForLoadState` |
| **Selector resolution fail**  | `error.message` contains `did not match` / `strict mode violation`                            |
| **App error (uncaught)**      | A `pageerror` event; or `error.message` contains `page crashed`                              |
| **Network failure**           | A `requestFailedEvent` correlated with the action; status `0` / `net::ERR_*`                  |
| **Slow-but-passing**          | No `error`; total duration above the user-stated budget                                       |
| **Worker-init failure**       | First `goto` fails with `ERR_CONNECTION_REFUSED` — dev server didn't boot                     |

If the failure mode does not match cleanly, ask the user. Do not invent
a category.

## Step 2 — Pick the primary metric

| Failure mode             | Primary metric                                          | Source                                       |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------- |
| Action timeout           | Action duration (ms) and poll-attempt count             | `after.endTime - before.startTime`           |
| Assertion timeout        | Time to first matching value vs. timeout                | Repeated `expect` checks in the trace        |
| Navigation timeout       | `responseEnd - requestStart` for the navigation request | `trace.network`                              |
| Selector resolution fail | Element-resolution attempts                             | `before.params.selector` + `event` retries   |
| App error                | Time-to-error from page load                             | `pageerror` event timestamp                  |
| Network failure          | Request count, response status, total transfer size     | `trace.network`                              |
| Slow-but-passing         | Total wall-clock and per-action ms                      | `last_after.endTime - first_before.startTime`|
| Worker-init failure      | Time to first failed request                            | `trace.network`                              |

State the metric explicitly in the report: "Primary metric: action
duration for `click('text=Save')` — measured 30,007ms (timeout)."

## Step 3 — Establish the budget

A finding without a budget is just narration. Pick one:

- **Default action timeout:** Playwright's default is 30s. Anything ≥
  29s is "ran to timeout" — call it out.
- **Default assertion timeout:** 5s.
- **CI wall-clock budget:** ask the user, or read from `playwright.config.ts`
  (`timeout`, `expect.timeout`, `globalTimeout`).
- **Per-step budget when "slow-but-passing":** rule of thumb — any
  single action > 1,000ms is worth investigating; > 5,000ms is an
  outlier even on slow CI.

## Step 4 — Pick a baseline

If the user provided two traces (one passing, one failing), the passing
trace **is** the baseline — diff it.

If only one trace is available:

- For a timeout: baseline is the configured timeout; target is the
  median action duration in the trace.
- For slow-but-passing: baseline is the median per-action duration;
  target is the user-stated budget or 1,000ms.
- For a flake suspected from a single failure: refuse to give a
  one-shot diagnosis — say so and request more runs (5–10 to compute a
  flake rate).

## Common mistakes

- **Reporting a "fix" without a metric.** "This will be faster" is not
  a measurement. **Fix:** every fix in the report carries an estimated
  ms saving derived from the trace.
- **Using p99 from a single run.** A single trace has no distribution.
  **Fix:** treat the single observation as a point estimate; never
  call it p50/p95/p99.
- **Confusing "timeout fired" with "the action took 30s".** The action
  did not "take" 30s — it polled for 30s. **Fix:** describe the wait
  as "polled for 30s without resolving", and look at *what* it was
  polling on.
- **Ignoring the assertion timeout when the test failed on `expect()`.**
  The 5s assertion timeout is its own budget. **Fix:** measure
  separately for action vs. assertion timeouts.
