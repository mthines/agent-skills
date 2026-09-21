---
title: Receipt mapping — Jev primitive to verify-behavior verdict
impact: HIGH
tags:
  - jev
  - receipt
  - thresholds
  - verify-behavior
---

# Receipt mapping

This rule owns the one decision that makes `jev-assert` composable: how a Jev
answer becomes exactly one of the five canonical `verify-behavior` verdicts
(`confirms` / `contradicts` / `ambiguous` / `null` / `unobtainable`), defined in
[`verification-receipt.md`](../../../../agents/shared/rules/verification-receipt.md).
The verdict set is closed — never emit a sixth token, and never collapse `null`
into `unobtainable` or vice versa.

## Contents

- [The primary primitive: a Noul](#the-primary-primitive-a-noul)
- [The mapping](#the-mapping)
- [null vs unobtainable](#null-vs-unobtainable)
- [Secondary primitives: Choice and Score](#secondary-primitives-choice-and-score)
- [Threshold calibration](#threshold-calibration)
- [Receipt format](#receipt-format)
- [Common mistakes](#common-mistakes)

## The primary primitive: a Noul

A semantic UI assertion is a yes/no judgment, so the default primitive is a
**Noul** — it returns a single probability in `[0, 1]` that the statement is
true (no separate confidence value).
Build the Noul question from the expectation with a fixed template so the phrasing
is not a per-call variable:

```text
question type: noul
instructions: Does the page state show that <expectation>?
state: { "page_text": "<captured accessibility/page text>" }
```

The expectation must already have passed the [provenance guard](./provenance.md)
— a Noul over a restatement of the state text is answerable by construction and
tells you nothing.

## The mapping

Let `p` be the Noul probability, `HIGH` the high threshold (default `0.85`), and
`LOW` the low threshold (default `0.15`).

| Condition                                 | Verdict       | Meaning                                             |
| ----------------------------------------- | ------------- | -------------------------------------------------- |
| `p >= HIGH`                               | `confirms`    | The outcome holds, with margin                     |
| `p <= LOW`                                | `contradicts` | The outcome is false, with margin                  |
| `LOW < p < HIGH`                          | `ambiguous`   | Ran, but the answer is not decisive                |
| The state is empty / the expectation is unanswerable from it | `null` | Ran, and the state genuinely lacks the asserted thing |
| The call could not run at all             | `unobtainable`| Tooling verdict — re-frame, never a guessed pass   |

`confirms` and `contradicts` are the only two verdicts a spec runner treats as a
definite pass / fail.
`ambiguous`, `null`, and `unobtainable` never silently pass a spec — the runner
records the spec `inconclusive` and says why.

## null vs unobtainable

The two look alike and mean opposite things — the same distinction
`verification-receipt.md` draws.

| Verdict        | The Jev call | The state                                       |
| -------------- | ------------ | ----------------------------------------------- |
| `null`         | **ran**      | present, but does not support the expectation   |
| `unobtainable` | **could not run** | never obtained a usable answer             |

Reach `unobtainable` for: `TYPESAFE_API_KEY` unset, the TypeSafe API unreachable
or erroring, or no text state captured (a screenshot-only capture is not usable
input).
Never emit `unobtainable` without having tried — it is a verdict established by
exhausting the call, not a shortcut past one.

## Secondary primitives: Choice and Score

Two adjacent judgments use a different primitive but map through the same table.

- **Choice** — screen/state detection ("Which screen is this? [checkout | error
  | loading | other]").
  A Choice returns a distribution plus a `confidence`.
  When the selected option is the asserted one **and** `confidence >= HIGH` →
  `confirms`; when a different option wins with margin → `contradicts`; when the
  distribution is not concentrated (`confidence < HIGH`) → `ambiguous`.
- **Score** — defect/quality grading on ordered levels.
  A Score is not a pass/fail on its own; the caller supplies the passing band.
  Inside the band with `confidence >= HIGH` → `confirms`; clearly outside →
  `contradicts`; otherwise → `ambiguous`.

A Noul near `0.5` means *similar probability for yes and no*, not "medium
intensity" — do not read a mid Noul as a weak `confirms`.

## Threshold calibration

`HIGH = 0.85` / `LOW = 0.15` are **documented defaults, not universal
constants**.
Per TypeSafe's confidence-routing guidance, decision thresholds must be tuned on
the target domain's own data and the cost of a wrong pass versus a wrong fail —
a verification gate that must not pass a broken UI wants a higher `HIGH` and a
wider ambiguous band than a best-effort screenshot label.
Callers override with `--threshold-high` / `--threshold-low`.
Record any deviation from the defaults in the receipt so a reader can see the
band the verdict was decided against, rather than silently biasing the result.

## Receipt format

```text
[receipt] tier: 3 | tool: jev | target: <page or spec id>
[receipt] question: Does the page state show that <expectation>?
[receipt] jev: noul=0.94 (high=0.85 low=0.15)
[receipt] verdict: confirms
```

The `[receipt] verdict: <token>` line is the last line and the machine-read one.
Its token is always one of the five above.

## Common mistakes

- Emitting a verdict word outside the five canonical tokens. **Fix:** map to the
  nearest of the five; there is no sixth.
- Collapsing `null` into `unobtainable`. **Fix:** ask "did the call run?" — if
  yes it is `null`, if no it is `unobtainable`.
- Reading a mid-range Noul as a weak pass. **Fix:** the ambiguous band is a
  first-class outcome; do not round it to `confirms`.
- Treating the default thresholds as fixed truth. **Fix:** calibrate per domain
  and record any override.
