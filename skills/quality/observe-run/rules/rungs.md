---
title: observe-run — the two cheapest-first rungs
impact: HIGH
tags:
  - observe-run
  - rungs
  - cheapest-first
---

# The two cheapest-first rungs

`observe-run` reuses `verify-behavior`'s cheapest-first ladder vocabulary rather than inventing a
second one: reading a run's telemetry is a **Tier 3** evidence source (execution — the highest-cost,
highest-certainty tier that skill's ladder already defines), and this file owns only the choice
**within** that tier between two ways of getting the executed proof.
This file defines **exactly two** rungs and no third.
A rung here is never a "Tier," a "Level," or a "Stage" — those words belong to other ladders in
this repo and mixing vocabularies is exactly what a rubric-reading L2 suite must never have to
disambiguate.

## Rung 1 — in-memory / file exporter

The app under test is started with an OTel SDK configured to export to an in-memory span
processor, or to a `file` exporter writing NDJSON to a scratch path.

| Property | Value |
| --- | --- |
| Cost | Instant — no network hop, no external process |
| Availability | Offline; works with no Dash0 CLI, no credentials, no network |
| Span content | Available immediately, in full |
| Coverage | Only the process(es) explicitly wired to the in-memory/file exporter |
| Cross-process fan-out | Not visible — a downstream service called over the network emits nothing this rung can see |

### Correct

```text
Start the app under test with OTEL_TRACES_EXPORTER=console (or a test-harness in-memory
processor already wired by the project), run the command, read the process's own span list.
```

### Incorrect

```text
Assume a downstream microservice's spans will show up in the in-memory exporter because the
app under test called it over HTTP.
```
✗ WRONG — the in-memory exporter only sees the process it is wired into. A cross-process call
needs rung 2.

## Rung 2 — the proxy in `--agent-mode` plus `dash0 spans query`

The app under test needs zero exporter-config change (it already points at the OTel default
ports); `dash0 -X otlp proxy --agent-mode` sits in front of those ports and forwards every batch to
Dash0, emitting a structured NDJSON event stream on stdout as it goes.
The assertion is then made by combining that event stream (a **delivery receipt** — it never
carries span content) with `dash0 spans query`, filtered on the run's `dev.run.id` resource
attribute (see [`rules/run-identity.md`](./run-identity.md)).
Full reader mechanics: [`rules/reader-adapters.md`](./reader-adapters.md).

| Property | Value |
| --- | --- |
| Cost | Ingest latency — the query has to wait for the batch to land in Dash0 |
| Availability | Needs the Dash0 CLI (or a portable fallback reader, per `rules/reader-adapters.md`) plus a resolvable Observability Profile dev target |
| Span content | Not in the proxy stream itself — the proxy stream is a delivery receipt; content comes from `dash0 spans query` |
| Coverage | Cross-process — any process pointed at the default OTLP ports, with **zero** app config change |
| Baseline comparability | Yes — every run stamps the same identity keys, so this run's spans are queryable against a prior run's |

### Correct

```text
Start `dash0 -X otlp proxy --agent-mode`, stamping `dev.run.id=<run-id>` by the mechanism
`rules/run-identity.md § The `Stamp on` column is not free at rung 2` selects for this process
(the `--resource-attribute` flag only when the run emits no metrics — it upserts onto every
forwarded batch, metrics included). Run the command under test, read the
`dash0.cli.otlp_proxy.forwarded` / `.stats` / `.error` / `.shutdown` events for delivery health,
then `dash0 spans query --filter "dev.run.id is <run-id>"` for span content.
```

### Incorrect

```text
Treat a `dash0.cli.otlp_proxy.forwarded` event alone as proof the expected span exists.
```
✗ WRONG — `forwarded` carries counts and bytes, never span content. The claim needs
`dash0 spans query` to confirm what actually arrived.

## The default-rung rule

Rung 1 is the default rung for a tight inner loop — no CLI dependency, no ingest latency, immediate
span content.
Reach for rung 2 only for the deliberate pass: verifying cross-process fan-out, a claim that spans
multiple services, or a baseline comparison against a prior run.
`observe-run` never escalates to rung 2 when rung 1 can already decide the claim — the same
cheapest-first discipline `verify-behavior`'s ladder enforces at every tier.

## What this rule does not do

- It does not decide whether an assertion is allowed to be checked at all — see
  [`rules/assertion-provenance.md`](./assertion-provenance.md).
- It does not decide which reader implementation performs rung 2's read — see
  [`rules/reader-adapters.md`](./reader-adapters.md).
- It does not map the observed stream state to a verdict — see
  [`rules/receipt-mapping.md`](./receipt-mapping.md).
