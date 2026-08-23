# Frontend RUM (thin pointer)

Applies to any `web` or `mobile` classification from
[`scope-detection.md`](./scope-detection.md).

This skill does not design frontend analytics events — that is
[`rum-tracking`](../../../analysis/rum-tracking/SKILL.md)'s job in full
(event naming, property schema, PII gate, centralized wrapper, tracking
plan). This rule file only covers the two things `rum-tracking` does not
own: **deciding whether this specific change needs an event**, and folding
the result into the shared regression-signal check.

## Step 1: Decide if this change needs a RUM event

A change needs at least one new or updated tracking event when it:

- Introduces a new user-facing flow, screen, or action (a button, form
  submission, navigation, or feature toggle a user can trigger).
- Changes the success/failure outcome of an existing tracked flow (e.g. adds
  a new failure branch to checkout).
- Adds a new client-side error boundary or a code path that can throw in the
  browser/app without an existing crash-reporting hook already covering it.

A change does **not** need a new event when it's a pure visual/style change
with no new interaction, an internal refactor with no observable behavior
change, or a change to a flow that's already fully covered by an existing
event (verify via `rum-tracking`'s tracking plan, not by assumption).

## Step 2: Delegate

```
Skill("rum-tracking", "implement", "<target>")
```

State the decision from Step 1 explicitly before delegating — the
delegation call should read as "this flow needs tracking, `rum-tracking`
owns the how," never a blind hand-off.

## Step 3: Web Vitals / performance regressions (not `rum-tracking`'s job)

For `web` changes, also confirm the change doesn't regress Core Web Vitals
observability itself: if the project's RUM SDK (Dash0 SDK Web, OTel browser,
or equivalent) reports LCP/CLS/INP, a new component should not opt out of it
(e.g. by mounting outside the instrumented root, or suppressing the SDK's
error/performance observer). This is an omission check, not new
instrumentation to write — flag it in `audit` mode if found.

## Step 4: Feed the shared regression-signal check

Whatever event(s) `rum-tracking` implements or confirms already exist, name
the regression detector per
[`regression-signals.md`](./regression-signals.md) — an event with no
funnel, dashboard, or alert watching it is not yet a regression signal.
