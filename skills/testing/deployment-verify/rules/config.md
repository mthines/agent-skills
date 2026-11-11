---
title: Config — `.agents/aw/release.yml`, deploy detection, flag providers, policy
impact: HIGH
tags: [deployment-verify, config, release-yml, deploy-detection, flags]
---

# Config

Repo values live in `.agents/aw/release.yml`, beside the rest of the `aw` suite config; template: [`templates/release.yml`](../templates/release.yml).
Resolve it like every suite file: the committed file, then `~/.agents/aw/config.yml` → `repos.<owner>/<name>.release` deep-merged over it.
The telemetry MCP server comes from `.agents/aw/telemetry.yml` (`mcp_server`, else the one connected server exposing `sql`).

`release.yml` is read by the controller with a built-in YAML subset parser: block and flow maps and lists, quoted strings, numbers, booleans, comments.
Anchors, tags, and multi-line strings fail with the line number; a `release.json` beside it wins when present.
Check the file with `node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --check-config`.

## Telemetry and exceptions

| Field | Meaning |
| --- | --- |
| `telemetry.kind: dash0-mcp` | The controller calls the Dash0 MCP server's `sql` tool over HTTP; `url` is the server, `token_env` names the variable holding a read-only auth token (default `DASH0_AUTH_TOKEN`) |
| `telemetry.kind: command` | `run` gets the SQL on stdin and `FROM`, `TO`, `DATASET` in the environment, and prints JSON rows: any other backend |
| `on_exception` | Command run once when a rollout ends `ROLLED_BACK`, `ESCALATE`, or `INCONCLUSIVE`; `{event}` is a JSON file with the outcome, reason, PR, contract, and state. Point it at an agent (an Agent0 webhook) |

## Policy

`rollback` is personal, read from `~/.agents/aw/config.yml` → `policies.rollback`, overridden by `repos.<slug>.policies.rollback`, overridden by `--rollback`:

| Value | On a ROLLBACK verdict |
| --- | --- |
| `ask` (default) | Print the verdict and evidence, ask once, act on yes; unattended runs use [`automation.md`](./automation.md#the-answer-to-every-question) |
| `auto` | Act at once, only when the contract says `reversibility: flag`; otherwise behave as `ask` |
| `never` | Report only |

## Deploy detection

The flag must not move until the merged code is serving.
Take the first row that matches `environments.<env>.deploy.detect`:

| `detect` | Live when |
| --- | --- |
| `{ attribute: <key>, equals: merge_sha }` | Spans of `service` carry `<key>` = the PR's merge commit SHA, or a later commit that contains it (`gh api repos/{owner}/{repo}/compare/<merge>...<live>` → `ahead` or `identical`) |
| `{ attribute: <key>, equals: <literal> }` | Spans carry that value |
| `manual` | The caller passes `--deployed-at <ISO>`; local stacks, where a restart is the deploy |

Check once per tick until live; past `timeout_minutes` (default 60) after `mergedAt`, end with `STOPPED — deploy not detected in <n> min, nothing changed`.
**Why:** a busy repository deploys the newest merge, so an earlier merge commit may never serve under its own SHA.
A platform's "deployment succeeded" event says the build is promoted, not that traffic reaches it; the telemetry check still decides.

```yaml
# ✗ Wrong on Vercel — service.version is the deployment ID (dpl_…), never the commit
detect: { attribute: service.version, equals: merge_sha }
# ✓ Right on Vercel — @vercel/otel sets vercel.sha to the commit
detect: { attribute: vercel.sha, equals: merge_sha }
```

## Flag providers

| Field | Meaning |
| --- | --- |
| `name` | What a contract's `flag.provider` names |
| `covers` | Globs of the paths whose flags this provider serves; `setup` uses them to suggest a provider per change |
| `rollout` | `percent` — `set` takes a percentage; `boolean` — only on or off, so steps collapse to `[100]` |
| `set` | Command; `{flag}`, `{value}` (a percent, or `true`/`false` for `boolean`), `{env}`. Idempotent, non-zero exit on failure |
| `propagation_seconds` | How long a change takes to reach traffic (a cache TTL, a redeploy) |

A provider that needs a redeploy to change a value (an environment variable read at start) is `rollout: boolean` with `propagation_seconds` set to a deploy's length.
Never call a provider's API directly from the skill; only through `set`.

## Notify

`notify`, `people`, and `posting.forbidden` route outcomes to Slack, Linear, or a command: [`notify.md`](./notify.md).

## `setup`

`/deployment-verify setup` writes `release.yml` once and validates it on re-runs:

1. Copy the template when the file is absent.
2. Detect flag systems: OpenFeature (`@openfeature/`, `open-feature/go-sdk`), the Vercel Flags SDK (`flags/next`, `@vercel/flags`), PostHog (`posthog-node`, `posthog-js`), LaunchDarkly, Unleash, a repo-local registry. Write one provider per system and ask for its `set` command; never invent one.
3. Find the deploy attribute: query one recent production span of each service and offer the attribute whose value matches a recent `main` commit.
4. Ask for `traffic` for `local` and `preview`; production is `real`.
5. Validate: every `set` path exists and is executable; `dataset` is readable.
