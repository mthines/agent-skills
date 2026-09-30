# Why the run counter has the shape it has

The rule is [`rules/run-telemetry.md` § The run counter](../rules/run-telemetry.md#the-run-counter); this file holds only the reasons.

## Why a separate counter, not the duration histogram

`increase()` computes the difference between the last sample in the window and a baseline sample before it, in the same series.
`pr_review.run.duration` is DELTA with one point per run, written at the end, so no series ever has a sample before the one it increments.
A monotonic CUMULATIVE sum can carry its own `0`, which a histogram point written by an SDK cannot.
Durations stay on the histogram; percentiles stay on `dash0.spans.red`.

## Why one series per run

Without `service.instance.id`, every run with the same version, harness, and labels shares one series.
A second run that ends on the same cumulative value as the first reads as no change, and a value that starts over at the same number is not seen as a reset.
The run's trace id is unique per run and links a series to its trace.
About 17 runs a week times four verdicts is negligible cardinality.

## Why a 0 on every verdict, every 30 s

The verdict is known only at the end, so every verdict the run can end on needs its `0` from the start; an attribute that first appears at the end has no baseline.
When a window boundary falls inside a run, the baseline is the last sample before that boundary, and it must lie within the query's lookback; a `0` at most 30 s old always does.
Dash0's `$__rate_interval` floor is 1 minute, and a range needs two samples, so the spacing must be 30 s or less.

## Why the points are written at `finish`, not by a live exporter

A review is not one process: `prepare-review.mjs`, each marker, `finalize.mjs`, and `execute-write-plan.mjs` are separate short commands, and none of them lives for the whole run.
A live 30-second exporter would need a detached background process in every harness, with its own exit and crash handling.
The ledger already holds the run's start and end, so `finish` writes the same points a live exporter would have sent, backdated, in the export that carries the trace.
The trace and the counter leave in the same `finish`, but as two requests: `/v1/traces`, then `/v1/metrics`.
`telemetry-summary.json` says `exported: true` only when both returned 2xx, so a run whose metrics request failed is flagged, and a later `finish` sends both again.
A 2xx is not inspected for an OTLP partial success, so a backend that accepts the request but drops the backdated points breaks the equality with the `invoke_agent pr-reviewer` span count without any signal; only reading the raw `pr_review.runs` series in the backend shows it.

## Why CUMULATIVE and not a PromQL workaround

On DELTA data, `sum_over_time` and `count_over_time` counted a run twice when the window equalled the step.
The fix belongs in the data, where every query then gets it for free.
