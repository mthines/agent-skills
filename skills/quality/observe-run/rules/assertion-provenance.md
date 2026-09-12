---
title: observe-run — assertion provenance is the centerpiece rule
impact: HIGH
tags:
  - observe-run
  - provenance
  - by-construction
  - integrity
---

# Assertion provenance is the centerpiece rule

An agent that writes the instrumentation **and** asserts on the instrumentation it wrote passes by
construction.
This is the telemetry-shaped version of exactly what
[`skills/quality/test-provenance-guard`](../../test-provenance-guard/SKILL.md) exists to catch for
test files — a test that re-implements the function it claims to test, then asserts against its
own copy, passes every time and protects against nothing.
Here the copy is a span the agent added specifically so the assertion would find it, rather than a
function body.
The framing is borrowed from that skill rather than reinvented; the taxonomy below is
telemetry-specific and exists nowhere else.

## Allowed: behavioral assertions

A behavioral assertion claims something about what the code **does**, verifiable only by observing
a run — never by reading the diff back.

1. **Span count** — how many spans of a given operation were produced for one logical unit of work.
2. **Parent/child structure** — a span's parent is the operation that should have called it.
3. **Duration** — a span (or a sum of spans) falls inside an expected latency bound.
4. **Span status on the error path** — a span's status flips to `Error` when the operation it wraps
   fails.
5. **Downstream fan-out** — how many outbound calls (child spans, HTTP requests) one inbound
   operation produced.
6. **Attribute cardinality** — an attribute's *set of distinct values* across a run stays bounded
   (or, inversely, is confirmed unbounded and therefore unsafe as a metric dimension).
7. **Ordering** — span A's start (or end) precedes span B's, across the run.

**This list is closed.** An expectation that maps to none of the seven is refused, and being
plausibly behavioral is not enough — a caller phrasing one is either restating a kind in different
words (rephrase it to the kind) or has found a genuinely new one, in which case it is added *here*,
numbered, before any caller relies on it. Closure is what makes the list checkable at all: an
open-ended "anything observable at runtime" readmits the by-construction assertions this rule
exists to refuse, since almost any source fact is *also* true at runtime. Adding a kind changes the
rubric the `observe-run-assertion-provenance` L2 suite reads, so it ships with that suite re-run
and golden cases for the new kind, per this repo's eval rules.

### Correct

```text
Claim: "checkout.charge fans out to exactly 2 payment-provider calls, not N+1 per line item."
Assertion: run the checkout flow with a 5-line-item cart, then assert the run's span count for
the payment-provider operation equals 2, regardless of cart size.
```

## Forbidden: by-construction assertions

A by-construction assertion is the diff read back: it does not verify behavior, it verifies that
the agent typed the string it meant to type.

- **"A span named `X` exists."** This is true the instant the instrumentation is written, before
  the code under it ever runs. It proves the span was declared, never that it fires correctly, at
  the right point, with the right parent, or under the right condition.

### Incorrect

```text
Claim: "checkout.charge emits a span."
Assertion: grep the source for `startSpan("checkout.charge")`.
```
✗ WRONG — this reads the diff, not a run. It would pass even if the span were wired to the wrong
parent, fired twice, or never actually executed on the path under test. Use assertion 2 (parent/child
structure) or assertion 1 (span count) against an actual run instead.

## The discriminator

Ask: **could this assertion be satisfied by reading the source code alone, without running
anything?**
If yes, it is by-construction — refuse it, and name the behavioral alternative from the list above
that would actually verify the claim.
If no — the answer depends on what happened when the code ran — it is behavioral, and
`observe-run` proceeds to select a rung (see [`rules/rungs.md`](./rungs.md)).

## What this rule does not do

- It does not decide which rung produces the executed proof — see [`rules/rungs.md`](./rungs.md).
- It does not decide the verdict once a behavioral assertion is checked — see
  [`rules/receipt-mapping.md`](./receipt-mapping.md).
- It does not detect by-construction **tests** (test files that shadow their SUT's exports) — that
  static + mutation check belongs to
  [`skills/quality/test-provenance-guard`](../../test-provenance-guard/SKILL.md), which this rule
  cites for framing only.
