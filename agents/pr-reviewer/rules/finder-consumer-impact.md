---
title: Consumer-impact finder — what the callers expected
impact: HIGH
tags:
  - pr-reviewer
  - dependencies
  - consequences
---

# Consumer-impact finder

The question is narrow and mechanical: **for each caller of a changed export, does what that caller expected still hold, and did this diff update it?**

It is the finder that answers "warn me about the consequences of changing this piece of code", and it is the one that most needs the workspace, because every answer is in a file the diff does not contain.

## Contents

- [Scope by tier](#scope-by-tier)
- [The six expectations](#the-six-expectations)
- [Procedure per consumer](#procedure-per-consumer)
- [Three outputs, not one](#three-outputs-not-one)
- [Consequence notes are the honest record](#consequence-notes-are-the-honest-record)
- [Config and schema consumers](#config-and-schema-consumers)
- [Where the trace stops](#where-the-trace-stops)

---

## Scope by tier

| Tier | Symbols traced |
| --- | --- |
| `deep` | **every** changed export with ≥ 1 consumer |
| `standard` | changed exports **in the delta** |
| `quick` | none — this finder does not run |

Within a tier, order by `consumer_files × (3 if signature|removed) × traffic_multiplier` descending, so a truncated budget truncates the least important tail.

## The six expectations

For each `(symbol, consumer)` pair, check these and only these. They are the complete list of ways a caller can be broken by a change it did not make.

| Expectation | Broken when | Detectable by |
| --- | --- | --- |
| **Return value** | shape, type, or nullability changed | the caller destructures, indexes, or compares against a literal |
| **Throws** | a new throw added, or an existing exception type changed | the caller has no `catch`, or catches a different type |
| **Ordering** | the callee's side effects were reordered, or it became lazy | the caller relies on a write having happened before the next line |
| **Nullability** | now returns or accepts `null`/`undefined` where it did not | a `=== null` check, a non-null assertion, or the absence of either |
| **Async-ness** | sync became async, or a promise is now returned unawaited | a missing `await`, or a `.then` on a non-promise |
| **Defaults** | a parameter default changed or was removed | the caller omits that argument |

```text
✅ RIGHT — "client.ts:214 added `throw new RetryExhausted`; sync.ts:88 checks
            `result === null` and has no try/catch" → throws expectation, broken
❌ WRONG — "retryRequest changed, so its 14 callers should be reviewed"
```

The second one is a task list, not a finding. Every caller either holds or does not, and the finder's job is to say which.

## Procedure per consumer

1. **Read the consumer's line and its enclosing function** from `$WORKDIR`. Not the diff — the diff does not contain it.
2. **Read the changed declaration** and, for a `signature` change, both the LEFT and RIGHT forms so the delta is explicit.
3. **Check the six expectations.** Most pairs fail none of them and cost one read.
4. **If one is broken, look for the guard.** A `try/catch` in the caller's caller, a wrapper that normalizes the return, a type assertion that would have failed to compile. If a guard exists, the pair holds — record it as verified, do not emit.
5. **If it is broken and unguarded, emit an `issue`** with the caller's line as the anchor and both lines as evidence.
6. **If the diff already updated the consumer**, the pair holds. Say so in the consequence note; do not emit a finding about code the PR fixed.

Step 4 is the one that separates this finder from a grep.
It is also why the workspace is a hard requirement: without it, step 4 is guesswork and step 5 posts findings about guards it could not see.

## Three outputs, not one

| Result | Output | Where |
| --- | --- | --- |
| A caller's expectation is broken and unguarded | `issue` candidate | inline, at the caller |
| The change requires a follow-up the diff does not make (a migration, a doc, a version bump) | `suggestion` candidate | inline |
| The change is **safe but wide** | a **consequence note** — report-only, not a finding, never inline | the `Impact` section |

The third one is new, and it is the point.

```markdown
- `retryRequest` (`src/api/client.ts`) — signature change · 14 consumer files in 3 packages
  · 13 verified unaffected · 1 finding inline
```

## Consequence notes are the honest record

A `deep` run that traced twenty-one consumers and found one problem currently reports one problem, which is indistinguishable from a run that looked at one consumer and found it.

The consequence note is what makes the work visible, and it has a second use: it is the surface a maintainer reads to decide whether the trace was *right*.
"13 verified unaffected" is checkable. Silence is not.

**A consequence note never carries a severity, never enters `SEVERITY_TALLY`, and never affects the verdict.**
It is a statement about coverage, not about risk.

**Never write a consequence note for a trace that did not happen.** If the budget truncated after six of fourteen consumers, the note says six of fourteen and names the cap. A note claiming fourteen is a false receipt, and it is worse than no note because it forecloses the question.

## Config and schema consumers

`impact.json.config_consumers[]` carries the same shape for non-code changes: a changed `config/schema.json`, a migration, an environment variable, a feature flag default.

The expectations differ, and there are three:

| Expectation | Broken when |
| --- | --- |
| **Presence** | a key the reader requires was removed or renamed |
| **Type** | a value's type or enum set narrowed |
| **Default** | a default changed, and the reader relies on the old one for existing rows or deployments |

The last is the one that produces incidents: a default that changes affects everything that never set the value explicitly, and nothing in the diff mentions those.

## Where the trace stops

Be explicit about the limits, because a confident trace over a boundary it cannot cross is worse than declining.

| Boundary | Behavior |
| --- | --- |
| A consumer in another repository | out of scope. Note it in `Impact` as "consumers outside this repo were not traced". |
| Dynamic dispatch, reflection, a string-keyed registry, DI | the graph under-counts here. If the symbol looks registry-registered, say the consumer list may be incomplete rather than reporting it as complete. |
| A generated file | trace it, but do not emit a finding on generated output — emit on the generator's input. |
| `DEPTH_CAPABILITY = diff-only` | the finder does not run. It cannot; and a version of it that guesses from the diff is the thing this rule exists to prevent. |
