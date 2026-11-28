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
- [Abandoned runs](#abandoned-runs)
- [Reading it back](#reading-it-back)
- [Dashboard](#dashboard)

## What records it

| Boundary | Recorded by |
| --- | --- |
| run starts, `preflight` span, its new and accepted gaps; the work (`--ticket`, `--task`, branch, `origin` repo, the branch's open PR via `gh`) | `preflight.mjs` (begins the run; a run still open in the ledger is exported as `abandoned`, ending at its own last event — [Abandoned runs](#abandoned-runs)) |
| the run's PR, as soon as any command names it (`--pr` URL, or a number resolved against `origin`) | `state.mjs --next` · `--companions` · `--record`, `merge-gate.mjs --pr` |
| the next stage opens on a resume; the human wait since the last hold | `state.mjs --next` |
| `build` ends, `companions` starts; tier, skipped and accepted companions | `state.mjs --companions` |
| a finished after-Build checklist step | `state.mjs --checkpoint` |
| gate decision, `refused_by`, `user_visible`, `has_flag_contract`, early or no-CI, the no-flag class that let a diff through (`gate.no_flag_class`), how many flag triggers hit (`gate.flag_triggers`), and which warning a pass carried (`gate.no_provider_warning` or `gate.no_deploy_verify_warning`) | `merge-gate.mjs` |
| a stage's decision; the next stage opens; a run-ending decision exports the run | `state.mjs --record` |
| outcome sweep counts; one `atelier.outcome` span per changed outcome | `outcomes.mjs` |
| the open run's state as one `atelier.run.state` gauge point, at each run boundary above (not the outcome sweep) and at the start and end of every `wait` | `emitState` in `telemetry.mjs`; a run that ends exports it with its trace |

The ledger is `<git common dir>/atelier-telemetry/telemetry.jsonl`, shared by every worktree of the clone; set `ATELIER_RUN_DIR` to give a concurrent second run in the same clone its own.
Telemetry writes only to the ledger and stderr, never to stdout, and never changes a script's exit code.

## What you add

Three things, each riding on a command you already run; never spend a tool call on telemetry alone.

1. **Waits.** Run every command that only waits on CI or on a review through `wait`, which runs it and exits with its code:

   ```text
   ✗ node "$T" wait ci; gh pr checks <pr-url> --watch          # no command after --: a zero-length wait, the CI time booked as active
   ✓ node "$T" wait ci -- node ci-wait.mjs --pr <pr-url>       # T="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs"
   ```

   Kinds: `ci` (checks, `ci-wait.mjs`, the undraft poll), `review` (`approval-wait.mjs`), `human`, `other`.
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

A run is marked `atelier.smoke=true`, and every dashboard panel drops it, in exactly these cases (`atelier.smoke_reason`):

| Case | `atelier.smoke_reason` |
| --- | --- |
| `ATELIER_SMOKE=1` or `true` in the environment; set it in every test or e2e path that can export | `env` |
| the repo has no `origin` remote (a scratch repo) | `no-remote` |
| `node "$T" smoke` | `smoke-command` |

```text
✗ ATELIER_OTLP_ENDPOINT=… node e2e-atelier.mjs                  # a test run lands on the dashboard as a real run
✓ ATELIER_SMOKE=1 ATELIER_OTLP_ENDPOINT=… node e2e-atelier.mjs   # exported, marked smoke, filtered out
```

A repo with an `origin` remote is never marked smoke by the scripts: a real run in any repo counts.

## Schema

Every attribute and metric name below is a dashboard contract: renaming one empties the panels that read it.

| Span | Attributes |
| --- | --- |
| `atelier.run` (root) | `atelier.run.outcome` (`merged` · `held` · `refused` · `failed` · `stopped` · `abandoned`), `atelier.stage.reached`, `atelier.run.reason`, `atelier.run.reason_bucket`, `atelier.run.duration_s` · `.active_s` · `.wait_s`, `atelier.run.decisions`, `atelier.run.duplicate`, `atelier.run.resumed`, `atelier.resume.idle_s` · `.after` · `.after_bucket`, `atelier.abandon.last_event` · `.idle_s` · `.same_work`, `atelier.preflight.status` · `.gaps` (new only) · `.gap_count` · `.accepted` · `.accepted_count`, `atelier.tier`, `atelier.companions.decision` · `.skipped` · `.accepted`, `atelier.checklist.step`, `atelier.gate.decision` · `.refused_by` · `.contract_only` · `.early` · `.no_ci`, `atelier.user_visible`, `atelier.has_flag_contract`, `atelier.memory.lorekit` · `.lessons_used` · `.bus_failed` · `.decision_events` · `.outcomes_listed`, `atelier.outcomes.final` · `.changed`; ERROR only when the outcome is `failed` |
| `atelier.stage <name>` | `preflight` · `setup` (a resume before `--next`) · `build` · `companions` · `ready` · `merge`; `atelier.stage.name`, `.decision`, `.reason`, `.reason_bucket`, `.recorded_as` (the state-machine stage when it differs); ERROR only on `failed` |
| `atelier.wait <kind>` | child of its stage; `atelier.wait.kind`, `atelier.wait.exit_code` |
| `atelier.outcome` | its own trace; `atelier.outcome` (`clean` · `reverted` · `hotfixed`), `atelier.outcome.previous`, `atelier.outcome.evidence_count`, `atelier.merge_sha` |
| every span | `vcs.repository.name`, `vcs.owner.name`, `vcs.repository.url.full`, `vcs.change.id` (PR number), `vcs.ref.head.revision`, `vcs.ref.head.name` (branch at preflight), `atelier.pr.url`, `atelier.ticket.id`, `atelier.ticket.url`, `atelier.task.title` (≤ 120 chars), `atelier.work.ref`, `atelier.run.id`, `atelier.harness`, `gen_ai.request.model`, `atelier.smoke`, `atelier.smoke_reason` |

`atelier.work.ref` is never empty: the PR URL, else the ticket URL, else the ticket id, else `<owner>/<repo>@<branch>`, else `unknown`; show it as a table's identifying column.

`atelier.*.reason_bucket` is a bounded enum (`REASON_BUCKETS` in `telemetry.mjs`); group by it, never by the free-text reason.

| Metric | Type | Attributes |
| --- | --- | --- |
| `atelier.runs` | CUMULATIVE sum, one series per run (`service.instance.id` = trace id), 0 baseline every 30 s | `atelier.run.outcome`, `atelier.smoke`, `atelier.run.duplicate` |
| `atelier.prs.merged` | same shape, final value 1 when merged | `atelier.smoke`, `atelier.run.duplicate` |
| `atelier.run.state` | GAUGE, seconds: epoch time of the transition; one series per run and state | `atelier.run.id`, `atelier.work.ref`, `vcs.repository.name`, `atelier.stage.name`, `atelier.run.state` (`active` · `waiting_ci` · `waiting_review` · `waiting_human` · `waiting_other` · then the six outcomes), `atelier.reason_bucket` (ended runs), `atelier.smoke` |
| `deployment.rollout.state` | GAUGE, seconds, from `deployment-verify` (service `deployment-verify`): epoch time of the rollout's last transition; keyed by `atelier.work.ref` (the run's PR URL) | `deployment.phase`, `deployment.step`, `deployment.outcome`, `deployment.env`, `atelier.smoke` |
| `atelier.outcomes` | CUMULATIVE sum, 0 then 1 per outcome change | `atelier.outcome`, `atelier.smoke` |
| `atelier.stage.duration` | DELTA histogram, seconds | `atelier.stage.name`, `atelier.stage.decision`, `atelier.smoke` |
| `atelier.wait.duration` | DELTA histogram, seconds | `atelier.wait.kind` (`human` = idle between a hold and the resume), `atelier.smoke` |

```promql
# correct: runs counted with the counter, anchored, the window equal to the step
sum by (atelier_run_outcome) (increase({otel_metric_name="atelier.runs", service_name="atelier", atelier_smoke=""}[1d] anchored))

# incorrect: one DELTA point per run has no baseline, so runs go missing
histogram_count(increase({otel_metric_name="atelier.stage.duration"}[1d]))
```

The board ("Pipeline now") reads `atelier.run.state`; an ended run, `held` included, drops off the in-flight panels:

```promql
# correct: the newest state per run, runs that have ended removed
topk by (atelier_run_id) (1, last_over_time({otel_metric_name="atelier.run.state", service_name="atelier", atelier_smoke=""}[3d]))
  unless on (atelier_run_id) last_over_time({otel_metric_name="atelier.run.state", service_name="atelier", atelier_smoke="", atelier_run_state=~"merged|held|refused|failed|stopped|abandoned"}[3d])

# incorrect: every state a run passed through, so one PR is listed once per state
last_over_time({otel_metric_name="atelier.run.state", service_name="atelier", atelier_smoke=""}[3d])
```

```promql
# incorrect: time() - gauge returned one value for every series in Dash0
time() - topk by (atelier_run_id) (1, last_over_time({otel_metric_name="atelier.run.state", service_name="atelier"}[3d]))
```

Stage percentiles and totals come from the `atelier.stage.duration` histogram, never from `dash0.spans.duration`, which returned no value grouped by `atelier_stage_name`.
A run's `atelier.run.wait_s` equals the sum of its `atelier.wait` spans and of its non-`human` `atelier.wait.duration` points.

```promql
# correct: p90 per stage from atelier's own histogram, smoke runs dropped
histogram_quantile(0.9, sum by (atelier_stage_name) (increase({otel_metric_name="atelier.stage.duration", service_name="atelier", atelier_smoke=""}[$__range])))

# incorrect: the derived span metric returned no value per stage, so the panel was empty
histogram_quantile(0.9, sum by (atelier_stage_name) (increase({otel_metric_name="dash0.spans.duration", otel_span_name=~"atelier.stage .*"}[$__range])))
```

D0QL has no `quantile`.

## Abandoned runs

A run whose session ended with no run-ending record is closed by the next `preflight.mjs` as `abandoned`, reason `superseded: a later run began` (bucket `superseded`), and its root span says what it last did:

| Attribute | Value |
| --- | --- |
| `atelier.abandon.last_event` | the open stage, plus the checklist step or decision when the last record names one: `stage companions · checklist sentinel`, `decision build hold` |
| `atelier.abandon.idle_s` | seconds from its last record to the next run's start |
| `atelier.abandon.same_work` | the next run names the same PR, else the same ticket, else the same repo and branch |
| `atelier.run.duplicate` | `true` when it recorded no decision and was active ≤ 20 s (`DUPLICATE_MAX_ACTIVE_S`); its bucket is then `duplicate` |

A duplicate is a double invocation or a dropped start, not lost work: every throughput panel filters `atelier_run_duplicate=""`, the merge rate in its denominator too.

```promql
# correct: duplicates leave the denominator; a merged run is never a duplicate
sum(increase({otel_metric_name="atelier.prs.merged", service_name="atelier", atelier_smoke=""}[$__range] anchored)) / sum(increase({otel_metric_name="atelier.runs", service_name="atelier", atelier_smoke="", atelier_run_duplicate=""}[$__range] anchored))

# incorrect: nine 3 s double invocations halve the merge rate
sum(increase({otel_metric_name="atelier.prs.merged", service_name="atelier", atelier_smoke=""}[$__range] anchored)) / sum(increase({otel_metric_name="atelier.runs", service_name="atelier", atelier_smoke=""}[$__range] anchored))
```

## Reading it back

Run with the Dash0 `sql` tool on the dataset the export targets; `duration` is nanoseconds, and an absent attribute reads `''`.

```sql
-- recent runs: one row per run, identified by work.ref even before a PR exists
SELECT timestamp AS started, span_attributes['atelier.work.ref'] AS work, span_attributes['atelier.ticket.id'] AS ticket, span_attributes['atelier.task.title'] AS task,
       span_attributes['atelier.run.outcome'] AS outcome, span_attributes['atelier.stage.reached'] AS reached, span_attributes['atelier.run.reason_bucket'] AS why,
       round(duration / 1e9) AS duration_s, span_attributes['atelier.pr.url'] AS pr, span_attributes['atelier.run.id'] AS run_id
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.smoke'] != 'true'
ORDER BY started DESC LIMIT 50

-- runs per time bucket by outcome
SELECT time_bucket(timestamp) AS t, span_attributes['atelier.run.outcome'] AS outcome, count() AS runs
FROM spans WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.smoke'] != 'true'
GROUP BY t, outcome ORDER BY t

-- merged PRs (run over the week you want)
SELECT uniqExact(span_attributes['atelier.pr.url']) AS merged FROM spans
WHERE resource_attributes['service.name'] = 'atelier' AND name = 'atelier.run' AND span_attributes['atelier.run.outcome'] = 'merged' AND span_attributes['atelier.smoke'] != 'true'

-- time per stage (avg and max; percentiles: the dashboard's atelier.stage.duration panels)
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

[`dashboards/atelier.json`](../dashboards/atelier.json) is a Perses dashboard: the pipeline now (in-flight runs by stage and state, recently ended runs with their reason), the rollout after the merge (`deployment.rollout.state`, written by `deployment-verify`), throughput, bottlenecks (stage time, active vs waiting), why runs stop (holds, companions, preflight, outcomes), and memory.
Import it in Dash0 under Dashboards → Create → Import (paste the JSON), or apply it as a `PersesDashboard` resource through the Dash0 operator; never edit it from a run.
Import it into the dataset the export targets (`Dash0-Dataset` in `ATELIER_OTLP_HEADERS`, `PR_REVIEWER_OTLP_HEADERS`, or `OTEL_EXPORTER_OTLP_HEADERS` under `ATELIER_TELEMETRY=on`) on the Dash0 instance that endpoint belongs to.
