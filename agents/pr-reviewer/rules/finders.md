---
title: Finders — independent generators that flag, never filter
impact: HIGH
tags:
  - pr-reviewer
  - detection
  - candidates
---

# Finders

The pipeline this replaces asked **one** generator to be careful and then ran eleven filters over its output.
That is the wrong shape. A careful generator does the filters' job badly and in secret: it declines to raise things, and nothing downstream can tell the difference between "no defect there" and "the generator talked itself out of it".

Phase D inverts it. **Finders flag. The verifier filters.**

## Contents

- [The polarity rule](#the-polarity-rule)
- [What a finder never knows](#what-a-finder-never-knows)
- [The candidate record](#the-candidate-record)
- [The finder table](#the-finder-table)
- [Diversify then vote](#diversify-then-vote)
- [Independence, and what breaks it](#independence-and-what-breaks-it)
- [What finders receive](#what-finders-receive)

---

## The polarity rule

Every finder prompt says, in substance:

> Investigate every suspicious pattern in your scope. Err on the side of flagging. Something you flag that turns out to be guarded costs one verifier pass; something you decline to flag costs a bug in production.

This is not an invitation to noise, because the noise never reaches the PR — the verifier drops `contradicted` candidates and the confidence gate drops weak ones.
It is a statement about **where** the judgment lives. A finder that suppresses is judging without evidence it is in a position to gather.

```text
✅ RIGHT (finder) — "sync.ts:88 checks `=== null`; client.ts:214 now throws. Flag it."
❌ WRONG (finder) — "sync.ts:88 checks `=== null`, but there is probably a catch
                     somewhere upstream, so I will not raise it."
```

The second one is the verifier's sentence, and the verifier is the thing that can go and look.

## What a finder never knows

A finder is **never** told:

- the confidence threshold, or that one exists;
- the placement caps (per-file, per-run);
- the relevance memory's `suppress` verdicts;
- how many candidates the other finders produced.

Handing a generator its own filter makes it pre-filter, and it will do so silently.
The suppress direction in particular is applied **after** verification, for the reason [`memory.md`](./memory.md) gives: a suppressed *verified* finding is a maintainer preference, while a suppressed *candidate* is a defect nobody looked at.

## The candidate record

Every finder emits this shape and nothing else. It never posts, never scores its own confidence, and never assigns a final severity.

```yaml
- finder: consumer-impact                 # enumerable — see fingerprint.mjs FINDERS
  defect_class: contract-break            # enumerable — see fingerprint.mjs DEFECT_CLASSES
  path: src/jobs/sync.ts
  line: 88
  symbol: retryRequest                    # the changed export this is about, or omitted
  claim: "`retryRequest` now throws `RetryExhausted` instead of returning `null`; this caller checks `=== null` and never catches."
  bad_outcome: "unhandled rejection in the sync job after 3 failed attempts"
  evidence:
    - "src/api/client.ts:214 (throw added)"
    - "src/jobs/sync.ts:88 (null check)"
  severity_hint: high                     # a hint; `severity` decides
  fix: |
    try { … } catch (e) { if (e instanceof RetryExhausted) return markFailed(job); throw e }
  verify_by: "grep callers of retryRequest for try/catch; run src/jobs/sync.test.ts"
```

Two fields carry more weight than they look like they do:

- **`bad_outcome`** is what makes a candidate falsifiable. "This is fragile" has no bad outcome and cannot be verified or dropped; "the sync job throws an unhandled rejection after three failures" can be. A candidate with no concrete bad outcome is a `quality` candidate at best, and the finder should say so rather than dressing it as correctness.
- **`verify_by`** is the finder handing the verifier a cheap test. A finder that knows how to check its own claim and does not say so wastes the verifier's budget re-deriving it.

`finder` and `defect_class` come from the enums in [`scripts/fingerprint.mjs`](../scripts/fingerprint.mjs) so the fingerprint is buildable:

```bash
node agents/pr-reviewer/scripts/fingerprint.mjs build \
  --finder consumer-impact --defect-class contract-break \
  --symbol retryRequest --path src/jobs/sync.ts
```

An unknown value exits non-zero rather than producing a key nothing else will ever match.

## The finder table

| Finder | Scope | Looks for | Replaces |
| --- | --- | --- | --- |
| **correctness** | delta hunks + enclosing function + the graph's consumer list per touched symbol | logic, edge cases, error paths, races, state assumptions; the shape checklists kept verbatim | Persona 1, with `critical`'s code-mode taxonomy folded in as a checklist |
| **consumer-impact** | every changed export with ≥ 1 consumer (all of them in `deep`, delta-only in `standard`) | per consumer, does its expectation still hold — return value, throws, ordering, nullability, async-ness, defaults — and does the diff update it? | the old holistic escalation's selection-and-trace, plus the consequence surface that did not exist. See [`finder-consumer-impact.md`](./finder-consumer-impact.md) |
| **dependency** | `impact.json.dependencies[]` | changelog for `(from, to]`, breaking and deprecated APIs, intersected with `usage_sites` | Persona 4, which never resolved a version. See [`finder-dependency.md`](./finder-dependency.md) |
| **intent** | the whole PR | description vs diff, semantically; scope creep; unmentioned behavior change | Gate 1's semantic half, Persona 3, and holistic intent-match |
| **standards** | delta files (all files in `deep`) | the repo's own governing docs | [`standards-conformance.md`](../../shared/rules/standards-conformance.md), unchanged |
| **quality** | delta | maintainability, tests, naming — **material only**; cosmetic emits nothing inline outside `deep` | Persona 2 and `code-quality` review mode |
| `ux`, `critical`, `--with …` | as today | as today | unchanged |

The optimality lens stays report-only and `deep`-only, via [`optimality-review.md`](../../shared/rules/optimality-review.md).

**Persona 4 is retired, not renamed.** It was gated on the diff touching a manifest, which meant a transitive major bump through a lockfile — the common case — never triggered it, and it never resolved a version even when it did fire. The dependency finder runs off resolved lockfile deltas instead.

## Diversify then vote

When the harness dispatches `pr-reviewer` as a sub-agent **with `Task` in its grant**, or when the harness itself is the caller, the correctness finder runs as **N = 3** sub-agents over the same hunks in **permuted file order**, each with the impact graph.

| Agreement | `votes` | Verifier treatment |
| --- | --- | --- |
| ≥ 2 of 3 at the same `(path, line ± 3)` and defect class | `2` or `3` | a unanimous candidate is pre-corroborated |
| 1 of 3 | omitted | ordinary — the verifier is the only independent check |

`--effort high` raises N to 5.

Permuting file order matters: a single pass over a long diff attends unevenly, and the tail of the file list gets less. Three passes in different orders is the cheapest way to make the tail as likely to be examined as the head.

**In-agent, without `Task`, the correctness finder runs once and `votes` is omitted.**
This is not a degraded mode to apologize for — the verifier is a genuine independent check, and voting is an amplifier on top of it, not a substitute for it.

## Independence, and what breaks it

Run finders concurrently where the runtime allows parallel `Skill()` calls in one turn (the fan-out idiom in [`holistic-review.md`](../../shared/rules/holistic-review.md)); serially otherwise.

**The split is about independence of framing, not speed.** Two things break it even when the calls are parallel:

1. **Passing one finder's candidates to another.** The second then confirms the first rather than looking. Cross-finder agreement is computed in Phase F, from the emitted records, after all finders have run.
2. **A shared running summary.** "Findings so far: 6" is enough to make the next finder quieter. Give each finder the code, the graph, and its own scope. Nothing about the run.

## What finders receive

| Input | Every finder | Notes |
| --- | --- | --- |
| `$WORKDIR` | yes | the code, on disk — never fetch a file over the API |
| `impact.json` | yes | leads, never verdicts ([`impact-graph.md`](./impact-graph.md)) |
| its own scope | yes | from the tier ([`depth-routing.md`](./depth-routing.md)) |
| knowledge facts for touched symbols | correctness, consumer-impact | re-verified or dropped first ([`memory.md`](./memory.md)) |
| hotspot history as a checklist line | correctness, quality | "6 defects here in 90 d, classes: nil-deref, contract-break" |
| a prior human catch on this file | correctness | "a reviewer previously caught: …" |
| telemetry leads | correctness, consumer-impact, intent | [`telemetry.md`](./telemetry.md) — read the code the lead points at |
| the PR description and linked tickets | intent | |

Everything in that list is a **pointer at code to read**.
None of it is evidence on its own, and a finding whose evidence is a memory record, a graph edge, or a span count rather than a line of code is not a finding yet.
