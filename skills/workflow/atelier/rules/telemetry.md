---
title: Telemetry — one trace per atelier run, recorded by the scripts the run already calls
impact: MEDIUM
tags: [atelier, telemetry, otlp, dash0, dashboards]
---

# Telemetry

Every atelier run becomes one OTLP trace, `atelier.run`, with a child span per stage, and every merged-PR outcome change becomes one `atelier.outcome` span.
The scripts record it; [`scripts/telemetry.mjs`](../scripts/telemetry.mjs) is the executable form.
**Why:** [`../references/telemetry.md`](../references/telemetry.md).

## Contents

- [What records it](#what-records-it)
- [What you add](#what-you-add)
- [Export](#export)
- [Schema](#schema)
- [Reading it back](#reading-it-back)
- [Dashboard](#dashboard)

## What records it

| Boundary | Recorded by |
| --- | --- |
| run starts, `preflight` span, its gaps | `preflight.mjs` (begins the run; a run still open in the ledger is exported as `abandoned` first) |
| the next stage opens on a resume; the human wait since the last hold | `state.mjs --next` |
| `build` ends, `companions` starts; tier, skipped and accepted companions | `state.mjs --companions` |
| gate decision, `refused_by`, `user_visible`, `has_flag_contract` | `merge-gate.mjs` |
| a stage's decision; the next stage opens; a run-ending decision exports the run | `state.mjs --record` |
| outcome sweep counts; one `atelier.outcome` span per changed outcome | `outcomes.mjs` |

The ledger is `<git common dir>/atelier-telemetry/telemetry.jsonl`, shared by every worktree of the clone; set `ATELIER_RUN_DIR` to give a concurrent second run in the same clone its own.
Telemetry writes only to the ledger and stderr, never to stdout, and never changes a script's exit code.

## What you add

Three things, each riding on a command you already run; never spend a tool call on telemetry alone.

1. **Waits.** Run every command that only waits on CI through `wait`, which runs it and exits with its code:

   ```text
   ✗ node "$T" wait ci; gh pr checks <pr-url> --watch          # no command after --: a zero-length wait, the CI time booked as active
   ✓ node "$T" wait ci -- gh pr checks <pr-url> --watch        # T="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs"
   ```

   Kinds: `ci` (checks, `--watch`, the undraft poll), `review`, `human`, `other`.
2. **Memory.** On Build's `--record`, pass `--memory "lorekit=<ok|unreachable>,lessons_used=<n>"`: Step 0's LoreKit probe and the number of `aw` lessons Build applied (`0` when none).
   On any later `--record` after a bus write failed, pass `--memory "bus_failed=<n>"`.
   Unknown keys and values are dropped.
3. **Exits with nothing to record.** A preflight stop and a Build that fails before a PR exists record no stage, so end the run on your last command:

   ```bash
   node "$T" finish --outcome stopped --reason "<the Needs you: gap>"            # preflight stop
   node "$T" finish --stage build --decision failed --reason "<Needs you: line>" # Build failed, no PR
   ```

## Export

Export is opt-in; the summary (`telemetry-summary.json` next to the ledger) is written either way.

| Set | Exports to |
| --- | --- |
| `ATELIER_TELEMETRY=off` | nothing; wins over every row below |
| `ATELIER_OTLP_ENDPOINT` (+ `ATELIER_OTLP_HEADERS`) | that endpoint |
| `PR_REVIEWER_OTLP_ENDPOINT` (+ `_HEADERS`), unless `PR_REVIEWER_TELEMETRY=off` | the same backend pr-reviewer exports to |
| `ATELIER_TELEMETRY=on` and `OTEL_EXPORTER_OTLP_ENDPOINT` | the host's OTLP endpoint |
| none of these | nothing |

```text
✗ OTEL_EXPORTER_OTLP_ENDPOINT set by the host → atelier exports there     # a host's own OTEL_* is never picked up silently
✓ ATELIER_OTLP_ENDPOINT=https://ingress.eu-west-1.aws.dash0.com ATELIER_OTLP_HEADERS="Authorization=Bearer <token>,Dash0-Dataset=default"
```

`ATELIER_MODEL` (or `preflight.mjs --model <id>`) names the model; `ATELIER_HARNESS` overrides the detected harness.
`node "$T" smoke` exports one synthetic run and one outcome marked `atelier.smoke=true`, and exits 1 when the export failed.

## Schema

Every attribute and metric name below is a dashboard contract: renaming one empties the panels that read it.

| Span | Attributes |
| --- | --- |
| `atelier.run` (root) | `atelier.run.outcome` (`merged` · `held` · `refused` · `failed` · `stopped` · `abandoned`), `atelier.stage.reached`, `atelier.run.reason`, `atelier.run.reason_bucket`, `atelier.run.duration_s` · `.active_s` · `.wait_s`, `atelier.run.decisions`, `atelier.run.resumed`, `atelier.resume.idle_s` · `.after` · `.after_bucket`, `atelier.preflight.status` · `.gaps` · `.gap_count`, `atelier.tier`, `atelier.companions.decision` · `.skipped` · `.accepted`, `atelier.gate.decision` · `.refused_by` · `.contract_only`, `atelier.user_visible`, `atelier.has_flag_contract`, `atelier.memory.lorekit` · `.lessons_used` · `.bus_failed` · `.decision_events` · `.outcomes_listed`, `atelier.outcomes.final` · `.changed`; ERROR only when the outcome is `failed` |
| `atelier.stage <name>` | `preflight` · `setup` (a resume before `--next`) · `build` · `companions` · `ready` · `merge`; `atelier.stage.name`, `.decision`, `.reason`, `.reason_bucket`, `.recorded_as` (the state-machine stage when it differs); ERROR only on `failed` |
| `atelier.wait <kind>` | child of its stage; `atelier.wait.kind`, `atelier.wait.exit_code` |
| `atelier.outcome` | its own trace; `atelier.outcome` (`clean` · `reverted` · `hotfixed`), `atelier.outcome.previous`, `atelier.outcome.evidence_count`, `atelier.merge_sha` |
| every span | `vcs.repository.name`, `vcs.owner.name`, `vcs.repository.url.full`, `vcs.change.id` (PR number), `vcs.ref.head.revision`, `atelier.pr.url`, `atelier.run.id`, `atelier.harness`, `gen_ai.request.model`, `atelier.smoke` |

`atelier.*.reason_bucket` is a bounded enum (`REASON_BUCKETS` in `telemetry.mjs`); group by it, never by the free-text reason.

| Metric | Type | Attributes |
| --- | --- | --- |
| `atelier.runs` | CUMULATIVE sum, one series per run (`service.instance.id` = trace id), 0 baseline every 30 s | `atelier.run.outcome`, `atelier.smoke` |
| `atelier.prs.merged` | same shape, final value 1 when merged | `atelier.smoke` |
| `atelier.outcomes` | CUMULATIVE sum, 0 then 1 per outcome change | `atelier.outcome`, `atelier.smoke` |
| `atelier.stage.duration` | DELTA histogram, seconds | `atelier.stage.name`, `atelier.stage.decision` |
| `atelier.wait.duration` | DELTA histogram, seconds | `atelier.wait.kind` (`human` = idle between a hold and the resume) |

```promql
# correct: runs counted with the counter, anchored, the window equal to the step
sum by (atelier_run_outcome) (increase({otel_metric_name="atelier.runs", service_name="atelier", atelier_smoke=""}[1d] anchored))

# incorrect: one DELTA point per run has no baseline, so runs go missing
histogram_count(increase({otel_metric_name="atelier.stage.duration"}[1d]))
```

Percentiles come from Dash0's `dash0.spans.duration`; D0QL has no `quantile`.

## Reading it back

Run with the Dash0 `sql` tool on the dataset the export targets; `duration` is nanoseconds, and an absent attribute reads `''`.

```sql
-- runs per time bucket by outcome
SELECT time_bucket(timestamp) AS t, span_attributes['atelier.run.outcome'] AS outcome, count() AS runs
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.smoke'] != 'true'
GROUP BY t, outcome ORDER BY t

-- merged PRs (run over the week you want)
SELECT uniqExact(span_attributes['atelier.pr.url']) AS merged FROM spans
WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.run.outcome'] = 'merged' AND span_attributes['atelier.smoke'] != 'true'

-- time per stage (avg and max; percentiles: the dashboard's dash0.spans.duration panels)
SELECT span_attributes['atelier.stage.name'] AS stage, count() AS n, avg(duration) / 1e9 AS avg_s, max(duration) / 1e9 AS max_s
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name LIKE 'atelier.stage %' GROUP BY stage

-- active vs waiting, per run and in total
SELECT sum(toFloat64OrZero(span_attributes['atelier.run.active_s'])) AS active_s, sum(toFloat64OrZero(span_attributes['atelier.run.wait_s'])) AS waiting_in_run_s,
       sum(toFloat64OrZero(span_attributes['atelier.resume.idle_s'])) AS waiting_on_human_s
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.smoke'] != 'true'

-- where runs stop, and why
SELECT span_attributes['atelier.stage.name'] AS stage, span_attributes['atelier.stage.decision'] AS decision, span_attributes['atelier.stage.reason_bucket'] AS why, count() AS n
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name LIKE 'atelier.stage %' AND span_attributes['atelier.stage.decision'] IN ('hold', 'refuse', 'failed')
GROUP BY stage, decision, why ORDER BY n DESC

-- companions most often skipped, and preflight gaps
SELECT span_attributes['atelier.companions.skipped'] AS skipped, span_attributes['atelier.preflight.gaps'] AS gaps, count() AS runs
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' GROUP BY skipped, gaps ORDER BY runs DESC

-- revert and hotfix rate over merged PRs that reached a final outcome
SELECT uniqExact(span_attributes['atelier.pr.url']) AS classified,
       uniqExactIf(span_attributes['atelier.pr.url'], span_attributes['atelier.outcome'] = 'reverted') AS reverted,
       uniqExactIf(span_attributes['atelier.pr.url'], span_attributes['atelier.outcome'] = 'hotfixed') AS hotfixed
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.outcome' AND span_attributes['atelier.smoke'] != 'true'

-- memory: LoreKit reachability, lessons applied, decision events expected, sweep reads
SELECT span_attributes['atelier.memory.lorekit'] AS lorekit, count() AS runs, sum(toFloat64OrZero(span_attributes['atelier.memory.lessons_used'])) AS lessons,
       sum(toFloat64OrZero(span_attributes['atelier.memory.decision_events'])) AS decision_events, sum(toFloat64OrZero(span_attributes['atelier.memory.bus_failed'])) AS bus_failed,
       sum(toFloat64OrZero(span_attributes['atelier.memory.outcomes_listed'])) AS outcome_reads
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' GROUP BY lorekit
```

A pr-reviewer or other skill's trace started during a run joins by PR and time: its `dash0.gen_ai.vcs.pull_request.url` equals the run's `atelier.pr.url`, and its timestamp falls inside the run's `atelier.stage build` or `ready` span.

## Dashboard

[`dashboards/atelier.json`](../dashboards/atelier.json) is a Perses dashboard: throughput, bottlenecks (stage time, active vs waiting), why runs stop (holds, companions, preflight, outcomes), and memory.
Import it in Dash0 under Dashboards → Create → Import (paste the JSON), or apply it as a `PersesDashboard` resource through the Dash0 operator; never edit it from a run.
