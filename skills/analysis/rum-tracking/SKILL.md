---
name: rum-tracking
description: >
  Guides product analytics and RUM (Real User Monitoring) event tracking
  in web (React/Next.js) and mobile (React Native/Expo) apps. Decides what
  user interactions are valuable to capture, what's noise, what's PII to
  avoid, and how to implement, audit, update, and remove tracking code
  cleanly. Covers event naming, property schemas, tracking plans,
  GDPR/CCPA/DPDPA compliance, OpenTelemetry semantic conventions for
  browser and mobile RUM, and platforms (PostHog, Segment, Mixpanel,
  Amplitude, Datadog RUM, Sentry, OTel, Dash0). Modes: guide (default),
  implement, audit, remove, plan. Triggers on "track this event",
  "add analytics", "what should I track", "is this PII", "tracking plan",
  "remove tracking", "audit analytics", "/rum-tracking".
argument-hint: '[guide|implement|audit|remove|plan] [<target>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - rum
    - analytics
    - tracking
    - product-analytics
    - opentelemetry
    - pii
    - gdpr
    - react
    - react-native
    - dash0
---

# RUM Tracking

Guides product-analytics and RUM event tracking for web (React/Next.js)
and mobile (React Native/Expo) apps.
Decides what to capture, what to drop, what's PII, and how to add, audit,
update, and remove tracking code without breaking downstream dashboards.

> **External dependency.** The OTel guidance in [`rules/otel-conventions.md`](./rules/otel-conventions.md)
> builds on the `otel-instrumentation` and `otel-semantic-conventions` skills,
> which live in the [dash0 agent-skills repo](https://github.com/dash0hq/agent-skills),
> not this one. That rule **invokes them at runtime via `Skill()` when they're
> installed** (and skips silently otherwise) — install them alongside this skill
> to get their authoritative span/metric/attribute guidance.

> **This `SKILL.md` is a thin index.**
> Detailed rules live in `rules/*.md` and load on demand.
> Worked examples live in `references/*.md`.
> Literal scaffolding lives in `templates/*.md`.

---

## Mode Detection

Parse `$1` as the mode.
State the detected mode in one line before continuing.

| Mode        | Default | Trigger                                                              |
| ----------- | ------- | -------------------------------------------------------------------- |
| `guide`     | **yes** | "what should I track", "is this worth tracking", default if no mode  |
| `implement` |         | "add tracking", "instrument this", "track this event"                |
| `audit`     |         | "audit tracking", "review analytics", "find tracking issues"         |
| `remove`    |         | "remove tracking", "delete this event", "deprecate", "/rm-tracking"  |
| `plan`      |         | "tracking plan", "design event schema", "what events do we need"     |

If `$1` is a target file or directory, treat it as the scope for `audit`,
`implement`, or `remove`.

---

## Workflow by Mode

### Guide mode (default)

The user is deciding *whether* and *what* to track at a specific point.

1. Load [`rules/what-to-track.md`](./rules/what-to-track.md) and
   [`rules/what-not-to-track.md`](./rules/what-not-to-track.md).
2. Cross-check the proposal against
   [`rules/pii-and-compliance.md`](./rules/pii-and-compliance.md).
3. Recommend an event name + property set using
   [`rules/event-design.md`](./rules/event-design.md).
4. If the project uses OpenTelemetry RUM (Dash0 SDK Web, OTel browser /
   mobile, Embrace), also apply
   [`rules/otel-conventions.md`](./rules/otel-conventions.md).
5. Surface canonical events from
   [`references/event-catalog.md`](./references/event-catalog.md) instead
   of inventing new ones when one fits.

### Implement mode

The user wants tracking code written.

1. Confirm the event is in the tracking plan
   ([`rules/tracking-plan.md`](./rules/tracking-plan.md)).
   If not, propose adding it to the plan **first** and gate the user
   before writing instrumentation.
2. Pick the platform:
   - Web (React/Next.js) → [`rules/implementation-web.md`](./rules/implementation-web.md).
   - Mobile (React Native/Expo) → [`rules/implementation-mobile.md`](./rules/implementation-mobile.md).
3. If using OpenTelemetry, also load
   [`rules/otel-conventions.md`](./rules/otel-conventions.md).
4. All tracking calls must go through the centralized wrapper
   ([`templates/analytics-wrapper.template.ts`](./templates/analytics-wrapper.template.ts)).
   Never call the vendor SDK directly from a component.
5. Run the PII gate from
   [`rules/pii-and-compliance.md`](./rules/pii-and-compliance.md) on every
   property before the diff is final.

### Audit mode

The user wants existing tracking reviewed.

1. Walk the checklist in
   [`rules/audit-checklist.md`](./rules/audit-checklist.md).
2. For every finding, cite a file path and line number.
3. Group findings into: blocking (PII / consent / compliance), important
   (drift / ghost events / cardinality), nice-to-have (naming consistency).
4. Output a ranked fix list — do not auto-edit unless the user approved a
   pre-defined audit scope.

### Remove mode

The user wants tracking deprecated or deleted.

1. Apply the lifecycle in
   [`rules/update-and-remove.md`](./rules/update-and-remove.md).
2. Find every callsite via the centralized wrapper's typed event names.
3. Identify downstream consumers (dashboards, funnels, dbt models,
   cohorts) before deletion.
4. Mark `deprecated` first, set a sunset date, then remove.
5. Update the tracking plan and the inventory in the same PR.

### Plan mode

The user wants to design, update, or codegen a tracking plan.

1. Apply the structure in
   [`rules/tracking-plan.md`](./rules/tracking-plan.md).
2. Start from
   [`templates/tracking-plan.template.yaml`](./templates/tracking-plan.template.yaml).
3. Choose a naming school ([`rules/event-design.md`](./rules/event-design.md))
   and freeze it for the project.
4. Wire codegen (Avo, RudderTyper, Typewriter, or hand-rolled
   `json-schema-to-typescript`) so the wrapper is type-checked.

---

## Required Reading by Mode

Load on demand — do not preload.

| Mode        | Files                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guide`     | [`rules/what-to-track.md`](./rules/what-to-track.md), [`rules/what-not-to-track.md`](./rules/what-not-to-track.md), [`rules/event-design.md`](./rules/event-design.md), [`rules/pii-and-compliance.md`](./rules/pii-and-compliance.md), [`references/event-catalog.md`](./references/event-catalog.md)                                                                                                              |
| `implement` | [`rules/tracking-plan.md`](./rules/tracking-plan.md), [`rules/implementation-web.md`](./rules/implementation-web.md) or [`rules/implementation-mobile.md`](./rules/implementation-mobile.md), [`rules/otel-conventions.md`](./rules/otel-conventions.md) (if OTel), [`rules/pii-and-compliance.md`](./rules/pii-and-compliance.md), [`templates/analytics-wrapper.template.ts`](./templates/analytics-wrapper.template.ts) |
| `audit`     | [`rules/audit-checklist.md`](./rules/audit-checklist.md), [`rules/pii-and-compliance.md`](./rules/pii-and-compliance.md), [`rules/event-design.md`](./rules/event-design.md)                                                                                                                                                                                                                                       |
| `remove`    | [`rules/update-and-remove.md`](./rules/update-and-remove.md), [`rules/tracking-plan.md`](./rules/tracking-plan.md)                                                                                                                                                                                                                                                                                                  |
| `plan`      | [`rules/tracking-plan.md`](./rules/tracking-plan.md), [`rules/event-design.md`](./rules/event-design.md), [`templates/tracking-plan.template.yaml`](./templates/tracking-plan.template.yaml)                                                                                                                                                                                                                       |

[`references/platforms.md`](./references/platforms.md) is optional — load
when the user asks "which platform should we use" or names a specific
vendor.

---

## Core Principles

1. **The tracking plan is the source of truth.**
   Every event must exist in the plan before it exists in code.
2. **Centralized wrapper, never raw SDK calls.**
   One module owns every `track()` callsite; swapping vendors must be a
   single-file change.
3. **Type-safe events.**
   Use codegen (Avo, RudderTyper, Typewriter) or a hand-rolled
   discriminated union so renames break the build.
4. **PII never appears in event properties.**
   Use opaque `user.id`, hash for correlation, strip URLs and free-text.
5. **Low-cardinality event names; rich, bounded properties.**
   ≤ 30 event names in a typical app; high-value context in properties.
6. **Defer sampling to the pipeline.**
   SDKs export everything; the Collector or platform decides what to
   keep.
7. **OpenTelemetry semantic conventions when present.**
   `user.id`, `session.id`, `browser.*`, `app.*`, `error.type` come from
   the registry — do not invent custom names that overlap.
8. **Remove tracking the same way you add it.**
   Plan first, deprecate, find consumers, then delete.

## Anti-patterns (one-liners)

- Scattering `posthog.capture()` / `mixpanel.track()` calls across
  components instead of one wrapper.
- Tracking every hover, scroll, or render — drowns signal, explodes cost.
- Putting email, full URLs with tokens, raw `req.body`, or stack traces
  with user input into event properties.
- Using email or username as `distinct_id` / `user.id` — always opaque.
- Naming events inconsistently (`signup` and `user_registered` for the
  same concept).
- Deleting an event before checking which dashboards consume it.
- Configuring SDK-side sampling — sample in the Collector instead.
- Treating hashed email as anonymous — it remains personal data under
  GDPR.

## Definition of Done

- [ ] Mode detected and stated.
- [ ] Required reading for the mode loaded.
- [ ] If `implement` or `remove`: tracking plan updated in the same diff.
- [ ] PII gate run on every new or modified event.
- [ ] Centralized wrapper used; no raw SDK calls in feature code.
- [ ] Downstream consumers identified before removal.
- [ ] Recommendation cites file paths and line numbers, or proposes a
      concrete diff.
