---
title: OpenTelemetry Conventions for RUM
impact: HIGH
tags:
  - opentelemetry
  - semconv
  - rum
  - browser
  - mobile
  - dash0
---

# OpenTelemetry Conventions for RUM

When the project ships RUM through OpenTelemetry (Dash0 SDK Web,
`@opentelemetry/sdk-trace-web`, Embrace, Splunk RUM, Honeycomb beacon,
or any OTLP-emitting client), follow the official semantic conventions.
Custom attribute names that overlap registry namespaces fragment queries
across services and break Dash0's derived-attribute computation.

This rule is the RUM-specific application of the
[`otel-semantic-conventions`](../../otel-semantic-conventions/SKILL.md)
and [`otel-instrumentation`](../../otel-instrumentation/SKILL.md) skills —
load them for full attribute / span / metric guidance.

## Contents

- [Signal selection — span, metric, or log?](#signal-selection--span-metric-or-log)
- [Resource attributes (set once at SDK init)](#resource-attributes-set-once-at-sdk-init)
- [Span attributes for RUM](#span-attributes-for-rum)
- [Span names — low cardinality](#span-names--low-cardinality)
- [Span kinds for RUM](#span-kinds-for-rum)
- [Status code](#status-code)
- [Metrics for RUM](#metrics-for-rum)
- [Sampling](#sampling)
- [Dash0 specifics](#dash0-specifics)
- [Mobile OTel — status](#mobile-otel--status-may-2026)
- [Anti-patterns](#anti-patterns)

## Signal selection — span, metric, or log?

| Telemetry concern                     | Signal                          | Why                                                                  |
| ------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| User interaction → outbound call       | **Span** (`INTERNAL` → `CLIENT`) | Has a duration, hierarchy, and propagates to the backend.            |
| Page / screen view                     | **Span** (`INTERNAL`)             | Has a duration; nests fetches and clicks underneath.                  |
| Web Vital (LCP, INP, CLS, TTFB, FCP)   | **Metric** (Histogram)            | Distribution matters; aggregate over many users.                      |
| App start, screen render time          | **Metric** (Histogram)            | Same — distribution.                                                  |
| Error occurrence                       | **Log** with `exception.*` + span error status | Logs carry trace correlation; spans get `ERROR` status.       |
| Business event (`order_completed`, `signup`) | **Log record** (event semantics) or vendor `track()` | Discrete fact, not a duration. The OTel Events API rides on logs.      |
| Crash (mobile)                          | **Log** at FATAL + native crash report (Sentry / Crashlytics) | OTel doesn't natively symbolicate yet.            |

**Default rule:** if it has a duration → span; if it has a numeric value
you want to aggregate → metric; if it's a discrete fact or human-readable
fact → log/event.

## Resource attributes (set once at SDK init)

Resource attributes describe **the app**, not the user.
They are attached to every signal automatically.

| Attribute                       | Required | Example                                          |
| ------------------------------- | -------- | ------------------------------------------------ |
| `service.name`                  | yes      | `"web-shop-frontend"`                            |
| `service.version`               | yes      | `"2026.05.27"` (build hash or release tag)       |
| `deployment.environment.name`   | yes      | `"production"` / `"staging"` / `"preview"`       |
| `telemetry.sdk.name`            | auto     | Set by the SDK                                   |
| `telemetry.sdk.language`        | auto     | `"webjs"` / `"reactnative"`                       |

**Do not put** the following on the resource — they vary per request /
user and belong on spans:

- `user.id`, `enduser.id`
- `session.id`
- `browser.language`, `browser.brands` (in server-side telemetry)
- IP / geolocation

## Span attributes for RUM

| Namespace        | Use for                                                    | Example attribute keys                                                                |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `session.*`      | Browser / app session                                       | `session.id`, `session.previous_id`                                                   |
| `browser.*`      | Browser identity                                           | `browser.brands`, `browser.platform`, `browser.language`, `browser.mobile`            |
| `app.*`          | Client app state                                            | `app.installation.id`, `app.screen.name`                                              |
| `android.*`      | Android-specific                                            | `android.state` (`active` / `background`)                                             |
| `ios.*`          | iOS-specific                                                | `ios.app.state`                                                                       |
| `device.*`       | Physical device                                              | `device.id`, `device.manufacturer`, `device.model.name`                              |
| `user.*` / `enduser.*` | User identity                                          | `user.id` (opaque), `user.role` (bounded). **Never `user.email`.**                    |
| `geo.*`          | Coarse location                                              | `geo.country.iso_code` — never precise GPS                                            |
| `url.*`          | URL                                                          | `url.path`, `url.template` (preferred over `url.full`)                                |
| `http.*`         | Fetch / XHR                                                  | `http.request.method`, `http.response.status_code`                                    |
| `feature_flag.*` | Feature flag state at event time                            | `feature_flag.key`, `feature_flag.variant`                                            |
| `exception.*`    | Exception details (on a log record, not a span event)        | `exception.type`, `exception.message`, `exception.stacktrace`                         |

Always search the
[Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/)
before inventing a name.

### Custom attributes — when allowed, how to namespace

The registry covers most RUM cases.
For genuine domain-specific concepts (`tenant.id`, `cart.value_cents`),
prefix with a project namespace to avoid collisions:

```ts
span.setAttribute('com.acme.cart.value_cents', 4990);
span.setAttribute('com.acme.tenant.id', 'tnt_a1b2c3');
```

Never invent a name that overlaps an existing namespace
(`user.handle`, `http.endpoint`, `browser.theme`).

## Span names — low cardinality

Span names must be bounded.
Variable data goes in attributes.

| Pattern                 | Good                       | Bad (high cardinality)                  |
| ----------------------- | -------------------------- | --------------------------------------- |
| Page / route load       | `documentLoad`             | `documentLoad /users/12345`             |
| Fetch                   | `GET /api/users/:id`       | `GET /api/users/12345`                  |
| User interaction        | `click submit-button`      | `click button-12345-row-42`             |
| Screen view (mobile)    | `screen Settings`          | `screen Settings (userId=42)`           |

For fetches, use `url.template` not `url.full`.
For interactions, use a bounded element identifier (a `data-track-id`
or accessibility role), not a generated DOM ID.

## Span kinds for RUM

| Kind          | When to use in RUM                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `INTERNAL`    | Page load, screen view, user interaction handler. The root span for a user flow.                              |
| `CLIENT`      | Fetch / XHR to a backend, third-party script load. Always a child of an `INTERNAL` user-action span.          |
| `PRODUCER`    | Posting to a message channel (Web Push, BroadcastChannel, WebSocket send) — rarely needed in browser RUM.     |
| `CONSUMER`    | Receiving a push message / WebSocket frame — rarely needed.                                                   |
| `SERVER`      | **Never** on the client. A `SERVER` span means handling an inbound request, which the browser does not do.    |

Root client spans must be `INTERNAL` (page load, interaction).
A `CLIENT` root span signals lost trace context — see
[`otel-instrumentation` span hygiene](../../otel-instrumentation/rules/spans.md#root-spans-must-not-be-client).

## Status code

| HTTP response on a client fetch | Span status | Why                                                |
| ------------------------------- | ----------- | -------------------------------------------------- |
| 1xx, 2xx, 3xx                   | `UNSET`     | Request succeeded                                  |
| 4xx                             | `ERROR`     | Client's request failed                            |
| 5xx                             | `ERROR`     | Server error = client failure                       |
| No response (timeout, offline)  | `ERROR`     | Connection failure                                  |

Always include a status message when setting `ERROR` — error class plus
short context, no stack trace.
Record the stack trace as a separate log record with `exception.*`
attributes.

## Metrics for RUM

Use Histograms for distributions; never put high-cardinality identifiers
on metric attributes.

| Metric (custom, RUM-specific)         | Type      | Unit | Safe attributes                                                  |
| ------------------------------------- | --------- | ---- | ---------------------------------------------------------------- |
| `app.web_vital.lcp`                   | Histogram | `s`  | `route` (templated), `device.type`, `geo.country.iso_code`        |
| `app.web_vital.inp`                   | Histogram | `s`  | same                                                              |
| `app.web_vital.cls`                   | Histogram | `1`  | same                                                              |
| `app.web_vital.ttfb`                  | Histogram | `s`  | same                                                              |
| `app.web_vital.fcp`                   | Histogram | `s`  | same                                                              |
| `app.start.cold`                      | Histogram | `s`  | `app.version`, `device.type`                                      |
| `app.start.warm`                      | Histogram | `s`  | same                                                              |
| `app.frozen_frames.count`             | Counter   | `1`  | `screen.name` (bounded), `app.version`                            |

**Never on metrics**: `user.id`, `session.id`, `url.full`, raw `route`
with IDs, timestamps.
See [`otel-instrumentation` metrics cardinality](../../otel-instrumentation/rules/metrics.md#cardinality-management).

The Web Vitals metric names above are project-local — there is **no
stable OTel semantic convention for Web Vitals yet** (the Client
Instrumentation SIG is still drafting).
Pick the names once and freeze them; document the choice in the tracking
plan.

## Sampling

`AlwaysOn` in the SDK.
Defer all sampling to the Collector or the platform (Dash0 / Honeycomb /
vendor-provided).

```ts
// Bad — SDK-side sampling loses errors and slow requests
const provider = new WebTracerProvider({
  sampler: new TraceIdRatioBasedSampler(0.1),
});

// Good — default AlwaysOn; sample in the pipeline
const provider = new WebTracerProvider();
```

RED metrics (request rate / error rate / duration) cannot be computed
from sampled traces — materialize them via a connector in the Collector
before sampling.

## Dash0 specifics

Dash0 derives several attributes at ingestion (`dash0.operation.name`,
`dash0.span.type`).
These work automatically *if* the source spans set the right inputs:

| Dash0 derivation                  | Depends on                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `dash0.operation.name`            | `http.request.method` + `http.route` / `url.template`                                     |
| `dash0.span.type` = `http`        | `http.*` namespace attributes present                                                     |
| Service map edges                 | Correct span kind (`CLIENT` outbound) + `server.address` / `peer.service`                  |
| AI-powered log templates          | Structured log severity, log body conventions                                              |

When using `@dash0/sdk-web`:

```ts
import { init, setUser, sendEvent } from '@dash0/sdk-web';

init({
  serviceName: 'web-shop-frontend',
  endpoint: {
    url: process.env.NEXT_PUBLIC_OTLP_ENDPOINT!,
    authToken: process.env.NEXT_PUBLIC_OTLP_AUTH_TOKEN!,
  },
});

setUser({ id: user.id });                                       // opaque ID only
sendEvent('checkout.completed', { order_id, value_cents, currency });
```

See [Dash0 SDK Web](https://github.com/dash0hq/dash0-sdk-web) for the
full surface.

## Mobile OTel — status (May 2026)

| SDK                              | Status                                                          |
| -------------------------------- | --------------------------------------------------------------- |
| Embrace React Native             | Fully OTel-based                                                |
| `callstack/react-native-open-telemetry` | Community, growing                                       |
| Splunk RUM React Native          | Beta                                                             |
| Honeycomb RN                     | Beta distros                                                     |
| Dash0 mobile SDK                  | Roadmap — use OTLP-emitting vendor SDK in the meantime          |

Until upstream OTel React Native instrumentations stabilize, ship a
vendor SDK that emits OTLP and apply the same semantic conventions
through it.

## Anti-patterns

- Putting `user.id` on a metric attribute.
- Putting `browser.language` on the resource.
- Naming a span by the full URL (`GET /users/12345`).
- Sampling in the SDK (`TraceIdRatioBasedSampler`).
- Inventing `user.handle` / `http.endpoint` when the registry already has
  `user.name` / `http.route`.
- Setting span status to `ERROR` without a status message.

## References

- [OpenTelemetry — Browser SDK](https://opentelemetry.io/docs/languages/js/getting-started/browser/)
- [OTel Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/)
- [OTel — Sessions](https://opentelemetry.io/docs/specs/semconv/registry/attributes/session/)
- [Dash0 SDK Web](https://github.com/dash0hq/dash0-sdk-web)
- [`otel-semantic-conventions/rules/attributes.md`](../../otel-semantic-conventions/rules/attributes.md)
- [`otel-instrumentation/rules/spans.md`](../../otel-instrumentation/rules/spans.md)
- [`otel-instrumentation/rules/metrics.md`](../../otel-instrumentation/rules/metrics.md)
- [`otel-instrumentation/rules/sensitive-data.md`](../../otel-instrumentation/rules/sensitive-data.md)
