---
title: Platforms — Vendor Comparison for Web and Mobile RUM
impact: MEDIUM
tags:
  - reference
  - platforms
  - vendors
  - posthog
  - segment
  - dash0
---

# Platforms

A pragmatic comparison of the platforms that show up in 2026 RUM /
product-analytics decisions.
This is not a marketing scoreboard — pick by the column that matters
most to the project, not by feature count.

## Contents

- [Decision rubric](#decision-rubric)
- [Product analytics](#product-analytics)
- [RUM and APM](#rum-and-apm)
- [CDPs (Customer Data Platforms)](#cdps-customer-data-platforms)
- [OpenTelemetry-native](#opentelemetry-native)
- [Privacy-first analytics](#privacy-first-analytics)

---

## Decision rubric

| Question                                                  | Lean toward                                            |
| --------------------------------------------------------- | ------------------------------------------------------ |
| One product analytics tool, OSS preferred                  | PostHog                                                 |
| One product analytics tool, polished commercial             | Mixpanel / Amplitude                                   |
| Many destinations, vendor-neutral pipe                       | Segment / RudderStack                                  |
| Errors + perf + replay primary                              | Sentry                                                  |
| RUM tied to backend traces                                   | Datadog RUM                                            |
| Privacy-first, no consent banner                             | Plausible / Fathom                                     |
| OpenTelemetry-native, vendor-neutral                         | Dash0 / Honeycomb / Elastic EDOT / Embrace             |
| Marketing team owns the tool                                 | GA4 / Vercel Analytics                                 |
| Free tier matters most                                       | PostHog / Amplitude (Starter)                          |

---

## Product analytics

### PostHog

- OSS (Apache 2.0); self-host or cloud.
- Events + flags + session replay + error tracking + experiments in one
  SDK.
- Best free tier in 2026 (1 M events / month, replay, flags).
- Autocapture available but explicit tracking is the default
  recommendation.
- Reserved property prefix: `$`.
- React Native SDK is first-class.
- [posthog.com/docs](https://posthog.com/docs)

### Mixpanel

- Polished funnel / cohort UX.
- Naming convention: Object Action, Title Case, past tense
  (`Order Completed`).
- Strong Lexicon governance UI; Data Standards (March 2025) added
  inline naming/owner/screenshot enforcement.
- No native crash tracking — pair with Sentry on mobile.
- [docs.mixpanel.com](https://docs.mixpanel.com)

### Amplitude

- Deep behavioural cohorts; best AI Data Assistant (beta 2025).
- Naming: Object Action, Title Case.
- Govern for data governance; ranked recommendations on the data home.
- No native crash tracking.
- [docs.amplitude.com](https://amplitude.com/docs)

### Heap

- Autocapture-first.
- "Define events after the fact" model.
- Heap Govern for taxonomy management.
- [heap.io](https://www.heap.io/)

---

## RUM and APM

### Datadog RUM

- Full RUM: views, actions, resources, long tasks, errors, session
  replay.
- Tightly correlated with Datadog APM (backend trace IDs flow through).
- Expensive at scale; pricing per session.
- Sensitive Data Scanner scrubs PII on-stream.
- [docs.datadoghq.com/real_user_monitoring](https://docs.datadoghq.com/real_user_monitoring/)

### Sentry

- Errors + performance + session replay + profiling.
- Best-in-class crash + symbolication pipeline.
- React Native: full crash + JS errors + source maps + dSYMs via
  `@sentry/react-native/expo`.
- Not sufficient as your *only* analytics — pair with product analytics.
- [docs.sentry.io](https://docs.sentry.io/)

### New Relic Browser

- Full RUM, tied to NRDB.
- Strong query language (NRQL).
- Lighter-weight than Datadog at small scale.

### Dynatrace, AppDynamics

- Enterprise-only at this point; rarely the right choice for new
  projects.

---

## CDPs (Customer Data Platforms)

A CDP is a router: one stream, many destinations.
You still need a product analytics or RUM tool downstream.

### Segment

- The default CDP since 2018.
- Protocols for tracking-plan enforcement.
- Typewriter for typed wrappers.
- Acquired by Twilio (2020); pricing pressure has driven teams to
  RudderStack and others.
- [segment.com/docs](https://segment.com/docs)

### RudderStack

- OSS alternative; self-host or cloud.
- Tracking Plan API + RudderTyper codegen.
- Strong warehouse-first story.
- [rudderstack.com/docs](https://www.rudderstack.com/docs)

### mParticle

- Mobile-first heritage.
- Strong attribution / MMP integrations.
- Enterprise pricing.

---

## OpenTelemetry-native

These emit OTLP directly and live well with backend OTel.

### Dash0 SDK Web

- OSS browser SDK (`@dash0/sdk-web`).
- Sensible defaults: auto-instruments page load, fetch, sessions,
  errors.
- Designed for Dash0 but emits standard OTLP.
- Custom event API (`sendEvent`) + identify (`setUser`).
- For Next.js: use `instrumentation-client.js`.
- [github.com/dash0hq/dash0-sdk-web](https://github.com/dash0hq/dash0-sdk-web)

### OpenTelemetry JS (browser)

- Official upstream SDK; still marked experimental.
- Auto-instrumentations: document load, fetch, XHR, user interactions.
- More setup than vendor-managed SDKs.
- [opentelemetry.io/docs/languages/js/getting-started/browser](https://opentelemetry.io/docs/languages/js/getting-started/browser/)

### Honeycomb beacon

- OTel-native; opinionated for trace-centric observability.

### Elastic EDOT Browser

- Elastic's OTel browser distro.
- Strong out-of-box dashboards.
- [elastic.co/observability-labs/blog/edot-browser-rum](https://www.elastic.co/observability-labs/blog/edot-browser-rum)

### Embrace (mobile)

- React Native SDK fully OTel-based since 2024.
- Strong session-replay + crash story.
- [embrace.io](https://embrace.io)

### Splunk RUM React Native

- Beta as of mid-2026.
- OTel-based.

### `callstack/react-native-open-telemetry`

- Community RN OTel.
- Most active community RN OTel project.

---

## Privacy-first analytics

### Plausible

- Cookieless, no persistent IDs.
- GDPR-compliant by default; no consent banner needed.
- No events / funnels in the strict product-analytics sense — page
  views + custom goals.
- [plausible.io](https://plausible.io)

### Fathom

- Same general posture as Plausible.
- Cookieless, no PII.
- [usefathom.com](https://usefathom.com)

### Simple Analytics, Pirsch, GoatCounter

- Similar privacy-first lineup; pick on UX.

Trade-off: you give up rich behavioural cohorts in exchange for
compliance simplicity.
For most B2B SaaS with logged-in users, a richer tool with a consent
gate is the better choice.

---

## Marketing-team default

### GA4

- Free; ubiquitous.
- Weak for product analytics (event cardinality, funnel building).
- Mandatory custom event setup for anything non-trivial.
- Reserved event names list is strict — see `event-design.md`.

### Vercel Analytics / Speed Insights

- Zero-config Web Vitals + page views via `@vercel/analytics`.
- Custom events via `track()`; weak for funnels.
- Best paired with another tool for behavior.

---

## Comparison summary

| Concern                  | Product analytics                   | RUM / APM             | CDP                | OTel-native      |
| ------------------------ | ----------------------------------- | --------------------- | ------------------ | ---------------- |
| Free tier                | PostHog, Amplitude                  | Sentry (10k errors)    | RudderStack OSS    | Honeycomb 20M    |
| Best naming governance   | Mixpanel Data Standards, Amplitude  | n/a                    | Segment Protocols  | Dash0            |
| OSS                       | PostHog                              | Sentry                 | RudderStack         | OTel JS, Dash0 SDK |
| Mobile-first             | PostHog RN, Mixpanel RN, Amplitude  | Datadog RUM, Sentry RN | Segment RN         | Embrace          |
| Backend correlation      | weak                                 | Datadog (strongest)    | medium             | strong            |
| Session replay            | PostHog, Datadog, Sentry, Mixpanel  | Datadog, Sentry        | n/a                | Dash0 (roadmap)   |
| Cost at scale            | PostHog OSS cheapest                 | Datadog most expensive | RudderStack OSS    | varies           |

## References

- [PostHog vs Mixpanel](https://posthog.com/blog/posthog-vs-mixpanel)
- [Segment vs RudderStack](https://www.rudderstack.com/blog/segment-vs-rudderstack/)
- [Amplitude — best analytics tools for Next.js 2026](https://amplitude.com/compare/best-analytics-tools-nextjs)
- [Dash0 — Website monitoring with OpenTelemetry](https://www.dash0.com/guides/website-monitoring-with-opentelemetry-and-dash0)
- [Embrace OTel React Native](https://embrace.io/blog/embrace-react-native-sdk-now-fully-built-on-opentelemetry/)
