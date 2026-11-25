# deployment-verify — design

## Where it sits

`aw` builds and tests the change, `review-loop` converges and merges it, `aw-verify` proves it on a local stack or the preview.
`deployment-verify` runs after the merge, on the deployment users reach, and is the only skill in the suite that changes production state: one flag value at a time, or a rollback.

## The contract is written before the deploy

A threshold chosen after seeing the rollout's numbers is chosen to pass them.
So the contract lives in the PR body, written before the merge, and a contract may only tighten the repo's thresholds.
The PR body also survives the merge and the worktree cleanup, which `.agent/{branch}/` files do not.

## The criteria come from the PR too

`aw-verify` writes the acceptance criteria into the PR as a visible, collapsed region, because `.agent/{branch}/` is gone after the merge and a later session has only the PR.
The controller reads them to show which promises the rollout watches and which nothing watches, and to draft the contract before the merge; it never judges a criterion, so the verdict stays `decide.mjs`'s.
The one write is a `🚀` on a watched criterion after a `PASS`: the checklist the reviewer saw go ✅ before the merge shows what production confirmed after it, and a rollback leaves the marks alone because a rollout verdict is about the contract's spans, not about each criterion.

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

## A human hold, and an earned recommendation

A rollout that passes every gate can still need a person: the gates measure errors and latency, not whether the feature is the one the team wanted at 50 % of traffic.
`hold_after` puts that person at one committed step, and the default is no hold, so a repository opts in by editing a reviewed file.
The hold has no timeout because a hold that resolves itself is a delay, not a gate.

Published thresholds for when an agent has earned autonomy are opinion, not measurement, so this skill ships no default that grants it.
The policy is a committed `promotion:` block a human owns; the loop only counts evidence against it and never edits it.
The evidence is agreement: a human approving the controller's PASS at a hold, slowly enough to have read it, counts one; a fast approval is a rubber stamp and counts neither way, because counting it would let the streak measure attention instead of correctness.
Disagreement is cheaper to learn from than agreement, so any override, rollback, revert, or change of model resets the streak and drops a level at once.
The streak is kept per repository and risk class because a team that trusts UI changes has said nothing about migrations.
The recommendation is printed beside the hold and nothing acts on it yet: a recommendation that has been right for months is the evidence a team needs before letting it act.

Guarded rollouts hold on insufficient sample and never pass on it; the earned-autonomy signal follows the same rule, so missing evidence of any kind recommends `HUMAN`.
The signal is written with `expected_version`, because two ticks or a tick and a person can update it at once, and a lost reset is the one write that must never be overwritten by a stale increment.

## Telemetry constraints this design follows

- Flag SDK hooks commonly record evaluations as span events; Dash0's D0QL `spans` table has no events column, so the cohort must be a span attribute.
- Framework instrumentation often makes the handler's active span an inner span whose status stays `UNSET` on a 500, so errors are read on the root SERVER span, joined by `trace_id` when needed.
- D0QL has no percentiles, so the latency rule uses averages.
- Ingestion lags the traffic by tens of seconds, so every measurement waits and, when the skill sent the traffic, checks the count it sent.

## Flags a PR flips

A flag compiled into the code has no runtime switch, so a `set` command for it would edit the registry and cut a release: neither instant nor reviewed.
Before `rollout: pr`, setup offered only that command or `providers: []`, and the second leaves the flip unmeasured.
A PR that only flips the flag is a deploy like any other, so the no-flag before/after loop measures it without new machinery; stepping (1 → 100 %) is lost, which a compiled flag cannot do anyway.
No script opens that PR: turning a feature on for everyone is the decision `hold_after` exists to give a human, and the flip PR keeps it with a reviewer.

## Not covered

- A soak window after 100 %: the rollout ends at 100 % PASS and says so.
- Choosing the flag and writing the contract: that belongs to the planning step (`aw`), before the merge.
- Acting on an `AUTO` recommendation, or detecting a revert PR: a hold advances only on a human `approve`, and whoever opens a revert records the `revert` event.
