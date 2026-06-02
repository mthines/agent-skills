---
title: Event Design — Naming, Properties, and Cardinality
impact: HIGH
tags:
  - naming
  - properties
  - schema
  - cardinality
  - reserved-names
---

# Event Design

Two decisions per event: **what to call it** and **what to attach to
it**.
Both must be consistent across the whole product — and frozen the moment
the first dashboard or funnel consumes them.

## Naming — pick one school, freeze it

Vendors disagree.
The skill must follow whatever the project already uses; if no
convention exists, recommend Option A.

| School                  | Format                              | Example                                | Used by                       |
| ----------------------- | ----------------------------------- | -------------------------------------- | ----------------------------- |
| **A. Object Action**    | Title Case, past tense              | `Order Completed`, `Plan Upgraded`     | Segment, Mixpanel, Amplitude  |
| **B. object_action**    | snake_case, past tense              | `order_completed`, `plan_upgraded`     | PostHog, Avo codegen          |
| **C. function-style**   | camelCase function (codegen output) | `orderCompleted()`                     | Avo, Typewriter wrappers      |

**Universal rules across all schools:**

- One canonical name per concept.
  Never `signup` and `user_registered` in the same product.
- Past tense — events describe things that **happened**.
  `Order Completed` ✓, `Complete Order` ✗.
- Object first, then action.
  `Plan Upgraded` ✓, `Upgraded Plan` ✗.
- Properties are *always* `snake_case`, even in school A.

### Good vs bad

```text
# Good (school B)
project_created
invite_accepted
subscription_started
order_completed

# Bad — mixed school
projectCreated          # camelCase outside codegen
Subscription_started    # mixed case
order completed         # space without Title Case
COMPLETED_ORDER         # SHOUTING + reversed
order_complete          # present tense
new_order               # not Object-Action
```

### Reserved name prefixes — do not collide

| Prefix       | Owner                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `$`          | PostHog system events (`$pageview`, `$screen`, `$identify`)                                    |
| `ga_`, `gtm.`| GA4 / GTM                                                                                       |
| `Segment.`   | Segment internal                                                                                |
| `_`          | Avoid as a leading character on properties — reserved by several platforms.                     |

Source: [GA4 — Reserved event names](https://support.google.com/analytics/answer/13316687).

## Property design

### One canonical name per concept

```text
# Good
plan_name

# Bad — same concept, four names
plan
planName
subscription_plan
SubscriptionPlanName
```

Maintain a property dictionary alongside the tracking plan.
See [`tracking-plan.md`](./tracking-plan.md).

### Required shape per property

| Field         | Required | Notes                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `name`        | yes      | snake_case, registry-aligned where one exists                                  |
| `type`        | yes      | `string` / `number` / `boolean` / `enum` / ISO-8601 `datetime` / `array<...>` |
| `required`    | yes      | `true` / `false`                                                                |
| `enum_values` | if enum  | Bounded set. Never free-text.                                                  |
| `pii_class`   | yes      | `none` / `quasi` / `pii` / `sensitive` (see PII rules)                          |
| `description` | yes      | One line — what this means *and* what it isn't                                  |
| `example`     | yes      | One literal value                                                              |

### Type discipline

| Concept             | Type        | Example                  | Anti-pattern                        |
| ------------------- | ----------- | ------------------------ | ----------------------------------- |
| Money               | `number`    | `4990` cents             | `"$49.90"` string                   |
| Currency            | `string`    | `"USD"`                  | embedded in the money value         |
| Date / time         | string      | ISO-8601 `2026-05-27T12:00:00Z` | epoch with no timezone        |
| Boolean             | `boolean`   | `true` / `false`         | `"yes"` / `"no"` / `0` / `1`        |
| Categorical         | `enum`      | `"pro"`                  | free-text                           |
| ID                  | `string`    | `"usr_a1b2"`             | `number` (cap to string only IDs)   |

**Money is integer minor units + separate currency.**
Floating-point dollars introduce rounding errors across platforms.

### Reserved property names

Many platforms reserve property names.
Avoid these unless you're populating them with the platform's expected
value.

| Property                            | Reserved by                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `$current_url`, `$referrer`, `$os`  | PostHog                                                                                          |
| `distinct_id`, `anonymous_id`       | Segment, PostHog, RudderStack                                                                     |
| `timestamp`, `event`, `user_id`     | Segment / Mixpanel / Amplitude — set by the SDK                                                  |
| `session_id`                        | OTel `session.id` + most vendors — let the SDK manage                                            |
| `trace_id`, `span_id`               | OTel — set automatically when in a span context                                                  |

If you need your own version, namespace it: `app_session_id`,
`internal_user_id`.

## Cardinality discipline

Cardinality is the number of unique time series your tracking creates.
The tolerance differs per signal — be strict with metrics, looser with
spans and events.

| Where the value lands           | Cardinality tolerance                | Safe to attach                                          | Avoid                                 |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------- | ------------------------------------- |
| Event property (product analytics) | Medium — depends on platform     | `plan_name`, `cart_item_count`, `order_id` (for joins) | Free-text fields, raw URLs, timestamps |
| User property                   | Low — re-emitted on identify         | `plan`, `signup_cohort`, `role`                          | Per-session values, computed metrics  |
| Span attribute (OTel)           | High                                  | `order.id`, `tenant.id`, `feature_flag.key`              | Request bodies, serialized arrays     |
| Metric attribute (OTel)         | **Very low — strict**                 | `http.request.method`, bucketed status, plan tier        | `user.id`, `url.full`, timestamps     |

See `otel-instrumentation` rules/metrics for the cardinality budgeting
table.
Rule of thumb: **never put IDs on metric attributes**.

### Bucket high-cardinality continuous values

```ts
// Bad
{ cart_value_cents: 4990 }   // OK on events; bad on metrics

// Good — bucketed for metric attribute
{ cart_value_band: '10-50' } // metric-safe
```

## Property selection — minimum viable set

Per event, attach only what answers "what would I want to filter on?".

| Event                  | Required                                  | Optional                                                |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `signed_up`            | `plan`                                    | `referrer`, `utm_*` (sanitized)                          |
| `subscription_started` | `plan_name`, `price_cents`, `currency`    | `trial`, `coupon_code`, `billing_period`                 |
| `checkout_started`     | `cart_value_cents`, `currency`, `item_count` | `cart_id`                                              |
| `order_completed`      | `order_id`, `value_cents`, `currency`, `payment_method` | `coupon_code`, `shipping_country`           |
| `error_occurred`       | `error.type`, `screen` or `route`         | `severity`, `recoverable`                                |

Anything not in the minimum set goes on `identify` (user properties) or
session-level properties.

## Common mistakes

- **Both flat and nested representations** for the same concept (`plan`
  and `subscription.plan`).
  **Fix:** pick one, deprecate the other.
- **Embedding units in property names** (`load_time_ms`, `duration_seconds`).
  **Fix:** name the property `load_time` or `duration` and store the unit
  in metadata; or in OTel use a separate `unit` field.
- **Free-text "reason" properties** (`cancel_reason: "I just didn't like it"`).
  **Fix:** present a bounded enum at the UI; capture free text in a
  separate, scrubbed feedback store.
- **Per-mount tracking** in React without an effect dep guard — fires on
  every render. See [`what-not-to-track.md`](./what-not-to-track.md).

## References

- [Segment — Naming conventions](https://segment.com/academy/collecting-data/naming-conventions-for-clean-data/)
- [Mixpanel — Tracking plan basics](https://docs.mixpanel.com/docs/tracking-best-practices/tracking-plan)
- [PostHog — Schema management](https://posthog.com/docs/product-analytics/schema-management)
- [GA4 — Reserved event names](https://support.google.com/analytics/answer/13316687)
- [Avo — Codegen TypeScript](https://www.avo.app/docs/reference/avo-codegen/programming-languages/typescript)
