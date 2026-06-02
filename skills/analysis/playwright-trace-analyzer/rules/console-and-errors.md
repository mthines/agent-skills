---
title: Console and Page Errors — Reading the event stream
impact: MEDIUM
tags:
  - console
  - pageerror
  - dialog
  - app-errors
---

# Console and Page Errors

Page-side errors are recorded as `event` lines in `trace.trace`. They
are often the smoking gun the test missed — an app crash that happened
before the assertion timed out.

## Event types to extract

| `class.method`            | Meaning                                          | Action                                                  |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `Page.console`            | `console.{log, info, warn, error, debug}` call    | Filter to `error`/`warning`; quote message verbatim      |
| `Page.pageerror`          | Uncaught exception in page JS                     | Treat as **always interesting** — quote stack trace     |
| `Page.crash`              | Renderer crash                                    | Critical — the whole page died                          |
| `Page.dialog`             | `alert` / `confirm` / `prompt` opened             | If unhandled, blocks every action after                 |
| `Frame.requestfailed`     | A frame-level fetch failed                        | Cross-reference with `trace.network`                    |
| `Page.framedetached`      | A frame went away                                 | Following actions targeting that frame will fail        |

## Extraction (jq)

```bash
# All page errors and warnings
jq -c '
  select(.type=="event" and .class=="Page" and (.method=="pageerror" or .method=="console"))
  | select(.method=="pageerror" or (.params.type=="error" or .params.type=="warning"))
' trace.trace
```

## Correlate error → action

Errors that fire **between** `before.startTime` and `after.endTime` of
the failing action are usually the cause. Use the timestamp on the
event (`event.timestamp` or — when missing — the line ordinal).

When a `pageerror` fires inside a failing action:

1. Quote the full stack trace.
2. Map the top frame to a source file (after sourcemaps if available).
3. Treat the error as the root cause unless evidence contradicts.

## Examples

### Good — finding

> At +5,180ms (during `click('Save')`), `Page.pageerror` fired:
> `TypeError: Cannot read properties of undefined (reading 'id')` at
> `webpack:///./src/forms/SaveForm.tsx:88`. The save handler reads
> `formState.user.id` but `user` is `undefined` until the
> `/api/session` response, which arrived at +5,400ms. Race: the button
> is visible before session loads. Fix: gate the button on
> `formState.user` (`disabled={!user}`) or wait for session in
> `beforeEach`.

### Bad — finding

> The console has errors.

Why bad: no message, no timestamp, no actionable mapping.

## Console noise filter

Some warnings are noise (third-party deprecation, dev-server HMR
chatter). Don't suppress them silently; list them under a "Likely
noise" subheading in the report so the user can confirm.

Heuristics for noise:

- Source URL contains `webpack-dev-server`, `vite/`, `@react-refresh`,
  `@vite/`.
- Message starts with `[HMR]` or `[Vue warn]: <Suspense>` (StrictMode
  double-invoke artefacts).
- React-DevTools install prompts.

Real signals:

- Anything from your app's source path.
- Any `pageerror` (uncaught) — never noise.
- `Failed to fetch` — the request failed before ever leaving the page.

## Common mistakes

- **Reporting count of warnings.** "12 warnings" is not a finding.
  **Fix:** quote the messages and tie the relevant ones to actions.
- **Ignoring `pageerror` because the test "passed".** A pageerror in a
  passing test usually means the assertion happened to be elsewhere
  in the DOM. **Fix:** flag it; tests should fail on uncaught errors.
- **Confusing `console.error` with `pageerror`.** First is a logged
  message; second is an uncaught exception. **Fix:** name them
  correctly.
