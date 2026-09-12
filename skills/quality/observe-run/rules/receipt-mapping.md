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

The three clean-stream rows share one guard.
Write it **once**, here, and let the rows reference it by name — an enumeration repeated per row is
a list to keep in sync, and twice now a conjunct escaped one copy of it:

> **`CLEAN`** ≡ a `dash0.cli.otlp_proxy.shutdown` event **was observed**
> AND its `reason == signal`
> AND `*.failed == 0`
> AND no `dash0.cli.otlp_proxy.error` event appeared.

`NOT CLEAN` is the negation of that definition, not of any list below it.

| Observed proxy-stream state | Expected span present? | Verdict |
| --- | --- | --- |
| `CLEAN` AND totals > 0 | present | `confirms` — the code emitted what the claim asserted |
| `CLEAN` AND totals > 0 | absent | `contradicts` — the code genuinely did not emit |
| `NOT CLEAN` | (any) | `ambiguous` — never `contradicts`. A degraded delivery path cannot be read as proof of absence. |
| `CLEAN` AND totals == 0 | n/a (nothing flowed) | `null` — the claim is unverified; silence is not proof |

`NOT CLEAN` is reached by any of — **illustrative, never the definition**: an
`dash0.cli.otlp_proxy.error` event; `*.failed > 0`; `shutdown.reason == deadline`; or **no
`shutdown` event at stream end at all**, which is the proxy `SIGKILL`ed, crashed, or the reader
losing the stream.
That last one is why `CLEAN` opens on the event being *observed* rather than on its `reason`:
`reader-adapters.md` documents the event's value domain (`signal` or `deadline`) but never promises
the event is emitted, so a killed proxy satisfies no `reason` test and a row keyed on `reason`
alone leaves that stream with no verdict.

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

Total is not the whole claim — the rows must also be **mutually exclusive**, or a state matching two
of them has no single verdict and the reader picks whichever they read first.
Both halves hold for one structural reason: `CLEAN` is defined once, the three clean rows partition
it (`totals == 0`; `totals > 0` with the span present; `totals > 0` with it absent), and the
`ambiguous` row is `NOT CLEAN` — so every stream matches exactly one row **by construction**, with
no list to keep in sync.

That shape is the fix for a defect this table shipped twice, each time the same way and each time
in the opposite direction:

| Escaped conjunct | Symptom | Direction |
| --- | --- | --- |
| `no error event`, present on the `null` row only | an `error` event with `*.failed == 0` matched both `contradicts` and `ambiguous` | **over**-match — two rows, and the forbidden one wins on a first read |
| `a shutdown event exists`, implied by every row and guaranteed by none | a `SIGKILL`ed proxy satisfied neither `reason == signal` nor `reason == deadline` | **under**-match — no row at all, so the table was not total |

Both were reachable rather than theoretical: `dash0.cli.otlp_proxy.error` is an independent event
with its own `error.kind` / `reason` / `code`, **not** a derivative of `stats`'s `*.failed`
counters, and the `shutdown` event's documented value domain is a promise about its `reason` when
it is emitted, never a promise that it is
(see [`rules/reader-adapters.md`](./reader-adapters.md)).

So when editing this table, re-derive totality and exclusivity against the **whole** of `CLEAN`,
not against the prose that happens to argue for it: the conjunct that escapes is the one no
argument on this page currently mentions.

## What this rule does not do

- It does not decide **which rung** produced the stream state — see
  [`rules/rungs.md`](./rungs.md).
- It does not decide whether the assertion being graded is even allowed — see
  [`rules/assertion-provenance.md`](./assertion-provenance.md).
- It does not re-define `confirms` / `contradicts` / `ambiguous` / `null` — see
  [`skills/quality/verify-behavior/rules/receipt.md`](../../verify-behavior/rules/receipt.md),
  which stays the single canonical definition.
