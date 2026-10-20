---
name: telemetry-verify
description: >
  The telemetry witness: reads what the services recorded during one closed window of traffic
  another skill produced (ui-verify, verify, a repro), traces each acceptance criterion from web
  event to backend trace to database, and finds errors behind a green UI, slow paths, and missing
  signals. Read-only. Triggers on "check the telemetry", "prove it with traces", "/telemetry-verify".
disable-model-invocation: false
argument-hint: '--env <local|preview> --from <ISO> --to <ISO> [--host <host>] [--driver playwright|chrome] [--brief <plan.md>] [--out <findings.jsonl>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags: [telemetry, verification, traces, web-events, logs, dash0, opentelemetry, receipt]
---

# Telemetry verify

The browser proves what the user saw; this skill proves what the services saw while they saw it.
It reads one closed time window of traffic someone else produced and returns one `TELEMETRY` block.
It never produces traffic, never edits code, and never widens the window to find something.

## Invocation

```text
Skill("telemetry-verify", "--env <local|preview> --from <ISO-8601 UTC> --to <ISO-8601 UTC> [--host <preview host>] [--driver playwright|chrome] [--brief <plan.md path>] [--out <findings.jsonl path>]")
```

Callers run it in a sub-agent, so query results stay out of their context:

```text
Agent(subagent_type="general-purpose", prompt="Run Skill(\"telemetry-verify\", \"<args>\") and return only its TELEMETRY block")
```

Use `general` as the sub-agent type on OpenCode and Dash0 Agent0.

| Argument | Meaning |
| --- | --- |
| `--env` | The environment in `.agents/aw/environments.yml` the traffic ran against |
| `--from`, `--to` | The traffic window, recorded by the caller immediately before and after it |
| `--host` | The preview host; filters web events to this run's pages |
| `--driver` | The browser driver; `chrome` is the user's own browser, so sessions cannot be isolated |
| `--brief` | `plan.md`; its `telemetry:` acceptance criteria become expectations. Default `.agent/{branch}/plan.md` when it exists |
| `--out` | Append findings to this file in the `verify` skill's findings record shape |

## Step 0 — Resolve config and skip honestly

Resolve `.agents/aw/telemetry.yml` and `environments.yml` plus the personal overlay (`~/.agents/aw/config.yml` → `repos.<owner>/<name>`), as the `verify` skill's `rules/config.md` defines.
Take the first row that applies; each prints its line and returns `verdict: null`:

| Condition | `pipe:` line |
| --- | --- |
| No `.agents/aw/environments.yml` | `skipped (no .agents/aw config — run /verify setup)` |
| `backend: none` | `skipped (telemetry.backend: none)` |
| `backend: dash0-mcp` and no connected tool ends in `getSpans` or `getWebEvents` | `skipped (no Dash0 MCP server connected)` |
| The window holds only browser traffic and the app ships no web SDK (no `telemetry.yml` → `web` block, no `@dash0/sdk-web` dependency) | `skipped (no web SDK in this app)` |

## Step 1 — Wait for ingest

If `now < --to + ingest_wait_seconds`, sleep the difference.
Query `from = --from − 30 s` and `to = --to + 30 s`, the same on every retry.

```text
✗ Wrong — 0 events → widen to the last 15 minutes → judge what came back (someone else's traffic)
✓ Right — 0 events → wait 30 s → re-query the same window, at most 4 attempts
```

## Step 2 — Pipe check

Prove the backend can see the window before reading any absence as good news.
Every component that served traffic in the window, and the web SDK when browser traffic ran, must have left at least one record.
A component that served requests and left nothing is `missing-signal`; zero records everywhere after the retries is `pipe: inconclusive (no records in window)`, never clean.

## Step 3 — Expectations

Collect them per [`rules/expectations.md`](./rules/expectations.md):

1. Every `telemetry:` acceptance criterion in the brief, refused when it is by-construction.
2. Every signal the diff adds: spans, attributes, logs, metrics, and custom web events.

## Step 4 — Read and judge

Run the backend file's queries for steps 2–4 of [`rules/receipt.md`](./rules/receipt.md): journeys, errors, performance.

| `backend` | File | Sees |
| --- | --- | --- |
| `dash0-mcp` | [`rules/dash0-mcp.md`](./rules/dash0-mcp.md) | Spans, logs, metrics, and web events in a Dash0 dataset |
| `logs` | [`rules/logs.md`](./rules/logs.md) | Service logs the stack driver captured, plus browser console and network evidence |

A configured backend that is unreachable is `pipe: skipped (<reason>)`; never swap backends silently.

## Step 5 — Return the block

Print exactly the block in [`rules/receipt.md § Output`](./rules/receipt.md#output), and append findings to `--out` when given.

## Core principles

1. **Read-only, one window.** Judge only records inside the window the caller produced.
2. **Silence is never clean.** No records means the pipe is broken or the read is early, not that nothing went wrong.
3. **Behavioral, never by-construction.** A claim that reading the source could satisfy is refused, not graded.
4. **Findings never change the verdict.** The verdict answers the brief's telemetry criteria; findings are reported beside it.
5. **No repo values in `rules/`.** Datasets, services, and thresholds come from `.agents/aw/`.

## Definition of done

- [ ] Config resolved, or a `skipped (<reason>)` line printed.
- [ ] Ingest waited; every retry used the same window.
- [ ] Pipe checked before any absence was judged.
- [ ] One journey line per acceptance criterion the window exercised.
- [ ] The `TELEMETRY` block printed exactly; findings appended when `--out` was given.
