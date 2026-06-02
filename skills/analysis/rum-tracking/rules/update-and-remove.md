---
title: Update and Remove — Lifecycle, Deprecation, and Cleanup
impact: HIGH
tags:
  - lifecycle
  - deprecation
  - removal
  - versioning
  - cleanup
---

# Update and Remove

Adding tracking is easy.
Removing it is where most teams accumulate noise, broken dashboards, and
PII risk.
Every event has a lifecycle: `proposed` → `live` → `deprecated` →
sunset.
Never skip a stage.

## The lifecycle

```text
proposed     →    live     →     deprecated     →     sunset (removed)
 (plan PR)        (in code)      (still firing,        (removed from
                                  consumers being        plan + code)
                                  migrated)
```

| Stage        | What it means                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `proposed`   | Listed in the tracking plan with an owner. No code yet. Consumers being designed.                        |
| `live`       | Plan entry exists, code emits the event, at least one consumer (dashboard / funnel / cohort) uses it. |
| `deprecated` | Marked in the plan with a sunset date. Code still emits. Consumers being migrated.                       |
| sunset       | Plan entry archived. Code callsites removed. Consumers no longer reference it.                            |

## Adding a new event

1. **Plan first.**
   Add the event entry to the tracking plan
   ([`tracking-plan.md`](./tracking-plan.md)) with `lifecycle: proposed`.
2. **Codegen.**
   Regenerate the wrapper's type union.
   The build fails everywhere the new event might be needed — that's
   the point.
3. **Implement.**
   Call `track({ name: 'new_event', props: {…} })` from the appropriate
   callsite.
   See [`implementation-web.md`](./implementation-web.md) and
   [`implementation-mobile.md`](./implementation-mobile.md).
4. **Verify ingestion.**
   In dev: confirm the event arrives at the destination with the
   expected schema.
   In staging: smoke-test from a real client.
5. **Promote.**
   Flip `lifecycle: live` in the plan.
   Link the consuming dashboard / funnel / cohort.

## Updating an event

Walk the decision tree before editing.

| Change                                                | Action                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Add an optional property                              | Edit the plan. Bump nothing. Existing consumers unaffected.                 |
| Add a required property                               | This is a **breaking change**. Bump to `_v2` (see below).                   |
| Rename an existing property                           | Breaking. Bump to `_v2`.                                                    |
| Change a property's type or allowed enum values        | Breaking. Bump to `_v2`.                                                    |
| Change *what* the event means                          | Breaking. Bump to `_v2`.                                                    |
| Change the sample rate                                 | Edit the plan. Note in the changelog so analysts know the curve shifts.    |
| Fix a typo in the description                          | Edit the plan. No code change.                                              |

**Never silently rename.**
Even if no consumer "should" be using the old name, something always is.

## The `_v2` migration

When you must break compatibility:

1. Add `<name>_v2` to the plan with the new schema.
2. Emit **both** events from the same callsite for the deprecation
   window:

   ```ts
   track({ name: 'order_completed', props: v1Props });
   track({ name: 'order_completed_v2', props: v2Props });
   ```

3. Migrate consumers (dashboards, dbt models, cohorts) to `_v2`.
4. Mark `order_completed` as `lifecycle: deprecated` with a sunset
   date.
5. On the sunset date: remove the v1 emit from code, mark plan entry
   `lifecycle: sunset`.

Typical deprecation window: **30 days minimum, 90 days for events
that feed exec dashboards**.

## Removing an event — the cleanup checklist

Run **all** of these before deleting any code.

### 1. Find the consumers

Search every place the event is read:

| Where                                       | How                                                                |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Dashboards (Mixpanel / Amplitude / PostHog)  | Each platform has a "find usage" or audit screen — use it.         |
| Funnels                                      | Same.                                                              |
| Cohorts                                      | Same.                                                              |
| Alerts                                       | Same.                                                              |
| Data warehouse / dbt models                  | `grep -r <event_name> models/` and `models/staging/stg_events*`.    |
| Reverse ETL syncs                            | Hightouch / Census destination definitions.                         |
| Annotations in product docs / runbooks       | Repo grep.                                                          |
| Code outside the wrapper                     | `grep -r "track\(['\"]order_completed" .`                          |

If any consumer is found, **stop** — migrate first, then return.

### 2. Mark the event deprecated

```yaml
# analytics/events/order_completed.yaml
name: order_completed
lifecycle: deprecated
sunset_date: 2026-07-01
deprecated_in_favor_of: order_completed_v2
```

### 3. Add a build-time warning

```ts
// codegen output, e.g.
/** @deprecated Use `order_completed_v2`. Sunset: 2026-07-01. */
order_completed: { /* ... */ };
```

TypeScript surfaces the `@deprecated` JSDoc as a lint warning at every
callsite.

### 4. Verify zero consumers

Re-run step 1.
Confirm: no dashboards, no dbt models, no alerts, no code references
outside the wrapper.

### 5. Remove code callsites

`grep -r "name:\s*['\"]<event_name>" .` and delete each one.
With a typed wrapper, deleting the union member surfaces every callsite
as a build error.

### 6. Remove from the plan

Move the entry to `analytics/events/_archive/`.
Do not delete the file outright — archive preserves the audit trail for
GDPR / SOC 2.

### 7. Communicate

Post in the team channel:

> ✂️ `order_completed` sunset on 2026-07-01.
> Replacement: `order_completed_v2`.
> Affected dashboards: revenue-overview (migrated 2026-06-15).

## Avoid the "rename without versioning" mistake

```text
# Bad — silent rename in the same PR
- name: order_completed
+ name: order.completed

# Good — explicit deprecation
  name: order_completed
  lifecycle: deprecated
  sunset_date: 2026-07-01
  deprecated_in_favor_of: order.completed

# (separate event file)
  name: order.completed
  lifecycle: proposed
```

## Never reuse a retired event name

Once `order_completed` has been retired, do not introduce a *new*
`order_completed` that means something different.
The old data is still in warehouses and will be merged with the new
data, corrupting both.

Use `order_completed_v2`, `order.completed`, or a fresh name.

## Property removal

The same lifecycle applies to individual properties.
Removing a required property is breaking; removing an optional property
without consumers is safe.

| Step                                                                                | Notes                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| Mark the property `lifecycle: deprecated` in the plan.                              | TypeScript surfaces the deprecation warning.       |
| Stop reading the property in downstream consumers.                                  | Same audit as step 1 above.                        |
| Stop sending the property in code.                                                  | Wrapper change.                                    |
| Remove from the plan.                                                                | Archive.                                           |

## Anti-patterns

- Deleting an event from the plan before the code emits — data keeps
  flowing into the destination with no schema record. Audit screams.
- Renaming in place. Always version.
- "We can't tell if anyone uses it, so let's just remove it." Run the
  consumer audit; if you genuinely can't tell, deprecate for a quarter
  instead.
- Skipping the `_archive/` step. The plan loses its history.
- Reusing a retired name. Old data + new data = corrupted reports.

## References

- [`tracking-plan.md`](./tracking-plan.md) — the plan structure.
- [`event-design.md`](./event-design.md) — naming and property rules.
- [Avo — Inspector issue types](https://www.avo.app/docs/inspector/issue-types-in-inspector)
- [Avo — Audit dbt package](https://www.avo.app/blog/avo-audit)
- [Burning Monk — Event versioning strategies](https://theburningmonk.com/2025/04/event-versioning-strategies-for-event-driven-architectures/)
