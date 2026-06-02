---
title: Tracking Plan — Schema as Source of Truth
impact: HIGH
tags:
  - tracking-plan
  - schema
  - codegen
  - versioning
  - governance
---

# Tracking Plan

The tracking plan is the contract between product, engineering, and
analytics.
Every event must live in the plan **before** it lives in code.
A plan-as-code workflow (YAML or JSON Schema in the repo, codegen for
the wrapper) is the only durable way to keep instrumentation honest.

## What goes in the plan

For each event, the minimum fields:

| Field            | Required | Notes                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `name`           | yes      | The canonical event name (one school — see [`event-design.md`](./event-design.md)).         |
| `description`    | yes      | One line — what fires this event.                                                            |
| `trigger`        | yes      | Where it fires: file path + function, or screen + action.                                    |
| `owner`          | yes      | Team or person responsible.                                                                  |
| `lifecycle`      | yes      | `proposed` / `live` / `deprecated`.                                                          |
| `version`        | yes      | `v1`, `v2`, … (increment on a breaking change — see [`update-and-remove.md`](./update-and-remove.md)). |
| `pii_class`      | yes      | `none` / `quasi` / `pii` / `sensitive`.                                                       |
| `sample_rate`    | when sampled | `1.0` if always tracked; `0.05` if 5 %.                                              |
| `properties`     | yes      | List with `name`, `type`, `required`, `enum_values`, `description`, `example`.               |
| `consumers`      | recommended | List of dashboards / funnels / cohorts / dbt models that read this event.                |

Each property also has the same metadata (see
[`event-design.md`](./event-design.md)).

## Plan structure (YAML, repo-local)

The canonical layout is one file per event under `analytics/events/`,
or a single `tracking-plan.yaml` for small apps.
Use the template at
[`templates/tracking-plan.template.yaml`](../templates/tracking-plan.template.yaml).

```yaml
version: 1
events:
  - name: order_completed
    description: Fired once the payment processor confirms a successful charge.
    trigger:
      web: app/checkout/actions.ts > completeCheckout
      mobile: features/checkout/CheckoutScreen.tsx > onSuccess
    owner: growth-team
    lifecycle: live
    version: v1
    pii_class: none
    properties:
      - name: order_id
        type: string
        required: true
        description: Opaque order identifier.
        example: ord_a1b2c3
        pii_class: none
      - name: value_cents
        type: number
        required: true
        description: Total order value in minor units.
        example: 4990
        pii_class: none
      - name: currency
        type: string
        required: true
        enum_values: [USD, EUR, GBP]
        description: ISO 4217 currency code.
        example: USD
        pii_class: none
      - name: payment_method
        type: string
        required: true
        enum_values: [card, paypal, bank, gift_card]
        description: Payment provider used for the order.
        example: card
        pii_class: none
    consumers:
      - dashboard:revenue-overview
      - funnel:checkout-conversion
      - dbt:fct_orders
```

## Codegen — generate the wrapper from the plan

Manual maintenance of the typed event union and the YAML plan diverges
in weeks.
Generate one from the other.

| Tool                                          | What it generates                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| [Avo Codegen](https://www.avo.app/docs/reference/avo-codegen/programming-languages/typescript) | Typed TS / Swift / Kotlin wrappers from the Avo plan, dev-time validation. |
| [RudderTyper](https://www.rudderstack.com/docs/dev-tools/ruddertyper/) | Same idea, paired with the RudderStack plan API.                              |
| [Segment Typewriter](https://github.com/segmentio/typewriter) | Same for Segment Protocols.                                                   |
| Hand-rolled `json-schema-to-typescript`       | Self-managed plan + script in `scripts/codegen.ts`. Lowest dependency cost. |

The codegen target is **always** the `AnalyticsEvent` union consumed by
the wrapper.
Renaming a property in the plan must break the build at every callsite
that uses the old name.

## Runtime validation

| Environment | Validation                                                              |
| ----------- | ----------------------------------------------------------------------- |
| dev         | Throw on missing required props, unknown properties, wrong types.       |
| staging     | Log warning + send to telemetry; do not block the user.                  |
| prod        | Silent drop on validation failure; emit a `analytics_validation_failed` event. |

Zod or Yup makes runtime validation cheap.
Strip validation in production builds if perf matters.

```ts
import { z } from 'zod';

const orderCompletedSchema = z.object({
  order_id: z.string(),
  value_cents: z.number().int().positive(),
  currency: z.enum(['USD', 'EUR', 'GBP']),
  payment_method: z.enum(['card', 'paypal', 'bank', 'gift_card']),
});
```

## CI gate

Add a PR check that:

1. Diffs the codebase's tracked event names against the plan.
   Fail if any callsite references an event not in the plan.
2. Fails if a property's `pii_class` is `pii` or `sensitive` without
   an exemption comment.
3. Fails if an event marked `deprecated` is still referenced from
   non-test code.
4. Fails if a `live` event has no `consumers` listed (signals a ghost
   event being born).

The simplest first version is a script that grep-walks the centralized
wrapper's type union and reconciles it against `analytics/events/*.yaml`.

## Versioning — when to bump v1 → v2

Bumping creates a **new event** that fires alongside the old one for a
deprecation window.

| Change                                                    | Bump? | Why                                                |
| --------------------------------------------------------- | ----- | -------------------------------------------------- |
| Add an optional property                                  | No    | Backwards-compatible additive.                      |
| Add a required property                                   | Yes   | Existing consumers break.                            |
| Rename a property                                         | Yes   | Existing consumers break.                            |
| Change a property's type or enum values                   | Yes   | Existing consumers break.                            |
| Change the semantic meaning of the event                  | Yes   | The event is no longer the same fact.                |
| Drop a deprecated property after sunset                   | No    | Already announced; the v2 event is already the home. |

During the deprecation window:

```ts
track('order_completed', v1Props);
track('order_completed_v2', v2Props);
```

Migrate consumers (dashboards, dbt models) to the v2 event, then sunset
v1 on the published date.

## Cross-platform consistency

Same event name on web and mobile when they describe the same fact.
Different names when they don't.

| Web event                  | Mobile event                | Same? |
| -------------------------- | --------------------------- | ----- |
| `signed_up`                | `signed_up`                  | Yes    |
| `checkout_started`         | `checkout_started`           | Yes    |
| `$pageview`                | `$screen`                    | No (different facts) |
| `web_vital`                | `app_start`                  | No     |

If the property shape differs (e.g. web has `route`, mobile has
`screen`), document both shapes in the plan under the same event name
with a `platform` discriminator.

## References

- [Segment — Tracking plan basics](https://segment.com/docs/protocols/tracking-plan/best-practices/)
- [RudderStack — Tracking plans](https://www.rudderstack.com/docs/data-governance/tracking-plans/)
- [Mixpanel — Lexicon](https://docs.mixpanel.com/docs/data-governance/lexicon)
- [Amplitude — Data](https://amplitude.com/docs/data/index)
- [PostHog — Schema management](https://posthog.com/docs/product-analytics/schema-management)
- [Avo — Tracking plan](https://www.avo.app/docs/data-design/avo-tracking-plan)
- See [`event-design.md`](./event-design.md) for naming and property rules.
- See [`update-and-remove.md`](./update-and-remove.md) for the deprecation lifecycle.
