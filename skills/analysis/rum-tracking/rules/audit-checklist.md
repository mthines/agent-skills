---
title: Audit Checklist — Review Existing RUM and Analytics Tracking
impact: HIGH
tags:
  - audit
  - review
  - cleanup
  - compliance-audit
---

# Audit Checklist

Apply this checklist when reviewing an existing tracking implementation.
Every finding cites a file path + line number.
Findings group into three tiers:

| Tier        | When                                                                | Examples                                                  |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| **Blocking** | Data is leaving the app that shouldn't, or a regulator could fine. | PII in event props, no consent gate, missing deletion API. |
| **Important** | Telemetry is silently broken or unreliable.                       | Ghost events, missing events, cardinality explosions.      |
| **Nice-to-have** | Drift or inconsistency that hurts analyst productivity.        | Naming inconsistency, undocumented owners.                  |

## 0 — Discovery (before the audit)

- [ ] Tracking plan exists in the repo.
      Path: `analytics/events/*.yaml` or similar.
- [ ] Centralized analytics wrapper exists.
      Single import surface for `track()` / `identify()`.
- [ ] List of destinations is enumerable.
      Each destination's auth token rotation policy is known.

## 1 — Blocking findings

### 1.1 — Consent gate

- [ ] No SDK loads before consent is granted (GDPR jurisdictions).
- [ ] Consent state is checked in the wrapper before every `track()`.
- [ ] Default state in EU regions is **opt-out**.
- [ ] Global Privacy Control (GPC) signal honored in CCPA regions.
- [ ] Verified in a private window: rejecting cookies produces **zero**
      network calls to analytics domains.

### 1.2 — PII / sensitive data

- [ ] `distinct_id` / `user.id` is opaque (UUID), never email or
      username.
- [ ] No event property contains: email, full name, phone, password,
      API key, token, credit card, SSN, raw IP.
- [ ] URLs in `$current_url` / `referrer` are stripped of `?token=`,
      `?reset=`, `?email=`, `?code=`, `?api_key=`.
- [ ] Exception messages do not echo user input.
- [ ] Session replay (if enabled) masks `<input>`, `<textarea>`, and
      anything tagged `data-private` / `ph-no-capture`.
- [ ] Free-text fields are either dropped, hashed, or PII-scanned.

Cross-reference against [`pii-and-compliance.md`](./pii-and-compliance.md).

### 1.3 — Compliance plumbing

- [ ] Deletion API call wired to the user-delete flow for every
      destination.
- [ ] Data retention configured per destination (≤ 13 months unless
      documented).
- [ ] Apple App Privacy Manifest covers every linked SDK (mobile).
- [ ] Google Play Data Safety form matches actual SDK behavior (mobile).
- [ ] iOS ATT consent prompted before IDFA-dependent SDK init (mobile).
- [ ] DPA signed with every analytics vendor.

## 2 — Important findings

### 2.1 — Ghost events (fire, nobody consumes)

For each event in the codebase:

- [ ] Has at least one consumer: dashboard, funnel, cohort, alert, or
      dbt model.

Process:

```bash
# Extract all event names from the wrapper / type union
grep -roE "name:\s*['\"][^'\"]+['\"]" lib/analytics/events.ts

# For each, search the destination's dashboards / dbt
# (typically a manual audit in the vendor UI)
```

Tools that automate this:
[Avo Inspector](https://www.avo.app/docs/inspector/issue-types-in-inspector),
[Heap Govern](https://www.heap.io/),
[Mixpanel Lexicon](https://docs.mixpanel.com/docs/data-governance/lexicon).

### 2.2 — Missing events (consumed, not firing)

- [ ] Every event referenced in a dashboard / funnel / dbt model is
      defined in the wrapper.
- [ ] No dashboard query against `event_name = '<unknown>'`.

### 2.3 — Cardinality explosions

For every property attached to a metric or used in a `group by`:

- [ ] Bounded value set or numeric bucket.
- [ ] No `user.id`, `order.id`, `url.full`, raw `path` with IDs, or
      timestamp on a **metric** attribute.
- [ ] `$current_url` on `$pageview` is the route template, not the raw
      URL.

See `otel-instrumentation` rules/metrics for cardinality budgeting.

### 2.4 — Deprecated events still firing

For each event marked `lifecycle: deprecated`:

- [ ] Sunset date set.
- [ ] Replacement (`deprecated_in_favor_of`) recorded.
- [ ] Build-time `@deprecated` warning surfaces at callsites.
- [ ] Past the sunset date? Remove per
      [`update-and-remove.md`](./update-and-remove.md).

### 2.5 — Plan ↔ code drift

- [ ] Every event in the wrapper has a plan entry.
- [ ] Every plan entry has a code emit OR is `proposed` / `archived`.
- [ ] Property names match between plan and code.
- [ ] Required properties in the plan are required by the wrapper's
      type union.

### 2.6 — SDK-side sampling

- [ ] No `TraceIdRatioBasedSampler` / `BatchSpanProcessor` with sampling
      in the SDK init.
- [ ] Sampling is configured in the Collector or platform, not the
      browser / mobile SDK.

### 2.7 — Per-render tracking

```bash
grep -rE "useEffect\(\(\) => \{[^}]*track\(" components/
# Look for missing dep arrays — fires on every render
```

- [ ] All `track()` calls inside `useEffect` have proper dep arrays.
- [ ] No `track()` called in render path.

### 2.8 — Cross-platform consistency

- [ ] Same event name on web + mobile when it represents the same fact.
- [ ] Property shapes match across platforms.
- [ ] Web `$pageview` and mobile `$screen` distinguished.

### 2.9 — Performance

- [ ] Analytics bundle gzipped ≤ 20 KB initial (web).
- [ ] SDK init does not block LCP candidate.
- [ ] Mobile offline queue exists and is capped (≤ 1,000 events or
      1 MB AsyncStorage).
- [ ] Beacon API or `keepalive: true` used for unload events (web).

## 3 — Nice-to-have findings

### 3.1 — Naming consistency

- [ ] One naming school across the project (Object Action / object_action /
      function).
- [ ] No `signup` + `user_registered` for the same concept.
- [ ] Properties are `snake_case` regardless of event-name school.
- [ ] No embedded units in property names (`load_time_ms` →
      `load_time`).

### 3.2 — Plan completeness

- [ ] Every event has an owner.
- [ ] Every event has a description.
- [ ] Every property has an `example` value.
- [ ] Every event has a `pii_class`.
- [ ] Every `live` event has at least one listed consumer.

### 3.3 — OpenTelemetry alignment (if using OTel)

- [ ] Custom attributes use a project namespace prefix (`com.acme.*`).
- [ ] No custom attribute that collides with a registry namespace
      (`user.handle`, `http.endpoint`).
- [ ] Span kinds correct (CLIENT for fetch, INTERNAL for interactions).
- [ ] No `CLIENT` root spans.

## Output format

```markdown
## Audit — <project>

Blocking (n):
- [pii] `Checkout.tsx:42` — `track('order_completed', { email: user.email })` puts PII in event properties. Fix: opaque `user_id` only.
- [consent] `app/_analytics/init.tsx:8` — SDK initialized before consent check. Fix: gate on `window.__consent.analytics`.

Important (n):
- [ghost] `signup_form_loaded` defined in `events.ts:34` but no dashboard / funnel / dbt model consumes it.
- [cardinality] `events.ts:51` — `cart_value_cents` used as a metric attribute. Fix: bucket to `cart_value_band`.

Nice-to-have (n):
- [naming] `events.ts:18,29` — mixes `user_signed_up` and `signup_completed`. Pick one.
```

## References

- [`pii-and-compliance.md`](./pii-and-compliance.md)
- [`event-design.md`](./event-design.md)
- [`tracking-plan.md`](./tracking-plan.md)
- [`update-and-remove.md`](./update-and-remove.md)
- [Avo Inspector — Issue types](https://www.avo.app/docs/inspector/issue-types-in-inspector)
