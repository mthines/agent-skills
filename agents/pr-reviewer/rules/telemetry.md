---
title: Telemetry — production exposure as a review input
impact: MEDIUM
tags:
  - pr-reviewer
  - dash0
  - observability
---

# Telemetry

One constraint decides this entire rule: **no telemetry exists for the change itself before merge.**

Production spans describe the code the PR is *modifying*, never the code the PR *introduces*.
A Vercel preview emits nothing until something drives it.
So telemetry can never tell the reviewer whether a change is correct — it can only tell it how **exposed** the code being changed is, and what that code has historically done wrong.

That makes it an input about exposure and history, landing at four seams the pipeline already has: Phase B (exposure), Phase D (leads), Phase F (consequence notes), and [`memory.md`](./memory.md) (post-merge learning).

## Contents

- [Three rules that hold everywhere](#three-rules-that-hold-everywhere)
- [Capability gate](#capability-gate)
- [Exposure — a Phase B input](#exposure--a-phase-b-input)
- [Leads — a Phase D input](#leads--a-phase-d-input)
- [Preview comparison](#preview-comparison)
- [Post-merge regression](#post-merge-regression)
- [Report surface](#report-surface)
- [Budget and failure modes](#budget-and-failure-modes)

---

## Three rules that hold everywhere

**1. Telemetry raises priority. It never lowers it.**

A symbol with zero spans in thirty days is **unknown**, not safe.
It may be uninstrumented, sampled out, behind a flag, or on a cold path that fires once a quarter and matters enormously when it does.

```text
✅ RIGHT — high traffic on a changed signature ⇒ deep tier
✅ RIGHT — no spans found ⇒ multiplier stays 1, tier unchanged, report says "unknown"
❌ WRONG — no spans found ⇒ band lowered to `none`, tier downgraded to quick
❌ WRONG — no spans found ⇒ finding's severity reduced
```

**2. Telemetry never blocks.**

No token in `SEVERITY_TALLY`. No phrase in `FAIL_REASONS`. No confidence points.
Gate 2's argument applies unchanged: the agent did not diagnose the error rate and cannot separate a real regression from a sampling change, a deploy window, or a downstream outage.
An error rate is a **lead the verifier must attribute to the diff** before it is a finding.

**3. Aggregates and signatures only.**

Read counts, rates, percentiles, span names, and `exception.type` values.
**Never** copy raw span attributes — request bodies, `user.id`, `enduser.*`, URLs carrying query strings — into a comment, a knowledge record, or a report.
The PII rules in [`pii-and-compliance.md`](../../../skills/analysis/rum-tracking/rules/pii-and-compliance.md) govern what the reviewer *republishes*, and a review comment is published to everyone who can see the PR.

## Capability gate

Bound once at Step 1.1b, next to `DEPTH_CAPABILITY`.

| `TELEMETRY_CAPABILITY` | Condition | Effect |
| --- | --- | --- |
| `none` | no `mcp__dash0*` tool in the session, **or** no path → service mapping | the whole rule is skipped; the report renders `Telemetry: none` |
| `production` | Dash0 reachable and ≥ 1 changed path maps to a service | exposure + leads |
| `production+preview` | as above, **and** spans exist for the head SHA (`vcs.ref.head.revision = <head>` or `git.pull_request_link = <PR URL>`) | adds the preview comparison |

The path → service mapping comes from, in order:

1. The Observability Profile's Package Map, when `measurable setup` has run (`apps/web/** → ui-web`, `services/api/** → api`).
2. OTel code attributes on the spans themselves — `code.file.path`, `code.function.name`.
3. A `telemetry.services:` glob map in `.github/review.yaml`.

**No mapping means `none`.** The reviewer never guesses a service name from a directory name: reviewing `apps/web` against a service called `web` that is actually the marketing site produces confident nonsense.

Prefer the `dash0-prod` server for exposure and `dash0-dev` for preview spans.
That is the stabilizer's server-preference rule inverted, and deliberately: the stabilizer wants CI spans, the reviewer wants production ones.

## Exposure — a Phase B input

Two bounded queries per run fill an optional `production` block in `impact.json`:

```jsonc
"production": {
  "sampled_at": "2026-09-03T09:12:00Z",
  "services": [
    { "service": "api", "paths": [ "src/api/client.ts", "src/billing/charge.ts" ],
      "req_per_min": 412, "error_rate": 0.0031, "p99_ms": 840,
      "deploy_attribution": "service.version" }
  ],
  "symbols": [
    { "name": "retryRequest", "path": "src/api/client.ts",
      "spans_7d": 1240000, "error_rate": 0.012, "p99_ms": 2300,
      "exception_types_30d": [ { "type": "TimeoutError", "count": 3800 },
                               { "type": "RetryExhausted", "count": 412 } ],
      "traffic_band": "high" }
  ],
  "routes": [ { "route": "POST /v1/charges", "handler": "src/billing/charge.ts",
                "req_per_min": 38, "error_rate": 0.002, "traffic_band": "medium" } ]
}
```

Feed it in with `--production`:

```bash
node "$AGENT_SUPPORT/pr-reviewer/scripts/build-impact-graph.mjs" /tmp/pr-files.json \
  --workdir "$WORKDIR" --production /tmp/production.json \
  > /tmp/pr-impact.json
```

Symbol-level rows exist only where spans carry `code.function.name`, or where the span name *is* the function.
Otherwise a symbol inherits its service's band — which is a real approximation and is labelled as one.

| `traffic_band` | Requests per minute | Blast multiplier |
| --- | --- | --- |
| `unknown` | no data | 1 |
| `low` | < 1 | 1 |
| `medium` | < 100 | 1.5 |
| `high` | ≥ 100 | 2 |

Two effects, both upward-only:

- **Blast radius.** Each symbol's term is multiplied by its band, and `why[]` names the exposure: "`retryRequest`: 14 consumer files, ~1.2 M spans/week in `api`". A twelve-line diff on a `high`-band handler therefore routes `standard` rather than `quick` — the "a simple diff on a hot path is not simple" case.
- **Deep trigger.** Any changed symbol with `traffic_band: high` **and** `change ∈ {signature, removed}` is a `deep` trigger, alongside high-stakes paths and dependency majors.

Cache the block on the symbol's `knowledge::<symbol>@<path>` record with its `sampled_at` stamp and a **24-hour freshness bar**.
Per-commit re-reviews of one PR then re-query at most once a day, and the next PR on that symbol — any branch, any author — gets the exposure for free.

## Leads — a Phase D input

The correctness and consumer-impact finders receive the `production` block in exactly the standing of the impact graph: **read the code the lead points at; never quote the number as the finding.**

| Lead | What the finder checks | Shape if verified |
| --- | --- | --- |
| **Live error signature on a changed path** — `exception.type` counts on spans from the changed function or route, 30 d | Does the diff change how that exception is produced, caught, or propagated? Removing a `catch`, narrowing a retry, or changing a timeout on a path that throws `TimeoutError` 3 800×/month is a consequence the author should hear about. | `issue (medium): … TimeoutError fires ~130×/day on this path in production; the removed catch turns each into a 500.` |
| **Claims to fix a live error** — the PR body or linked ticket names an error, a Dash0 URL, or a ticket that resolved to one | Intent finder: does the changed path actually produce that `exception.type` or span name? | `question: the PR says it fixes RetryExhausted on checkout, but that exception is emitted from src/jobs/sync.ts:88, which the diff does not touch.` |
| **A new failure mode with no signal** — the diff adds a `throw`, a rejected promise, or an error branch on a service in the profile | Does an error span status or an error-severity log accompany it? At most **one** `suggestion:` per PR, pointing at [`regression-signals.md`](../../../skills/quality/measurable/rules/regression-signals.md). Skip with `--no-observability`. | `suggestion: the new InsufficientFunds branch is invisible to the api error-rate check — set span status Error or log at error severity.` |

A lead the verifier cannot attribute to the diff is `unobtainable` and is **dropped**.

```text
❌ WRONG — "this file has a 1.2 % error rate in production" (true, and not this PR's doing)
✅ RIGHT — "the catch removed at line 214 was handling TimeoutError, which this path
            throws ~130×/day" (the diff, the code, and the exposure, in that order)
```

## Preview comparison

The preview emits spans only when something drives it: `preview-spec run` dispatching `aw-tester`, a developer clicking through, or an E2E job pointed at it — and only if the preview app's exporter tags resources with `vcs.ref.head.revision` or `git.pull_request_link`.

Under `production+preview`, one comparison per touched route or service, preview head vs the production 7-day baseline:

| Signal | Treatment |
| --- | --- |
| An `exception.type` or error span name on the preview that the production baseline has **never** emitted on that route | an `issue (medium)` lead, verified against the diff like any other. The one preview signal strong enough to become a finding. |
| Error-rate rise on a route the diff touches | consequence note in `Impact` — preview traffic is a handful of requests |
| Latency shift (p50 / p99) | note only, marked `preview, n=<spans>`; **never** a finding. Cold starts and region make preview latency uninformative. |
| No spans for the head SHA | `Telemetry: production (no preview spans for <sha7>)`; nothing inferred |

## Post-merge regression

This is where telemetry pays for itself across branches and authors, and it is the one input the memory layer otherwise has no source for.

After merge and deploy, the changed services carry a `service.version` / `deployment.version` / `vcs.ref.head.revision` that attributes spans to the deploy.
Compare error rate and new `exception.type` values in the 24 h after against the 7 d before, using the rate-decay and build-version shapes `fix-bug` Phase 8 already defines, **inverted** — a rise instead of a decay.

The comparison runs **outside** the reviewer: the `reviewer-comment-relevance.yml` workflow in `deploy-regression` mode consumes a pre-computed report, because a GitHub Action cannot authenticate to Dash0 and a recorder holding a telemetry client could not be tested offline.

| Outcome | Record write |
| --- | --- |
| A new or risen signature on a file the reviewer **did not flag** | `hotspot::<path>` `missed += 1` with `{pr, sha, exception_type}`; the symbol's `history[]` gains `outcome: regressed-in-prod` |
| A regression on a symbol the reviewer flagged, where the thread was dismissed, downvoted, or resolved with no change | `rule::<fp>` gains an `amplify` evidence entry at **weight 3** — one production regression outweighs three 👎 |
| A regression on a symbol the reviewer flagged and the author fixed before merge | **no write.** The fix worked; the regression is elsewhere. Attribution by symbol rather than by file is what keeps this honest. |
| No change | **no write.** Silence is not evidence of safety, so no `confirmed-safe` counter exists. |

## Report surface

Inside the `Impact` accordion, one `Telemetry` line plus one consequence note per exposed symbol:

```markdown
**Telemetry:** production (`api`, `ui-web`; sampled 09:12 UTC; no preview spans for `a1b2c3d`)

- `retryRequest` (`src/api/client.ts`) — ~1.2 M spans/week in `api`, p99 2.3 s, `TimeoutError` ~130×/day. Signature change; 14 consumers.
- `POST /v1/charges` — 38 req/min, error rate 0.2 %. Body change only.
```

Rendered from `impact.json` by `render-report.mjs` like every other slot.
**The agent never types a number into prose** — a remembered figure that disagrees with the query is worse than no figure.

`Telemetry: none` renders when the capability is absent, so a reader can tell "no exposure data" from "no exposure".

## Budget and failure modes

| Queries | Cap |
| --- | --- |
| exposure (services; symbols + routes) | 2 per run |
| error signatures per changed service | 1 each, cap 5 |
| preview comparison per touched route | 1 each, cap 5, only under `production+preview` |

Windows are bounded: 7 days for exposure, 30 for error signatures.

**A query error or timeout downgrades `TELEMETRY_CAPABILITY` to `none` for the run and says so in the report.**
It never retries in-loop, and it never fails the review.

The agent's `tools:` grant gains **read-only** Dash0 span and metric query tools and nothing else — no dashboard, check-rule, or SLO writes.
That keeps the hands-off boundary `measurable` and the `dash0` agent already hold: this rule reads telemetry, it never provisions it.
