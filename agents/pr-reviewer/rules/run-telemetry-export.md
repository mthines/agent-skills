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

#### Linking a review to its Agent0 run

The link is optional: with none of the three variables below set, as on a local run, the trace carries no Agent0 attribute, link, or warning.
`begin` reads them through `hostFacts()`, so they must be in the environment `prepare-review.mjs` runs in.

| Variable | Set by | Recorded as |
| --- | --- | --- |
| `PR_REVIEWER_AGENT0_RUN_ID` | the automation prompt, from `{{dash0.workflow.run.id}}` | `agentic_workflow.run.id` on the root span and the resource |
| `PR_REVIEWER_AGENT0_WORKFLOW_ID` | the automation prompt, from `{{dash0.workflow.id}}` | `agentic_workflow.id` on the root span and the resource |
| `OPENCODE_STEP_TRACEPARENT` | Agent0's OpenCode, for every tool call — chat runs included | `pr_review.agent0.trace_id` and `.span_id` on the root span, and a span link from the root to that step span; the first `begin`'s value is kept |

The root also carries `pr_review.agent0.link`: `run` (the run id is known), `trace` (only the step trace context), or `none` (an Agent0 run with neither).
A variable that is set but malformed — an unresolved `{{dash0.workflow.run.id}}`, a traceparent that is not W3C — is never recorded as an id: `review-telemetry: ignored — PR_REVIEWER_AGENT0_RUN_ID is not an id …` goes to stderr and its name to `pr_review.agent0.rejected`.

Prompt variables never reach the shell, and each Bash call starts a fresh shell, so export the two ids from the prompt into `$BASH_ENV`, the file Agent0 sources before every command:

```bash
# correct: the automation prompt's first command — every later command, prepare-review.mjs included, sees both ids
printf 'export PR_REVIEWER_AGENT0_RUN_ID=%q\nexport PR_REVIEWER_AGENT0_WORKFLOW_ID=%q\n' '{{dash0.workflow.run.id}}' '{{dash0.workflow.id}}' >> "$BASH_ENV"

# incorrect: an export in its own Bash call is gone before the review's first command runs
export PR_REVIEWER_AGENT0_RUN_ID='{{dash0.workflow.run.id}}'
```

Watch the link on the root's span metric.
On an automation that passes the ids every review reads `run`, so a rise in any other value means it stopped linking: `trace` when the run id was dropped (Agent0 still sets the step traceparent, so a dropped id never reads `none`), `none` when the traceparent is missing too, and a non-empty `pr_review_agent0_rejected` when a value was malformed.
Chat reviews read `trace` by design, so watch the change, not the level:

```promql
sum by (pr_review_agent0_link, pr_review_agent0_rejected) (increase({otel_metric_name="dash0.spans", service_name="pr-reviewer", otel_span_name="invoke_agent pr-reviewer", gen_ai_harness_name="agent0"}[1d]))
```

### The trace

It follows the [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) as Dash0 reads them for coding agents ([span attributes](https://dash0.com/docs/dash0/darkplane/insights/span-attributes)), and the attribute contract of the [Dash0 agent plugin](https://github.com/dash0hq/dash0-agent-plugin):

| Span | Attributes |
| --- | --- |
| `invoke_agent pr-reviewer` (root) | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.id=<run id>`, `gen_ai.conversation.name=pr-reviewer <owner>/<repo>#<n>` (only when the run is not joined to a harness session), `pr_review.opencode.parent_tool_call_id` (the OpenCode tool call that ran `begin`, when `OPENCODE_PARENT_TOOL_CALL_ID` is set), the outcome under `pr_review.*` (including where each scored candidate went — `posted_inline`, `deferred`, `dedupe_dropped`, `confidence_dropped`, `advisory_deferred`, `anchorless`, and `memory.suppressed` — the reported findings' severity ([§ Severity and delivery](#severity-and-delivery)), and `pr_review.impact_image` = `added` · `skipped` · `failed` and `pr_review.impact_image.reason`), what the post step delivered (`pr_review.post.*`, [§ Severity and delivery](#severity-and-delivery)), the routing decision (`pr_review.triggers`: the comma-joined `D`-ids that fired, omitted when none; `pr_review.delta_scaled`: boolean; `pr_review.state_status`: `read`, `empty`, `unreadable`, `none`, or `ignored`, where `none` also marks a first run), the memory the review used and read ([§ The memory](./run-telemetry.md#the-memory)), and the lenses it loaded ([§ The lenses](./run-telemetry.md#the-lenses)) |
| `pr_review.step <name>` | `pr_review.step.name`, `pr_review.step.kind` (`script` · `model` · `dispatch`), `pr_review.step.marked`, `pr_review.opencode.tool_call_id` (the OpenCode tool call whose marker opened it, when `OPENCODE_PARENT_TOOL_CALL_ID` is set); ERROR with `error.type=step_failed` when the step failed; the `lenses` step also carries `pr_review.lenses.loaded`, `pr_review.lenses.names`, `pr_review.lenses.builtin`, and `pr_review.lenses.custom` |
| `pr_review.phase <name>` | child of a script step: `pr_review.step.name`, `pr_review.phase.name` |
| `pr_review.worker <unit>` | `pr_review.worker.unit` |
| every span | `gen_ai.agent.name`, `gen_ai.conversation.id`, `dash0.gen_ai.vcs.*` (repository, owner, PR URL, head ref and revision), `user.name` |

### Severity and delivery

`finalize.mjs` records the severity of the findings the review reported, and `execute-write-plan.mjs` records what the `post` step wrote to GitHub, both on the root span:

| Attribute | Set by | Value |
| --- | --- | --- |
| `pr_review.findings.critical` · `.high` · `.medium` · `.low` | `finalize` | reported findings per `severity` tier — posted inline or listed over the inline cap; the four sum to `posted_inline + deferred`, and match the tiers of `dash0.darkplane.review.findings.*` |
| `pr_review.findings.blocking` | `finalize` | the reported findings marked `(blocking)` |
| `pr_review.post.path` | `post` | `gh` (this script wrote) · `mcp` (no gh access path: the agent posts over MCP, outside the trace) · `refused` (a historical, dry-run, or isolated plan) |
| `pr_review.post.sticky` | `post` | `created` · `updated` · `recreated` (the PATCH 404'd) · `pointer` (the PATCH failed, the pointer posted) · `aborted` (the body failed its pre-write check) · `failed` · `none` |
| `pr_review.post.sticky.comment_id` | `post` | the comment GitHub wrote, as a string; only when the write succeeded |
| `pr_review.post.review` | `post` | `posted` · `aborted` (the payload failed its safety check) · `failed` · `none` (no inline comments) |
| `pr_review.post.review.id` | `post` | the review GitHub created, as a string; only when it posted |
| `pr_review.post.inline_sent` | `post` | inline comments in the review that posted, `0` otherwise — compare with `posted_inline`, which finalize planned |
| `pr_review.post.threads.replied` · `.reply_failed` · `.resolved` · `.resolve_failed` | `post` | thread writes that succeeded and failed |

A dry run finishes at `finalize` and carries no `pr_review.post.*`; a run that never reached finalize carries no `pr_review.findings.*`.
Neither is zero: an absent attribute means the step did not run.

A sticky report or inline review that never reached GitHub (`aborted` or `failed`) marks the `pr_review.step post` span ERROR, `error.type=step_failed`, its status message naming the write and GitHub's reason (`inline review (3 comments) not posted: HTTP 422: …`), and prints `execute-write-plan: error — …` on stderr.
The root stays OK, because the review ran.
A degraded but delivered write — `pointer`, or a failed thread reply or resolve — prints `execute-write-plan: warning — …` and leaves the step OK, so the step's error rate counts only undelivered reviews.
A ledger or export failure prints `execute-write-plan: run telemetry not recorded — …` (`finalize: run telemetry not recorded — …` at finalize) and never fails the post.

Watch delivery on the `post` step's span metric, never on the root's verdict:

```promql
# correct: runs whose report or inline review never reached GitHub
sum(increase({otel_metric_name="dash0.spans", service_name="pr-reviewer", otel_span_name="pr_review.step post", otel_span_status_code="ERROR"}[1h]))

# incorrect: Agent0 marks an automation run `success` whether or not anything posted, and the root stays OK on a failed post
sum(increase({otel_metric_name="dash0.spans", service_name="pr-reviewer", otel_span_name="invoke_agent pr-reviewer", otel_span_status_code="ERROR"}[1h]))
```

```sql
-- correct: delivery read from what the post step wrote
SELECT span_attributes['pr_review.post.review'] AS review, count() AS runs,
       sum(toFloat64OrZero(span_attributes['pr_review.post.inline_sent'])) AS sent,
       sum(toFloat64OrZero(span_attributes['pr_review.posted_inline'])) AS planned
FROM spans
WHERE resource_attributes['service.name'] = 'pr-reviewer' AND name = 'invoke_agent pr-reviewer'
GROUP BY review

-- incorrect: posted_inline is finalize's plan, set before anything is posted, and on a dry run too
SELECT sum(toFloat64OrZero(span_attributes['pr_review.posted_inline'])) AS delivered FROM spans WHERE ...
```

### Re-reviews

`finalize.mjs` (`priorCounts()`) separates what a review found for the first time from what it carried or dropped because of an earlier review, from `candidates[].first_seen_sha`, `prior_dedup`, `threads`, and the context's threads and prior run:

| Attribute | Value |
| --- | --- |
| `pr_review.findings.new` · `.carried` | reported findings (posted inline or listed over the cap) without and with `first_seen_sha`; they sum to `posted_inline + deferred` |
| `pr_review.findings.repeat_dropped` | `prior_dedup` entries `already-posted`; `.repeat_dropped_foreign` is the subset whose prior comment is not on one of this agent's threads |
| `pr_review.findings.flip_flop_dropped` | `prior_dedup` entries `flip-flop` |
| `pr_review.findings.withdrawn` | `prior_dedup` entries `addressed`, plus this agent's own threads `judgments.threads` classifies `fixed` or `obsolete` |
| `pr_review.findings.reposted` | inline findings whose fingerprint is an unresolved thread of this agent's — the duplicate the dedup prevents; should be 0 |
| `pr_review.prior.carried_in` · `pr_review.findings.carried_unaccounted` | carried findings the state record handed in, and those neither back as candidates nor in `prior_dedup`; should be 0 |
| `pr_review.prior.check` | re-reviews only: `ok`, or `reposted`, `carried_lost`, `unrecorded` (no `prior_dedup`), comma-joined in that order |

"This agent's threads" are those whose first comment carries a v2 `<!-- fp:v2:… -->` marker, never those matching the login: on Agent0 every automation posts as the same GitHub App.
A first run computes all of these without `prior_dedup` — everything it reports is new.
A run that skips Step 2 — an unmoved head, or a push with no delta lines and no new file (a rebase, a base merge, a binary- or mode-only change) — drops and re-admits nothing: it is not held to `prior_dedup`, its carried findings are not checked, and its `carriedFindings` is `null` so Step 4c keeps the record's list.
A re-review without `prior_dedup` records none of the model-dependent counts, and `prior.check` says `unrecorded`; each problem is also a `finalize: warning — …` line on stderr.

Sum findings per PR from `new`, never from `confirmed`, which counts a carried finding again on every re-review; alert on `prior.check`, the one bounded string, because PromQL label matchers on numeric `pr_review.*` attributes find nothing:

```sql
-- correct: findings a PR received, each once
SELECT span_attributes['dash0.gen_ai.vcs.pull_request.url'] AS pr, count() AS reviews,
       sum(toFloat64OrZero(span_attributes['pr_review.findings.new'])) AS new_findings,
       sum(toFloat64OrZero(span_attributes['pr_review.findings.withdrawn'])) AS withdrawn
FROM spans
WHERE resource_attributes['service.name'] = 'pr-reviewer' AND name = 'invoke_agent pr-reviewer'
GROUP BY pr

-- incorrect: a finding carried across five reviews is counted five times
SELECT sum(toFloat64OrZero(span_attributes['pr_review.confirmed'])) FROM spans WHERE ...
```

```promql
sum(increase({otel_metric_name="dash0.spans", service_name="pr-reviewer", otel_span_name="invoke_agent pr-reviewer", pr_review_prior_check=~".*(reposted|carried_lost|unrecorded).*"}[1d]))
```

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

On an automation that passes the run id ([§ Linking a review to its Agent0 run](#linking-a-review-to-its-agent0-run)), join on `agentic_workflow.run.id`: Agent0's `agentic_workflow.invoke` span carries the same id and the run's cost.
Several reviews in one run share it, so divide the run's cost by them rather than counting it once per review.

```sql
-- correct: review -> its Agent0 automation run -> that run's cost
SELECT span_attributes['agentic_workflow.run.id'] AS run, span_attributes['gen_ai.usage.cost_usd_cents'] AS cost_cents
FROM spans
WHERE resource_attributes['service.name'] = 'agents' AND name = 'agentic_workflow.invoke'
  AND span_attributes['agentic_workflow.run.id'] IN (
    SELECT span_attributes['agentic_workflow.run.id'] FROM spans
    WHERE resource_attributes['service.name'] = 'pr-reviewer' AND name = 'invoke_agent pr-reviewer')

-- incorrect: agents.cost divided by the review count — chat and /review-loop reviews in the same window inflate the count
```

Without the run id, the trace carries no token counts, but on Agent0 it joins to the model steps that do.
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
