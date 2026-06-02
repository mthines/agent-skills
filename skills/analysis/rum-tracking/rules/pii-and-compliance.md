---
title: PII and Compliance — Privacy Rules for Event Tracking
impact: CRITICAL
tags:
  - pii
  - privacy
  - gdpr
  - ccpa
  - dpdpa
  - consent
  - sensitive-data
---

# PII and Compliance

PII that lands in event properties is hard to remove.
Most analytics platforms replicate it across regions and downstream
warehouses within minutes.
Block PII at the source — at the call site, in the wrapper, and again in
the Collector as defence in depth.

This rule aligns with the
[`otel-instrumentation` sensitive-data rules](../../otel-instrumentation/rules/sensitive-data.md);
when in doubt, that rule's `Never-instrument list` wins.

## The never-track list

These never appear in event properties, span attributes, log bodies,
session-replay text, or error messages.
No exceptions, even when the user "just needs it for one analysis".

| Category                       | Examples                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Auth secrets                   | Passwords, API keys, bearer tokens, OAuth secrets, session cookies, reset tokens      |
| Financial instruments          | Full card number (PAN), CVV, expiry, IBAN, full bank account number                   |
| Government identifiers         | SSN, passport, driver's license, tax ID, national ID                                  |
| Health & biometrics            | Diagnoses, prescriptions, fingerprints, face vectors                                   |
| GDPR Art. 9 special category   | Race, ethnicity, religion, political views, sexual orientation, union membership      |
| Children's data without consent | Any identifier for a user known to be under 13 (US) / 18 (India, depending on regime) |
| Authorization / Cookie headers | Verbatim values                                                                        |

If the user insists on storing one of these, propose hashing or
truncating — and surface the regulatory risk in plain terms.

## High-risk fields — evaluate before sending

These are useful but easy to misuse.
Evaluate each against the project's compliance posture before adding.

| Field                                | Permitted on            | Condition                                                                                                       |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `user.id` / `enduser.id`             | events, spans, logs     | **Only opaque** (UUID / internal ID). Never email, username, or anything human-readable.                         |
| IP address (`client.address`)        | spans, logs              | Only if needed for abuse / geo. Truncate to /24 (IPv4) or drop entirely. Truncation is not full anonymization.   |
| Email                                | **Never** as attribute  | Use opaque `user.id`. For destination match-keys, HMAC with a per-tenant salt and store the mapping outside telemetry. |
| `url.full` / `$current_url`          | events, spans            | Strip query params (`?token=`, `?reset=`, `?email=`, `?api_key=`). Keep path + route.                            |
| Request / response bodies            | **Never** as attribute  | Log a content hash + size only. Bodies are user input — could contain anything.                                  |
| `exception.message`                  | spans, logs              | Sanitize before sending — exception messages routinely embed user input ("invalid email alice@example.com").     |
| Free-text feedback fields            | **Never** raw            | Scan for PII patterns + truncate, or drop entirely. Capture in a scrubbed feedback store.                        |
| Search query                          | sometimes                | Drop or hash. Track `search_submitted` with `query_length` + `result_count` only.                                |
| Form field values on submit          | **Never**                | Track `form_submitted` with a bounded `form_id` + `success` boolean.                                              |
| Device IDs (IDFA / GAID)             | iOS / Android            | iOS only after `requestTrackingPermissionsAsync()` returns `granted`. Never store linked to user identity.        |

## Compliance regime cheatsheet

| Regime                          | Scope               | Consent model                       | Key implication for tracking                                                |
| ------------------------------- | ------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| **GDPR** (EU)                   | EU residents        | Opt-in (Art. 6 lawful basis)        | Right to erasure (Art. 17), data portability (Art. 20). Hashing ≠ anonymization. |
| **CCPA / CPRA** (California)    | CA residents        | Opt-out + honour Global Privacy Control (GPC) | "Sale / Share" disclosure, right to delete, do-not-sell flag.       |
| **DPDPA** (India, 2023, rules Nov 2025) | India residents | Opt-in; under-18 = child       | No behavioural tracking of minors.                                            |
| **LGPD** (Brazil)               | BR residents        | Opt-in, 10 lawful bases             | DPIA for biometrics, children, or large-scale processing.                    |
| **COPPA** (US, < 13)            | US children          | Verifiable parental consent         | No behavioural advertising. Most platforms have a children's-app mode.       |
| **HIPAA** (US health)           | PHI                  | Authorization + Business Associate Agreement | No PHI in analytics without a BAA.                                  |
| **ePrivacy / EU cookies**       | EU                   | Prior opt-in before non-essential cookies | Cover fingerprinting too (EDPB Guidelines 2/2023).                    |
| **IAB TCF v2.3**                | EU industry          | TC-string consent signals           | Required for adtech destinations.                                            |

GDPR fines: up to **€20M or 4 % global revenue**.
CCPA: **$2,500 per violation, $7,500 if intentional**.

## Patterns

### Opaque user IDs

```ts
// Bad
identify(user.email);

// Bad
identify({ user_id: user.email });

// Good
identify({ user_id: user.id });   // internal UUID
```

### HMAC for destination match-keys

When a downstream destination (an ad pixel, an email-match audience)
needs an email to join on, HMAC with a per-tenant salt — never raw, never
plain SHA-256.

```ts
import { createHmac } from 'node:crypto';

function emailMatchKey(email: string): string {
  return createHmac('sha256', process.env.TELEMETRY_HASH_KEY!)
    .update(email.trim().toLowerCase())
    .digest('hex');
}

// Used server-side, never client-side
track('user_signed_up', { user_id: user.id, email_match_key: emailMatchKey(user.email) });
```

Store the salt → user mapping **outside** the observability backend.

### URL sanitization

```ts
const SENSITIVE_PARAMS = ['token', 'api_key', 'session', 'reset', 'email', 'code'];

export function safeUrl(href: string): { route: string; query: Record<string, string> } {
  const u = new URL(href);
  for (const k of SENSITIVE_PARAMS) u.searchParams.delete(k);
  return { route: u.pathname, query: Object.fromEntries(u.searchParams) };
}
```

In OTel, run a `SpanProcessor` that does the same on `url.full` and
`http.request.header.*` — see the `otel-instrumentation` skill's
[sensitive-data rule](../../otel-instrumentation/rules/sensitive-data.md).

### Exception messages

```ts
// Bad — echoes user input
captureException({ message: `Invalid email: ${form.email}` });

// Good — describes the error class only
captureException({ message: 'ValidationError: invalid email format', error_type: 'ValidationError' });
```

### Consent gate (mandatory order)

```ts
// 1. Page loads with ZERO analytics scripts firing.
// 2. CMP shows; default state is OPT-OUT for GDPR regions.
// 3. On opt-in, initialize SDK with consent flags.
// 4. Honour GPC header / DNT in CCPA jurisdictions.

if (consent.status !== 'granted') return;
await analytics.init({
  consent: {
    advertising: consent.purposes.advertising === 'granted',
    measurement: consent.purposes.measurement === 'granted',
  },
});
```

**Verify**: open a private window, reject all cookies, and confirm the
Network tab shows **zero** calls to `posthog.com`, `mixpanel.com`,
`segment.io`, `amplitude.com`, or any custom OTel endpoint.

### Deletion APIs (wire to the user-delete flow)

| Platform   | Endpoint                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| Segment    | `POST /v1/workspaces/{workspace}/regulations` (`SUPPRESS_WITH_DELETE`)                                  |
| PostHog    | `POST /api/projects/{id}/persons/{id}/delete_events/`                                                   |
| Mixpanel   | `POST https://mixpanel.com/api/app/data-deletions/v3.0/`                                                 |
| Amplitude  | `POST https://amplitude.com/api/2/deletions/users`                                                       |
| Dash0      | OTel-based — delete via the dataset retention policy + the project's user-deletion job.                 |

Trigger every relevant vendor's deletion when a user invokes Art. 17 /
CCPA delete.
Track the deletion call itself with `user_deleted` (server-side only).

## Top developer mistakes (checklist)

- [ ] `distinct_id = user.email` "for convenience"
- [ ] `track('signup', { email, password })` — never store any password field
- [ ] `window.location.href` verbatim — strip query params first
- [ ] `track('form_submitted', { ...form })` spread
- [ ] Autocapture on `/account`, `/billing`, `/health` without route blocklist
- [ ] Session replay enabled with no `data-private` / `ph-no-capture` mask on inputs
- [ ] `Sentry.captureException(e)` echoing user input in `e.message`
- [ ] `console.log(user)` reaching the RUM log capture
- [ ] Tracking children without an age gate or consent
- [ ] Storing hashed email and calling it anonymous (it isn't under GDPR)
- [ ] Forgetting that `referrer` leaks the previous app's URL incl. tokens

## References

- [`otel-instrumentation` — sensitive data rules](../../otel-instrumentation/rules/sensitive-data.md)
- [GDPR Art. 9 — Special categories](https://gdpr-text.com/read/article-9/)
- [EDPB Guidelines 2/2023 on cookies and fingerprinting](https://edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy_en)
- [PostHog — Privacy & Compliance](https://posthog.com/docs/privacy)
- [Datadog RUM — Data security](https://docs.datadoghq.com/data_security/real_user_monitoring/)
- [IAB TCF v2.3 — mandatory 28 Feb 2026](https://iabeurope.eu/transparency-consent-framework/)
- [India DPDPA — 2023 + 2025 rules](https://www.meity.gov.in/data-protection-framework)
