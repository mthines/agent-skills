// lib/analytics/index.ts
//
// Centralized analytics wrapper. The ONLY module that components import
// to track events. Swapping vendors is a single-file change in
// `lib/analytics/destinations.ts`.
//
// Companion files:
//   lib/analytics/events.ts          - typed event union (or codegen output)
//   lib/analytics/destinations.ts    - vendor SDK adapters
//   lib/analytics/server.ts          - server-side equivalent for Server Actions
//
// Replace `// TODO:` markers with project-specific values.

import type { AnalyticsEvent, UserProperties } from './events';
import { destinations } from './destinations';

// -------- Consent gate --------
// CMP (Cookiebot / OneTrust / custom) sets window.__consent on opt-in.
// Default state in EU is opt-out — see rules/pii-and-compliance.md.

declare global {
  interface Window {
    __consent?: { analytics: boolean; advertising: boolean };
  }
}

function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return window.__consent?.analytics === true;
}

// -------- Core API --------

export function track<E extends AnalyticsEvent>(event: E): void {
  if (typeof window === 'undefined') return;          // SSR no-op
  if (!hasAnalyticsConsent()) return;                 // consent gate

  for (const destination of destinations) {
    try {
      destination.track(event.name, event.props as Record<string, unknown>);
    } catch (err) {
      // Never let a destination failure crash the host app.
      // Log to console in dev only.
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(`[analytics] ${destination.name} failed`, err);
      }
    }
  }
}

export function identify(user: { id: string } & UserProperties): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;

  const { id, ...properties } = user;
  for (const destination of destinations) {
    try {
      destination.identify(id, properties);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(`[analytics] ${destination.name} identify failed`, err);
      }
    }
  }
}

export function group(group: { id: string; type: string } & Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;

  const { id, type, ...properties } = group;
  for (const destination of destinations) {
    try {
      destination.group?.(type, id, properties);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(`[analytics] ${destination.name} group failed`, err);
      }
    }
  }
}

export function reset(): void {
  for (const destination of destinations) {
    try {
      destination.reset();
    } catch {
      // ignore
    }
  }
}

// -------- React hooks (client only) --------

import { useEffect } from 'react';

/**
 * Fires `$pageview` once per route change.
 * In Next.js App Router, wrap the consumer in <Suspense> because
 * useSearchParams() bails out of static rendering otherwise.
 */
export function usePageView(route: string, hasQuery: boolean): void {
  useEffect(() => {
    track({
      name: '$pageview',
      props: { route, has_query: hasQuery },
    } as AnalyticsEvent);
  }, [route, hasQuery]);
}

/**
 * Mark a side-effect that should fire once per session, not per render.
 */
export function useTrackOncePerSession<E extends AnalyticsEvent>(event: E, key: string): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(`analytics:once:${key}`)) return;
    sessionStorage.setItem(`analytics:once:${key}`, '1');
    track(event);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// ============================================================================
// lib/analytics/events.ts                  (hand-written or codegen output)
// ============================================================================

export type UserProperties = {
  plan?: 'free' | 'pro' | 'enterprise';
  signup_date?: string;            // ISO-8601
  role?: 'owner' | 'admin' | 'member' | 'viewer';
};

export type AnalyticsEvent =
  | { name: '$pageview'; props: { route: string; has_query: boolean } }
  | { name: '$screen'; props: { path: string; has_params: boolean } }
  | { name: 'signed_up'; props: { plan: 'free' | 'pro' | 'enterprise'; referrer?: string } }
  | { name: 'subscription_started'; props: { plan_name: string; price_cents: number; currency: 'USD' | 'EUR' | 'GBP'; billing_period: 'monthly' | 'annual'; trial: boolean } }
  | { name: 'checkout_started'; props: { cart_id: string; cart_value_cents: number; currency: 'USD' | 'EUR' | 'GBP'; item_count: number } }
  | { name: 'order_completed'; props: { order_id: string; value_cents: number; currency: 'USD' | 'EUR' | 'GBP'; payment_method: 'card' | 'paypal' | 'bank' | 'gift_card'; item_count: number } }
  | { name: 'plan_upgraded'; props: { from_plan: string; to_plan: string; price_delta_cents: number; currency: 'USD' | 'EUR' | 'GBP' } }
  | { name: 'error_occurred'; props: { error_type: string; severity: 'info' | 'warn' | 'error' | 'fatal'; route?: string; screen?: string } }
  | { name: 'web_vital'; props: { metric: 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'; value_ms: number; rating: 'good' | 'needs-improvement' | 'poor'; route: string } }
  // Add new events here. Adding to this union is the source of truth —
  // the wrapper enforces every callsite at compile time.
  ;

// ============================================================================
// lib/analytics/destinations.ts            (vendor adapters)
// ============================================================================

export interface Destination {
  name: string;
  identify(userId: string, properties?: Record<string, unknown>): void;
  track(name: string, properties: Record<string, unknown>): void;
  group?(type: string, id: string, properties: Record<string, unknown>): void;
  reset(): void;
}

// --- Option A: Dash0 SDK Web (OTel-native) ---
// import { init, setUser, sendEvent, addAttributes } from '@dash0/sdk-web';
//
// init({
//   serviceName: process.env.NEXT_PUBLIC_SERVICE_NAME ?? 'web-app',
//   endpoint: {
//     url: process.env.NEXT_PUBLIC_OTLP_ENDPOINT!,
//     authToken: process.env.NEXT_PUBLIC_OTLP_AUTH_TOKEN!,   // ingest-only token
//   },
// });
//
// const dash0Destination: Destination = {
//   name: 'dash0',
//   identify(userId) { setUser({ id: userId }); },              // opaque only
//   track(name, props) { sendEvent(name, props); },
//   reset() { setUser({ id: null as unknown as string }); },     // adjust per SDK
// };

// --- Option B: PostHog ---
// import posthog from 'posthog-js';
//
// const posthogDestination: Destination = {
//   name: 'posthog',
//   identify(userId, properties) {
//     posthog.identify(userId, properties);
//   },
//   track(name, properties) {
//     posthog.capture(name, properties);
//   },
//   group(type, id, properties) {
//     posthog.group(type, id, properties);
//   },
//   reset() {
//     posthog.reset();
//   },
// };

// --- Option C: Segment ---
// import { AnalyticsBrowser } from '@segment/analytics-next';
// const analytics = AnalyticsBrowser.load({ writeKey: process.env.NEXT_PUBLIC_SEGMENT_KEY! });
//
// const segmentDestination: Destination = {
//   name: 'segment',
//   identify(userId, properties) { void analytics.identify(userId, properties); },
//   track(name, properties)      { void analytics.track(name, properties); },
//   group(type, id, properties)  { void analytics.group(id, { type, ...properties }); },
//   reset()                      { void analytics.reset(); },
// };

// Register the active destinations. Keep this list short.
export const destinations: Destination[] = [
  // dash0Destination,
  // posthogDestination,
];
