---
title: Contract — what "broken" means for this change, written before the deploy
impact: HIGH
tags: [deployment-verify, contract, pr-body, thresholds]
---

# Contract

Every run judges one change against its contract.
The contract lives in the PR body, so it survives the merge and the worktree cleanup.
Write it before the PR merges; never write or edit it after the rollout starts.
**Why:** a threshold chosen after seeing the numbers is chosen to pass them.

## Visible, collapsed

The block is readable by a reviewer and closed by default: the markers are the only hidden part, and the JSON sits in a `<details><summary>` that says what it is.
The controller also reads an older bare fence.

```text
✗ a contract only a script can find: the JSON inside an HTML comment
✓ <!-- deployment-verify:v1 --> <details><summary>🚦 Deployment contract — …</summary> ```json … ``` </details> <!-- /deployment-verify:v1 -->
```

## Draft from the criteria

`/aw-verify` leaves the PR's acceptance criteria as the `intent` region of its verify report (visible, collapsed).
A PR with no contract yet and not merged: `node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --draft-contract --pr <n>` prints a contract built from its `api:` criteria (`root_spans`), with `service` left as `<service.name>`.
Review it, fill the placeholders, add `flag` and `cohort` when a flag exists, and write it into the PR body before the merge; the script never writes it, and refuses a merged PR.

Before the criteria are on the PR, draft from the `/aw` brief: `--draft-contract --from-plan .agent/<branch>/plan.md` (add `--pr <n>` to prefer the PR's criteria and keep the merged-PR refusal).
It reads the brief's `[api:…]` criteria, and prefills `flag.key` only when the brief's `## Requirements` and `## Guardrails` name exactly one flag as a backticked key beside the word "flag" (`` the `checkoutV2` feature flag ``, `` flag `checkoutV2` ``); a key with a dot, slash, or space never counts.
Zero or several such keys → no `flag`, and stderr says which; a prefilled flag still needs `flag.provider` and `cohort` filled.

```text
✗ tick.mjs --draft-contract on a merged PR, then pasting its output (thresholds chosen after the numbers)
✓ tick.mjs --draft-contract --pr 214   # before the merge → edit → add to the PR body
✓ tick.mjs --draft-contract --from-plan .agent/feat-x/plan.md   # before the criteria are published
```

## Shape

One fenced JSON block between the markers, anywhere in the PR body, inside the `<details>` above; JSON because the controller reads it with no dependencies:

````markdown
<!-- deployment-verify:v1 -->
<details><summary>🚦 Deployment contract — checkoutV2 via posthog, root span GET /api/checkout</summary>

```json
{
  "service": "ui",
  "root_spans": ["GET /api/checkout"],
  "flag": { "key": "checkoutV2", "provider": "posthog" },
  "cohort": { "attribute": "feature_flag.result.variant", "test": "true", "control": "false", "on": "root" },
  "reversibility": "flag",
  "thresholds": { "max_error_rate_delta_pp": 2 }
}
```

</details>
<!-- /deployment-verify:v1 -->
````

| Field | Meaning |
| --- | --- |
| `service` | Resource `service.name` the change runs in |
| `root_spans` | SERVER span names the flag changes; errors and latency are read here |
| `flag` | The flag the change ships behind; `provider` names a `release.yml` → `flags.providers[].name`. Omit for a change with no flag |
| `cohort` | Required with `flag`, ignored without one. The span attribute naming the cohort, its flag-on (`test`) and flag-off (`control`) values, and `on`: `root` or `child` ([`telemetry.md`](./telemetry.md)) |
| `env` | Optional `release.yml` environment for this change; default is `--env`, else `production`. An explicit `--env` flag overrides it. Lets one `--all` run verify a backend and a UI PR that detect on different attributes |
| `reversibility` | `flag`, `redeploy`, or `irreversible` |
| `thresholds` | Optional; may only tighten `release.yml` thresholds |
| `steps` | Optional; overrides `release.yml` → `steps` for this change |
| `model` | Optional; the model that wrote the change (`claude-opus-5-5`). The earned-autonomy signal resets when it changes ([`autonomy.md`](./autonomy.md)) |

## Validate before step 1

Take the first row that fails; print its line and stop without touching the flag:

| Check | Stop line |
| --- | --- |
| No region in the PR body | `no contract — add a <!-- deployment-verify:v1 --> block to the PR body` |
| The start marker is there, but prose or a second fence sits between the markers | `contract block malformed: only one ```json fence may sit between the markers` — move the extra line below the end marker; never add a second block |
| `flag.provider` names no `release.yml` provider | `unknown provider <name>` |
| `cohort.attribute` is `feature_flag.*` read from span **events** only | `cohort attribute must be a span attribute — span events are not queryable` |
| A `thresholds` key loosens `release.yml` (higher `max_*`, lower `min_*`) | `contract loosens <key> — thresholds may only tighten` |
| `reversibility: irreversible` | run in report-only mode: measure and decide, never roll back, say `irreversible — rollback needs a human` |

```text
✗ Wrong — loosens the error budget for this change:   "thresholds": { "max_error_rate_delta_pp": 20 }
✓ Right — a payment path tightens it:                 "thresholds": { "max_error_rate_delta_pp": 1, "min_test_requests": 50 }
```

## No flag

A change with no flag has no cohorts; omit `flag` and `cohort`.
The contract is measured before and after the deploy ([`loop.md`](./loop.md#no-flag--before-and-after)): one step at 100 % with `baseline` as the reference, and a rollback through `release.yml` → `rollback` instead of the flag.
Say so in the report: `no flag — before/after only, attribution weaker`.

```json
// ✗ Wrong — a no-flag contract that invents a flag to satisfy the cohort check
{ "service": "api", "root_spans": ["GET /x"], "flag": { "key": "none", "provider": "posthog" } }
// ✓ Right
{ "service": "api", "root_spans": ["GET /x"], "reversibility": "redeploy" }
```
