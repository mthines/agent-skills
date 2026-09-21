---
title: Provenance guard — only user-observable outcomes, never restatements
impact: HIGH
tags:
  - jev
  - provenance
  - assertion-by-construction
  - integrity
---

# Provenance guard

An agent that writes an expectation and then asks Jev to confirm its own
paraphrase of the page it just read will always get `confirms`.
That is **assertion-by-construction** — the same failure
[`test-provenance-guard`](../../test-provenance-guard/SKILL.md) catches for tests
and [`observe-run`'s assertion-provenance rule](../../observe-run/rules/assertion-provenance.md)
catches for telemetry.
This rule is Step 0 of every run: an expectation that fails it is **refused**,
not graded.

## The rule

An expectation is admissible only if it is a **user-observable outcome** — a
claim a person looking at the screen could confirm without knowing how the state
text was captured.
It is refused when it is a **restatement of the captured state** — a claim
answerable by string-matching the text Jev is about to be handed.

The test: *could this expectation be settled by reading the source or the
captured text alone, with no judgment about what the user experiences?*
If yes, it is a restatement — refuse it.

## Admissible vs refused

| Expectation                                                        | Verdict  | Why                                                        |
| ------------------------------------------------------------------ | -------- | --------------------------------------------------------- |
| the user sees an order-confirmation number                         | admit    | An outcome a person confirms; not a literal string check  |
| the page shows that the payment succeeded                          | admit    | Semantic outcome; the wording need not appear verbatim    |
| the form reports the email address is already in use               | admit    | Outcome about what the user is told                        |
| the page contains the text "Order #12931"                          | refuse   | A literal substring match — use a locator/text assertion  |
| the DOM has a node with role "alert"                               | refuse   | A structural check answerable by the locator ladder       |
| the captured state includes the string I just read                | refuse   | Restatement of the input by construction                   |

A literal-string or structural claim is not wrong — it is simply not Jev's job.
Route it to the existing locator or `text:` assertion, which verifies it
deterministically and for free.

## Closed, not open-ended

Admissibility is about *user-observable outcomes*, deliberately narrow.
An expectation that asks Jev "anything true about this page" re-admits exactly the
by-construction claims this guard exists to exclude, so breadth is refused on the
same ground as a restatement.
When an expectation is borderline, prefer refusing and asking the author to phrase
it as what the user experiences.

## On refusal

Do not silently pass or grade a refused expectation.
Report it plainly: name the expectation, say it is a restatement / structural
check, and point the author at the deterministic assertion that fits.
A refused expectation is a spec-authoring finding, not a verdict about the page.

## Common mistakes

- Accepting "the page contains '<literal>'". **Fix:** that is a `text:`
  assertion; refuse and redirect.
- Accepting a structural/DOM claim. **Fix:** that is the locator ladder's job;
  refuse and redirect.
- Broadening the question to "is anything here correct". **Fix:** keep it to one
  named user-observable outcome.
- Grading a refused expectation anyway. **Fix:** refuse it — a by-construction
  pass is worse than no assertion.
