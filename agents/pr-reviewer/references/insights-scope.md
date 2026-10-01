# Why an Agent0 run exports under the AI SDLC Insights scope

The rule is [`rules/run-telemetry.md` § The scope](../rules/run-telemetry.md#the-scope); this file holds only the reasons.

## Why the plugin's scope

AI SDLC Insights lists a span as a coding session only under an instrumentation scope it reads, and the Dash0 agent plugin exports every span under `dash0-agent-plugin` (`internal/otlp/trace.go` in [dash0hq/dash0-agent-plugin](https://github.com/dash0hq/dash0-agent-plugin)).
A span under `agent-skills/pr-reviewer` is stored and queryable, but it is not listed as a session, and its harness does not appear in the harness filter.

## Why only agent0

On a harness the plugin covers, the plugin already records the review: an `invoke_agent pr-reviewer` span when the sub-agent stops, its `chat` spans with token counts, and one `execute_tool` span per tool call.
A second `invoke_agent pr-reviewer` under the plugin's scope would count every review twice there.
On Agent0 no plugin runs, so the reviewer's trace is the only record of the review, and nothing is counted twice.
A CI or smoke harness stays out because its runs are synthetic.

## Why not nest under the harness's trace instead

Nesting the steps under a harness span needs a W3C `TRACEPARENT` handed to the command that runs the script.
The Agent0 OpenCode sandbox sets none in a tool's environment, so there is no harness span to nest under.

## What an Agent0 session shows

The session carries the `agent0` harness, the `pr-reviewer <owner>/<repo>#<n>` title, the run's duration, and the branch that links it to the pull request.
Cost, tokens, and tool calls read zero: Insights derives them from `chat` and `execute_tool` spans, and a script cannot see model usage.
Insights marks a session failed when any of its spans is ERROR, so a finalize that failed and then succeeded on a re-run marks the session failed.

## Why the OpenCode tool call id, and why the first one

OpenCode sets `OPENCODE_PARENT_TOOL_CALL_ID` per tool call, so its value differs on every command.
The value read at `begin` names the tool call that started the run, which leads from a trace back to the Agent0 run.
A later `begin` runs in a later tool call, so it never replaces the first value.
