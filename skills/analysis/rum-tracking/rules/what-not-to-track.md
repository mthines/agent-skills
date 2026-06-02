---
title: What NOT to Track — Noise, Cost, and Cardinality Anti-Patterns
impact: HIGH
tags:
  - noise
  - cardinality
  - sampling
  - cost
  - anti-patterns
---

# What NOT to Track

Every event you track costs ingest, storage, and analyst attention.
A noisy stream hides real signal.
Reject events that fit the patterns below — or aggregate them, sample
them, or move the data into properties on an event you already have.

## The reject list

Refuse outright unless there is a specific dashboard or alert that needs
the data **today**.

| Pattern                                              | Why it's wrong                                                                                                                                    | Better option                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `button_clicked` on every button                     | Hundreds of distinct buttons collapse into one event; `button_name` becomes a high-cardinality property that no dashboard can chart usefully.     | Track ~10 named events for the buttons that matter.                        |
| `mouse_moved`, `cursor_position`, `pointer_*`        | Multi-MB per session. No production analysis uses this.                                                                                            | Session replay (sampled) if you need it.                                   |
| Per-keystroke / `key_pressed`                        | Massive volume; leaks PII the moment a user types in a form.                                                                                       | Track `form_submitted` only.                                              |
| Hover events                                         | Unreliable on mobile; rarely actionable on web.                                                                                                    | If you must, sample at 1 %.                                                |
| Scroll-position-per-pixel                            | High volume; rarely actionable.                                                                                                                    | `read_75_percent` once per article if reading depth matters.              |
| Every component render                               | Re-renders are a code concern, not a product concern.                                                                                              | Profile in React DevTools / profiler skill instead.                       |
| `feature_seen` on render                             | Fires once per mount, ~50 times per session, signal undefined.                                                                                     | Fire once per session, gated by `useEffect` + `sessionStorage`.            |
| API endpoint hits (`api_users_get`)                  | Implementation detail; the front-end already tracked the user action.                                                                              | Server-side trace in OTel for the backend; not a product event.            |
| `page_loaded` per route                              | The SDK fires `$pageview` automatically.                                                                                                            | Use the SDK's built-in pageview.                                          |
| Internal admin / staff actions on the same stream    | Distorts every cohort.                                                                                                                              | Either don't track or fire to a separate `internal-tools` project.        |
| Synthetic / load-test traffic                        | Same distortion problem.                                                                                                                            | Block by user-agent / IP allowlist before SDK init.                       |
| Click coordinates as event properties                | Unbounded values, no analysis path.                                                                                                                  | Drop; session replay covers this if needed.                              |

## High-cardinality property values

A property value that can take more than a few thousand distinct values
will break aggregations in most platforms and inflates storage for all
of them.

| Avoid in event properties                                | Why                                                              | Fix                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| Free-text user input (search query, feedback text)       | Unbounded; PII risk.                                              | Hash, bucket, or drop. Track `search_submitted` with `query_length` and `result_count` instead. |
| Full URL with query string                               | Tokens, session IDs, reset codes leak in.                         | Use route template (`/users/:id`) — strip `?token=…`.              |
| Raw IP address                                            | Cardinality + PII.                                                | Coarsen to /24 (IPv4) or /48 (IPv6); prefer dropping at the edge.   |
| Stack traces verbatim                                    | Often contain user input.                                          | Send `error.type` + sanitized message; full stack in a separate, scrubbed error stream. |
| Timestamps as properties                                  | Every value unique → cardinality explosion in metrics.            | The event already has a timestamp at the SDK level.                |
| Auto-incrementing IDs (`order_id`, `message_id`)         | Unbounded → safe on spans/events; **never on metrics**.            | OK as event properties for joins; never as metric labels.          |

For platform-specific cardinality limits, see
[`tracking-plan.md`](./tracking-plan.md) and the
[GA4 cardinality limits](https://support.google.com/analytics/answer/12226705).

## When to sample instead of drop

Some events are valuable in aggregate but ruinous if every single one
is stored.

| Event                                | Sampling policy                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Session replay                       | 5–10 % of sessions in production; 100 % of sessions that produce an error (tail-based).                  |
| Web Vitals on infinite-scroll views  | Send each vital once per page, not once per scroll.                                                      |
| Internal request traces              | Sample in the Collector, not in the SDK. See `otel-instrumentation` skill — keep SDK at `AlwaysOn`.       |
| High-frequency user interactions     | Aggregate to a counter (`scroll_depth: 75`) and emit once per session.                                   |

**Never sample**: signups, payments, subscription changes, refunds,
errors with severity ≥ error, identify calls.
Sampling these directly costs revenue insight.

## The "just in case" anti-pattern

> "Let's track it now, we might want it later."

This is the single biggest source of tracking-plan rot.

| Symptom                                                          | Fix                                                                                                       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Event has no consumer (dashboard, funnel, cohort, alert).        | Do not add it. Add when the consumer is built.                                                            |
| Event was added "for a future migration."                        | Remove. Add when the migration starts.                                                                    |
| Property was added "because the data was there."                 | Remove. The minimum schema is cheaper than enriching later.                                               |
| Catch-all `event_metadata: {...}` blob property.                 | Decompose into named properties or drop — blobs defeat analytics tooling.                                  |

If you cannot name the dashboard or funnel that consumes the event
within 30 seconds, do not add it.

## Examples

### Bad — one event, infinite cardinality

```ts
track('button_clicked', { label: button.innerText });
// button_clicked dominates every chart, label has 500+ values
```

### Good — ~10 named events

```ts
track('checkout_started', { cart_value_cents: 4990, currency: 'USD' });
track('plan_upgrade_requested', { from_plan: 'free', to_plan: 'pro' });
```

### Bad — full URL leaks query tokens

```ts
track('$pageview', { url: window.location.href });
// url = "/reset?token=eyJhbGc…&email=alice@example.com"
```

### Good — route template, no query

```ts
track('$pageview', { route: '/reset' });
```

### Bad — per-render event

```tsx
useEffect(() => {
  track('billing_page_viewed', { plan: user.plan });
}); // runs every render
```

### Good — once per session

```tsx
useEffect(() => {
  if (sessionStorage.getItem('billing_page_seen')) return;
  sessionStorage.setItem('billing_page_seen', '1');
  track('billing_page_viewed', { plan: user.plan });
}, []);
```

## References

- [ClickHouse — High cardinality is slow](https://clickhouse.com/resources/engineering/high-cardinality-slow-observability-challenge)
- [GA4 — Event cardinality limits](https://support.google.com/analytics/answer/12226705)
- [Segment — Data quality](https://segment.com/docs/protocols/tracking-plan/best-practices/)
- See [`pii-and-compliance.md`](./pii-and-compliance.md) for the PII reject list.
- See [`otel-conventions.md`](./otel-conventions.md) for cardinality rules on OTel signals.
