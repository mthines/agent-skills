---
title: Expectations — the brief's telemetry criteria and the signals the diff adds
impact: HIGH
tags:
  - telemetry-verify
  - expectations
  - provenance
---

# Expectations

Two sources, judged together.

## 1. The brief's `telemetry:` acceptance criteria

Read the Acceptance Criteria in `--brief`; a telemetry criterion is an `AC-<n>` line whose text starts with `telemetry:` after the ID.

```markdown
- [ ] AC-3 telemetry: submitting checkout creates one `checkout.submit` span with `order.id`, parented by the `POST /api/checkout` server span; a declined card sets its status to ERROR
```

### Behavioral, never by-construction

A criterion must be checkable only by observing a run.
Ask: could reading the source alone satisfy it?
Yes → refuse it: report `AC-<n> refused — by-construction; use <kind>` and leave it out of the verdict.

| Allowed kind | Example |
| --- | --- |
| Count | one `payment.charge` span per checkout, not one per line item |
| Parent and child | `checkout.submit` is a child of the `POST /api/checkout` server span |
| Duration | the `GET /api/views` server span stays under 300 ms |
| Error path | a declined card sets the span status to ERROR and logs one ERROR record |
| Fan-out | one inbound request makes at most 2 outbound calls |
| Attribute values | `order.id` is present and its values stay bounded |
| Ordering | `cache.lookup` ends before `db.query` starts |
| Web to backend link | the Save click's fetch carries the trace of `PUT /api/views` |

```text
✗ Wrong — "a span named checkout.submit exists"            (true the moment it is typed)
✓ Right — "one checkout.submit span per submit, child of POST /api/checkout, with order.id"
```

## 2. Signals the diff adds

Grep the added lines of `git diff <base>...HEAD`:

| Pattern | Signal |
| --- | --- |
| `startSpan(`, `startActiveSpan(`, `tracer.start`, `span.setAttribute(` | span name and its attributes |
| `logger.`, `log.`, `console.error(` with a literal message | log record |
| `meter.create`, `createCounter(`, `createHistogram(` | metric |
| `sendEvent(`, plus each `telemetry.yml` → `web.event_patterns` regex (capture 1) | custom web event |

For each name the window could have exercised: present with the attributes the code sets → confirmed; absent, or present without them → `missing-signal`.
A name the diff only removes or renames is not expected.
A signal the backend cannot see is `not-checkable (<backend>)`, never confirmed.
A new error path that sets no span status and writes no log is `missing-signal`: a failure must be visible.
