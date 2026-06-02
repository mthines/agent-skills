---
title: Action Timing — Reading the trace.trace action stream
impact: HIGH
tags:
  - actions
  - locators
  - auto-wait
  - timing
---

# Action Timing

Extract per-action durations, identify the slow ones, and map each to a
test source location.

## Anatomy of an action

```
{"type":"before","callId":"page@7","startTime":1714000005120,"class":"Frame","method":"click","params":{"selector":"text=Save","strict":true},"location":{"file":"tests/save.spec.ts","line":42,"column":18},"stack":[...]}
{"type":"after","callId":"page@7","endTime":1714000010140,"error":{"name":"TimeoutError","message":"locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator(\"text=Save\")\n  - locator resolved to <button>Save</button>\n  - attempting click action\n  - waiting for element to be visible, enabled and stable\n  - element is not stable - waiting"}}
```

- **Duration:** `after.endTime - before.startTime` (ms).
- **Source location:** `before.location.{file, line}`.
- **Selector:** `before.params.selector`.
- **Failure narrative:** `after.error.message` includes Playwright's
  `Call log` with each auto-wait condition. **Read it.**

## Extraction (jq + node)

For small traces (< 50 MB), jq works:

```bash
# Top 10 slowest actions
jq -s '
  group_by(.callId)
  | map(select(length == 2 and (.[0].type=="before") and (.[1].type=="after")))
  | map({
      callId: .[0].callId,
      method: (.[0].class + "." + .[0].method),
      selector: (.[0].params.selector // null),
      url: (.[0].params.url // null),
      file: (.[0].location.file // null),
      line: (.[0].location.line // null),
      dur_ms: (.[1].endTime - .[0].startTime),
      error: (.[1].error // null)
    })
  | sort_by(-.dur_ms)
  | .[:10]
' trace.trace
```

For larger traces, prefer
[`scripts/trace-summary.mjs`](../scripts/trace-summary.mjs) which streams
the file and emits a structured summary in one pass.

## What to look for, in order

| # | Signal                                                            | Meaning                                                       | Common cause                                              |
| - | ----------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 1 | One action ≥ 29,000ms with `TimeoutError`                          | Ran to default timeout                                        | Element never became actionable; selector ambiguous; navigation pending |
| 2 | Action ≥ 5,000ms that succeeded                                    | Slow but passing — flakes if CI gets slower                   | Auto-wait loop; animation; network race                    |
| 3 | Many actions ≥ 1,000ms in `beforeEach` / `beforeAll`               | Setup time dominates the run                                  | Login flow; seed-data API calls; warm-up renders           |
| 4 | A `click` followed by repeated `event` retries with `selector`     | Element resolved but not actionable                           | Animation / `pointer-events: none` / overlapping element   |
| 5 | `goto` ≥ 5,000ms without timeout                                   | Slow page load                                                | Heavy bundle; blocking script; slow API on the critical path |
| 6 | `waitForResponse` / `waitForRequest` ≥ 10,000ms                    | Test is racing against an event that didn't fire              | Wrong URL pattern; request collapsed by SW; condition typo |
| 7 | Repeated identical `fill` / `press` actions on the same selector   | Retried by the test or auto-wait re-resolved each time        | Re-rendered input loses focus; controlled-component races  |
| 8 | First `click` after `goto` significantly slower than later clicks  | Page still hydrating                                          | Missing `waitForLoadState('networkidle')` or readiness gate |

## Selector-strategy diagnosis

Read `before.params.selector` against the failure narrative:

| Selector style             | Failure note in `error.message`                          | Likely cause                                            |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `text=Foo`                 | `strict mode violation: locator resolved to N elements`  | Multiple matches; needs `getByRole` or `nth=0`          |
| `text=Foo`                 | `element is not stable`                                  | Animation; needs `toBeStable` or animation disable      |
| `getByRole('button', ...)` | `element is not visible`                                 | Element rendered but `display: none` / off-screen       |
| `css=.btn`                 | `element is not enabled`                                 | Disabled until form valid; needs precondition assertion |
| XPath                      | Slow resolution + `did not match`                        | Brittle; rewrite as role/test-id locator                |
| `data-testid=foo`          | `did not match`                                          | Component renamed; testid removed; gated by feature flag |

## Map action → source

`before.location` is the test file location of the API call. Always
quote `file:line` in the report. If `location` is missing (older
Playwright or programmatically constructed locators), fall back to
`stack[0]` and the test name from the surrounding `before` of the
`Test.run` action.

## Examples

### Good — finding

> `Frame.click({ selector: "text=Save" })` at `tests/save.spec.ts:42`
> ran for **30,007ms** before timing out. The auto-wait log shows the
> element resolved at +120ms, became visible at +180ms, but never
> reached "stable" — five `not stable - waiting` retries. The container
> has a `transform: translateY` animation in `src/ui/Toast.tsx:30`. Fix:
> wait for animation completion or disable animations in test
> (`page.addInitScript`). Estimated saving: 30s on every run, regardless
> of CI speed.

### Bad — finding

> The click is slow. Add `waitForTimeout(1000)`.

Why bad: no measurement, masks the race, will still flake when the
animation runs longer.

## Common mistakes

- **Treating action duration as the "time the user waited".** Auto-wait
  polls; the action only "blocks" once the element is actionable.
  **Fix:** read the call-log narrative.
- **Reporting `endTime` as the timestamp.** `endTime` is when the
  action returned; use `(startTime, endTime)` together.
- **Ignoring `event` lines between `before` and `after`.** They show
  the auto-wait retry path. **Fix:** include them when the action took
  > 1,000ms.
- **Conflating `Page.click` with `Frame.click`.** Different scopes —
  `Frame.click` includes iframe routing time. **Fix:** preserve the
  class name when reporting.
