---
title: observe-run — the collection-state to verdict mapping
impact: HIGH
tags:
  - observe-run
  - receipt
  - verdict
---

# The collection-state to verdict mapping

This file owns exactly one decision: given what the reader observed at the end of a run — a rung-1
in-memory / file span list **or** a rung-2 proxy stream — which of the four canonical tokens
`observe-run` emits.

**Both rungs, equally.** Rung 1 is the *default* rung
([`rules/rungs.md`](./rungs.md)), so a mapping expressed only in rung-2 vocabulary would leave the
common path ungraded — and silently, because the degraded row matches unconditionally and would
answer `ambiguous` every time. The guard below is therefore reader-neutral, with one realization
row per rung.

It introduces no additional grading vocabulary of its own.
The canonical contract lives at
[`skills/quality/verify-behavior/rules/receipt.md`](../../verify-behavior/rules/receipt.md), and
this skill reuses its four tokens verbatim: `confirms`, `contradicts`, `ambiguous`, `null`.
`observe-run` adds none beyond those four, and this table is total — every reachable collection
state, **on either rung**, maps to exactly one of them.

## The verdict table (total)

The three clean-collection rows share one guard.
Write it **once**, here, and let the rows reference it by name — an enumeration repeated per row is
a list to keep in sync, and twice now a conjunct escaped one copy of it.

The guard is stated in **reader-neutral** terms, because this file grades **both** rungs and rung 1
is the default one.
A guard written in one rung's vocabulary is not a stricter guard; it is a guard the other rung can
never satisfy, and since `NOT CLEAN` matches unconditionally, the other rung would then grade
`ambiguous` on every run it ever performed:

> **`CLEAN`** ≡ the reader observed the run's collection **terminate normally**
> AND **nothing was dropped or failed** on the way to the reader
> AND **no delivery error** was reported by the reader.

`NOT CLEAN` is the negation of that definition, not of any list below it, and not of either rung's
realization of it.

**That blockquote's shape is load-bearing, not formatting.** L1 derives the conjunct count from it,
so the definition is written to exactly three rules: **one conjunct per line**, every line after the
first **opens with the joiner `AND`**, and the token `AND` appears **nowhere else** inside the
blockquote. Adding a conjunct therefore means adding a line, which is what makes the count derivable
at all. The third rule is the one that looks arbitrary and is not: a line-internal `AND` is
syntactically indistinguishable from a second conjunct crammed onto an existing line, so permitting
it for emphasis would re-open the growth hole the derivation closes. Use a comma, or a new line.

| Observed collection state | Expected span, **in this run's observed set** | Verdict |
| --- | --- | --- |
| `CLEAN` AND totals > 0 | in the observed set | `confirms` — the code emitted what the claim asserted |
| `CLEAN` AND totals > 0 | not in the observed set | `contradicts` — the code genuinely did not emit |
| `NOT CLEAN` | (any) | `ambiguous` — never `contradicts`. A degraded delivery path cannot be read as proof of absence. |
| `CLEAN` AND totals == 0 | n/a (nothing flowed) | `null` — the claim is unverified; silence is not proof |

The second column is a **predicate over this run's own observed spans** — the same set `totals`
counts — and never over the backend at large. A span that exists in the dataset but carries another
run's `dev.run.id` is *not* in the observed set: reading it as present grades this run on a previous
run's evidence, which is the failure the run-scoping in
[`rules/run-identity.md`](./run-identity.md) exists to prevent.

**"The same set `totals` counts" is a requirement on `totals`, not a description of it.** The two
columns must range over **one population**, and that is the only reason the `contradicts` row is
sound: absence from a set is disproof only when the set is the one the count attested to. So
whatever `totals` is realized as per rung, it is **the size of the observed set** — and any counter
that ranges wider is a delivery receipt, not a census, and cannot serve here.

This is not a hypothetical distinction at rung 2, where the proxy's `spans.total` counts **every
process pointed at its ports** while the observed set is filtered to those carrying this run's
`dev.run.id`. Reading the receipt as the census made the two columns disagree on *membership*
rather than merely on identity, and the failure is again a silent wrong verdict: a downstream
service, a sidecar, or a concurrent dev process inflates `totals` without entering the observed set,
so `CLEAN` AND `totals > 0` AND *not in the observed set* grades **`contradicts`** on spans the app
never emitted — where the run belongs on the `null` row. `NOT CLEAN ⇒ ambiguous` does not catch it:
collection was never degraded, only **mis-attributed**.

The sharpest case is not a corner. Allowed assertion **kind 5 is downstream fan-out**, and
[`rungs.md`](./rungs.md)'s default-rung rule names cross-process fan-out as rung 2's *first reason
to exist* — so the run where a second process certainly emits spans is the one this rung is for.
[`run-identity.md`](./run-identity.md) therefore states the two preconditions that make the
populations coincide: the proxy is **exclusive to this run**, and **every process participating in
the claim carries `dev.run.id`**.

### What `CLEAN` and `totals` are, per rung

Each rung realizes the same three conditions against the signals its own reader actually has.
**Every rung the skill can select must appear here**; a rung with no row is a rung with no
reachable verdict but `ambiguous`.

**Rung 2 is rung 1's realization plus what the proxy adds — never the proxy's signals alone.**
Rung 2 runs **two processes**: the app under test, exporting exactly as it does on rung 1, and the
proxy in front of it. Every rung-1 condition **that is a property of the app process** therefore
still applies on rung 2, and the proxy's own signals are an *additional* conjunct covering the leg
rung 1 does not have. A rung-2 cell naming only `dash0.cli.otlp_proxy.*` state is the defect this
line exists to prevent: it grades the proxy's health and calls the result the run's, so an app that
never flushed reads `CLEAN` and its missing span reads `contradicts`.

The qualifier is load-bearing, because the universal without it is **false on this table's own
rows** — and a containment test that reports two false positives is one whose next real miss gets
waved through as a third known exception. Exactly two rung-1 conjuncts are properties of rung 1's
**reader** rather than of the app, and neither has or needs a rung-2 counterpart:

| Reader-local rung-1 conjunct | Why rung 2 does not carry it |
| --- | --- |
| `the file export is complete and parseable` (row 2) | rung 2 has no export file — the proxy stream replaces it, and its completeness is what `shutdown` + `*.failed` already report |
| `before the span list was read` (row 1) | qualifies *when* rung 1's in-memory list is safe to read; rung 2 reads a stream, so the clause has no referent |

Everything else **is** an app-process property and must appear on both rungs — including the span
processor's dropped-span count, which is the app's `BatchSpanProcessor` on *either* rung and is
exactly the app → proxy leg rung 2's row 2 conjoins. So: read each rung-2 cell against the rung-1
cell to its left, and check that it contains every conjunct not in the table above.

| Condition | Rung 1 — in-memory / file exporter | Rung 2 — `dash0 -X otlp proxy` |
| --- | --- | --- |
| collection terminated normally | the process under test exited on its own **and** the SDK's `forceFlush()` / `shutdown()` returned before the span list was read | **both processes**: rung 1's condition on the app (it exited on its own **and** its `forceFlush()` / `shutdown()` returned) **and** a `dash0.cli.otlp_proxy.shutdown` event **was observed** with `reason == signal` |
| nothing dropped or failed | the span processor reports **zero dropped spans** (a `BatchSpanProcessor` drops on a full queue and reports the count) and the file export is complete and parseable | **both legs**: rung 1's condition on the app — the SDK's exporter reporting no failed export and zero dropped spans (app → proxy) — **and** `*.failed == 0` accumulated over `logs.failed` / `spans.failed` / `metrics.failed` (proxy → Dash0) |
| no delivery error reported | the exporter's `export()` returned no failure result | **both legs**: rung 1's condition on the app (its `export()` returned no failure result) **and** no `dash0.cli.otlp_proxy.error` event appeared |
| `totals` | the number of **span** records in the in-memory span list / exported file, scoped to this run | the number of **span** records returned by the run's own `dash0 spans query --filter "dev.run.id is <run-id>"` — i.e. the size of the observed set |

**Rung 2's `totals` is the query's count, never the proxy's.** The proxy's `spans.total` (and
`final_total.spans` on `shutdown`) counts every process pointed at its ports and carries no
resource-attribute dimension, so it is a **delivery receipt, not a census**: it serves `CLEAN` above
and nothing else. Realizing `totals` from it made the two verdict columns range over different
populations — see the requirement stated under the verdict table.

Both rungs scope `totals` to **this run**, so a leftover span from a previous run is never counted
as this one's evidence — but **by different mechanisms**, and collapsing them into one sentence is
how a reachable mis-grade hid here. Rung 1's span list belongs to the process under test and is
scoped by `dev.run.id` on its resource. Rung 2's `totals` is a **proxy counter** carrying no
resource-attribute dimension at all; it is scoped by the **proxy's own lifetime**, which begins at
zero for this run.

The observed set, by contrast, is scoped by `dev.run.id` on **both** rungs — at rung 2 the
attribute-filtered `dash0 spans query` is what *defines* it. That asymmetry is why
[`rules/run-identity.md`](./run-identity.md) makes `dev.run.id` a **requirement** of rung 2 rather
than a best-effort stamp: drop it and `totals` keeps counting while the observed set empties, so an
emitted span grades `contradicts`. Rung 2 is not selectable without it.

**`totals` counts spans, on both rungs, because every assertion this skill grades is a span claim.**
All seven allowed behavioral assertion kinds
([`rules/assertion-provenance.md`](./assertion-provenance.md)) are statements about spans — count,
parent/child structure, duration, status, downstream fan-out, attribute cardinality, ordering — so
`totals` is the count of the evidence the verdict is actually about. Summing the `logs` and
`metrics` counters in as well makes `totals > 0` satisfiable by a run that emitted no spans at all:
that run skips the `null` row it belongs on, matches `CLEAN AND totals > 0` with the expected span
absent, and grades `contradicts` — a confident disproof produced by counting log records. On rung 2
read `spans.total` (or `final_total.spans`) alone; on rung 1 count span records alone, not every
record the exporter holds.

`NOT CLEAN` is reached, on rung 1, by any of — **illustrative, never the definition**: the process
killed before flush; a non-zero dropped-span count; a flush that timed out; or an export file that
is truncated or will not parse.
Rung 2 reaches `NOT CLEAN` through **every one of those** — its realization contains rung 1's, so
an app that never flushed is `NOT CLEAN` on rung 2 exactly as it is on rung 1 — **plus** the proxy's
own: a `dash0.cli.otlp_proxy.error` event; `*.failed > 0`; `shutdown.reason == deadline`; or **no
`shutdown` event at stream end at all**, which is the proxy `SIGKILL`ed, crashed, or the reader
losing the stream.

**Rung 2 has two delivery legs, and `*.failed` only sees the second one.**
`*.failed` is the proxy's own count of what it failed to forward to Dash0 — it cannot see what
never reached the proxy. The proxy is async-forward with a **128-deep per-signal queue that returns
503 / `UNAVAILABLE` when saturated** ([`rules/reader-adapters.md`](./reader-adapters.md)), so an SDK
that exhausts its retry budget against that 503 drops spans the proxy never received and never
counted. `*.failed` stays `0`, the run grades `CLEAN`, and an absent span then reads `contradicts`
— a confident disproof of data the app in fact emitted, which is the one verdict the degraded-path
invariant exists to prevent.
So rung 2's realization conjoins **both** legs: the proxy's `*.failed` for proxy → Dash0, and the
SDK exporter's own failure and dropped-span reporting for app → proxy — the same signal rung 1
reads, because on that leg rung 2 is in exactly rung 1's position. That is the one-row instance of
the containment rule above; the rule generalises it, because the same asymmetry produced the same
defect on the `collection terminated normally` row, where a cell reading only
`shutdown.reason == signal` graded the proxy's exit and said nothing about whether the app flushed.

**The containment rule is prose on purpose — do not add an L1 guard for it.** The reason is **scope,
not weakness**: the strongest faithful candidate was constructed and rejected on a *false positive*,
not on vacuity. That candidate — require every backticked identifier in a rung-1 cell to reappear in
the rung-2 cell beside it — **reds on row 2 today**, because rung 1's `BatchSpanProcessor` names the
mechanism while rung 2's app-leg conjunct names its *effect* ("zero dropped spans"), so the condition
is carried while the literal token is not. A guard that reds on a correct table teaches the next
author to satisfy it by typing the token, which is worse than no guard.

Note what this reason is **not**, because the obvious phrasing does not survive contact with the
guards kept in the same file. "Satisfied by typing a token" cannot be the criterion: the filled-cell
check one section up is satisfied by **any non-whitespace character**, and it is kept. A weak test is
not a disqualified test. What disqualifies a guard here is being **wider than its claim** — the
round-5 `/Rung 1/.test(section)` shape, where a token anywhere in the whole section satisfied a claim
about one cell. A cell-scoped check is bounded: it can be weak without being able to mislead. So the
bar for adding a cheap guard to this file stays low, and this particular guard fails a different
test.

L1 owns *mechanical* contracts here (root `CLAUDE.md`): that every rung has a column, that every body
row is filled for every rung, that each conjunct has a row, and that the conjunct count is derived
from the definition rather than hand-typed. Whether a filled cell says the right thing is a
reviewer's judgement, and the two cheap tests are stated above: read each rung-2 cell against the
rung-1 cell to its left, and ask what one guards that the other does not.

**Reading the observed set is not instantaneous at rung 2, and an unfinished read is not an absence.**
[`rungs.md`](./rungs.md) names rung 2's cost as *ingest latency — the query has to wait for the batch
to land in Dash0* — so a `dash0 spans query` issued the moment the proxy reports `shutdown` can
return an empty set while delivery was perfect. Graded straight through, that is `CLEAN` AND
`totals == 0`, which is the `null` row: unverified, never `contradicts`. That is the correct floor,
and it is why `totals` is defined above as the observed set's own size rather than the proxy counter
— with the counter as `totals`, the same run read `totals > 0` with the span absent and graded
`contradicts` on a read that had simply not finished.

`null` is the floor, not the goal. Before grading, **re-query until the observed set stops growing
or a bounded deadline passes**, taking the proxy's `final_total.spans` as the number to wait for
(that is what the receipt is *for*). Report a deadline reached with the set still short of it as
`ambiguous` — the read was truncated, which is a degraded reader, not evidence of absence. Never
extend the wait by widening the filter to a time window: that re-admits a concurrent run's spans,
the failure named above.

The no-`shutdown`-event case is why the realization opens on the event being *observed* rather than
on its `reason`: `reader-adapters.md` documents the event's value domain (`signal` or `deadline`)
but never promises the event is emitted, so a killed proxy satisfies no `reason` test and a row
keyed on `reason` alone leaves that stream with no verdict.

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
