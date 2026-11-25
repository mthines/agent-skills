---
title: Atelier telemetry — why a ledger, why these spans, why these metrics
tags: [atelier, telemetry, rationale]
---

# Atelier telemetry

The rule is [`../rules/telemetry.md`](../rules/telemetry.md); this file holds only the reasons.

## Why a ledger written by the scripts

A run is a dozen short commands with hours of `aw`, CI, and human time between them, so no process lives long enough to hold a span open.
Each command appends one record, and the record that ends the run builds and exports the trace, the same design pr-reviewer's `review-telemetry.mjs` uses.
The boundaries ride on commands atelier already runs (`preflight.mjs`, `state.mjs`, `merge-gate.mjs`, `outcomes.mjs`), because a marker the agent had to remember gets dropped on the long runs that matter most, and a marker issued on its own costs a model turn.
Waits are the one exception: only the agent knows a command waits, so `wait` wraps the command it would run anyway and keeps its exit code.

## Why the ledger lives in the git common dir

Build runs in a worktree and the other stages in the main checkout, and each Bash call starts a fresh shell, so an environment variable set in one call is gone in the next.
The git common dir is the one path every worktree of a clone shares and every command can derive on its own.

## Why a new trace per invocation, and `abandoned`

A resume can come days after a hold, from another machine; one trace spanning both would be mostly idle time and could not be exported until the last resume.
Each invocation is its own run joined by `atelier.pr.url`, and the idle time before a resume is recorded as `atelier.resume.idle_s` and a `human` wait, which is the bottleneck a held run hides.
A session that ends without a run-ending record leaves its run open; the next `preflight.mjs` exports it as `abandoned` with the stage it reached, so a stalled run is counted rather than lost.

## Why not `invoke_agent`, and why its own scope

pr-reviewer's root is `invoke_agent pr-reviewer` so AI SDLC Insights can list an Agent0 review as a session.
Atelier always runs inside a harness session the Dash0 agent plugin already records, so a GenAI root would list every run as a second, zero-cost session; `atelier.run` under `agent-skills/atelier` stays queryable without that.

## Why the counters look like pr-reviewer's

`atelier.runs` and `atelier.prs.merged` reuse pr-reviewer's run-counter shape: CUMULATIVE, one series per run, a 0 baseline every 30 s backdated across the run, because `increase()` drops a DELTA point that has no earlier sample in its series.
Durations stay on histograms and on Dash0's span metrics, and every metric attribute is a bounded enum: a free-text reason, a PR URL, or a run id as a label would create a series per run.

## Why outcomes are transitions

`outcomes.mjs` re-classifies every merged PR on every run, so emitting each result would count one PR dozens of times.
It emits only a final outcome that differs from the one LoreKit already stores, which the caller passes as `stored`, so each change is counted once; a sweep that exports and then loses its LoreKit write (a failure, or a concurrent run) exports that change again, and a clean PR that is later reverted is counted in both, and the dashboard's rate says so.

## Why `atelier.work.ref` and the ticket

A run that stops at preflight or in Build has no PR, so a table keyed on `atelier.pr.url` shows a blank row nobody can attribute.
Preflight is the first command of every run and already knows the request, the branch, and the repo, so it records them; `atelier.work.ref` folds them into one column that is filled on every run and upgrades to the PR URL once a command names it.

## Why smoke runs are marked by the environment and the remote

The trace a test exports is indistinguishable from a real one, so the test says so with `ATELIER_SMOKE`; a repo without `origin` cannot hold a PR atelier could merge, so its runs are scratch runs.
A repo with a remote is never guessed to be a test: the runs that once looked like tests came from a real session in another repo.

## Why stage percentiles use atelier's histogram

Panels over Dash0's derived `dash0.spans.duration`, grouped by `atelier_stage_name`, returned no value for real atelier stage spans; `atelier.stage.duration` is emitted by atelier itself with both `atelier.stage.name` and `atelier.smoke`, so its labels do not depend on how a backend derives span metrics.

## Why one exporter

The OTLP encoder is pr-reviewer's `otlp.mjs`, resolved by path like `merge-gate.mjs` resolves `prepare` and `deployment-verify`.
A copy would drift from the one the L1 self-test and the pr-reviewer smoke workflow prove against a real receiver.
Moving it to a shared folder would break the Agent0 bundle, which copies only the `agents/` tree.

## Why the PR_REVIEWER export settings are reused

A user who set `PR_REVIEWER_OTLP_*` already chose where agent-skills telemetry goes, and atelier's traces carry the same kind of facts (repository, PR, model).
A host's own `OTEL_*` is still never read without `ATELIER_TELEMETRY=on`: an Agent0 sandbox sets it for its own process telemetry.

## Why memory is reported, not observed

LoreKit calls are MCP tool calls the scripts cannot see, so Build's record carries the counts the agent already holds (the probe result, the lessons `aw` applied), and the sweep's reads come from `outcomes.mjs` itself.
The counts are as reported, like pr-reviewer's tool-call counts.

## Declined

- An `ATELIER_RUN_ID` environment variable for child traces: each Bash call starts a fresh shell, so nothing would carry it to pr-reviewer's `begin`; the PR URL plus the stage's time window joins the two without it.
- A separate smoke workflow: `telemetry.mjs smoke` exports the same synthetic run on demand, and L1 runs the self-test against a local receiver.
