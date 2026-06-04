---
title: Phase 1 — Pull historical telemetry from Dash0
impact: HIGH
tags:
  - telemetry
  - dash0-mcp
  - historical-baseline
---

# Phase 1 — Pull historical telemetry from Dash0

Phase 1 establishes the baseline.
It answers "which tests are actually flaky on this PR, and how often" using span history from CI runs that have already happened.
The trace evidence used for root cause comes from **local** runs in Phase 2 — see [`local-iteration.md`](./local-iteration.md).

If the historical telemetry is empty, **stop and surface that to the user** — never proceed on guesses.

## Dash0 MCP spans

The Dash0 MCP exposes every E2E run as OpenTelemetry spans tagged with PR metadata.
Two layers of signal:

1. **Root span per test attempt** (one row per failed test per retry).
2. **Child spans per Playwright action** (one row per `expect`, `goto`, `click`, etc.).

Both filtered to the resolved PR via `git.pull_request_link`.

### Canonical filter set

The filter set is **fixed for E2E roots on a PR**.
Do not omit fields — `otel.parent.id is_not_set` is what isolates the top-level test spans from their action children.

```jsonc
[
  { "key": "service.name",          "operator": "is",         "value":  "ui-e2e" },
  { "key": "otel.parent.id",        "operator": "is_not_set" },
  { "key": "ci.is_ci",              "operator": "is_one_of",  "value":  "true" },
  { "key": "git.pull_request_link", "operator": "is_one_of",  "values": ["<PR_URL>"] }
]
```

Time range: last **7 days** by default, or since the PR was opened — whichever is shorter.

The full filter reference (including alternate attribute keys for older runs and how to scope by commit SHA) lives in [`../references/dash0-mcp-filters.md`](../references/dash0-mcp-filters.md).

### Querying via MCP

Prefer the dash0-dev MCP server when the user has it configured.
Fall back to dash0-prod with the same filter shape if dash0-dev is not available.
Both expose the same span schema.

```text
mcp__dash0-dev__getSpans  filters=<canonical filter set>  timeRange=<since-pr-opened>
```

If the MCP tool surface in the current session uses a different prefix (`mcp__dash0-prod__getSpans`), substitute and proceed.
Schema is identical.

### What to extract

For every root span, produce a row:

| Field | Source attribute (typical) |
|-------|----------------------------|
| `test.name` | `test.name` |
| `test.file` | `test.file` (relative path, e.g. `tests/e2e/src/specs/foo.spec.ts`) |
| `test.line` | `test.line` |
| `attempt` | `test.retry` (0 = first attempt) |
| `outcome` | `test.outcome` (`passed`, `failed`, `flaky`, `timedOut`) |
| `duration_ms` | `duration_ms` or `(end - start) / 1e6` |
| `error_class` | `exception.type` from a child span event |
| `error_message` | `exception.message` (truncate to 200 chars in tables) |
| `run_id` | `vcs.run.id` or `gha.run_id` (used for artifact download) |
| `worker_index` | `playwright.worker_index` or `test.parallelIndex` |

### Aggregation

Group by `test.name` + `test.file`.
Per group, compute:

- `total_attempts` (sum of retries across all runs).
- `failure_count` (rows where `outcome ∈ {failed, timedOut}`).
- `flake_count` (rows where `outcome == flaky` — passed-on-retry).
- `failure_rate` = `failure_count / total_attempts`.
- `p50_duration_ms`, `p95_duration_ms`, `p99_duration_ms` (over passing attempts).
- `first_seen` and `last_seen` timestamps.
- `distinct_error_classes` (set of `error_class` values).

### Entry rule — mode-dependent

**`stabilize` mode (default):** a test enters the fix queue when `failure_rate ≥ 0.10` over `total_attempts ≥ 5`, or `flake_count ≥ 2` with at least one occurrence in the last 24 hours.
Below those thresholds, note the test as `watch` rather than `fix`.

**`optimize` mode:** a test enters the queue based on **slowness, not failure**:

- Top **10** tests by `p95_duration_ms` over `total_attempts ≥ 5`, **or**
- Any test whose `p95_duration_ms ≥ 3×` the median of all passing tests on this PR.

In optimize mode, **exclude** tests with `failure_rate > 0` — fix the flake first via `stabilize`, then come back to optimize.
Mixing the two queues blurs cause and effect.

### Gate

Phase 1 is complete when the aggregated table is printed.

- `stabilize`: if the table is empty, the PR has no measurable E2E failure — stop and report `no-signal`.
- `optimize`: if every test runs in roughly the same time (no `p95` outliers, no top-10 long tail), stop and report `no-headroom`.

## Phase 2 — Local reproduction

Trace evidence comes from **local** Playwright runs with `--trace=on`, not from CI artifact downloads.
See [`local-iteration.md`](./local-iteration.md) for the full procedure.

`gh run download` is **retained as a fallback** for when a flake cannot be reproduced locally (env divergence, CI-only fixture).
In that case, download the run's `trace.zip`, unpack it with the [`/playwright-trace-analyzer`](../../../analysis/playwright-trace-analyzer/SKILL.md) extractor, and note `evidence-from-ci-artifact` in the dossier so the report records the lower-fidelity path.

## Phase 3 — Correlate spans ↔ traces

This is the first phase where evidence layers join.
For each test in the queue, build a single dossier.
The dossier shape differs by mode.

### `stabilize` dossier

```text
test.name        : <name>
test.file:line   : <file>:<line>
failure_rate     : <rate>  (failure_count / total_attempts over N days)
attempts seen    : <total_attempts>
error_classes    : [<class_1>, <class_2>, ...]
recent_run_ids   : [<id_1>, <id_2>, ...]
trace evidence   :
  - run <id>, trace <dir>:
    - failing action: <callId>  <kind>  dur=<ms>  selector=<...>
    - top hotspots:
        - <action> dur=<ms>
        - <network request> dur=<ms> status=<code>
    - console errors: [<lines>]
    - failure_message: <verbatim from trace event>
```

### `optimize` dossier

```text
test.name        : <name>
test.file:line   : <file>:<line>
p50/p95/p99 ms   : <p50> / <p95> / <p99>  (passing attempts only)
attempts seen    : <total_attempts>
recent_run_ids   : [<id_1>, <id_2>, ...]
trace evidence (typical-slow run):
  - top time-consuming actions:
      - <action> dur=<ms>  selector=<...>    (X% of test wall-clock)
      - <action> dur=<ms>  ...
  - excessive waits:
      - <action> waited <ms> while DOM was already actionable (P5 signature)
      - <action> waited <ms> on a network request that returned <ms> earlier
  - long-tail network requests:
      - <url>  dur=<ms>  status=<code>
estimated savings: <ms>  (sum of "excessive wait" durations, conservative)
```

The trace-side block delegates to [`/playwright-trace-analyzer`](../../../analysis/playwright-trace-analyzer/SKILL.md) Phases 0–3.
Do not re-implement the action timing or network ranking — invoke the script:

```bash
node <skill_dir>/scripts/trace-summary.mjs <unpacked-trace-dir>
```

Then map the failing action's `location.file:line` to the test file referenced by the span.
The two should agree — if they do not, mark the dossier `evidence-disagrees` and either gather more evidence (re-run locally to capture a fresh trace) or downgrade to `recommendation-only` rather than committing a fix.

### Gate

Phase 3 is complete when every queued test has a dossier with both layers populated.
In `stabilize` mode, the span and trace layers must agree on the failing test file; in `optimize` mode, they must agree on which actions dominate wall-clock.
Move to [`root-cause-and-fix.md`](./root-cause-and-fix.md) for Phase 4 (and, in `stabilize` only, Phase 5).
