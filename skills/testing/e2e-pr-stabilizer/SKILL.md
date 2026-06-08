---
name: e2e-pr-stabilizer
description: >
  Stabilizes or optimizes Playwright E2E tests on one PR via a local-first
  loop, then ratifies with a single CI run. Pulls Dash0 spans
  (`git.pull_request_link`) as the historical baseline, then captures every
  iteration's evidence locally with `--trace=on` (same OTel exporter, same
  trace schema). Validation is empirical, not predictive: before commit,
  every new locator must resolve against source (static grep) or the live
  app (`locator.count()`); after commit, the fixed test must pass three
  consecutive local runs before the single push. Modes: `stabilize`
  (default) heals flaky / failing tests; `optimize` is report-only and
  ranks slow-action wins by measured ms saved. Refuses `.skip`, `.fixme`,
  `waitForTimeout`, or any check-weakening edit. Use when a PR has flaky
  or failing E2E tests or when you want to find slow tests worth
  tightening. Triggers on "stabilize this PR", "fix flaky e2e", "heal
  playwright on PR", "ui-e2e is failing", "self-heal e2e", "optimize e2e",
  "/e2e-pr-stabilizer".
disable-model-invocation: true
license: MIT
argument-hint: '[stabilize|optimize] [pr-url|pr-number]'
allowed-tools: Bash(gh *) Bash(git *) Bash(node *) Bash(pnpm *) Bash(npx *) Bash(jq *) Read Edit Write Grep Glob
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: slash-command
  tags:
    - playwright
    - e2e
    - flake-detection
    - local-iteration
    - ci
    - github-actions
    - telemetry
    - dash0-mcp
    - trace-analysis
    - self-healing
    - selector-validation
    - pull-request
---

# E2E PR Stabilizer

Stabilize the Playwright E2E suite for a single pull request using **evidence, not assumptions**.
Spans, traces, and the live app are the source of truth — not the CI dashboard.
This skill never proposes a fix without a measurement to point at, and never commits a fix until three consecutive local runs prove it works.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in [`rules/*.md`](./rules) and [`templates/*.md`](./templates).
> Each phase loads only what it needs.

---

## What this skill combines

| Source | Role |
|--------|------|
| [Playwright Healer agent](https://playwright.dev/docs/test-agents) — external; one of the [Playwright Test Agents](https://playwright.dev/docs/test-agents) on the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) | Test-debugging methodology — how to fix a Playwright test correctly. |
| [`/playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md) | Per-run `trace.zip` extraction, hotspot ranking. |
| [`/ci-auto-fix`](../../delivery/ci-auto-fix/SKILL.md) | Reused only for Phase 7's single push + watch — the iteration loop no longer lives here. |
| Dash0 MCP server (`dash0-dev` or `dash0-prod`) | Historical evidence — failure recurrence, retry counts, span-level evidence across CI runs. |
| Local Playwright runner | Primary evidence source — trace.zip per run, OTel spans to Dash0 (`ci.is_ci=false`), and the live app for selector verification. |
| GitHub Actions (one call) | Final CI ratification at Phase 7. |

This skill is the orchestrator over those.

> **External dependency — the Playwright Healer agent.** The healer methodology
> this skill drives fixes through is **not** an agent in this repo; it is
> Playwright's own **healer** ([Playwright Test Agents](https://playwright.dev/docs/test-agents):
> planner / generator / healer) running on the
> [Playwright MCP server](https://github.com/microsoft/playwright-mcp). Set it up
> with `npx playwright init-agents --loop=claude` (Playwright ≥ 1.56). At runtime,
> Phase 5 **uses the healer when the Playwright MCP is connected** (`mcp__playwright__*`
> tools present) and **falls back to the inline root-cause methodology** when it
> isn't — so the skill works with or without it, but is strongest with it.
It does not duplicate their content — each phase delegates.

---

## Modes

| Mode | Default | Entry rule (what enters the fix queue) | Phase 5 (edits) | Phase 6 (local 3-pass gate) | Phase 7 (CI ratification) | Phase 8 output |
|------|---------|----------------------------------------|-----------------|-----------------------------|---------------------------|----------------|
| `stabilize` | **yes** | `failure_rate ≥ 0.10` over ≥ 5 attempts, or `flake_count ≥ 2`. | Drafted, then double-gated before commit. | Required — 3 consecutive local passes per fixed test. | One push, one CI watch. | Stabilization report with before / after numbers, local-pass log, CI verdict. |
| `optimize` | | Top-N slowest tests by total time, or actions with `dur > 5×median`. | **Skipped.** | **Skipped.** | **Skipped.** | Recommendations-only report — humans apply the wins. |

`stabilize` is the default because optimization edits (tightening timeouts, removing waits) carry flake risk that warrants human judgment.
`optimize` runs Phases 1–4 only and emits a ranked recommendations report.

## Input

`$ARGUMENTS` is parsed as `[mode] [pr-ref]` in any order:

- `optimize` (literal token) selects optimize mode; anything else is treated as `pr-ref`.
- `pr-ref` is a PR URL (`https://github.com/dash0hq/dash0/pull/13319`) or PR number (`13319`).
- If `pr-ref` is missing, auto-detect the open PR for the current branch (same path as [`/ci-auto-fix`](../../delivery/ci-auto-fix/SKILL.md) Step 0).
- If `mode` is missing, default to `stabilize`.

Resolve mode + PR before doing anything else.
See [`rules/input-resolution.md`](./rules/input-resolution.md).

---

## Workflow

Eight phases.
Do not skip a gate.
Phases 5, 6, and 7 are skipped in `optimize` mode (the `Modes` column says so explicitly).

| Phase | Name | Modes | Rule file | Gate |
|-------|------|-------|-----------|------|
| 0 | Resolve target | both | [`rules/input-resolution.md`](./rules/input-resolution.md) | Mode + PR URL + branch + head SHA + owner / repo printed. |
| 1 | Pull historical telemetry | both | [`rules/telemetry-driven-analysis.md`](./rules/telemetry-driven-analysis.md) | Dash0 spans for this PR fetched and grouped by test name; failure recurrence + retry counts measured (stabilize) **or** action `dur` distribution measured (optimize). |
| 2 | Local reproduction + trace capture | both | [`rules/local-iteration.md`](./rules/local-iteration.md) | Each queued test run locally with `--trace=on`; trace.zip + (where available) fresh Dash0 spans tagged `ci.is_ci=false` captured. |
| 3 | Correlate spans ↔ traces | both | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md) | Each queued test has a span-side signature **and** a trace-side hotspot. |
| 4 | Root-cause synthesis | both | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md) | A single, evidence-anchored hypothesis per candidate, citing the span signature and the trace hotspot. Speculative hypotheses become `recommendation-only` entries, not fixes. |
| 5 | Draft fix + selector-existence check | **stabilize only** | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md), [`rules/fix-validation.md`](./rules/fix-validation.md), [`rules/guard-rails.md`](./rules/guard-rails.md) | Diff drafted; every new locator proven to resolve against source (static grep) **or** the live app (`locator.count() ≥ 1`). A locator that fails both checks is hallucinated — discard the diff and re-enter Phase 4 with that evidence. |
| 6 | Local verification — 3 consecutive passes | **stabilize only** | [`rules/local-iteration.md`](./rules/local-iteration.md) | Fixed test runs locally ≥ 3 times with `--trace=on` and passes **3 times in a row**. A single failure or flake within the streak resets the counter. Maximum 10 attempts per test before escalating. |
| 7 | CI ratification — one push, one watch | **stabilize only** | [`rules/verification-loop.md`](./rules/verification-loop.md) | All passing fixes committed and pushed in a single push event; the resulting CI run is watched to conclusion and its telemetry compared against the Phase 1 baseline. |
| 8 | Report | both | [`templates/stabilization-report.md`](./templates/stabilization-report.md) | Stabilize: report with before / after numbers + local-pass log + CI verdict + residual risk. Optimize: recommendations-only report ranked by measured wall-clock impact. |

Inner iteration in `stabilize` mode is local and bounded — see [`rules/local-iteration.md`](./rules/local-iteration.md).
The CI step in Phase 7 runs **once**.
If CI disagrees with the local result, that is a signal to escalate, not to re-enter the loop blindly.

---

## Required reading by phase

Load on demand.
Do not preload.

| Phase | Files |
|-------|-------|
| 0 | [`rules/input-resolution.md`](./rules/input-resolution.md) |
| 1 | [`rules/telemetry-driven-analysis.md`](./rules/telemetry-driven-analysis.md), [`references/dash0-mcp-filters.md`](./references/dash0-mcp-filters.md) |
| 2 | [`rules/local-iteration.md`](./rules/local-iteration.md) |
| 3–4 | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md) |
| 5 | [`rules/root-cause-and-fix.md`](./rules/root-cause-and-fix.md), [`rules/fix-validation.md`](./rules/fix-validation.md), [`rules/guard-rails.md`](./rules/guard-rails.md) |
| 6 | [`rules/local-iteration.md`](./rules/local-iteration.md) |
| 7 | [`rules/verification-loop.md`](./rules/verification-loop.md) |
| 8 | [`templates/stabilization-report.md`](./templates/stabilization-report.md) |

For trace mechanics (zip → JSONL → action timeline), defer to [`/playwright-trace-analyzer`](../../analysis/playwright-trace-analyzer/SKILL.md).
Do **not** re-implement.

---

## Core principles

1. **Iterate locally, ratify on CI.**
   The inner loop is local because it is seconds-per-run, has the same trace artifacts, and emits the same OTel spans.
   CI runs once at the end as ground truth.
2. **Data first, hypothesis second.**
   Every fix is anchored to (a) a span with a measured failure rate, or (b) a trace action with a measured `dur`.
   "I think this is flaky" is not a finding.
3. **Two evidence layers, not one.**
   Spans tell you *which tests fail and how often across runs* (historical and local).
   Traces tell you *why one specific run failed*.
   A fix is only credible when both layers agree.
4. **Validate empirically, not predictively.**
   Confidence in a fix comes from running it, not from scoring it on paper.
   The two gates the skill enforces are both deterministic: selectors must exist (verifiable against source or live app), and the fixed test must pass three consecutive local runs (verifiable from exit codes).
5. **Selectors must exist before they are used.**
   Every new locator in a draft fix is verified against the component source (static) and, when ambiguous, the running app (live).
   The skill never commits a fix that names an element that does not exist.
6. **Three consecutive local passes or no commit.**
   A single passing run can be a coin flip on a flake.
   Three in a row makes the fix statistically credible before we spend a CI cycle on it.
7. **Never weaken the suite.**
   No `.skip`, `.fixme`, `waitForTimeout`, `continue-on-error`, `--no-verify`, or removed assertions.
   The full list lives in [`rules/guard-rails.md`](./rules/guard-rails.md).
8. **Test-side fix unless the trace proves otherwise.**
   Most flakes are selector, timing, or state-management bugs in tests.
   If the trace evidence points to product code, surface it to the user as a separate recommendation — do not silently mutate app code.
9. **One PR at a time.**
   Cross-PR refactors belong in a different skill.

---

## Anti-patterns

One-liners; the full list lives in [`rules/guard-rails.md`](./rules/guard-rails.md).

- Pushing a fix because "the diff looks right" without three consecutive local passes.
- Trusting a single local pass as proof — flakes pass once routinely.
- Drafting a fix that uses `getByTestId('foo')` when nothing in the component source emits `data-testid="foo"`.
- Patching `waitForTimeout(1500)` to mask a race instead of fixing the wait condition.
- Marking a test `.fixme()` because it is "flaky" without a measured cause.
- Treating a single failed CI run as evidence — flakes are statistical, so fetch the span history.
- Re-running CI hoping for a green without applying a code change.
- Editing product code based on speculation when the trace points at a selector or test-state issue.

---

## Quickstart

```text
/e2e-pr-stabilizer                                                       # stabilize, auto-detect PR
/e2e-pr-stabilizer 13319                                                 # stabilize PR 13319
/e2e-pr-stabilizer https://github.com/dash0hq/dash0/pull/13319           # stabilize via URL
/e2e-pr-stabilizer optimize                                              # optimize, auto-detect PR
/e2e-pr-stabilizer optimize 13319                                        # optimize PR 13319
```

Once invoked, the skill drives end-to-end:

1. Resolves the mode and the PR.
2. Queries the Dash0 MCP for E2E spans filtered to this PR (`git.pull_request_link`) — historical baseline.
3. **Reproduces locally** with `--trace=on`, capturing trace.zip and (where the local OTel reporter is wired) fresh spans.
4. Correlates and produces an evidence-anchored finding set.
5. **stabilize:** drafts each fix, verifies every new locator resolves against source or the live app, then commits locally.
6. **stabilize:** runs the fixed test locally until it passes 3 times in a row (per fix).
7. **stabilize:** pushes once; watches the CI run; compares fresh telemetry to baseline.
8. Emits the report — stabilization (before / after + local-pass log + CI verdict) or optimization (recommendations).

---

## Definition of Done

### Both modes

- [ ] Mode (`stabilize` | `optimize`) and PR target resolved and printed.
- [ ] Historical telemetry pulled from the Dash0 MCP using the documented filter set, grouped by test name.
- [ ] Each queued test reproduced locally with `--trace=on`; trace artifacts captured per run.
- [ ] Each candidate has a span-side signature and a trace-side hotspot.
- [ ] Report written using the template, with the mode stated and findings ranked by measured impact.

### `stabilize` only

- [ ] Every new locator in every applied fix was verified against the component source or via a live `locator.count() ≥ 1` probe.
- [ ] Every applied fix passed 3 consecutive local runs with `--trace=on` and no failures or flakes within the streak.
- [ ] Fixes committed locally, pushed in one push, CI run watched to conclusion.
- [ ] Fresh telemetry pulled and compared to baseline — failures eliminated, retry counts reduced.
- [ ] No `.skip`, `.fixme`, `waitForTimeout`, or `continue-on-error` introduced (guard-rails check passed).

### `optimize` only

- [ ] No commits, no pushes, no edits to test files.
- [ ] Each recommendation cites an estimated wall-clock saving (ms) based on the trace evidence.
