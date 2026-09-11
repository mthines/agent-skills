---
title: observe-run — the proxy-stream-state to verdict mapping
impact: HIGH
tags:
  - observe-run
  - receipt
  - verdict
---

# The proxy-stream-state to verdict mapping

This file owns exactly one decision: given the observed state of a rung-2 proxy stream (or the
in-memory rung-1 span list) at the end of a run, which of the four canonical tokens
`observe-run` emits.

It introduces no additional grading vocabulary of its own.
The canonical contract lives at
[`skills/quality/verify-behavior/rules/receipt.md`](../../verify-behavior/rules/receipt.md), and
this skill reuses its four tokens verbatim: `confirms`, `contradicts`, `ambiguous`, `null`.
`observe-run` adds none beyond those four, and this table is total — every reachable proxy-stream
state maps to exactly one of them.

## The verdict table (total)

| Observed proxy-stream state | Expected span present? | Verdict |
| --- | --- | --- |
| `*.failed == 0` AND `shutdown.reason == signal` AND totals > 0 | present | `confirms` — the code emitted what the claim asserted |
| `*.failed == 0` AND `shutdown.reason == signal` AND totals > 0 | absent | `contradicts` — the code genuinely did not emit |
| ANY `dash0.cli.otlp_proxy.error` event, OR `*.failed > 0`, OR `shutdown.reason == deadline` | (any) | `ambiguous` — never `contradicts`. A degraded delivery path cannot be read as proof of absence. |
| `*.failed == 0` AND `shutdown.reason == signal` AND no `error` event AND totals == 0 | n/a (nothing flowed) | `null` — the claim is unverified; silence is not proof |

`totals` is the sum of `dash0.cli.otlp_proxy.stats`'s `<signal>.total` attributes (`logs.total` +
`spans.total` + `metrics.total`) accumulated across the run's `dash0.cli.otlp_proxy.stats` events,
scoped to this run's `dev.run.id` resource attribute (see
[`rules/run-identity.md`](./run-identity.md)).
`*.failed` is the same accumulation over `logs.failed` / `spans.failed` / `metrics.failed`.
`shutdown.reason` is read from the `dash0.cli.otlp_proxy.shutdown` event's `reason` attribute
(`signal` or `deadline`) — **never** from the process exit code, which is zero in both cases; a
drain that hits its 5-second deadline still exits zero, and only `reason` distinguishes it from a
clean signal-driven shutdown.

### Correct

```text
proxy state: spans.total=3, spans.failed=0, shutdown.reason=signal, no error event
expected span (name="checkout.charge", parent="checkout.handler") found in the forwarded set
→ verdict: confirms
```

### Incorrect

```text
proxy state: shutdown.reason=deadline (drain timed out), exit code 0
expected span not found in the forwarded set
→ verdict: contradicts   ✗ WRONG — a deadline-hit shutdown means delivery was incomplete;
                             the absence is unverified, not disproved. Correct verdict: ambiguous.
```

## Why the table is total, not just the brief's two rows

A verdict table that only handles "clean state, span present or absent" leaves the zero-totals
case unrepresentable — did nothing flow because nothing ran, or because the proxy never received
anything?
Reading zero totals as `contradicts` would claim the code disproved the assertion when in fact
nothing was ever observed, which is exactly the null-is-never-confirmation invariant this file's
canonical source enforces, applied in reverse: absence of a confirming signal is not itself a
disproof.
The `null` row exists so that state has an honest verdict instead of silently falling through to
whichever row happens to match loosest.

## What this rule does not do

- It does not decide **which rung** produced the stream state — see
  [`rules/rungs.md`](./rungs.md).
- It does not decide whether the assertion being graded is even allowed — see
  [`rules/assertion-provenance.md`](./assertion-provenance.md).
- It does not re-define `confirms` / `contradicts` / `ambiguous` / `null` — see
  [`skills/quality/verify-behavior/rules/receipt.md`](../../verify-behavior/rules/receipt.md),
  which stays the single canonical definition.
