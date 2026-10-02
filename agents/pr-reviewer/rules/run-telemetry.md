# Run telemetry — where one review's wall clock goes

A review's wall time is roughly its number of model turns times the time one turn takes.
A/B rounds 3–9 on sync-tray#72 measured 13–16 seconds per turn, but only four coarse phases per run — setup, finders, verification, finalize — so no single step's cost was ever known.
This rule gives every run a per-step breakdown, and exports it as a trace in the shape Dash0's AI Coding Insights reads.
[`review-telemetry.mjs`](../scripts/review-telemetry.mjs) is the executable form.

## What is recorded without you

| Step | Recorded by | When |
| --- | --- | --- |
| `prepare` | `prepare-review.mjs` | Starts the run; backdated to the script's own start. Each internal phase (`fetch`, `resolve`, `workspace`, `classify-shape`, `impact-graph`, `packet`, `standards`, `triage-routing`) is a child span with its own start and end. |
| `finalize` | `finalize.mjs` | Adds the outcome (verdict, candidates, confirmed, posted inline) to the run; **finishes and exports the run under `--dry-run`** when it renders. A finalize that fails to render is an ERROR step and leaves the run open, so the re-run that succeeds is the one exported. |
| `post` | `execute-write-plan.mjs` | A real run's last step; finishes and exports the run. |
| `load` | `worker intent import`, or the caller's `dispatch` | The gap in which the agent reads its definition and rules. A dispatch stamp before `prepare` starts the run there; when the caller ran `prepare` itself (`/pr-review`, `review-loop`), `review-telemetry.mjs dispatch` records the dispatch after it, and the gap holding that record is `load`. |

The ledger is `telemetry.jsonl` next to `context.json` — `context.telemetry.runDir`.
Read it once, right after `prepare-review.mjs` wrote the context:

```bash
RUN_DIR="$(jq -r '.telemetry.runDir' ctx.json)"
TELEMETRY="$AGENT_SUPPORT/pr-reviewer/scripts/review-telemetry.mjs"
```

Most harnesses start a fresh shell for every tool call, so these variables do not survive to the next command.
Write the two literal paths into every marker instead of relying on them; the examples below use the variables only for brevity.

Under `/pr-review` and `review-loop` the caller runs `prepare-review.mjs` once and hands the reviewer `--context`, so the run and its `prepare` step begin in the caller; the reviewer marks its steps into the same ledger. The intent worker runs no prepare at all. `prepare-review.mjs --no-telemetry` starts no run, for a caller that must not.

## What you mark: the model steps

Everything between `prepare` and `finalize` is model time, and only you know where one step ends and the next begins.
Mark a step when it starts; a step ends when the next one starts.
A gap nobody marked is exported as `unmarked`, so the steps always add up to the run.

`prepare-review.mjs` prints the marker for this run on its `markers` line, with both absolute paths filled in, followed by the steps this run's tier and topology will take.
The same two values are in the context as `telemetry.markers.command` and `telemetry.markers.steps`.
Copy the command from there rather than rebuilding it.
On dash0#20655 a deep run that read this rule before Step 1 marked `memory`, `gates`, `finders`, and `judgments`, and never marked `lenses`, `consolidate`, or `verify`, although all three ran.

| Step | Starts at |
| --- | --- |
| `memory` | Step 0.7 / Step 1.0 memory reads |
| `gates` | Step 1.8 |
| `finders` | Phase D, the first finder |
| `lenses` | Step 2.4, the holistic broad pass |
| `consolidate` | Step 2.5 |
| `verify` | Step 2.6b, your own candidates — on the first command that verifies one, with `--attr candidates=<n>` ([below](#verify-opens-before-the-verification-it-measures)) |
| `intent-wait` | hybrid only: after `verify`, waiting for the intent file; `--wait` records the wait as `intent_wait_ms` |
| `intent-verify` | hybrid only: deduping and verifying the intent candidates the verified pool did not already hold |
| `judgments` | writing `judgments.json` |
| `validate` | the `validate-judgments.mjs` command — it closes `judgments`, so that step gets a tool-call count too |
| `assert` | Step 4a's pre-write assertions, after `finalize` and before `post`; not under `--dry-run`, where `finalize` has already exported the run |

A step that does not run this time — `memory` when memory is skipped, `intent-wait` and `intent-verify` outside `hybrid`, `lenses` on `quick` — gets no marker.
Step 4c and 4d's LoreKit writes are not a step: they run after `post` has already exported the run, so a marker there records nothing.

**Never spend a tool call on a marker.**
A turn costs 13–16 seconds; ten markers issued on their own would add two minutes to the run they measure.
Put the marker in front of the step's first real command, joined with `;`.
A marker always exits 0 — a misuse is a stderr warning — so it can never stop the command after it.

```bash
# correct: the marker rides on the command the step needed anyway
node "$TELEMETRY" step verify --attr candidates=6 --run-dir "$RUN_DIR"; rg -n "pendingCount" "$WORKDIR"

# incorrect: a turn spent on the marker alone
node "$TELEMETRY" step verify --attr candidates=6 --run-dir "$RUN_DIR"
```

**When a step starts with a Read or Write tool call**, which cannot carry a marker, put the marker on that step's first shell command instead.
A few seconds booked to the previous step costs less than a turn, and it never justifies writing a file through a heredoc instead of the Write tool.

**Pass your running tool-call count on every marker**, as `--attr tool_calls_so_far=<N>`: the number of tool calls you have made in this run so far.
The trace turns consecutive counts into `pr_review.step.tool_calls` per step.
It separates a step that is slow because it takes many turns from one that is slow because each turn generates a lot: in round 10 on sync-tray#72, `finders` was 11 calls in 212 s and `verify` was 2 calls in 205 s.
The count is yours, so it is approximate; the trace labels it as reported.

```bash
node /abs/review-telemetry.mjs step verify --attr tool_calls_so_far=34 --attr candidates=20 --run-dir /abs/run; rg -n "pendingCount" /abs/workdir
```

Attach a count to the open step with `--attr`; `verify` requires one (below).
Keys are prefixed `pr_review.` automatically, so a marker can never overwrite a `gen_ai.*` or VCS attribute.

### `verify` opens before the verification it measures

1. Put the `verify` marker on the **first command that verifies one of your own candidates**.
2. Give it `--attr candidates=<n>`: the consolidated candidates you are about to verify, `0` when there are none.
3. Never put it on the same command as `intent-wait`, `intent-verify`, or `judgments`, and never issue it after the verification ran.

`review-telemetry.mjs` prints a stderr note for a `verify` marker without a count, and for a marker that closes `verify` after under a second or zero tool calls while it held candidates; that `verify` is flagged `pr_review.empty=true` in the trace and `EMPTY` in the summary.
A `verify` with `candidates=0` may close at once.
`prepare-review.mjs` lists the requirement on its `markers` line and in `telemetry.markers.attrs`.

```bash
# correct: verify rides on the first verification command, with its count
node "$TELEMETRY" step verify --attr tool_calls_so_far=34 --attr candidates=6 --run-dir "$RUN_DIR"; sed -n 80,120p "$WORKDIR/src/jobs/sync.ts"

# incorrect: verify chained onto the next marker — the whole verification is booked to intent-wait
node "$TELEMETRY" step verify --attr tool_calls_so_far=34 --run-dir "$RUN_DIR"; node "$TELEMETRY" step intent-wait --attr tool_calls_so_far=34 --run-dir "$RUN_DIR"
```

**Why:** a `verify` closed early books its verification to the next step, so the trace blames the wrong step and hides how many candidates the time bought.

**Sub-agents.**
In the hybrid default, fold the intent worker in when you read its file, on the same command, after `verify`.
With `--wait <s>` it first polls for the file (every 2 s, 10 minutes in total across calls), prints `intent: ready after <s>s wait`, `intent: not ready … re-run this command`, or `intent: timed out …`, and records the wait as `intent_wait_ms` on the `intent-wait` step, the worker span, and the root — `pr_review.intent_wait_ms` is the number that says whether reading late brought the wait to ~0.
It prints one stderr line saying what it folded in.
When the caller left a dispatch stamp in the worker's directory (`dispatched_at`, or the `-<unix seconds>` suffix `/pr-review` puts on it), the run and the worker both start at the dispatch.
A delivered worker also tells `finalize.mjs` that the intent finder was isolated, so `--no-dispatch` does not report it as having run in-context:

```bash
INTENT_FROM="/the/path/passed/as/--intent-from/intent.json"
node "$TELEMETRY" step intent-wait --attr tool_calls_so_far=41 --run-dir "$RUN_DIR"; node "$TELEMETRY" worker intent import --from "$(dirname "$INTENT_FROM")" --done "$INTENT_FROM" --wait 540 --run-dir "$RUN_DIR"; cat "$INTENT_FROM"
```

**Stopping early.**
If you stop before a finalize succeeds, finish the run on your last command so the failure is exported rather than left in the ledger:

```bash
node "$TELEMETRY" finish --status error --message "<why the run stopped>" --run-dir "$RUN_DIR"
```

A finalize re-run after one that already exported is not added to the trace; the summary line says so.

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
| `invoke_agent pr-reviewer` (root) | `gen_ai.operation.name=invoke_agent`, `gen_ai.agent.id=<run id>`, `gen_ai.conversation.name=pr-reviewer <owner>/<repo>#<n>` (only when the run is not joined to a harness session), `pr_review.opencode.parent_tool_call_id` (the OpenCode tool call that ran `begin`, when `OPENCODE_PARENT_TOOL_CALL_ID` is set), the outcome under `pr_review.*`, and the memory the review used and read ([§ The memory](#the-memory)) |
| `pr_review.step <name>` | `pr_review.step.name`, `pr_review.step.kind` (`script` · `model` · `dispatch`), `pr_review.step.marked`; ERROR with `error.type=step_failed` when the step failed |
| `pr_review.phase <name>` | child of a script step: `pr_review.step.name`, `pr_review.phase.name` |
| `pr_review.worker <unit>` | `pr_review.worker.unit` |
| every span | `gen_ai.agent.name`, `gen_ai.conversation.id`, `dash0.gen_ai.vcs.*` (repository, owner, PR URL, head ref and revision), `user.name` |

Two histograms carry the durations across runs: `pr_review.step.duration` (by step and kind) and `pr_review.run.duration` (by tier, topology, and verdict).
Neither carries a run id, a PR number, or a user as an attribute.

### The memory

The root span says which LoreKit memories the review used and read, and links each one back to LoreKit.
`finalize.mjs` records them from `judgments.memory` as one `memory` ledger record; a finalize re-run replaces it.
You supply the inputs only: copy `id`, `scope`, and `key` onto every `memory.relevance_rules[]` and `memory.lessons_used[]` entry — `id` from the `memory_list` / `memory_search` entry, since `memory_read` returns none, and `scope` from the call when the entry omits it — and list every body you fetched with `memory_read` in `memory.read[]` ([`posting.md`](./posting.md)).

| Where | Attribute | Value |
| --- | --- | --- |
| root | `pr_review.memory.used` | memories that shaped the review — every `lessons_used[]` entry and every relevance rule that acted (an applied action, or a finding it suppressed), the same set Step 4c cites. The report's `Memories — … used` also lists idle rules, so the two counts can differ |
| root | `pr_review.memory.read` | memories whose body the run fetched; omitted when `memory.read` is absent |
| root | `pr_review.memory.used_ids` | the used memories' LoreKit ids, comma-separated — filter runs by one with `contains` |
| root | `pr_review.memory.suppressed` | findings a relevance rule suppressed this run |
| event `pr_review.memory.used` · `pr_review.memory.read` | `pr_review.memory.id`, `.scope`, `.key`, `.kind` (`rule` · `knowledge` · `hotspot` · `lesson`) | one event per memory; `used` when it shaped the review, `read` when it was only read — an idle relevance rule included |
| event | `pr_review.memory.url` | `<LOREKIT_APP_URL>/lore?memoryId=<id>`, else `/lore?scope=…&lesson={scope,key}`; omitted when neither is known — never fabricated |
| event | `pr_review.memory.action`, `.note`, `.fingerprint`, `.seen_count`, `.suppressed` | what it did: a rule's direction or applied action, a lesson's `used_as`, and the findings it suppressed |

A memory named in more than one array is one event, matched by `id`, else by `key` in the same scope.
At most 50 events are kept, used memories first.
A run whose finalize never ran carries none of these, so "no memory attributes" means unknown and `pr_review.memory.used=0` means none was used.

```text
# correct: id, scope, and key from the list or search entry — the trace links it by id
{ "id": "cb10f4e2-eaf1-48e1-933c-e633a23e2716", "scope": "repo::acme/widget", "key": "hotspot::src/api/client.ts", "used_as": "finder pointer (re-verified)" }

# incorrect: the id dropped — the trace falls back to the scope + key link, and a key alone gets none
{ "key": "hotspot::src/api/client.ts", "used_as": "finder pointer (re-verified)" }
```

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
