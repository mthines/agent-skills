---
name: telemetry-verify
description: >
  The telemetry witness: reads what the services recorded during one closed window of traffic
  another skill produced (ui-verify, verify, a repro), traces each acceptance criterion from web
  event to backend trace to database, and finds errors behind a green UI, slow paths, and missing
  signals. Never edits code; run on its own, it posts its receipt to the PR's verify comment. Triggers on "check the telemetry", "prove it with traces", "/telemetry-verify".
disable-model-invocation: false
argument-hint: '--env <local|preview> --from <ISO> --to <ISO> [--host <host>] [--driver playwright|chrome] [--brief <plan.md>] [--out <findings.jsonl>] [--pr <url|n>] [--no-comment]'
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: advisory
  tags: [telemetry, verification, traces, web-events, logs, dash0, opentelemetry, receipt]
---

# Telemetry verify

The browser proves what the user saw; this skill proves what the services saw while they saw it.
It reads closed time windows of traffic someone else produced and returns one `TELEMETRY` block.
It never produces traffic, never edits code, and never widens the window to find something.

## Invocation

```text
Skill("telemetry-verify", "--env <local|preview> (--windows <probes.jsonl> | --from <ISO-8601 UTC> --to <ISO-8601 UTC>) [--host <preview host>] [--driver playwright|chrome] [--brief <plan.md path>] [--out <findings.jsonl path>] [--pr <url|number>] [--no-comment]")
```

Callers run it in a sub-agent, so query results stay out of their context, and pass `--no-comment`, because they post the receipt in their own region:

```text
Agent(subagent_type="general-purpose", prompt="Run Skill(\"telemetry-verify\", \"<args> --no-comment\") and return only its TELEMETRY block")
```

Use `general` as the sub-agent type on OpenCode and Dash0 Agent0.

| Argument | Meaning |
| --- | --- |
| `--env` | The environment in `.agents/aw/environments.yml` the traffic ran against |
| `--from`, `--to` | The traffic window, recorded by the caller immediately before and after it |
| `--windows` | A `probes.jsonl` whose lines carry `id`, `window_start`, `window_end`, and optional `log_offsets`: read them all in one pass, from the first start to the last end, and attribute each record to the window that contains it |
| `--host` | The preview host; filters web events to this run's pages |
| `--driver` | The browser driver; `chrome` is the user's own browser, so sessions cannot be isolated |
| `--brief` | `plan.md`; its `telemetry:` acceptance criteria become expectations. Default `.agent/{branch}/plan.md` when it exists |
| `--out` | Append findings to this file in the `aw-verify` skill's findings record shape |
| `--pr` | The PR whose verify comment gets the `telemetry` region; default the current branch's PR (`gh pr view --json url`) |
| `--no-comment` | Post nothing; every calling skill passes it |

## Step 0 — Resolve config and skip honestly

Resolve `.agents/aw/telemetry.yml` and `environments.yml` plus the personal overlay (`~/.agents/aw/config.yml` → `repos.<owner>/<name>`), as the `aw-verify` skill's `rules/config.md` defines.
Take the first row that applies; each prints its line and returns `verdict: null`:

| Condition | `pipe:` line |
| --- | --- |
| No `.agents/aw/environments.yml` | `skipped (no .agents/aw config — run /aw-verify setup)` |
| `backend: none` | `skipped (telemetry.backend: none)` |
| `backend: dash0-mcp` and no connected tool ends in `getSpans` or `getWebEvents` | `skipped (no Dash0 MCP server connected)` |
| The window holds only browser traffic and the app ships no web SDK (no `telemetry.yml` → `web` block, no `@dash0/sdk-web` dependency) | `skipped (no web SDK in this app)` |

## Step 1 — Wait for ingest

With `--windows`, `--from` is the first `window_start` and `--to` the last `window_end`.
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
A signal the environment does not export (for example logs that go only to stdout) is `not-exported (<signal>)`, not `missing-signal`; read it from the process log under the window's `log_offsets`.

## Step 3 — Expectations

Collect them per [`rules/expectations.md`](./rules/expectations.md):

1. Every `telemetry:` acceptance criterion in the brief, refused when it is by-construction.
2. Every signal the diff adds: spans, attributes, logs, metrics, and custom web events.

## Step 4 — Read and judge

Spend queries in this order and stop as soon as every expectation and AC has a verdict; about 12 calls covers a run:

1. **Errors, whole span:** one query each for ERROR spans, ERROR/WARN logs, and error web events, scoped to this run's service or instance. Attribute each hit to its window.
2. **Expectations:** one query per `telemetry:` criterion and per new signal.
3. **Journeys:** `getTraceDetails` only for an AC whose window had an error, or whose path you cannot otherwise confirm.
4. **Performance:** only for routes a journey exercised.

Read only the backend file and [`rules/receipt.md § Output`](./rules/receipt.md#output); the other rule files are for disputes.

Run the backend file's queries for steps 2–4 of [`rules/receipt.md`](./rules/receipt.md): journeys, errors, performance.

| `backend` | File | Sees |
| --- | --- | --- |
| `dash0-mcp` | [`rules/dash0-mcp.md`](./rules/dash0-mcp.md) | Spans, logs, metrics, and web events in a Dash0 dataset |
| `logs` | [`rules/logs.md`](./rules/logs.md) | Service logs the stack driver captured, plus browser console and network evidence |

A configured backend that is unreachable is `pipe: skipped (<reason>)`; never swap backends silently.

## Step 5 — Return the block

Print exactly the block in [`rules/receipt.md § Output`](./rules/receipt.md#output), and append findings to `--out` when given.

## Step 6 — Post the `telemetry` region

Run on its own (no `--no-comment`), post the receipt as the `telemetry` region of the PR's one verify comment, per the `aw-verify` skill's `rules/pr-comment.md` (its § When to post gate, and its script):

```bash
node "${CLAUDE_SKILL_DIR}/../aw-verify/scripts/verify-comment.mjs" --pr <pr-url> --section telemetry --file .agent/<branch>/telemetry-verify/comment-telemetry.md
```

Region body, in the `aw-verify` skill's `rules/pr-comment.md` § Layout shape, a `###` headline because it may sit under an aggregate region:

````markdown
### <✅ Telemetry confirms | ❌ Telemetry contradicts | ⚠️ Telemetry is ambiguous | ⏭️ Telemetry not graded> — <what the services recorded, in the user's words>

<One sentence: which journeys were recorded end to end.> <the attention line for the headline, per the `aw-verify` skill's `rules/pr-comment.md` § Attention line: ✅ **Nothing needs your attention.**, or **Needs you:** and each open critical/high finding · ⚠️ **Why not ✅:** each ambiguous journey and what would settle it, then **Needs you:** and each open critical/high finding · ❌ **Needs you:** `contradicts` journeys, then each open critical/high finding · ⏭️ **Needs you:** why it was not graded and the fix, then each open critical/high finding>

<sub>`<head-sha7>` · <env> · window <from> → <to> · updated {{UPDATED}}</sub>

#### What I checked

<details><summary>✅ <b>Save a view</b> → traced from the click to the database</summary>

click "Save" → POST /api/views 201 (84 ms) → views-service PUT (21 ms) → postgres INSERT (4 ms). [trace 4bf92f35](<Dash0 link>)

<sub>Proves AC-2</sub>

</details>

<details><summary>Details</summary>

**Run details**

**telemetry-verify** · head `<head-sha>` · `<env>` · window <from> → <to> · backend <backend and scope>

- pipe: <the pipe line>
- verdict: <confirms | contradicts | ambiguous | null>

| ID | Kind | Severity | What happened | Evidence |
| --- | --- | --- | --- | --- |

</details>
````

Row glyphs: `confirms` ✅, `contradicts` ❌, `ambiguous` ⚠️, `null` ⏭️.
One row per journey, `<what the user did> → <what the services recorded>`; a `contradicts` row comes first and is `<details open>`, every other row is closed.
Evidence is a link from the backend's URL tool (`generateDash0Url`) or a trace ID; never a log file path.
Print `comment: <comment-url> (region telemetry)`, or the `not posted (<reason>)` / `failed (<reason>)` line.

## Core principles

1. **Read-only, one window.** Judge only records inside the window the caller produced; the only write is the PR comment's `telemetry` region.
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
- [ ] Run on its own: the `telemetry` region posted, or a `comment: not posted (<reason>)` line.
