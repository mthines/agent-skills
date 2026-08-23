# Backend / API Instrumentation

Applies to any `api` or `worker` classification from
[`scope-detection.md`](./scope-detection.md). This is the built-in fallback —
prefer delegating to the dedicated skills when installed:

```
Skill("otel-instrumentation")        # authoritative span/metric authoring
Skill("otel-semantic-conventions")   # attribute naming lookup
```

(Both live in the [dash0 agent-skills repo](https://github.com/dash0hq/agent-skills),
not this one. Skip silently and use the checklist below when absent.)

## What a new or changed operation needs

For every new or materially changed endpoint, RPC method, queue handler, or
job entry point:

| Signal        | Minimum bar                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| **Trace span** | One span per operation, named per OTel semantic conventions for the protocol (e.g. HTTP: `{method} {route}`, not the raw path with unresolved params). Attributes: `http.request.method`, `http.route`, `http.response.status_code` (HTTP); `messaging.system`, `messaging.destination.name` (queues); `rpc.system`, `rpc.method` (RPC). Never invent a custom attribute name that duplicates a registry one. |
| **Span status** | `Ok` on success; `Error` with `span.recordException` (or the language equivalent) on any unhandled failure, set at the point the failure is known — not re-derived later from a log line. |
| **RED metric** | If the operation is on a request/response hot path: a request counter, an error counter (or an `error` boolean/status-code label on the request counter), and a duration histogram. Reuse an existing RED metric for the service if one already covers this route pattern — do not create a near-duplicate. |
| **Structured log** | At the point of failure, one log line with severity `error` (or `warn` for a recoverable/degraded case) carrying enough context to triage without reproducing: the operation name, a correlation id (trace id, request id), and the specific failure reason — not just "request failed." |

## Anti-patterns specific to backend instrumentation

- Wrapping a handler in a span but never setting `Error` status on failure —
  the trace looks healthy while the operation is failing.
- A duration histogram with unbounded label cardinality (e.g. a label with
  the raw user id or full URL) — this breaks the metric backend, not just
  the query.
- Logging the exception message but not attaching the trace id — makes the
  log un-correlatable to the span that produced it.
- Adding a metric that duplicates an existing RED series under a different
  name because the existing one wasn't discovered first.

## When the language/framework has first-class OTel support

Prefer the framework's own auto-instrumentation for the span (e.g. an
existing OTel SDK middleware) and add only the attributes and the
error-path log/metric it doesn't already cover — do not hand-roll a span
the framework already creates.

## Verifying it actually works

Before declaring backend instrumentation done, confirm — don't assume:

1. The span appears with the expected name and attributes in a local trace
   export (console exporter, or the project's existing dev-mode OTel setup).
2. Triggering the failure path (a targeted test or manual repro) produces
   both the `Error` span status and the structured log line.
3. If a new metric was added, confirm it increments during that same test —
   a metric that's never actually recorded is worse than no metric, because
   it reads as coverage in a dashboard query that returns nothing.
