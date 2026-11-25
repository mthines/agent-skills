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
| `{ attribute: <key>, equals: merge_sha }` | Spans of `service` carry `<key>` = the PR's merge commit SHA, or a later commit or release tag that contains it (`gh api repos/{owner}/{repo}/compare/<merge>...<live>` → `ahead` or `identical`) |
| `{ attribute: <key>, equals: <literal> }` | Spans carry that value |
| `manual` | The caller passes `--deployed-at <ISO>`; local stacks, where a restart is the deploy |

A serving value that is a release tag (`v2.0.4541` or `2.0.4541`) resolves to a git ref: try `v<n>` then `<n>`, or only `<tag_prefix><n>` when `detect.tag_prefix` is set.
Every serving value that contains the merge is recorded as `live_values`; the no-flag after window reads only those ([`loop.md`](./loop.md#no-flag--before-and-after)).

```yaml
# ✓ Right — a service whose service.version is the release tag
detect: { attribute: service.version, equals: merge_sha }
# ✓ Right — tags carry another prefix
detect: { attribute: service.version, equals: merge_sha, tag_prefix: "rel-" }
```

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

## Pipeline

`pipeline` describes the default-branch workflow that builds and releases a merge; atelier's Deliver stage reads it ([`atelier/rules/deliver.md`](../../../workflow/atelier/rules/deliver.md)), and `deployment-verify` itself ignores it.
Optional; absent, Deliver reads every run of the merge commit and requires no job by name.

| Field | Meaning |
| --- | --- |
| `workflow` | The workflow's `name:`; only its runs count. Empty reads every run started for the merge commit |
| `required_jobs` | Job names that must conclude `success`. Name only jobs that run on every merge: a required job that is skipped or missing is red, and a job gated on a release condition also skips when nothing is due. A failed job is red without being listed |
| `timeout_minutes` | How long Deliver waits for the run to finish (default 20; 0 reads once) |

```yaml
# ✗ Wrong — release-macos runs only when a release is due, so it skips (and reads red) on a merge that releases nothing
pipeline: { workflow: CI, required_jobs: [test, release-macos] }
# ✓ Right — only a job that runs on every merge is named; a failed version or release job is red on its own
pipeline: { workflow: CI, required_jobs: [test], timeout_minutes: 30 }
```

## Hold and promotion

Both are optional and off when absent; an existing `release.yml` behaves as before.

| Field | Meaning |
| --- | --- |
| `hold_after` | A step value other than the last; the rollout waits there after a PASS for a human `approve` or `override` ([`hold.md`](./hold.md)) |
| `promotion` | The committed earned-autonomy rule: `min_agree_streak`, `min_review_seconds`, `risk_classes`, `max_level` ([`autonomy.md`](./autonomy.md)). It only shapes the recommendation printed at a hold |

```yaml
# ✗ Wrong — a hold at the last step has nothing left to approve; the config fails to load
hold_after: 100
# ✓ Right
hold_after: 10
promotion: { min_agree_streak: 5, min_review_seconds: 120, risk_classes: [ui], max_level: 1 }
```

## Notify

`notify`, `people`, and `posting.forbidden` route outcomes to Slack, Linear, or a command: [`notify.md`](./notify.md).

## `setup`

`/deployment-verify setup` writes `release.yml` once and validates it on re-runs:

1. Copy the template when the file is absent.
2. Detect flag systems: OpenFeature (`@openfeature/`, `open-feature/go-sdk`), the Vercel Flags SDK (`flags/next`, `@vercel/flags`), PostHog (`posthog-node`, `posthog-js`), LaunchDarkly, Unleash, a repo-local registry. Write one provider per system and ask for its `set` command; never invent one.
3. Find the deploy attribute: query one recent production span of each service and offer the attribute whose value matches a recent `main` commit.
4. Ask for `traffic` for `local` and `preview`; production is `real`.
5. Leave `hold_after` and `promotion` commented out, as the template has them; uncomment one only when the user asks for a human hold ([`hold.md`](./hold.md)).
6. Find the default-branch workflow (`.github/workflows/*.yml` with `on: push` to the default branch) and write `pipeline:` with its name and the jobs that must run on a merge; leave `required_jobs` empty when unsure.
7. Validate: every `set` path exists and is executable; `dataset` is readable; `tick.mjs --check-config` prints `release.yml ok`.
