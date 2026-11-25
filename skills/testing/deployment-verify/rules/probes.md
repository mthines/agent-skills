---
title: Probes — the same tagged requests before and after a no-flag deploy, judged per route
impact: HIGH
tags: [deployment-verify, probes, synthetic, baseline, auth, no-flag]
---

# Probes

A no-flag run compares before with after ([`loop.md`](./loop.md#no-flag--before-and-after)).
On real traffic the two sides are different requests: another route mix, cold instances, the deploy pipeline's own test burst.
A probe sends the same request set on both sides, after a warm-up, and [`decide.mjs`](../scripts/decide.mjs) judges each route against its own before side.
[`scripts/probe.mjs`](../scripts/probe.mjs) runs it; [`scripts/tick.mjs`](../scripts/tick.mjs) calls it. This file is their specification.

**Why:** a pooled before/after verdict moves when the route mix moves, not only when the code does: a fast route in the before window and a slow one in the after window read as a latency regression.

## When probes run

Every row must hold; otherwise the run measures real traffic exactly as before.

| Condition | Source |
| --- | --- |
| The contract has no `flag` | the PR's contract |
| `.agents/aw/probes.yml` exists and is valid | committed in the repo |
| A probe's `covers` names one of the contract's `root_spans` | `probes.yml` |

A flagged run never probes: its control cohort already shares the window.

## `probes.yml`

Committed beside `release.yml`. It holds request shapes only: base URLs and identities come from `environments.yml`, and no value in it is a secret.

```yaml
version: 1
defaults:
  identity: probe                        # environments.<env>.auth.identities.probe
  tag:
    header: { X-Deployment-Verify: probe }                  # sent on every request
    span_filter: { deployment.environment.name: test }      # finds the probe's own spans, to confirm which version answered
  warmup: { requests: 3, discard: true }  # passes sent and thrown away first
  budget: { max_rpm: 60 }                 # requests are paced under this
  rounds: 20                              # measured passes: per-route n = rounds × requests on that route
  history: issue                          # optional: keep results per version (below)
  mcp_path: /functions/v1/mcp             # optional: appended to the URL when the environment has no mcp_url
probes:
  reads:
    covers: [lorekit.memories, lorekit.mcp]
    fixtures:
      setup: node scripts/probe-fixtures.mjs   # idempotent; prints a JSON object, e.g. {"key": "probe-1"}
    requests:
      - name: list
        http: { method: GET, path: /functions/v1/memories?scope=project::probe }
        route: /memories
        expect: { status: 200, json: $.items }
      - name: read
        mcp: { tool: memory.read, args: { scope: project::probe, key: "{fixture.key}" } }
        route: /mcp
        expect: { isError: false }
```

| Field | Rule |
| --- | --- |
| request kind | Exactly one of `http` (`method`, `path`, `headers`, `body`), `mcp` (`tool`, `args`: a JSON-RPC `tools/call` POST), `command` (`run`: exit 0 is ok) |
| `route` | Required. The `http.route` its span reports; routes are compared one by one, never pooled |
| `expect` | `http`: `status` (default 2xx) and `json` (a `$.a.b` path that must exist). `mcp`: `isError` (default `false`). A miss is an error sample |
| `{fixture.<k>}` | Filled from the `fixtures.setup` command's JSON stdout. Setup is idempotent and has no teardown, so every version reads the same data |
| `rounds` | Size it so each route's n is at least `thresholds.min_test_requests`; a smaller window ends `INCONCLUSIVE`, never `PASS` |

Validate with `node ${CLAUDE_SKILL_DIR}/scripts/probe.mjs --check [--env <env>]`: it names each problem by its path (`probes.reads.requests[1].route: required`).
Draft one for review with `node ${CLAUDE_SKILL_DIR}/scripts/tick.mjs --draft-probes --pr <n>`: one probe covering the contract's root spans, one request per `api:` criterion. A human reviews and commits it; the draft is never written for them.

## Auth — a bearer identity

A probe sends as one `environments.yml` identity with `strategy: bearer`, an `auth.identities.<role>` entry in the shape the `aw-verify` skill's `rules/auth.md` defines:

```yaml
environments:
  production:
    url: https://api.example.com
    auth:
      identities:
        probe:
          strategy: bearer
          token: { env: EXAMPLE_PROBE_TOKEN }       # or { command: <mints one>, ttl_seconds: 3000 }
          header: Authorization                      # default; sent as `Bearer <token>`
          check: { http: { path: /me } }             # the preflight request
```

1. **Least privilege.** A read-only token, scoped to probe data and a probe account, never a person's or an admin's.
2. **Preflight before every window.** The `check` request runs first. A 401 or 403 mints a fresh token once (`command` only), then stops the run `STOPPED — probe auth failed`.
3. **An auth failure is never a sample.** A 401 or 403 anywhere in a window stops the run; it never counts as an error and never reaches `decide.mjs`.
4. **The token never leaves memory.** It is never in `probes.yml`, the report, the state, or a log line. A minted token is cached in a `0600` file in the OS temp directory, outside the repo, until `ttl_seconds`.

```yaml
# ✗ Wrong — a value in a tracked file, and an expired token read as a 100 % error rate → ROLLBACK
headers: { Authorization: "Bearer lk_ro_9f2c…" }
# ✓ Right — the name of an env var; a 401 ends STOPPED and nothing is rolled back
token: { env: EXAMPLE_PROBE_TOKEN }
```

## The before side

Take the first that exists:

1. **Live.** A run that starts before the new version serves probes the old version during the `deploy` phase, once. Report: `probe: before live at <time>`.
2. **History.** With `history: issue`, an after-probe that passed, or the first one recorded with no before side, is recorded as one comment on the repo's `deployment-verify baselines` issue, keyed by environment and version. A run that starts after the deploy uses the latest record on another version in the same environment. Report: `probe: before history <version>`.
3. **Neither.** The after-probe is recorded and the run ends `INCONCLUSIVE — no before-side probe … baseline recorded for <version>`. The next deploy has a before side.

Never end `PASS` with no before side: an after window alone proves nothing changed for the better or the worse.
Never record a regressed window: the next deploy would be judged against it, and a fix that is still slow would pass.

## Verdict

After the deploy is live, one probe window is the after side.
**Confirm who answered.** With `tag.span_filter` and a `detect.attribute`, the controller waits the ingest delay and counts the window's tagged root spans by version. Any answered by an old version (a rolling deploy still in progress) → probe again on the next tick; still stale → `INCONCLUSIVE`, never a verdict. With no `span_filter` the report says `served by not confirmed`. For each route probed on both sides, `decide.mjs` gets `test` = after, `control.n = 0`, `baseline` = before, with the contract's thresholds.
The worst route decides: ROLLBACK over HOLD over PASS, with the route named in the reason.

| Worst route | Outcome |
| --- | --- |
| PASS | `PASS — every probed route held against its own before side` |
| HOLD | `INCONCLUSIVE — probe window too small …`: raise `rounds` |
| ROLLBACK | `release.yml` → `rollback` `kind: platform`, else `ESCALATE — rollback needs a human` ([`rollback.md`](./rollback.md)). After a platform rollback, the same probes prove recovery against the same before side; a route still regressed → `ESCALATE` |

No route probed on both sides → `INCONCLUSIVE`. The report adds one row per route: `before n/err/avg/p95`, `after n/err/avg/p95`, verdict.

```text
✗ Wrong — pooled: before 60 × /mcp at 10 ms + 20 × /memories at 900 ms; after the mix flips → x3.1 → ROLLBACK
✓ Right — per route: /mcp 10 → 10 ms PASS, /memories 900 → 950 ms PASS → PASS
```

## Budget and side effects

- Pace every request under `budget.max_rpm`, and keep the total under the service's own rate limit for the probe account.
- Probe traffic is real traffic to the service: reads may bump counters, and writes leave rows. Use a dedicated probe account and scope, and prefer read-only requests.
- The verdict reads client timings; telemetry only confirms which version answered. Send the tag on every request so `span_filter` can find it.
