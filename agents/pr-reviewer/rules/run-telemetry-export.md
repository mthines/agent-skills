# Run telemetry — exporting and querying

The rule the reviewer follows while it runs is [`run-telemetry.md`](./run-telemetry.md); this file holds the rules for whoever exports, queries, or changes the trace, and is not inlined into the Agent0 bundle.

## Exporting to Dash0

Export is opt-in.
Set `PR_REVIEWER_OTLP_ENDPOINT` and `PR_REVIEWER_OTLP_HEADERS`, or set `PR_REVIEWER_TELEMETRY=on` to reuse the standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.
A host's own `OTEL_*` variables are never picked up silently: an Agent0 sandbox sets them for its own process telemetry, and a review trace carries repository names, PR URLs, and a git user name.
`PR_REVIEWER_TELEMETRY=off` wins over everything.
The summary — `telemetry-summary.json`, and a table on stderr — is written whether or not anything is exported.

```text
PR_REVIEWER_OTLP_ENDPOINT=https://ingress.eu-west-1.aws.dash0.com
PR_REVIEWER_OTLP_HEADERS=Authorization=Bearer <token>,Dash0-Dataset=default
```

### On an Agent0 Automation

An automation's `sandbox.envVars` reach its setup script and never the run, and the installer does not copy them anywhere: the export headers carry a token, and `review-telemetry.mjs` reads the settings from the run's own environment only.
Export them to the run from a setup script, through `$DASH0_AGENT_ENV`, in the `export` form the repo's own installers append there — `%q`-quoted, because the headers hold a space:

```bash
# In the automation's (or the organization's global) setup script:
if [ -n "${DASH0_AGENT_ENV:-}" ]; then
  printf 'export PR_REVIEWER_OTLP_ENDPOINT=%q\n' "https://ingress.eu-west-1.aws.dash0.com" >> "$DASH0_AGENT_ENV"
  printf 'export PR_REVIEWER_OTLP_HEADERS=%q\n' "Authorization=Bearer <ingest-only token>,Dash0-Dataset=default" >> "$DASH0_AGENT_ENV"
fi
```

1. Use an ingest-only token limited to one dataset: the value is visible to the run, and to anyone who can read the setup script.
2. The host must reach the endpoint: a `trusted_only` sandbox reaches only allowlisted hosts.
3. When the installer sees these variables in its own environment it prints a note that it did not write them, never their values.

The harness is named `agent0` when either `/tmp/workspace/agent-skills/env.sh` or `/tmp/workspace/pr-reviewer/env.sh` exists; an automation that installs only the reviewer writes the second.
An `agent0` run exports under the AI SDLC Insights scope ([§ The scope](#the-scope)), so it is listed there as an `agent0` session.

### The trace

It follows the [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) as Dash0 reads them for coding agents ([span attributes](https://dash0.com/docs/dash0/darkplane/insights/span-attributes)), and the attribute contract of the [Dash0 agent plugin](https://github.com/dash0hq/dash0-agent-plugin):

| Span | Attributes |
| --- | --- |
| `invoke_agent pr-reviewer` (root) | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.id=<run id>`, `gen_ai.conversation.name=pr-reviewer <owner>/<repo>#<n>` (only when the run is not joined to a harness session), `pr_review.opencode.parent_tool_call_id` (the OpenCode tool call that ran `begin`, when `OPENCODE_PARENT_TOOL_CALL_ID` is set), the outcome under `pr_review.*` (including where each scored candidate went — `posted_inline`, `deferred`, `dedupe_dropped`, `confidence_dropped`, `advisory_deferred`, `anchorless`, and `memory.suppressed` — and `pr_review.impact_image` = `added` · `skipped` · `failed` and `pr_review.impact_image.reason`), the memory the review used and read ([§ The memory](./run-telemetry.md#the-memory)), and the lenses it loaded ([§ The lenses](./run-telemetry.md#the-lenses)) |
| `pr_review.step <name>` | `pr_review.step.name`, `pr_review.step.kind` (`script` · `model` · `dispatch`), `pr_review.step.marked`, `pr_review.opencode.tool_call_id` (the OpenCode tool call whose marker opened it, when `OPENCODE_PARENT_TOOL_CALL_ID` is set); ERROR with `error.type=step_failed` when the step failed; the `lenses` step also carries `pr_review.lenses.loaded` and `pr_review.lenses.names` |
| `pr_review.phase <name>` | child of a script step: `pr_review.step.name`, `pr_review.phase.name` |
| `pr_review.worker <unit>` | `pr_review.worker.unit` |
| every span | `gen_ai.agent.name`, `gen_ai.conversation.id`, `dash0.gen_ai.vcs.*` (repository, owner, PR URL, head ref and revision), `user.name` |

Two histograms carry the durations across runs: `pr_review.step.duration` (by step and kind) and `pr_review.run.duration` (by tier, topology, and verdict).
Neither carries a run id, a PR number, or a user as an attribute.

### The scope

The run's trace and metrics export under one instrumentation scope, picked by the harness its spans name:

| Harness | Scope |
| --- | --- |
| `agent0` (`SESSION_HARNESSES`) | `dash0-agent-plugin` — the scope AI SDLC Insights lists sessions from |
| every other harness, and none | `agent-skills/pr-reviewer` |

Add a harness to `SESSION_HARNESSES` only when no Dash0 agent plugin records its sessions.
Never add a `PLUGIN_HARNESSES` member — the plugin already emits `invoke_agent pr-reviewer` there, and a second one under its scope counts every review twice — and never a CI or smoke harness, which would list synthetic runs as sessions.

**Why:** [`references/insights-scope.md`](../references/insights-scope.md).

### The run counter

Count runs with `pr_review.runs`, never with `histogram_count` of `pr_review.run.duration`: that histogram is DELTA with one point per run, so `increase()` finds no baseline and drops runs.

| Property | Value |
| --- | --- |
| Type | monotonic Sum, CUMULATIVE (`aggregationTemporality: 2`), unit `{run}` |
| Series | one per verdict per run — the resource's `service.instance.id` is the run's trace id |
| Verdicts | `PASS`, `WARN`, `FAIL`, and `none` for a run that finished without one (`finish --status error` before a finalize rendered) |
| Attributes | `pr_review.verdict`, `pr_review.dry_run` (omitted when the run finished before finalize), `pr_review.tier` |
| Points | a `0` on every series 1 ms after the run's start and every 30 s after that, then the final point at the run's end: `1` on the run's verdict, `0` on the rest; every point's `startTimeUnixNano` is the run's start. At most 480 points per series: a run longer than 4 h keeps its first `0` and the last 478 before the final point |

`finish` writes every point in the same export as the trace, backdated to the times it describes: two requests, `/v1/traces` then `/v1/metrics`, and `telemetry-summary.json` says `exported: true` only when both returned 2xx.
A run that never reaches `finish` exports neither, so the counter's total equals the number of `invoke_agent pr-reviewer` spans whenever both requests were accepted in full; an OTLP partial success that drops points is not detected.

Query it with an anchored `increase` whose window equals the step, summed over the instances:

```promql
# correct: one point per 5-minute step, each run counted in the step its end falls in
sum by (pr_review_verdict) (increase({otel_metric_name="pr_review.runs", service_name="pr-reviewer"}[5m] anchored))

# incorrect: a DELTA histogram with one point per run has no baseline, so runs go missing
histogram_count(increase({otel_metric_name="pr_review.run.duration"}[5m] anchored))
```

**Why:** [`references/run-counter.md`](../references/run-counter.md).

### The cost of a review

The trace carries no token counts, but on Agent0 it joins to the model steps that do.
The root's `pr_review.opencode.parent_tool_call_id` is the `gen_ai.tool.call.id` of an `agent0-sdk.model.step` span in service `agents`, and that span's `opencode.session.id` names the session whose steps carry `gen_ai.usage.*` and `dash0.gen_ai.usage.cost`.
Run it with the Dash0 `sql` tool on dataset `default`, over at most 3 days; a wider window times out:

```sql
-- correct: review -> the tool call that began it -> its Agent0 session -> that session's cost
SELECT span_attributes['opencode.session.id'] AS session, count() AS model_steps,
       round(sum(toFloat64OrZero(span_attributes['dash0.gen_ai.usage.cost'])), 2) AS cost_usd
FROM spans
WHERE resource_attributes['service.name'] = 'agents' AND name = 'agent0-sdk.model.step'
  AND span_attributes['opencode.session.id'] IN (
    SELECT span_attributes['opencode.session.id'] FROM spans
    WHERE resource_attributes['service.name'] = 'agents' AND name = 'agent0-sdk.model.step'
      AND span_attributes['gen_ai.tool.call.id'] IN (
        SELECT span_attributes['pr_review.opencode.parent_tool_call_id'] FROM spans
        WHERE resource_attributes['service.name'] = 'pr-reviewer' AND name = 'invoke_agent pr-reviewer'))
GROUP BY session ORDER BY cost_usd DESC LIMIT 20
```

```sql
-- incorrect: gen_ai.conversation.id is the review's own run id on Agent0, so this matches nothing
SELECT ... WHERE span_attributes['opencode.session.id'] = <the root's gen_ai.conversation.id>
```

The root's id names the session that ran `prepare-review.mjs`; under `/pr-review` that is the caller, and the review itself runs in a dispatched sub-agent's own session.
Each marked step carries `pr_review.opencode.tool_call_id` from the session its marker ran in, so swap the innermost sub-select for the step spans to cost the sub-agent's session too:

```sql
-- the sessions every marked step of a review ran in, caller and sub-agent alike
SELECT span_attributes['pr_review.opencode.tool_call_id'] FROM spans
WHERE resource_attributes['service.name'] = 'pr-reviewer' AND name LIKE 'pr_review.step %'
  AND trace_id = '<the review's trace id>'
```

To cost one step, sum its session's model steps whose `timestamp` falls inside that `pr_review.step <name>` span.
D0QL names the span column `name`, has no `quantile` (use `avg` and `max`), and needs a quoted `INTERVAL '30 MINUTE'`.

Three things the trace never contains:

1. **No `chat` span and no token counts.** The harness owns model usage — the Dash0 agent plugin reads it from the transcript — and a script cannot see it.
2. **No `execute_tool` span.** The plugin already emits one per tool call; a second copy would double every tool-call count.
3. **No `gen_ai.harness.name` inside a harness the plugin covers** (`claude-code`, `cursor`, `codex`, `github-copilot-cli`) unless the run is joined to that harness's session.
   Otherwise every review would appear as a second, zero-cost coding session next to the one the plugin already recorded.
   Join it by setting `PR_REVIEWER_CONVERSATION_ID` to the harness session id; the run then lands inside that session.
   A harness the plugin does not cover — `agent0`, a CI runner through `PR_REVIEWER_HARNESS` — is always named.

`PR_REVIEWER_OMIT_USER_INFO=true` drops `user.name`; `PR_REVIEWER_TEAM_NAME` sets `dash0.team.name`.

### Proof

`review-telemetry.mjs --self-test` builds a run from a synthetic ledger and asserts the tree, the contract, the harness rule, the scope rule, and an export into a real local OTLP receiver.
The `pr-reviewer · telemetry smoke` workflow exports one synthetic run to Dash0 whenever the telemetry code changes, with `pr_review.smoke=true`, and fails if the export did not succeed.
It ships as [`templates/review-telemetry-smoke.workflow.yml`](../templates/review-telemetry-smoke.workflow.yml); copy it to `.github/workflows/` to turn it on.
