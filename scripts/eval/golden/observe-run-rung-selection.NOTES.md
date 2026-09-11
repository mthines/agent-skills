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
Six of the fourteen cases are paraphrases of the rule's own Correct/Incorrect examples and table
rows — including the rule's own Incorrect example for rung 1 (a cross-process call), which the
file itself states needs rung 2 — so the labels are traceable line-by-line to the shipped rubric.

## Label balance is a correctness property, not a statistic

The set is **8 `rung-1` / 6 `rung-2` across 14 cases**, a 57.1% majority-class baseline — below the
70% `EVAL_GATE` floor, so neither an always-`rung-1` nor an always-`rung-2` responder passes.
This mirrors the `code-review-retrieval-relevance` suite's own correction (from a passing 4/1 split
to 8/6): the split is chosen so a green run means the model applied the two-rung distinction, not
that it picked the more common label.

## What this suite measures

Given a claim about what to verify, does the model — reading `rules/rungs.md` live, and nothing
else — pick the cheaper rung whenever it can decide the claim, per the file's own "never escalates
to rung 2 when rung 1 can already decide" rule?
