---
name: deployment-verify
description: >
  Verifies a merged change on a real deployment and reverses it when it hurts: waits until the merged
  commit is serving, steps the change's feature flag through a rollout (1 → 10 → 50 → 100 %), compares
  the flag-on and flag-off cohorts in the same window from telemetry, lets a deterministic rule decide
  PASS, HOLD, or ROLLBACK, flips the flag back on a failure, proves recovery, and notifies where the
  outcome needs a human. Resumable across short runs, so a scheduled automation can drive it unattended.
  `setup` writes `.agents/aw/release.yml`. Triggers on "verify the deploy", "is it working in production", "roll out this flag", "/deployment-verify".
disable-model-invocation: false
argument-hint: '[run|tick|setup] [<pr-url|pr-number>|--all] [--env production|preview|local] [--steps 1,10,50,100] [--rollback ask|auto|never] [--deployed-at <ISO>] [--unattended] [--no-comment]'
license: MIT
metadata:
  author: mthines
  version: '0.2.0'
  workflow_type: orchestrator
  tags: [deployment, rollout, feature-flags, rollback, telemetry, verification, production, automation, notify]
---

# deployment-verify

The suite before the merge proves the change works; this skill proves it keeps working where users are, takes it back out when it does not, and tells someone.
A script runs the rollout; the agent sets it up and handles what the script cannot.
A clean rollout spends no model tokens: [`scripts/tick.mjs`](./scripts/tick.mjs) measures, [`scripts/decide.mjs`](./scripts/decide.mjs) decides, and an agent is woken only for an exception.
Why it is shaped this way: [`references/design.md`](./references/design.md).

## Invocation

```text
/deployment-verify <pr>                        # run: tick until the rollout ends, waiting between ticks
/deployment-verify tick --all --unattended     # one tick for every in-progress PR, then exit (automations)
/deployment-verify <pr> --env local --deployed-at 2026-11-11T08:38:38Z
/deployment-verify setup                       # write or validate .agents/aw/release.yml (interactive only)
```

| Argument | Meaning |
| --- | --- |
| `<pr>` | A merged PR carrying a contract; `--all` = every merged PR labelled `deployment-verify` |
| `run` (default) | Tick repeatedly, waiting until the next unit is due, until the outcome is terminal |
| `tick` | Do every unit that is due now, then exit ([`rules/state.md`](./rules/state.md)) |
| `--env` | A `release.yml` environment; default `production` |
| `--steps` | Override `release.yml` → `steps` |
| `--rollback` | Override the personal `rollback` policy for this run |
| `--deployed-at` | Required when the environment's deploy detection is `manual` |
| `--unattended` | No questions; the automation answers apply ([`rules/automation.md`](./rules/automation.md)). Implied in a prepared Agent0 sandbox |
| `--no-comment` | Post nothing to the PR; state then lives only in this session, so `tick` is refused |

## Step 0 — Resolve and refuse early

1. Resolve `.agents/aw/release.yml` and `telemetry.yml` plus the personal overlay ([`rules/config.md`](./rules/config.md)). Missing `release.yml` → `STOPPED — run /deployment-verify setup first`.
2. Run `node ${CLAUDE_SKILL_DIR}/scripts/decide.mjs --self-test`; a failure stops every PR: the verdict rule is broken.
3. Per PR: `gh pr view <pr> --json body,mergeCommit,mergedAt,state,url,labels`. Closed without `mergedAt` → remove the label, stop: nothing deployed.
4. Per PR without state: extract and validate the contract ([`rules/contract.md`](./rules/contract.md)).

## Step 1 — Run the controller

```bash
node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --pr <n> [--run] [--env <env>]       # PR mode, state in the PR comment
node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --all                                # every in-progress PR, one tick each
node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --local <state.json> --contract <contract.json> --env local --deployed-at <ISO> --run
```

`tick` = one pass, then exit; `--run` = keep ticking until the outcome is terminal.
Never re-implement a step the controller performs; read its stderr and the report it writes.
It implements these rules, which stay its specification:

| Phase | Rule |
| --- | --- |
| `deploy` | Wait for the merged commit to serve — [`rules/config.md § Deploy detection`](./rules/config.md#deploy-detection) |
| `baseline`, `step` | Measure, confirm live, `decide.mjs`, act — [`rules/loop.md`](./rules/loop.md), queries per [`rules/telemetry.md`](./rules/telemetry.md) |
| `rollback` | Reverse, prove recovery, hand off the cause — [`rules/rollback.md`](./rules/rollback.md) |

## Step 2 — Handle the exception (the only agent work in a rollout)

The controller exits `3` and runs `release.yml` → `on_exception` when a rollout ends `ROLLED_BACK`, `ESCALATE`, or `INCONCLUSIVE`.
Woken by that event, or by exit `3`:

1. Read the report comment and the state line on the PR.
2. Find the cause ([`rules/rollback.md § Hand off the cause`](./rules/rollback.md#hand-off-the-cause)).
3. `ESCALATE` with `rollback needs a human` and no platform rollback → open the revert PR ([`rules/rollback.md § Act`](./rules/rollback.md#act)).
4. Notify ([`rules/notify.md`](./rules/notify.md)) and add the cause and the `notify:` line to the report comment.

`PASS` and `STOPPED` need no agent; the controller's PR comment is the whole report.

## Report

The controller writes the PR's report comment (marker `<!-- deployment-verify:v1:report -->`) with this block and the state line; the agent only appends `cause:` and `notify:`:

```text
DEPLOYMENT <IN PROGRESS | PASS | ROLLED_BACK | INCONCLUSIVE | ESCALATE | STOPPED>
change:   <PR title> (#<n>) · flag <key> via <provider> · <env>
deploy:   live at <time> (<attribute>=<sha7>)
baseline: <n> requests, <e> errors, <avg> ms
step   test n/err/ms    control n/err/ms   verdict
1 %    26/7/304         2593/0/3.6         ROLLBACK error rate +26.9pp vs control > 5pp
action:   flag → 0 at <time>; RECOVERED in <s> s
cause:    <Agent0 answer and thread link, or "not investigated">
notify:   slack #deploys ok · linear ENG-123 ok
next:     /fix-bug <PR URL> — failing window <from>..<to>
not watched: <e.g. no soak window — run ended at <time>>
```

## Anti-patterns

| Never | Instead |
| --- | --- |
| Judge PASS or ROLLBACK yourself, or run the loop by hand | Run `tick.mjs`; it calls `decide.mjs` |
| Advance a step on HOLD | Extend the same step |
| Edit the contract after the first tick | Stop, fix the contract, start a new rollout |
| Trust `set` exiting 0 | Confirm the step is live from the cohort share |
| Detect a Vercel deploy by `service.version` | `vercel.sha` — `service.version` is the deployment ID |
| Roll back with a revert PR while a flag exists | Set the flag off |
| Report RECOVERED without a clean post-rollback window | Measure one more window |
| Sleep through a rollout inside one automation run | Tick and exit; the schedule brings the next tick |
| Ask a question in an unattended run | Apply the automation answer |
| Drop a failed notification | Record it in the PR comment |
