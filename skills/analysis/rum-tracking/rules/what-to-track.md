---
title: What to Track — Valuable Events for RUM and Product Analytics
impact: HIGH
tags:
  - events
  - taxonomy
  - activation
  - conversion
  - web-vitals
  - errors
---

# What to Track

A typical app needs 10–30 well-named events, not 200.
Track only events that answer one of three questions: **did the user
activate**, **did they convert**, or **what broke for them**.
Everything else is either noise (see
[`what-not-to-track.md`](./what-not-to-track.md)) or context that belongs
in properties on existing events.

## Decision flow

Walk these in order.
The first answer that fits is the right one.

| # | Ask                                                                       | Action                                                  |
| - | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1 | Does this event answer "did a user reach the aha moment"?                 | Track — activation event.                               |
| 2 | Does this event change revenue, retention, or account state?              | Track — conversion event.                               |
| 3 | Is this a step in a funnel we already report on?                          | Track — funnel event.                                   |
| 4 | Did something break, crash, or exceed a perf threshold?                   | Track — error / performance event.                      |
| 5 | Is this context we'd want *attached to an existing event*?                | Do not track. Add as a property to the existing event.  |
| 6 | None of the above?                                                        | Do not track.                                           |

If you cannot name the dashboard, funnel, or alert that consumes the
event within 30 seconds, you do not need the event.

## Categories worth tracking

### Activation events

The single action that distinguishes retained users from churned ones.
*Time-to-value* (TTV) is `aha_timestamp - account_created_timestamp`,
measured as the median per cohort.

| Domain          | Activation event examples                                 |
| --------------- | --------------------------------------------------------- |
| B2B SaaS        | `project_created`, `invite_sent`, `integration_connected` |
| Collaboration   | `first_message_sent`, `first_doc_shared`                  |
| E-commerce      | `first_purchase_completed`                                |
| Content / media | `first_5_min_played`, `first_episode_finished`            |

**Pick one canonical activation event per product** and track time-to-it
relentlessly.
"User signed in" is *never* an activation event — it's a prerequisite.

### Conversion events

Hard signals that move money or account state.
These must be **server-side tracked** in addition to client-side because
ad blockers and SDK failures cost you revenue data.

| Event                       | Required properties                                                          |
| --------------------------- | ---------------------------------------------------------------------------- |
| `signed_up`                 | `plan`, `referrer`, `utm_*` (sanitized)                                      |
| `subscription_started`      | `plan_name`, `price_cents`, `currency`, `billing_period`, `trial`            |
| `plan_upgraded`             | `from_plan`, `to_plan`, `price_delta_cents`, `currency`                      |
| `plan_downgraded`           | `from_plan`, `to_plan`                                                       |
| `subscription_cancelled`    | `plan_name`, `tenure_days`, `cancel_reason` (bounded enum, not free-text)   |
| `order_completed`           | `order_id`, `item_count`, `value_cents`, `currency`, `payment_method`        |
| `refund_issued`             | `order_id`, `refund_value_cents`, `currency`, `reason`                       |

**Currency is always a separate property** (`USD`, `EUR`, …).
Never multiply by exchange rate at tracking time.

### Funnel events

Every step of a multi-step flow that has a published drop-off chart.
Each step gets a discrete name; do *not* fire `funnel_step` with a `step`
property — that breaks per-step analysis in most tools.

```text
# Good — discrete events
checkout_started        → payment_info_entered → order_completed

# Bad — opaque step number
checkout_step  step=1   step=2                  step=3
```

### Engagement events

Repeat actions that signal retention.
Track the *first occurrence* and aggregate the rest into properties on
session or daily-summary events rather than firing per action.

| Pattern                  | Recommended event                                                  |
| ------------------------ | ------------------------------------------------------------------ |
| First use of a feature   | `<feature>_used_first_time`                                        |
| Repeat use (high volume) | Aggregate to `feature_usage_summary` per session, not per click    |
| Streak / habit signal    | `daily_streak_milestone` with `streak_days`                        |

### Performance events (RUM)

Capture the three Core Web Vitals plus the two diagnostic vitals.
On mobile, capture the lifecycle equivalents.

| Web vital                    | Threshold ("Good") | Notes                                                                                       |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| **LCP** (Largest Contentful Paint) | ≤ 2.5 s       | Loading                                                                                     |
| **INP** (Interaction to Next Paint) | ≤ 200 ms     | Responsiveness; **replaced FID in March 2024**. Must be RUM-measured — lab tools cannot.    |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1           | Visual stability                                                                            |
| **TTFB** (Time to First Byte)     | ≤ 800 ms        | Diagnostic, not Core                                                                        |
| **FCP** (First Contentful Paint)  | ≤ 1.8 s         | Diagnostic, not Core                                                                        |

Source: [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds).

| Mobile signal           | Notes                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| App start (cold / warm) | Cold ≤ 2 s; warm ≤ 1 s                                                 |
| Frozen frames           | Frame > 700 ms                                                         |
| ANRs (Android)          | Main-thread blocked > 5 s                                              |
| Crashes                 | Native + JS combined into a single `crash_rate` dashboard             |

### Error events

Errors are *always* worth tracking; the discipline is in what you attach.

| Capture                      | Drop                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| Error class / `error.type`   | Full `exception.message` if it might echo user input                  |
| Truncated stack trace        | Auth headers, cookies, request bodies                                  |
| Route or screen at the time  | Full URL with query strings (strip first — see PII rules)              |
| User-anonymous correlation   | Email, username, raw IP                                                |

Group similar errors at the backend; do not fire one event per
occurrence on hot loops.

### Session events

Fire automatically; do not invent your own.

| Event                | When                                                |
| -------------------- | --------------------------------------------------- |
| `$pageview`          | Route changes (web)                                 |
| `$screen`            | Screen focus changes (mobile)                       |
| `session_started`    | SDK starts a new session                            |
| `session_ended`      | Session times out or app backgrounded > N minutes   |

### Identify / Alias / Group

| Call         | When                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| `identify()` | On signup and on every login. Pass an opaque `user.id` — **never** email/username.|
| `alias()`    | Only when a destination requires linking an anonymous ID to a known user.         |
| `group()`    | B2B: on first context-switch into a workspace / org / account.                    |

User properties (set on `identify` / `group`) carry attributes that
rarely change: `plan`, `signup_date`, `role`, `team_size`.
Per-event context (cart value, page) goes in event properties.

## Quantity heuristic

| App size                          | Typical # of named events |
| --------------------------------- | -------------------------- |
| New B2C app                       | 5–10                       |
| Mature B2B SaaS                   | 15–30                      |
| Multi-product platform            | 30–60 per product line     |
| > 100 events                      | Almost certainly over-tracked — audit. |

If you cross 30, the next addition must replace something, not stack
on top.

## References

- [Segment — Tracking Plan best practices](https://segment.com/docs/protocols/tracking-plan/best-practices/)
- [PostHog — Product analytics best practices](https://posthog.com/docs/product-analytics/best-practices)
- [Mixpanel — Tracking plan](https://docs.mixpanel.com/docs/tracking-best-practices/tracking-plan)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [Datadog RUM — Error Tracking](https://docs.datadoghq.com/real_user_monitoring/error_tracking/)
