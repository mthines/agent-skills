---
title: Implementation — Web (React, Next.js App Router)
impact: HIGH
tags:
  - react
  - nextjs
  - app-router
  - implementation
  - typescript
---

# Implementation — Web

Every tracking call goes through one centralized wrapper.
Components import `track()`, `identify()`, and `usePageView()` — never
the vendor SDK directly.

The wrapper template lives in
[`templates/analytics-wrapper.template.ts`](../templates/analytics-wrapper.template.ts).
Copy it into the project and adapt the destination layer.

## Contents

- [Architecture](#architecture)
- [Type-safe events](#type-safe-events)
- [The wrapper](#the-wrapper)
- [Page-view tracking (App Router)](#page-view-tracking-app-router)
- [Server-side tracking (Server Actions)](#server-side-tracking-server-actions)
- [SDK initialization](#sdk-initialization)
- [Web Vitals](#web-vitals)
- [Error tracking](#error-tracking)
- [OpenTelemetry path (Dash0 / OTel JS)](#opentelemetry-path-dash0--otel-js)
- [Performance budget](#performance-budget)
- [Anti-patterns](#anti-patterns)

## Architecture

```text
features/billing/Checkout.tsx
        │
        ▼
lib/analytics/index.ts          ← typed track() / identify() / usePageView()
        │
        ▼
lib/analytics/destinations.ts   ← PostHog / Segment / Dash0 / OTel
        │
        ▼
vendor SDK
```

Three rules:

1. Components import **only** from `lib/analytics/index.ts`.
2. The destination layer is **the only place** that holds vendor SDK
   keys, init code, or `posthog.capture` / `mixpanel.track` calls.
3. Swapping vendors must be a single-file change.

## Type-safe events

Define every event as a discriminated union (small apps) or generate
from the tracking plan (Avo, RudderTyper, Typewriter, hand-rolled).

```ts
// lib/analytics/events.ts
export type AnalyticsEvent =
  | { name: 'signed_up'; props: { plan: 'free' | 'pro' | 'enterprise'; referrer?: string } }
  | { name: 'checkout_started'; props: { cart_value_cents: number; currency: 'USD' | 'EUR' | 'GBP'; item_count: number } }
  | { name: 'order_completed'; props: { order_id: string; value_cents: number; currency: 'USD' | 'EUR' | 'GBP'; payment_method: 'card' | 'paypal' | 'bank' } }
  | { name: 'plan_upgraded'; props: { from_plan: string; to_plan: string; price_delta_cents: number; currency: 'USD' | 'EUR' | 'GBP' } };
```

Renaming `cart_value_cents` to `cart_value` now fails the build at
every call site.

## The wrapper

```ts
// lib/analytics/index.ts
import type { AnalyticsEvent } from './events';
import { destinations } from './destinations';

export function track<E extends AnalyticsEvent>(event: E): void {
  if (typeof window === 'undefined') return;       // SSR no-op
  if (!hasConsent()) return;                        // consent gate
  destinations.forEach((d) => d.track(event.name, event.props));
}

export function identify(user: { id: string; plan?: string; signup_date?: string }): void {
  if (typeof window === 'undefined') return;
  if (!hasConsent()) return;
  destinations.forEach((d) => d.identify(user.id, { plan: user.plan, signup_date: user.signup_date }));
}

export function reset(): void {
  destinations.forEach((d) => d.reset());
}

function hasConsent(): boolean {
  return (window as Window & { __consent?: { analytics: boolean } }).__consent?.analytics === true;
}
```

`hasConsent()` is the canonical PII gate.
The CMP (Cookiebot, OneTrust, custom) writes `window.__consent` after
the user grants permission.
See [`pii-and-compliance.md`](./pii-and-compliance.md) for the consent
flow.

## Page-view tracking (App Router)

Next.js App Router requires a `<Suspense>` boundary around any client
component that reads `useSearchParams()` — otherwise the entire route
bails out of static rendering.

```tsx
// app/_analytics/page-view.tsx
'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { track } from '@/lib/analytics';

function PageViewInner() {
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    track({
      name: '$pageview',
      props: {
        route: pathname,
        has_query: params.toString().length > 0,
      },
    });
  }, [pathname, params]);

  return null;
}

export function PageView() {
  return (
    <Suspense fallback={null}>
      <PageViewInner />
    </Suspense>
  );
}
```

Mount `<PageView />` in `app/layout.tsx`.
Pass `route: pathname` and `has_query: boolean` only — **never** the raw
`params.toString()`, because that can contain reset tokens, OAuth
state, and email addresses.

## Server-side tracking (Server Actions)

Conversion events (signup, payment, subscription change) must fire from
the server because client tracking is blocked by ~30 % of users in 2026
(ad blockers + privacy extensions).

```ts
// app/actions/signup.ts
'use server';

import { track } from '@/lib/analytics/server';

export async function completeSignup(formData: FormData) {
  const user = await createUser(formData);
  await track({
    name: 'signed_up',
    user_id: user.id,
    props: { plan: user.plan, referrer: formData.get('referrer')?.toString() },
  });
  return user;
}
```

The server wrapper (`lib/analytics/server.ts`) talks to the same
destinations using their HTTP / Node SDK, with the auth secret in
`process.env` — never `NEXT_PUBLIC_*`.

## SDK initialization

Load the SDK after the LCP candidate to avoid hurting Largest
Contentful Paint.

```tsx
// app/_analytics/init.tsx
'use client';

import Script from 'next/script';

export function AnalyticsInit() {
  return (
    <Script
      id="analytics-init"
      strategy="afterInteractive"          // not beforeInteractive
      src="/scripts/analytics.js"          // self-hosted; first-party
    />
  );
}
```

Self-host the SDK on your own domain so ad blockers (which target
`*.posthog.com`, `*.mixpanel.com`, `*.segment.io`) cannot block it.
The CMP and consent state should still apply.

## Web Vitals

```tsx
// app/_analytics/vitals.tsx
'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { track } from '@/lib/analytics';

export function WebVitals() {
  useReportWebVitals(({ name, value, id, rating }) => {
    track({
      name: 'web_vital',
      props: {
        metric: name,                    // LCP / INP / CLS / TTFB / FCP
        value_ms: Math.round(value),
        rating,                          // good / needs-improvement / poor
        nav_id: id,
      },
    });
  });
  return null;
}
```

INP replaced FID in March 2024.
If a project still tracks FID, deprecate it via
[`update-and-remove.md`](./update-and-remove.md).

## Error tracking

Wire a single boundary that pipes JS errors and unhandled rejections to
the analytics wrapper, then to Sentry / Datadog / OTel exception logs.

```tsx
// app/global-error.tsx
'use client';

import { track } from '@/lib/analytics';

export default function GlobalError({ error }: { error: Error }) {
  track({
    name: 'error_occurred',
    props: {
      error_type: error.name,
      message: sanitizeMessage(error.message),    // strip user input
      severity: 'fatal',
    },
  });
  return <html><body>Something went wrong</body></html>;
}
```

`sanitizeMessage` must strip emails, tokens, and any free-text input —
see [`pii-and-compliance.md`](./pii-and-compliance.md).

## OpenTelemetry path (Dash0 / OTel JS)

If the project uses OTel directly instead of (or alongside) a product
analytics vendor:

```ts
// lib/analytics/destinations/dash0.ts
import { init, setUser, sendEvent, addAttributes } from '@dash0/sdk-web';

init({
  serviceName: 'web-shop-frontend',
  endpoint: {
    url: process.env.NEXT_PUBLIC_OTLP_ENDPOINT!,
    authToken: process.env.NEXT_PUBLIC_OTLP_AUTH_TOKEN!,    // ingest-only token, dataset-scoped
  },
});

export const dash0Destination = {
  identify(userId: string) {
    setUser({ id: userId });
  },
  track(name: string, props: Record<string, unknown>) {
    sendEvent(name, props);
  },
  setContext(attrs: Record<string, string>) {
    addAttributes(attrs);
  },
};
```

See [`otel-conventions.md`](./otel-conventions.md) for span / attribute
rules, and the
[`otel-instrumentation/rules/sdks/browser.md`](https://github.com/dash0hq/agent-skills)
file for full SDK setup including the OTel JS option.

## Performance budget

| Concern                                | Budget                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| Analytics bundle gzipped               | ≤ 20 KB initial                                            |
| SDK init time                          | After LCP candidate                                       |
| Per-event payload                       | < 1 KB                                                    |
| Flush cadence                            | 10 s or unload                                            |
| Beacon on unload                         | `navigator.sendBeacon()` — `fetch({ keepalive: true })` as fallback |

## Anti-patterns

- `posthog.capture()` / `mixpanel.track()` called from a feature
  component.
  **Fix:** add the event to the type union and route through the wrapper.
- Reading `useSearchParams()` outside a `<Suspense>` boundary.
  **Fix:** wrap the page-view component.
- Putting the SDK key in `NEXT_PUBLIC_*` for a server-side ingest token.
  **Fix:** server-side tokens live in regular `process.env`.
- Calling `track()` in render — fires once per render.
  **Fix:** `useEffect(() => track(...), [deps])`.
- Trying to read `window.location.href` and sending it as `url`.
  **Fix:** send `pathname` only and gate query strings.

## References

- [Next.js — `useReportWebVitals`](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)
- [PostHog — Next.js](https://posthog.com/docs/libraries/next-js)
- [Vercel — Custom events for Analytics](https://vercel.com/docs/analytics/custom-events)
- [Segment — Typewriter](https://github.com/segmentio/typewriter)
- [Avo Codegen — TypeScript](https://www.avo.app/docs/reference/avo-codegen/programming-languages/typescript)
- [`otel-instrumentation/rules/sdks/browser.md`](https://github.com/dash0hq/agent-skills)
- [`otel-instrumentation/rules/sdks/nextjs.md`](https://github.com/dash0hq/agent-skills)
