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

The set is **11 `behavioral` / 9 `by-construction` across 20 cases**, a 55.0% majority-class
baseline — below the 70% `EVAL_GATE` floor, so neither an always-`behavioral` nor an
always-`by-construction` responder passes.
That mirrors the `code-review-retrieval-relevance` suite's own correction (from a passing 4/1 split
to 8/6).

**Balance alone was not enough, and this set is the proof.**
At its original fourteen cases it was balanced 8/6 *and* trivially keyword-separable: every
`by-construction` assertion carried a static-read verb (`grep`, `statically`, *read the source*,
*without running*) and every `behavioral` one said *run*.
A responder keying on that one verb scored 14/14 having never consulted the discriminator, so a
green run measured nothing.
Six **decoy** cases now break the correlation, in both directions:

| Decoy direction | Surface verb | Correct label | Why |
| --- | --- | --- | --- |
| `decoy-byconstruction-*` (3) | *run the suite*, *execute the flow*, *start the service under the OTLP proxy* | `by-construction` | The run is a red herring — nothing about its outcome is read. The check is a source grep or a declaration inspection, so the discriminator still answers *yes, source alone settles it*. |
| `decoy-behavioral-*` (3) | *grep*, *without running anything further* | `behavioral` | The static verb targets the **emitted** OTLP export or a recorded trace, not source. An execution artifact cannot be read out of the diff, so the discriminator answers *no*. |

The sharpest of the six opens with *"without running anything further"* — near-verbatim the phrase
another case uses to signal `by-construction` — and is nonetheless `behavioral`, because the trace
it reads is something a run produced.

L1 `G52e` asserts **both** directions mechanically (≥ 2 `by-construction` cases wearing a run verb,
≥ 2 `behavioral` cases wearing a static-read verb), evaluated against the **assertion clause only**
and with negated run verbs stripped before the run-verb test — *without running* is a static tell,
not a run.
Deleting the decoys reds the build, so the set cannot silently re-degenerate into a keyword lookup.
When adding cases here, pair any new label with a decoy rather than letting the surface verb become
the answer again.

## What this suite measures

Given a claim-plus-assertion pair, does the model — reading `rules/assertion-provenance.md` live,
and nothing else — apply the discriminator correctly and classify the assertion as `behavioral` or
`by-construction`?
This is the suite `observe-run`'s own centerpiece rule names as its reason for existing: an agent
that writes the instrumentation and then asserts on the instrumentation it wrote passes by
construction, and this suite is the regression guard against that failure mode drifting back into
the rule's own prose.
