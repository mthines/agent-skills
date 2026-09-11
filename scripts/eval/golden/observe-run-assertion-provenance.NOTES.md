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
the error path) covered twice under two different operations to keep the set at fourteen without
skewing the split.
A case is labelled `by-construction` when the assertion is answerable by reading source or the
diff alone — a `grep` for a span-creation call, a static confirmation that `.setAttribute(...)` is
declared, a diff search for `startSpan` — matching the file's forbidden pattern and its own
Incorrect example verbatim in one case.

## Label balance is a correctness property, not a statistic

The set is **8 `behavioral` / 6 `by-construction` across 14 cases**, a 57.1% majority-class
baseline — below the 70% `EVAL_GATE` floor, so neither an always-`behavioral` nor an
always-`by-construction` responder passes.
This mirrors the `code-review-retrieval-relevance` suite's own correction (from a passing 4/1 split
to 8/6): the split is chosen so a green run means the model applied the discriminator, not that it
picked the more common label.

## What this suite measures

Given a claim-plus-assertion pair, does the model — reading `rules/assertion-provenance.md` live,
and nothing else — apply the discriminator correctly and classify the assertion as `behavioral` or
`by-construction`?
This is the suite `observe-run`'s own centerpiece rule names as its reason for existing: an agent
that writes the instrumentation and then asserts on the instrumentation it wrote passes by
construction, and this suite is the regression guard against that failure mode drifting back into
the rule's own prose.
