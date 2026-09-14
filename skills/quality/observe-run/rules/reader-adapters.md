---
title: observe-run — reader adapters, OTLP is the contract
impact: HIGH
tags:
  - observe-run
  - otlp
  - reader-adapter
  - vendor-neutrality
---

# Reader adapters — OTLP is the contract

OTLP is the contract; Dash0 is one implementation of the read.
This mirrors the argument this repo already makes for `pr-reviewer`'s rung 0 (root `CLAUDE.md`,
[`agents/pr-reviewer/rules/workspace.md`](../../../../agents/pr-reviewer/rules/workspace.md)):
`gw` selects the implementation there and never gates the rung, and the same shape applies here —
**the tool selects the implementation, it never gates the rung.**
A missing Dash0 CLI costs rung 1 nothing at all: rung 1 (in-memory / file exporter) has no Dash0
dependency whatsoever.

## Four readers, one table

| Reader | Rung | Vendor | When |
| --- | --- | --- | --- |
| SDK in-memory exporter | 1 | None (any OTel SDK) | Default rung, single-process, no external tool |
| Collector with a `file` exporter | 1 (portable fallback) | None (any distribution of the OpenTelemetry Collector) | No Dash0 CLI installed, still want the offline rung |
| `otel-desktop-viewer` | 1/2 (portable fallback) | None (open-source, vendor-neutral OTLP receiver + local UI) | Want a quick visual read without any vendor CLI |
| `dash0 -X otlp proxy --agent-mode` + `dash0 spans query` | 2 | Dash0 | Preferred rung-2 implementation — zero exporter-config change, structured NDJSON event stream |

No plugin registry, no discovery protocol, no reader-configuration schema exists for a fifth
reader. Adding one is a one-row edit to this table when it becomes needed — building the
abstraction ahead of that need is exactly the premature generality `code-quality` rule 4 warns
against.

## The `dash0 -X otlp proxy` reference

Everything below is quoted from the `dash0-cli` reference (`docs/commands.md`, `otlp proxy`
section) rather than restated as remembered fact, because it sits behind an experimental flag with
no stability guarantee — citing the source turns a future drift into a documentation update
instead of a silent lie.

### Requires `-X` / `--experimental`

```bash
dash0 -X otlp proxy [flags]
```

The `-X` requirement means **no hard dependency on flag stability** — this rule never assumes the
surface below is frozen, and rung 1 is completely unaffected if it changes.

### Ports

Default OTLP ports: **4318** (HTTP) and **4317** (gRPC) — the app under test needs **zero**
exporter-config change, because an OTel SDK at default endpoint configuration already points here.

### Decoration flags

`--resource-attribute key=value` (repeatable) upserts a resource attribute onto every forwarded
batch — this is the flag `rules/run-identity.md` uses to stamp `deployment.environment.name` and
`vcs.ref.head.name`.

**"Every forwarded batch" includes metrics, and there is no per-signal scoping flag.** That is why
`dev.run.id` is *not* in the list above: `run-identity.md` scopes it to spans and logs only, and
this flag cannot express that scope. It selects a different mechanism per process — see
[`run-identity.md § The `Stamp on` column is not free at rung 2`](./run-identity.md). Do not add
`dev.run.id` to a `--resource-attribute` here on the strength of the two keys that are listed.

### `--agent-mode`

When active, the proxy emits NDJSON OTLP/JSON event records on stdout — one log record per event —
instead of the human-readable banner and live stats block. This is the mode `observe-run` always
uses. `--agent-mode` is **incompatible with `--tail`**: `--tail`'s human-readable per-record dump is
rejected with an error under `--agent-mode`, because an agent already sees every batch through the
structured event stream.

### The five `dash0.cli.otlp_proxy.*` events

| `event_name` | Key attributes |
| --- | --- |
| `dash0.cli.otlp_proxy.started` | `endpoint.http`, `endpoint.grpc`, `dataset`, `profile.name` |
| `dash0.cli.otlp_proxy.forwarded` | `signal`, `count`, `bytes` |
| `dash0.cli.otlp_proxy.stats` | `logs.rate`, `logs.total`, `logs.failed`, `spans.rate`, `spans.total`, `spans.failed`, `metrics.rate`, `metrics.total`, `metrics.failed` |
| `dash0.cli.otlp_proxy.error` | `error.kind`, `reason`, `code` |
| `dash0.cli.otlp_proxy.shutdown` | `reason` (`signal` or `deadline`), `final_total.logs`, `final_total.spans`, `final_total.metrics` |

`forwarded` carries counts and bytes — never span content — so the proxy stream is a **delivery
receipt**, and content comes only from `dash0 spans query` filtered on the run's identity (see
[`rules/run-identity.md`](./run-identity.md)).

### The five `error.kind` values

`upstream_unreachable`, `upstream_5xx`, `upstream_4xx_auth`, `upstream_4xx_other`,
`internal_panic`.

### Not a Collector replacement, no outbound buffering

> The proxy is not a Collector replacement. It does not buffer outbound on a Dash0 outage.

This is the load-bearing caveat behind the verdict table's `ambiguous` row
([`rules/receipt-mapping.md`](./receipt-mapping.md)): a degraded delivery path is not "the proxy
will retry later and eventually get there" — there is no outbound buffer to retry from.

### Queue saturation — 128-deep, 503 / `UNAVAILABLE`

The proxy runs **async-forward** semantics: an HTTP 200 / gRPC `OK` to the SDK means "accepted at
this node," not "delivered" — the actual upstream forward happens asynchronously on a worker pool.
When the per-signal queue saturates at **128 deep**, the receiver returns **HTTP 503** (or gRPC
`UNAVAILABLE`), and the SDK retries with exponential backoff.

### `dash0 spans query`

Retrieves span content by querying Dash0 directly, filtered by resource attribute (e.g.
`--filter "dev.run.id is <run-id>"`). This is the only step in the rung-2 path that returns actual
span content; the proxy stream itself never does.

## The read path needs no MCP grant

Both halves of the rung-2 read — the `dash0 -X otlp proxy --agent-mode` process and the
`dash0 spans query` command — are plain CLI invocations run with `Bash`.
The whole read needs **no MCP grant**, which is a real advantage over an MCP-based read: it works
inside sub-agents that carry no MCP tool grant, and it works in CI, where an MCP server is often
not even reachable.

## What this rule does not do

- It does not decide which rung to use for a given claim — see [`rules/rungs.md`](./rungs.md).
- It does not map the observed proxy state to a verdict — see
  [`rules/receipt-mapping.md`](./receipt-mapping.md).
