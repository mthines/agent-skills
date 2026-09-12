# Real baseline (not a bootstrap seed)

This golden set is a **real baseline** for the `observe-run-assertion-provenance` L2 suite, not a
placeholder.
Per `aw-lessons::pr-b2-bootstrap-golden-and-l1-guard-pattern`, the placeholder-seed marker used
elsewhere in this directory is reserved for a set awaiting real hosted outcome data.
Neither condition applies here: both labels are derivable from the case text alone, against a rule
file this same PR ships, so there is no hosted corpus to wait for.

## Ground truth definition

Ground truth is derived directly from
[`skills/quality/observe-run/rules/assertion-provenance.md`](../../../skills/quality/observe-run/rules/assertion-provenance.md),
never by re-running the classification under test.
The rule states its own discriminator explicitly:

> Ask: could this assertion be satisfied by reading the source code alone, without running
> anything? If yes, it is by-construction … If no — the answer depends on what happened when the
> code ran — it is behavioral.

A case is labelled `behavioral` when the assertion names an executed run (a command, a request, a
load test) and reads what that run produced, matching one of the file's seven allowed kinds (span
count, parent/child structure, duration, span status on the error path, downstream fan-out,
attribute cardinality, ordering) — eight cases cover all seven kinds, with kind 4 (span status on
the error path) covered twice under two different operations.
A case is labelled `by-construction` when the assertion is answerable by reading source or the
diff alone — a `grep` for a span-creation call, a static confirmation that `.setAttribute(...)` is
declared, a diff search for `startSpan` — matching the file's forbidden pattern and its own
Incorrect example verbatim in one case.

## Balance is necessary and not sufficient — the set must also be inseparable

The set is **21 `behavioral` / 18 `by-construction` across 39 cases**, a 53.8% majority-class
baseline — below the 70% `EVAL_GATE` floor, so neither an always-`behavioral` nor an
always-`by-construction` responder passes.
That mirrors the `code-review-retrieval-relevance` suite's own correction (from a passing 4/1 split
to 8/6).

**Balance alone was not enough, and this set is the proof.**
At its original fourteen cases it was balanced 8/6 *and* trivially keyword-separable: every
`by-construction` assertion carried a static-read verb (`grep`, `statically`, *read the source*,
*without running*) and every `behavioral` one said *run*.
A responder keying on that one verb scored a perfect **14/14** having never consulted the
discriminator, so a green run measured nothing.
Twenty-five **decoy** cases now break three separate correlations, in both directions:

| Decoy direction | Surface tell it wears | Correct label | Why |
| --- | --- | --- | --- |
| `decoy-byconstruction-*` with a run verb | *run the suite*, *execute the flow*, *start the service under the OTLP proxy* | `by-construction` | The run is a red herring — nothing about its outcome is read. The check is a source grep, a declaration inspection, or a diff read, so the discriminator still answers *yes, source alone settles it*. |
| `decoy-behavioral-*` with a static-read verb | *grep*, *statically scan*, *without running anything further* | `behavioral` | The static verb targets the **emitted** export or a recorded trace, not source. An execution artifact cannot be read out of the diff, so the discriminator answers *no*. |
| `decoy-behavioral-*` naming `startSpan` | the `startSpan` literal, which the rule uses only in its *Incorrect* example | `behavioral` | How many times a call **fired**, or whether context propagated when it did, is a runtime fact. The API's spelling is incidental; the discriminator is about what settles the claim. |
| `decoy-byconstruction-*` naming no `startSpan` and no static verb | none of the three | `by-construction` | An import plus a wrapper, or an attribute key passed at a span-builder call, is a source fact however it is phrased — the forbidden pattern does not depend on the API's spelling. |

The sharpest decoy opens with *"without running anything further"* — near-verbatim the phrase
another case uses to signal `by-construction` — and is nonetheless `behavioral`, because the trace
it reads is something a run produced.

L1 `G52e` scores three declared tells per suite, **in both polarities** (a keyword that is wrong
80% of the time is an 80%-accurate classifier with its polarity flipped), and requires each to sit
below the `EVAL_GATE` floor read out of `evals-l2.yml` rather than re-encoded.
Negated run verbs are stripped before any tell is matched — *without running* is a static tell, not
a run, and counting it as one let an earlier version of this guard pass on two cases that execute
nothing at all.
Deleting the decoys reds the build, so the set cannot silently re-degenerate into a keyword lookup.
When adding cases here, pair any new label with a decoy rather than letting the surface verb become
the answer again.

### Why the guard scores *declared* tells and not the best of every token

An unrestricted scan for the single best keyword classifier is an authoring aid, never a gate.
At n≈30 it searches several hundred tokens and finds stopwords by chance: `and`, `one`, and `with`
all land near 70% on these sets, and `confirm` scores ~76% while pointing at **opposite** labels in
the two suites — which is the proof it is sampling noise rather than a shortcut anything could
learn.
A guard chasing that maximum would chase chance forever and could never be satisfied.
So the tells are declared, one per decision dimension, and fixed in `l1.mjs`; run the scan when
authoring new cases, and if it surfaces a token that is genuinely a shortcut rather than a
stopword, add it to the declared list with its own decoys.

### Measured after the decoys landed

CI run `34656896182` on the 39-case set: **39/39 (100.0%)**, every decoy included.
That is the pair of readings the set needs to be worth running — a rubric-reading model answers
every decoy correctly, while a rubric-free keyword responder now scores **53.8% / 61.5% / 61.5%** on
the three declared tells (run verb / `startSpan` / static verb).
Those are the figures `G52e` itself computes, negation strip included, so the numbers here and the
numbers the guard gates on are the same reading — an earlier draft quoted 48.7% for the run tell,
scored without the strip, which is not what anything enforces.
All three sit **above** 50%, so `max(acc, 100 - acc)` selects the accuracy itself: the strength the
guard gates on is 53.8 / 61.5 / 61.5, not the flipped complement.
Deleting the `decoy-` cases returns the run tell to **100.0%** — a rubric-free responder scored a
perfect 14/14 on the set as originally shipped.
A decoy a rubric-reader also gets wrong would not be a decoy; it would be a mislabelled case.

## What this suite measures

Given a claim-plus-assertion pair, does the model — reading `rules/assertion-provenance.md` live,
and nothing else — apply the discriminator correctly and classify the assertion as `behavioral` or
`by-construction`?
This is the suite `observe-run`'s own centerpiece rule names as its reason for existing: an agent
that writes the instrumentation and then asserts on the instrumentation it wrote passes by
construction, and this suite is the regression guard against that failure mode drifting back into
the rule's own prose.
