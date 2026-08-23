# Regression Signals

The check shared by every classification and every mode. A signal that
exists but that nothing watches is not coverage — this rule is what turns
"we emit telemetry" into "we would know if this broke."

## The three questions

For every signal added or confirmed (span, metric, RUM event, structured
log), answer all three before calling it done:

1. **Where does it show up?** A specific dashboard panel, a specific
   PromQL/D0QL query, or a specific existing alert/check rule — not "in the
   observability backend" generically.
2. **What would change if this regressed?** State the concrete symptom: an
   error-rate metric crossing a threshold, a latency percentile shifting, a
   funnel step's conversion dropping, a new log pattern appearing at `error`
   severity. If you cannot state this, the signal is incomplete.
3. **Who or what is watching it?** An existing Dash0 Check Rule, an existing
   dashboard someone actually looks at, or — if neither exists yet — an
   explicit note in the PR/walkthrough that one should be created. Silence
   here is the single most common way "we added telemetry" quietly means
   "we added telemetry nobody will ever look at."

## Errors and warnings specifically

Every new failure mode introduced by a change must be visible without
reproducing it locally:

| Failure shape                          | Minimum signal                                                          |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Unhandled exception in a request/handler | Span status `Error` + structured log at `error` severity (see [`backend-instrumentation.md`](./backend-instrumentation.md)) |
| Degraded-but-recovered path (retry succeeded, fallback used) | Log at `warn` severity; consider a counter if it can happen at volume — a one-off warn is fine as log-only |
| Client-side unhandled exception          | Routed through the project's existing error boundary / crash reporter — never a silent `catch {}` |
| Validation/expected 4xx-style rejection | Not necessarily an error span/log — mark as expected (e.g. `Ok` span with a `validation_failed` attribute) so it doesn't pollute the error rate used for regression detection |

Do not manufacture noise: an expected, handled rejection (bad user input)
logged at `error` severity will desensitize whoever watches the error-rate
metric to real regressions. Reserve `error` severity and `Error` span status
for genuinely unexpected failures.

## Proposing new dashboards/alerts (hands-off boundary)

When Steps 1–3 above surface a gap — a signal exists but nothing watches
it — this skill's job stops at naming the gap. Do not create or edit a
Dash0 dashboard, check rule, or SLO from inside this skill. Say, in the
`implement`/`audit` output:

> No existing check watches `<metric/signal>`. Propose one via Dash0 chat
> (the `dash0` agent) — it will build a check rule or dashboard panel for a
> human to review and create.

This mirrors the hands-off boundary the `dash0` agent itself keeps for SLOs
and alerts: propose, never silently create.

## Audit-mode classification

When running as part of `audit` mode or the `autonomous-workflow` Phase 4
gate, grade each signal:

- **`missing`** — a changed path in a `web`/`mobile`/`api`/`worker`
  classification with no signal at all. Advisory by default; blocks the
  gate only when the caller passed `--strict`.
- **`unlinked`** — a signal exists but Question 3 above has no answer (no
  dashboard, no alert, no explicit propose-a-check note). Always
  advisory — surfaced in the report, never blocks, even under `--strict`.
- **`pass`** — all three questions answered.
