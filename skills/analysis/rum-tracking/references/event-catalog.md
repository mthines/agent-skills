---
title: Canonical Event Catalog by Domain
impact: MEDIUM
tags:
  - reference
  - catalog
  - examples
  - b2b-saas
  - ecommerce
  - content
---

# Canonical Event Catalog

Reach for these before inventing new events.
Standard names are recognized by every analytics platform's pre-built
funnel templates (Mixpanel, Amplitude, PostHog, Segment).

## Contents

- [Universal events](#universal-events)
- [B2B SaaS](#b2b-saas)
- [E-commerce](#e-commerce)
- [Content and media](#content-and-media)
- [Mobile-specific](#mobile-specific)
- [Performance / RUM](#performance--rum)
- [Error / crash](#error--crash)

---

## Universal events

These fire in nearly every product.

| Event                 | When                                                                    | Required properties                                    |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `signed_up`           | Account creation completes server-side.                                 | `plan`                                                 |
| `signed_in`           | User authenticated (fresh login, not refresh).                          | `auth_method`                                          |
| `signed_out`          | User-initiated sign-out.                                                | —                                                      |
| `$pageview`           | Web route change.                                                       | `route`                                                |
| `$screen`             | Mobile screen focus.                                                    | `path`                                                 |
| `session_started`     | SDK starts a new session.                                               | —                                                      |
| `session_ended`       | Session ended (timeout or backgrounded > N minutes).                    | `duration_seconds`                                     |
| `$identify`           | User identified — set after `signed_up` / `signed_in`.                  | `user_id` (opaque), user properties                    |
| `$alias`              | Anonymous → known user link.                                            | `anonymous_id`, `user_id`                              |
| `$group`              | B2B context switch into a workspace / org / account.                    | `group_type`, `group_id`                               |

Reserved prefixes (`$…`) are PostHog convention; vendors map them
internally.

## B2B SaaS

### Activation funnel

| Event                  | Required properties                                            | Notes                                                 |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `signed_up`            | `plan`                                                          | Server-side.                                          |
| `workspace_created`    | `workspace_id`                                                   |                                                       |
| `invite_sent`          | `workspace_id`, `invite_count`                                   |                                                       |
| `invite_accepted`      | `workspace_id`                                                   |                                                       |
| `integration_connected` | `integration_name` (enum), `workspace_id`                       |                                                       |
| `first_project_created` | `workspace_id`, `project_template?`                            | Activation milestone.                                  |
| `aha_reached`          | `workspace_id`, `seconds_since_signup`                          | Custom activation marker — fire once per user.        |

### Monetization

| Event                       | Required properties                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `trial_started`             | `plan`, `trial_days`                                                                         |
| `trial_converted`           | `plan`, `trial_days`                                                                         |
| `trial_expired`             | `plan`, `trial_days`                                                                         |
| `subscription_started`      | `plan`, `price_cents`, `currency`, `billing_period` (`monthly` / `annual`)                  |
| `plan_upgraded`             | `from_plan`, `to_plan`, `price_delta_cents`, `currency`                                       |
| `plan_downgraded`           | `from_plan`, `to_plan`                                                                       |
| `seats_added`               | `from_seats`, `to_seats`, `price_delta_cents`, `currency`                                    |
| `seats_removed`             | `from_seats`, `to_seats`                                                                     |
| `subscription_paused`       | `plan`, `pause_days`                                                                          |
| `subscription_cancelled`    | `plan`, `tenure_days`, `cancel_reason` (bounded enum)                                         |
| `subscription_reactivated`  | `plan`                                                                                         |
| `payment_failed`            | `plan`, `failure_code` (bounded enum)                                                          |
| `invoice_paid`              | `invoice_id`, `value_cents`, `currency`                                                        |

### Engagement

| Event                          | Required properties                              |
| ------------------------------ | ------------------------------------------------ |
| `feature_used_first_time`      | `feature_name` (enum), `workspace_id`             |
| `report_generated`             | `report_type` (enum), `workspace_id`              |
| `api_key_created`              | `workspace_id`                                    |
| `webhook_configured`            | `event_type` (enum)                               |

## E-commerce

### Browse and discovery

| Event                  | Required properties                                                  |
| ---------------------- | -------------------------------------------------------------------- |
| `product_viewed`       | `product_id`, `category`, `price_cents`, `currency`                   |
| `product_list_viewed`  | `list_name`, `category`                                               |
| `search_submitted`     | `query_length`, `result_count` (**never the raw query**)              |
| `filter_applied`       | `filter_name`, `filter_value` (enum)                                  |

### Cart

| Event                 | Required properties                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `cart_viewed`         | `cart_id`, `item_count`, `cart_value_cents`, `currency`                        |
| `product_added`       | `cart_id`, `product_id`, `quantity`, `price_cents`, `currency`                  |
| `product_removed`     | `cart_id`, `product_id`, `quantity`                                              |
| `cart_abandoned`      | `cart_id`, `cart_value_cents`, `currency`, `item_count`                          |

### Checkout / conversion (fire server-side)

| Event                  | Required properties                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `checkout_started`     | `cart_id`, `cart_value_cents`, `currency`, `item_count`                                              |
| `payment_info_entered` | `cart_id`, `payment_method` (enum: `card`, `paypal`, `bank`, `gift_card`)                            |
| `coupon_applied`        | `cart_id`, `coupon_code`, `discount_cents`                                                            |
| `order_completed`      | `order_id`, `value_cents`, `currency`, `payment_method`, `item_count`, `shipping_country` (ISO 3166) |
| `order_refunded`       | `order_id`, `refund_value_cents`, `currency`, `reason` (enum)                                          |
| `order_shipped`        | `order_id`, `carrier` (enum)                                                                           |
| `order_delivered`      | `order_id`                                                                                              |

## Content and media

| Event                  | Required properties                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `content_viewed`       | `content_id`, `content_type` (enum: `article`, `video`, `podcast`), `category`        |
| `content_started`      | `content_id`                                                                          |
| `playback_started`     | `media_id`, `position_seconds`                                                         |
| `playback_paused`      | `media_id`, `position_seconds`                                                         |
| `playback_resumed`     | `media_id`, `position_seconds`                                                         |
| `playback_completed`   | `media_id`, `duration_seconds`                                                          |
| `read_25_percent`      | `content_id`                                                                          |
| `read_75_percent`      | `content_id`                                                                          |
| `content_shared`        | `content_id`, `share_target` (enum)                                                    |
| `content_saved`         | `content_id`                                                                          |
| `comment_posted`        | `content_id`, `comment_length`                                                         |

## Mobile-specific

| Event                  | Required properties                                                |
| ---------------------- | ------------------------------------------------------------------ |
| `app_installed`        | `install_referrer?` (sanitized)                                     |
| `app_opened`           | `cold_start` (boolean)                                              |
| `app_foregrounded`     | —                                                                  |
| `app_backgrounded`     | `session_duration_seconds`                                          |
| `deep_link_opened`     | `host`, `path` (no query string)                                    |
| `push_received`        | `campaign_id?`                                                       |
| `push_opened`          | `campaign_id?`                                                       |
| `notification_permission_granted` | `permission` (enum)                                       |
| `notification_permission_denied`  | `permission` (enum)                                       |
| `att_consent_granted`  | —                                                                   |
| `att_consent_denied`   | —                                                                   |

## Performance / RUM

| Event / Metric        | Type      | Value / Required properties                                                          |
| --------------------- | --------- | ------------------------------------------------------------------------------------ |
| `web_vital`           | Event     | `metric` (enum: `LCP`/`INP`/`CLS`/`TTFB`/`FCP`), `value_ms`, `rating`, `route`        |
| `app.web_vital.lcp`   | Histogram | seconds, attributes: `route`, `device.type`                                            |
| `app.web_vital.inp`   | Histogram | seconds, attributes: `route`, `device.type`                                            |
| `app.web_vital.cls`   | Histogram | dimensionless                                                                          |
| `app_start`           | Event     | `mode` (`cold`/`warm`), `duration_ms`                                                  |
| `app.start.cold`      | Histogram | seconds, attributes: `app.version`                                                     |
| `app.start.warm`      | Histogram | seconds                                                                                |
| `screen_render`       | Event     | `screen`, `duration_ms`                                                                |

Web Vitals naming follows the
[web-vitals npm package](https://www.npmjs.com/package/web-vitals).
There is no stable OTel semconv for Web Vitals yet — see
[`../rules/otel-conventions.md`](../rules/otel-conventions.md).

## Error / crash

| Event              | Required properties                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `error_occurred`   | `error_type` (string), `severity` (enum: `info`/`warn`/`error`/`fatal`), `route` / `screen` |
| `api_error`        | `endpoint` (route template), `status_code`, `error_type`                                   |
| `crash`            | `mode` (`native`/`js`), `app.version`, `os.version`                                           |

**Never include**: full exception messages with user input, full stack
traces with PII, request bodies, auth headers.
Sanitize first — see [`../rules/pii-and-compliance.md`](../rules/pii-and-compliance.md).

## References

- [Segment — Spec: Common events](https://segment.com/docs/connections/spec/)
- [Segment — Spec: E-commerce](https://segment.com/docs/connections/spec/ecommerce/v2/)
- [PostHog — Common events](https://posthog.com/docs/product-analytics/capture-events)
- [Mixpanel — Common SaaS events](https://docs.mixpanel.com/docs/tracking-best-practices)
- [web-vitals npm](https://www.npmjs.com/package/web-vitals)
