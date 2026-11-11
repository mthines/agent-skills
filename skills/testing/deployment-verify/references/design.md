# deployment-verify — design

## Where it sits

`aw` builds and tests the change, `review-loop` converges and merges it, `aw-verify` proves it on a local stack or the preview.
`deployment-verify` runs after the merge, on the deployment users reach, and is the only skill in the suite that changes production state: one flag value at a time, or a rollback.

## The contract is written before the deploy

A threshold chosen after seeing the rollout's numbers is chosen to pass them.
So the contract lives in the PR body, written before the merge, and a contract may only tighten the repo's thresholds.
The PR body also survives the merge and the worktree cleanup, which `.agent/{branch}/` files do not.

## Cohorts in the same window, not before and after

Before-and-after comparisons absorb everything else that changed in the gap: traffic mix, time of day, other deploys, an upstream incident.
Flag-on and flag-off requests in the same window share all of that, so the difference is the change.
The flag also names which change caused a regression when several ship in one deploy, which makes parallel autonomous loops attributable.
Before-and-after remains the fallback for the 100 % step and for changes with no flag, and the report says attribution is weaker there.

## A script decides

The agent measures and acts; `decide.mjs` returns PASS, HOLD, or ROLLBACK from fixed thresholds.
A model judging its own rollout drifts toward PASS, and a script's verdict is reproducible from the stats in the report.
The rule needs both a ratio and an absolute floor for latency: on a millisecond endpoint a harmless few-millisecond change is a large ratio.
HOLD exists because thin cohorts lie: a handful of requests can show 40 % errors or none.

## Confirm before trusting

A `set` command exiting 0 says the provider accepted a value, not that traffic sees it: caches, redeploys, and wrong targeting all sit in between.
The observed cohort share is the proof, so a step whose share does not match stops the run instead of producing a verdict about the wrong traffic.
For the same reason a rollback is not finished until a clean window is measured after it.

## Rollback order

Turning a flag off reverses one change in seconds plus the provider's propagation, and leaves every other change in the deploy alone.
A platform rollback reverses the whole deploy; a revert PR waits for CI and a new deploy.
So the order is flag, platform, revert PR, and `auto` is allowed only for `reversibility: flag`.

## A script runs the rollout

The checks before the merge already proved the change works, so production verification is a confirmation, and a confirmation that passes should cost close to nothing.
Every unit of a rollout is deterministic: read state, query, compare, flip a flag, write state.
So `tick.mjs` runs it without a model, and an agent is woken only for what needs judgment: finding a cause, opening a revert, telling people.
The controller is also what makes the loop testable: its self-test drives whole simulated rollouts, which a prompt cannot.

## Ticks, with the state on the PR

A rollout lasts hours; an automation run is capped at minutes, and a sandbox may not survive between runs.
So every run is a tick that does what is due and exits, and the state lives in the PR's report comment, which every host can read and the merge does not remove.
A label marks the PRs in progress, so a scheduled run finds its work without the trigger's event payload.
A lease in the state keeps a laptop run and an automation tick from acting on one rollout at once; concurrency settings alone cannot, because they only see one host.

## Unattended answers

An automation has no one to ask.
Turning a flag off is safe to do unasked: it reverses one change and is undone by turning it on again.
Reverting a deploy is not, so an unattended run escalates instead of acting.

## Notifications route by outcome

A merged PR's comments are read by nobody at 3 a.m.
Each outcome goes where someone acts on it: a rollback to the team channel and a ticket, an escalation to whatever pages a person, a pass only to the PR, because a channel that announces every success stops being read.
A notification that fails is written into the PR comment, so a silent channel never reads as a quiet night.

## Telemetry constraints this design follows

- Flag SDK hooks commonly record evaluations as span events; Dash0's D0QL `spans` table has no events column, so the cohort must be a span attribute.
- Framework instrumentation often makes the handler's active span an inner span whose status stays `UNSET` on a 500, so errors are read on the root SERVER span, joined by `trace_id` when needed.
- D0QL has no percentiles, so the latency rule uses averages.
- Ingestion lags the traffic by tens of seconds, so every measurement waits and, when the skill sent the traffic, checks the count it sent.

## Not covered

- A soak window after 100 %: the rollout ends at 100 % PASS and says so.
- Choosing the flag and writing the contract: that belongs to the planning step (`aw`), before the merge.
