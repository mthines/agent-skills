---
title: Automation — running unattended (Dash0 Agent0 automations, CI, cron)
impact: HIGH
tags: [deployment-verify, automation, agent0, unattended, triggers]
---

# Automation

A run is **unattended** when `--unattended` is passed or `/tmp/workspace/agent-skills/env.sh` exists (a prepared Agent0 sandbox).
Unattended runs always tick ([`state.md`](./state.md)) and never ask a question.

## The answer to every question

| The skill would ask | Unattended answer |
| --- | --- |
| Roll back? (`rollback: ask`) | `reversibility: flag` → yes, act. Anything else → do not act, outcome `ESCALATE` with `rollback needs a human (reversibility: <value>)` |
| Which provider? Which dataset? (`setup`) | Never run `setup` unattended; stop: `STOPPED — run /deployment-verify setup interactively` |
| Contract missing or invalid | `STOPPED`, comment on the PR, remove the label |

`rollback: never` still wins: report only.

## Recommended: a scheduled script, an agent on exceptions

The ticks need no model, so schedule the controller itself and spend agent time only when a rollout fails:

```yaml
# .github/workflows/deployment-verify.yml
on:
  schedule: [{ cron: "*/10 * * * *" }]
  pull_request: { types: [closed] }
  deployment_status: # Vercel and most platforms post GitHub deployment statuses
jobs:
  tick:
    if: github.event_name != 'deployment_status' || (github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production')
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write, issues: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with: { repository: mthines/agent-skills, path: .agent-skills }
      - run: node .agent-skills/skills/testing/deployment-verify/scripts/tick.mjs --all
        env:
          GH_TOKEN: ${{ github.token }}
          DASH0_AUTH_TOKEN: ${{ secrets.DASH0_AUTH_TOKEN }}
          AGENT0_WEBHOOK_URL: ${{ secrets.AGENT0_WEBHOOK_URL }}
          # plus each flag provider's API key, read by its set script
```

Set `release.yml` → `on_exception` to post `{event}` to an Agent0 automation's **Webhook** trigger; that automation runs Step 2 of `SKILL.md` and nothing else.
A clean rollout then costs a few seconds of CI per tick and no model tokens.

The `deployment_status` trigger starts the rollout the moment production finishes deploying instead of at the next scheduled tick.
Keep the schedule: it drives every later step, and it catches a missed or failed deployment event.

## Alternative: Dash0 Agent0 runs every tick

Every tick is then an agent run and consumes Agent0 credits, including ticks with nothing due.
One automation runs every rollout in the repository:

| Setting | Value |
| --- | --- |
| Triggers | **Deployment Status**, state `success`, environment `Production` (starts a rollout as the deploy lands); **Schedule** `@every 10m` (continues every rollout, and catches a missed deployment event). Add **GitHub Pull Request**, action `closed`, label `deployment-verify`, only to post the report comment at merge |
| Prompt | `Run node $AGENT_SKILLS_ROOT/skills/deployment-verify/scripts/tick.mjs --all in {{github.repository}}; on exit 3, handle the exception per the deployment-verify skill.` |
| Concurrency | `skip` — a tick that starts while one runs does nothing; the lease covers the rest |
| Timeout | 15 min — one tick, never a whole rollout |
| Network | **Trusted hosts only** for `gh`; **Full Network** when a provider's `set` calls a host outside that list |
| Secrets | Each provider's API key in **Settings → Agent0 → Environment Variables**, read by its `set` script; never in the setup script, setup variables, or parameters |
| Allowed tools | Dash0 query tools; the Slack and Linear write tools `notify` uses (a scheduled trigger does not allow them by default) |
| Setup script | The repo's Agent0 setup script, which installs every skill in this repository into the sandbox |

A `closed` PR that was not merged has no deploy: the first tick sees `state: closed` without `mergedAt` and removes the label.

## Other schedulers

Anything that can run the CLI on a timer works the same way:

```bash
node <agent-skills>/skills/testing/deployment-verify/scripts/tick.mjs --all
```

Run it every 5–10 minutes; the lease makes overlapping runs safe.
