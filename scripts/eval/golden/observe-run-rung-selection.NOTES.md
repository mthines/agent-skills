# Real baseline (not a bootstrap seed)

This golden set is a **real baseline** for the `observe-run-rung-selection` L2 suite, not a
placeholder.
Per `aw-lessons::pr-b2-bootstrap-golden-and-l1-guard-pattern`, the placeholder-seed marker used
elsewhere in this directory is reserved for a set awaiting real hosted outcome data.
Neither condition applies here: both labels are derivable from the case text alone, against a
rule file this same PR ships, so there is no hosted corpus to wait for.

## Ground truth definition

Ground truth is derived directly from
[`skills/quality/observe-run/rules/rungs.md`](../../../skills/quality/observe-run/rules/rungs.md),
never by re-running the rung-selection decision under test.
The rule defines exactly two rungs and states the deciding properties in its two comparison
tables:

| Property | Rung 1 | Rung 2 |
| --- | --- | --- |
| Availability | Offline; no Dash0 CLI, no credentials, no network | Needs the Dash0 CLI (or a portable fallback reader) plus a resolvable dev target |
| Coverage | Only the process(es) explicitly wired to the in-memory/file exporter | Cross-process — any process pointed at the default OTLP ports |
| Baseline comparability | Not stated (no row) | Yes — every run stamps identity keys queryable against a prior run |
| Cross-process fan-out | Not visible (rung 1's own Incorrect example calls this WRONG) | The deciding capability |

A case is labelled `rung-1` when the claim is scoped to one process, needs no CLI, and makes no
baseline or fan-out claim.
A case is labelled `rung-2` when the claim requires seeing a **different** process's span (fan-out,
a downstream service call), or an explicit comparison against a **prior run** (baseline), or names
`dash0 spans query` / the proxy directly.
Six of the first fourteen cases are paraphrases of the rule's own Correct/Incorrect examples and
table rows — including the rule's own Incorrect example for rung 1 (a cross-process call), which
the file itself states needs rung 2 — so the labels are traceable line-by-line to the shipped
rubric.

## Balance is necessary and not sufficient — the set must also be inseparable

The set is **15 `rung-1` / 13 `rung-2` across 28 cases**, a 53.6% majority-class baseline — below
the 70% `EVAL_GATE` floor, so neither an always-`rung-1` nor an always-`rung-2` responder passes.
That mirrors the `code-review-retrieval-relevance` suite's own correction (from a passing 4/1 split
to 8/6).

**Balance alone was not enough.**
At its original fourteen cases this set was balanced 8/6 *and* separable: a responder that answered
`rung-1` whenever the text said *process* scored 78.6%, and one keying on
*baseline* / *cross-process* / *separately-deployed* scored 85.7% — both above the gate, both
having read no rubric at all.
Fourteen **decoy** cases now break those correlations in both directions:

| Decoy direction | Surface vocabulary | Correct label | Why |
| --- | --- | --- | --- |
| `decoy-rung1-*` | *separately-deployed*, *cross-process*, *baseline*, *process* | `rung-1` | The vocabulary describes the system, not the assertion's scope. A caller's own client span, a "baseline" that is a constant rather than a prior run, and a cross-process pipeline whose claim covers one process are all decided by rung 1's Coverage row. |
| `decoy-rung2-*` | none of the three rung-2 words | `rung-2` | Three services "each deployed on its own", a browser-to-backend linkage, a sidecar that enriches after the app hands over, and a comparison against "the run recorded before the release" each need a reader that receives more than one exporter. |

The rung-2 vocabulary is a special case worth stating, because it *is* the rubric's own criterion:
`rungs.md`'s default-rung rule names cross-process fan-out, a multi-service claim, and a baseline
comparison against a prior run as the three escalation triggers.
So the decoys deliberately do **not** contradict that vocabulary — none of them makes a genuine
cross-process claim rung-1.
They separate the *word* from the *criterion*: a case may name a separately-deployed service while
asserting only on a span the process under test emits itself, and a case may need a prior run's
spans without ever saying "baseline".
That is the discrimination the suite exists to measure, and it is unreachable by keyword.

L1 `G52e` scores three declared tells per suite, **in both polarities** (a keyword that is wrong
80% of the time is an 80%-accurate classifier with its polarity flipped), and requires each to sit
below the `EVAL_GATE` floor read out of `evals-l2.yml`.
Deleting the decoys reds the build, so the set cannot silently re-degenerate into a keyword lookup.
When adding cases here, pair any new label with a decoy rather than letting the surface vocabulary
become the answer again.

### Measured after the decoys landed

CI run `34656896182` on the 28-case set: **28/28 (100.0%)**, every decoy included.
That is the pair of readings the set needs to be worth running — a rubric-reading model answers
every decoy correctly, while a rubric-free keyword responder now scores **60.7% / 64.3% / 64.3%** on
the three declared tells (`process` / rung-2 vocabulary / `offline`-`in-memory`).
Those are the figures `G52e` itself computes, so the numbers here and the numbers the guard gates on
are the same reading.
All three sit below 50% on the flipped polarity, so each tell's strength equals its accuracy.
A decoy a rubric-reader also gets wrong would not be a decoy; it would be a mislabelled case.

## What this suite measures

Given a claim about what to verify, does the model — reading `rules/rungs.md` live, and nothing
else — pick the cheaper rung whenever it can decide the claim, per the file's own "never escalates
to rung 2 when rung 1 can already decide" rule?
