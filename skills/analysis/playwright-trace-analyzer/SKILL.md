---
name: playwright-trace-analyzer
description: >
  Analyzes Playwright E2E `trace.zip` archives (and bare trace JSONL when
  unpacked). Extracts the action timeline, network waterfall, console
  errors, and DOM-snapshot anchors, then identifies the highest-impact
  problems (flaky waits, slow selectors, network bottlenecks, hung actions,
  unhandled console errors, navigation churn) and proposes concrete test
  or app fixes ranked by measured impact. Auto-detects whether the input
  is a `trace.zip`, a directory of unpacked trace files, or a single
  `trace.trace` / `trace.network` JSONL stream. Iterates via the
  `/confidence` skill — if root-cause certainty is below 90%, it digs
  deeper before recommending a fix. Use when handed a Playwright trace,
  asked "why is this test flaky?", "why did the test time out?", or asked
  to optimise an E2E suite with evidence. Triggers on "analyze trace",
  "playwright trace", "e2e trace", "test flake", "why did playwright
  fail", "playwright timing", "/playwright-trace-analyzer".
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - testing
    - playwright
    - e2e
    - trace
    - flake-detection
    - performance
    - network
    - action-timing
    - selector-strategy
    - measurement
    - evidence-based
---

# Playwright Trace Analyzer

Turn a Playwright `trace.zip` into a ranked, evidence-backed report of
flakes, slow steps, and root causes.

> **Index file.** Detailed extraction rules, analysis playbooks, and
> report templates live under `rules/`, `references/`, and `templates/`.
> Load only what the current phase needs — the body of `SKILL.md` is a
> thin orchestrator.

---

## Inputs

The user passes one or more of:

| Input                                | Detection signal                                                       |
| ------------------------------------ | ---------------------------------------------------------------------- |
| GitHub Actions run URL               | Matches `https://github.com/<owner>/<repo>/actions/runs/<id>` — fetch artifacts via `gh run download` |
| `trace.zip` archive                  | Magic bytes `50 4b 03 04`; entries include `trace.trace`, `trace.network`, `*.png`, `resources/`     |
| Unpacked trace directory             | Contains `trace.trace` + `trace.network` (NDJSON) and a `resources/` subdir                          |
| Single `trace.trace` JSONL stream    | NDJSON; each line has `type`, `callId`, `startTime`, `params` (e.g. `before`, `action`, `after`)     |
| Single `trace.network` JSONL stream  | NDJSON; entries with `type: "resource-snapshot"` or `requestEvent` / `responseEvent`                  |
| `report.json` (Playwright reporter)  | Top-level `config`, `suites`, `stats`; complementary, never authoritative for timing                  |

If the user passes a `report.json` plus a `trace.zip`, treat the report as
a high-level test status map and the trace as the source of truth for
timing and network data.

If a `test-results/` directory is passed, scan for the most recent
`trace.zip` per failed test and process them in order of failure recency.

See [`rules/input-detection.md`](./rules/input-detection.md) for the
precise detection logic and unpack recipe.

---

## Workflow

Six phases. Do not skip a gate.

| Phase | Name                | Rule file                                                                | Gate                                                                     |
| ----- | ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0     | Intake              | [`rules/input-detection.md`](./rules/input-detection.md)                 | Format detected, archive unpacked, `trace.trace` + `trace.network` parseable |
| 1     | Measurement frame   | [`rules/measurement-methodology.md`](./rules/measurement-methodology.md) | Failure mode named (timeout, assertion, error, slow-but-passing) and primary metric chosen (action ms, total wall-clock, request count) |
| 2     | Hotspot extraction  | [`rules/action-timing.md`](./rules/action-timing.md), [`rules/network-analysis.md`](./rules/network-analysis.md), [`rules/console-and-errors.md`](./rules/console-and-errors.md) | Top-N slow actions, top-N slow requests, error/console list — all with concrete numbers |
| 3     | Root-cause          | [`rules/flake-diagnosis.md`](./rules/flake-diagnosis.md)                 | Each hotspot mapped to a code-level cause (selector, locator, network call, app event) with file path or line where possible |
| 4     | Confidence gate     | [`rules/confidence-loop.md`](./rules/confidence-loop.md)                 | `/confidence analysis` ≥ 90% — else iterate (max 2 deep-dives)        |
| 5     | Fix plan            | [`templates/analysis-report.md`](./templates/analysis-report.md)         | Report written with ranked fixes, expected impact, and verification plan |

---

## Required reading by phase

Load on demand — do not preload.

| Phase | Files                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | [`rules/input-detection.md`](./rules/input-detection.md) — also points to [`scripts/trace-extract.mjs`](./scripts/trace-extract.mjs)                                 |
| 1     | [`rules/measurement-methodology.md`](./rules/measurement-methodology.md)                                                                                             |
| 2     | [`rules/action-timing.md`](./rules/action-timing.md), [`rules/network-analysis.md`](./rules/network-analysis.md), [`rules/console-and-errors.md`](./rules/console-and-errors.md) — backed by [`scripts/trace-summary.mjs`](./scripts/trace-summary.mjs) |
| 3     | [`rules/flake-diagnosis.md`](./rules/flake-diagnosis.md), [`references/flake-patterns.md`](./references/flake-patterns.md), [`references/performance-patterns.md`](./references/performance-patterns.md) |
| 4     | [`rules/confidence-loop.md`](./rules/confidence-loop.md)                                                                                                             |
| 5     | [`templates/analysis-report.md`](./templates/analysis-report.md)                                                                                                     |

Pass-vs-fail comparison (when given two traces of the same test):
[`scripts/trace-diff.mjs`](./scripts/trace-diff.mjs).

---

## Confidence-gated iteration

After the first pass at root-cause analysis, invoke the confidence skill
in `analysis` mode:

```text
Skill(skill="confidence", args="analysis")
```

Apply this gate:

| Score        | Action                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| **≥ 90%**    | Proceed to Phase 5 (fix plan).                                                                      |
| **70–89%**   | Run one deeper pass: re-read the trace, expand the action's `before`/`after` snapshots, correlate with network. |
| **< 70%**    | Surface the gap to the user with a question — do **not** propose changes on speculation.            |

After **two** deep-dive iterations without reaching 90%, stop and present
findings as a hypothesis with the evidence required to confirm it. See
[`rules/confidence-loop.md`](./rules/confidence-loop.md).

---

## Core principles

1. **Measure before recommending.** Every fix must be tied to a number
   from the trace. "This selector is slow" is not a finding; "`page.click('text=Save')`
   waited 4,820ms across 3 attempts before the button became actionable"
   is.
2. **Distinguish symptom from cause.** A timeout is the symptom; the
   reason the wait never resolved is the cause. The trace records the
   `before` and `after` DOM snapshots and every poll attempt — read them.
3. **Rank by impact, not by ease.** A 50ms selector fix that runs once
   matters less than a 200ms wait that runs in `beforeEach` of 40 tests.
4. **Auto-detect, do not interrogate.** Read the file shape, infer the
   format, state what you found. Ask the user only if detection genuinely
   fails.
5. **Confidence-gated honesty.** If `/confidence` returns < 90%, dig
   deeper or admit uncertainty. Do not paper over a weak diagnosis with a
   confident-sounding fix.
6. **One trace at a time, but diff when given two.** A passing run vs. a
   failing run of the same test is the strongest signal available.

---

## Anti-patterns (one-liners — full list in
[`references/flake-patterns.md`](./references/flake-patterns.md))

- Recommending `page.waitForTimeout(N)` without measuring the underlying
  race condition.
- Calling a test "flaky" without naming the race — every flake has a
  cause; "non-deterministic" is not a diagnosis.
- Reporting raw action counts without converting to wall-clock time
  share.
- Skipping the network log when an action timed out — most action
  timeouts are blocked on a request that never resolved.
- Swapping `text=` for `getByRole(...)` without checking whether the
  failure was selector resolution or actionability (visibility,
  pointer-events, animation).
- Fixing one slow action and ignoring the long tail of cumulative `auto-wait`
  delays (death-by-a-thousand-cuts is the common case in real suites).

---

## Trace-analysis quickstart

### Input is a GitHub Actions run URL

```bash
node <skill_dir>/scripts/fetch-gh-run.mjs https://github.com/<owner>/<repo>/actions/runs/<id> [--out <dir>]
```

The script uses the `gh` CLI (`gh run download`) to fetch every artifact
whose name matches Playwright conventions (`playwright-report*`,
`playwright-traces*`, `test-results*`, `*-traces`, `*-trace`), unpacks
nested ZIPs, and writes a manifest of all `trace.zip` files discovered,
grouped by failed test where possible. Then continue with the unpacked
flow below.

### Input is a `trace.zip`

1. **Unpack and index.**
   ```bash
   node <skill_dir>/scripts/trace-extract.mjs <path/to/trace.zip> [--out <dir>]
   ```
   Writes a normalised `trace.trace.jsonl`, `trace.network.jsonl`, and a
   manifest of resources/snapshots into `<dir>` (defaults to a sibling
   `<name>.unpacked/`).

2. **Run the summary.**
   ```bash
   node <skill_dir>/scripts/trace-summary.mjs <dir>
   ```
   Prints: total wall-clock, top-N slow actions, top-N slow requests,
   console errors, page errors, and the failing-action stack trace if
   present.

3. **(Optional) Diff a passing trace against a failing trace.**
   ```bash
   node <skill_dir>/scripts/trace-diff.mjs <pass-dir> <fail-dir>
   ```
   Surfaces actions that diverge in duration, requests present in one but
   not the other, and the first action where the two timelines fork.

4. **Map suspects to source.** Use
   [`rules/flake-diagnosis.md`](./rules/flake-diagnosis.md) Phases 3–4 to
   go from action callId → test file/line (Playwright trace events embed
   `location: { file, line, column }`).

The full extraction methodology (capture protocol, how to interpret the
network log, common flake shapes) is in
[`rules/flake-diagnosis.md`](./rules/flake-diagnosis.md). Don't preload
it — only when an input is detected.

## Definition of Done

- [ ] Input format detected and stated (zip / dir / single JSONL).
- [ ] Failure mode named — timeout, assertion, error, or slow-passing
      (Phase 1).
- [ ] Top-N slow actions listed with measured `dur` (ms).
- [ ] Top-N slow requests listed with `responseEnd - requestStart` (ms)
      and status.
- [ ] Console / page errors captured verbatim.
- [ ] Each hotspot mapped to a test file + line (from `location` in the
      trace event), or to an app file when the cause is in product code.
- [ ] `/confidence analysis` reached ≥ 90% (or two deep-dives
      recorded with the remaining uncertainty surfaced to the user).
- [ ] Fix plan written using
      [`templates/analysis-report.md`](./templates/analysis-report.md),
      with ranked fixes, expected ms saved, and a re-run verification
      step.
- [ ] User has the next concrete action (apply fix N, re-run with
      `--trace=on`, compare).
