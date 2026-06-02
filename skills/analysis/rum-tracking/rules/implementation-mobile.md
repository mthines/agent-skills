---
title: Implementation — Mobile (React Native, Expo)
impact: HIGH
tags:
  - react-native
  - expo
  - mobile
  - implementation
  - typescript
---

# Implementation — Mobile

Mobile tracking layers on top of the web wrapper pattern (one
centralized module, typed events) and adds three mobile-only concerns:
**lifecycle**, **offline queue**, and **platform consent** (App
Tracking Transparency, Apple Privacy Manifest, Google Play Data Safety).

## Contents

- [Architecture](#architecture)
- [SDK init (Expo)](#sdk-init-expo)
- [Screen views (Expo Router)](#screen-views-expo-router)
- [App lifecycle](#app-lifecycle)
- [Deep links](#deep-links)
- [Offline queue](#offline-queue)
- [iOS — App Tracking Transparency](#ios--app-tracking-transparency)
- [iOS — Privacy Manifest](#ios--privacy-manifest)
- [Android — Data Safety form](#android--data-safety-form)
- [Crash + error tracking](#crash--error-tracking)
- [Vendor SDK options](#vendor-sdk-options-1-liner-each)
- [Anti-patterns](#anti-patterns)

## Architecture

```text
features/Checkout.tsx
        │
        ▼
lib/analytics/index.ts          ← typed track() / identify() / useScreenView()
        │
        ▼
lib/analytics/destinations.ts   ← PostHog RN / Segment RN / Datadog / Sentry / OTel
        │
        ▼
vendor SDK
        │
        ▼
offline-queue (AsyncStorage / SQLite) ── flush on network ──► destination
```

Reuse the typed event union from
[`implementation-web.md`](./implementation-web.md) — events should be
**identical** across web and mobile so cross-platform funnels work.

## SDK init (Expo)

```ts
// lib/analytics/init.ts
import { init } from '@dash0/sdk-web';                // or PostHog / Segment / Sentry RN

export function initAnalytics() {
  init({
    serviceName: 'app-shop-mobile',
    endpoint: {
      url: process.env.EXPO_PUBLIC_OTLP_ENDPOINT!,
      authToken: process.env.EXPO_PUBLIC_OTLP_AUTH_TOKEN!,
    },
  });
}
```

`EXPO_PUBLIC_*` is read at build time by EAS Build and frozen into the
bundle.
**OTA updates can ship new event names but cannot change the endpoint
or auth token.**
For per-env switching, use EAS Build profiles (`eas.json` `env` blocks).

## Screen views (Expo Router)

```ts
// hooks/useScreenView.ts
import { useEffect } from 'react';
import { usePathname, useGlobalSearchParams } from 'expo-router';
import { track } from '@/lib/analytics';

export function useScreenView() {
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    track({
      name: '$screen',
      props: {
        path: pathname,
        has_params: Object.keys(params).length > 0,
      },
    });
  }, [pathname]);
}
```

Mount once at the root layout (`app/_layout.tsx`).
`useGlobalSearchParams` updates even when the route is unfocused —
that's the right hook for screen tracking.

**Strip params before sending** — deep links commonly carry tokens
(`?reset=…`, `?code=…`).
Send `has_params: boolean` and let analysts re-derive intent from the
flow, not the raw token.

## App lifecycle

```ts
// lib/analytics/lifecycle.ts
import { AppState, AppStateStatus } from 'react-native';
import { track } from '@/lib/analytics';

let last: AppStateStatus = 'active';

AppState.addEventListener('change', (next) => {
  if (last === next) return;

  if (next === 'active' && last !== 'active') {
    track({ name: 'app_foregrounded', props: {} });
  }
  if (next === 'background') {
    track({ name: 'app_backgrounded', props: {} });
    // good moment to flush the queue
  }

  last = next;
});
```

Also capture **cold vs warm start**: timestamp the module load, then
compare against the first `active` state.

## Deep links

```ts
import * as Linking from 'expo-linking';
import { track } from '@/lib/analytics';

Linking.addEventListener('url', ({ url }) => {
  const { hostname, path } = Linking.parse(url);
  track({
    name: 'deep_link_opened',
    props: {
      host: hostname ?? 'app',
      path: path ?? '/',
      // never the raw query string
    },
  });
});
```

## Offline queue

Mobile networks drop.
A naive `fetch()` in `track()` loses events.
The wrapper writes to a local outbox; a background flusher drains it
when the network is up.

```ts
// lib/analytics/offline-queue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const QUEUE_KEY = 'analytics:q';
const MAX_QUEUE_LENGTH = 1000;            // ~1 MB AsyncStorage budget

export async function enqueue(event: { name: string; props: Record<string, unknown>; ts: string }) {
  const raw = (await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]';
  const queue = JSON.parse(raw) as typeof event[];
  queue.push(event);
  if (queue.length > MAX_QUEUE_LENGTH) queue.shift();
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

NetInfo.addEventListener((state) => {
  if (state.isConnected) flush();
});

async function flush() {
  const raw = (await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]';
  const queue = JSON.parse(raw) as { name: string; props: Record<string, unknown>; ts: string }[];
  // send in batches, drop on 2xx, retry-with-backoff on failures
}
```

For apps that push > 1,000 events / session, switch to SQLite for the
outbox — transactional drains avoid duplicate sends on crash.

## iOS — App Tracking Transparency

Gate any IDFA-dependent destination behind `expo-tracking-transparency`.

```ts
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';

export async function requestAdvertisingConsent() {
  const { status } = await requestTrackingPermissionsAsync();
  if (status === 'granted') {
    await analytics.enableAdvertisingId();
  } else {
    await analytics.disableAdvertisingId();
  }
}
```

Call **before** initializing any SDK that wants IDFA.
A denied response yields a zero IDFA — most SDKs treat that as
anonymous correctly.

## iOS — Privacy Manifest

`PrivacyInfo.xcprivacy` declares every Required Reasons API the app or
any statically linked SDK uses.
Mandatory for App Store submissions since 2024.

Common entries triggered by analytics SDKs:

- `NSUserDefaults` (CA92.1)
- File timestamp APIs (C617.1)
- System boot time (35F9.1)
- Disk space (E174.1)

Each vendor SDK should ship its own privacy manifest.
Verify with EAS Build's privacy-manifest aggregation step.

## Android — Data Safety form

Google Play requires a Data Safety form per app declaring what data is
collected and shared, why, and whether it's encrypted in transit.
The form must match what the SDK actually sends — vendors publish
templates (PostHog, Mixpanel, Firebase, Sentry).

## Crash + error tracking

Native crashes and JS errors are different pipelines.
Most teams use one of:

| Stack                             | Native (iOS/Android crashes) | JS errors           | Source maps / dSYMs upload      |
| --------------------------------- | ---------------------------- | ------------------- | ------------------------------- |
| Sentry React Native               | Sentry                       | Sentry              | EAS Build plugin                 |
| Datadog Mobile RUM                | Datadog                      | Datadog             | EAS Build / Fastlane            |
| PostHog RN (error tracking)       | Native bridge                | PostHog             | manual                          |
| OTel + Embrace                     | Embrace                      | OTel logs            | manual                           |

For Sentry RN with Expo, the `@sentry/react-native/expo` plugin
auto-uploads source maps + dSYMs in the EAS Build pipeline.

## Vendor SDK options (1-liner each)

| SDK                              | Strength                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| PostHog React Native             | OSS all-in-one (events + flags + replay + error tracking).                |
| Segment Analytics RN             | Vendor-neutral CDP. Best for many destinations.                            |
| Mixpanel RN                      | Polished product analytics. No native crash tracking — pair with Sentry. |
| Amplitude RN                     | Deep cohorts. No error tracking.                                          |
| Datadog Mobile RUM               | Full RUM + backend trace correlation. Expensive at scale.                 |
| Sentry React Native              | Best-in-class crashes + perf + sessions.                                  |
| Firebase Analytics                | Free, GA4-shaped.                                                          |
| Adjust / AppsFlyer                | Attribution-first.                                                         |
| Embrace                          | OTel-native; full RUM + error tracking.                                    |
| `callstack/react-native-open-telemetry` | Community OTel RN. Growing.                                       |

See [`references/platforms.md`](../references/platforms.md) for a
deeper comparison.

## Anti-patterns

- Skipping the offline queue.
  **Fix:** any tracking that doesn't queue loses ~5–15 % of events to
  flaky networks.
- Initializing the SDK *before* ATT consent on iOS.
  **Fix:** init after consent (or with `enableAdvertisingId: false` and
  toggle after).
- Putting `EXPO_PUBLIC_OTLP_AUTH_TOKEN` with admin scope in the bundle.
  **Fix:** ingest-only, dataset-scoped tokens (see Dash0 docs).
- Tracking the raw deep-link URL with query string.
  **Fix:** parse it; send `host` + `path` only.
- Not symbolicating crashes — stack traces become useless after one
  release.
  **Fix:** wire dSYM / mapping upload into the EAS Build pipeline.

## References

- [Expo Router — Screen tracking](https://docs.expo.dev/router/reference/screen-tracking/)
- [Expo — Privacy Manifests](https://docs.expo.dev/guides/apple-privacy/)
- [Expo — Tracking Transparency](https://docs.expo.dev/versions/latest/sdk/tracking-transparency/)
- [React Native — AppState](https://reactnative.dev/docs/appstate)
- [PostHog React Native](https://posthog.com/docs/libraries/react-native)
- [Sentry React Native](https://docs.sentry.io/platforms/react-native/)
- [Embrace OTel React Native](https://embrace.io/blog/embrace-react-native-sdk-now-fully-built-on-opentelemetry/)
