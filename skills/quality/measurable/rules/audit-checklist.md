# Audit Checklist

Used standalone (`/measurable audit`) and as the
`autonomous-workflow` Phase 4 gate (see the workflow's
[Observability Gate](../../../workflow/autonomous-workflow/rules/phase-4-testing.md#observability-gate)
trigger). Read-only — never mutates files in this mode.

Walk every changed path in the diff (or the given target) against:

- [ ] **Classified.** Every changed path has a classification from
      [`scope-detection.md`](./scope-detection.md) (read the Observability
      Profile first if one exists).
- [ ] **Backend/API coverage.** Every new or changed endpoint/handler/job
      entry point (`api`, `worker`) has: a span, correct span status on the
      failure path, and a structured error/warn log —
      [`backend-instrumentation.md`](./backend-instrumentation.md).
- [ ] **RED metric where warranted.** Hot-path operations have a request /
      error / duration signal, reusing an existing series rather than a
      near-duplicate.
- [ ] **Frontend coverage.** Every new user-facing flow (`web`, `mobile`)
      has a tracking event, or an explicit, cited reason it doesn't need one
      — [`frontend-rum.md`](./frontend-rum.md).
- [ ] **No silent failure.** No `catch {}` (or language equivalent) that
      swallows an exception without a log at `error`/`warn` severity and,
      for a traced operation, a span status flip —
      [`regression-signals.md`](./regression-signals.md).
- [ ] **No manufactured noise.** Expected/handled rejections (validation,
      expected 4xx) are not logged at `error` severity or flagged as span
      errors — this would desensitize error-rate-based regression
      detection.
- [ ] **Regression detector named.** For every signal in the diff, Question
      3 of [`regression-signals.md`](./regression-signals.md) has an
      answer — an existing dashboard/alert, or an explicit propose-via-Dash0
      note. Ungraded signals are `unlinked`, not `pass`.
- [ ] **Cardinality sanity.** No new metric label or span attribute carries
      unbounded values (raw user id, full URL, free-text) that would break
      the metric backend.
- [ ] **Registry conformance** — *only when the Observability Profile names a
      Weaver registry*. Every signal name the diff adds is defined in the
      registry, and no name it renames, deprecates, or removes leaves a
      consumer unaccounted for —
      [`weaver-schema.md`](./weaver-schema.md). Grade the result with the
      same three verdicts; Weaver never introduces a fourth.

The registry row is skipped entirely, with no finding and no note, when no
profile exists or the profile records no registry. "This repo should adopt
Weaver" is not an audit finding about this diff.

## Output format

```markdown
### Observability Coverage Audit

**Missing (blocking only under `--strict`):**
- `src/api/checkout.ts:42` — new `POST /checkout` handler has no span, no
  error log on the `PaymentDeclined` branch.
- `model/checkout.yaml:7` — `weaver registry diff` reports
  `acme.checkout.latency` → `acme.checkout.duration` as `renamed`; the
  `checkout-latency` check rule still queries the old name.

**Unlinked (advisory):**
- `src/components/UpsellBanner.tsx:18` — `upsell_shown` event added, but no
  dashboard/funnel currently reads it.
- `model/checkout.yaml:11` — `acme.checkout.duration` is in the registry and
  emitted, but nothing queries it yet.

**Pass:**
- `src/api/orders.ts` — span, RED metric, error log, and existing
  `orders-error-rate` check rule all present.
```

**Advisory by default.** Neither `missing` nor `unlinked` findings gate the
check unless the caller passed `--strict`, in which case `missing` findings
on `web`/`mobile`/`api`/`worker` classifications gate it as failed.
`unlinked` findings never gate, `--strict` or not — they're a nudge, not a
block, since not every signal needs a bespoke dashboard on day one.
