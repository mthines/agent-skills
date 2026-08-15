---
title: Phase 7 — Single CI ratification (push once, watch once)
impact: HIGH
tags:
  - ci-ratification
  - github-actions
  - re-verification
  - telemetry
---

# Phase 7 — Single CI ratification

A fix that passed the Phase 6 local 3-consecutive-pass gate has earned a single CI cycle to ratify it.
This phase is **not an iteration loop** — it is one push, one watch, one comparison against the Phase 1 baseline.

If CI disagrees with the local result, that is a signal to escalate to the user, not to re-enter the loop blindly.
The local environment is faster but not identical to CI; persistent CI-only failure means the bug is environment-coupled and deserves human judgment.

---

## Pre-flight

Before pushing, confirm the state is shippable:

1. **Working tree is clean except for the committed fixes.** `git status` should show no untracked files in `tests/e2e/` (delete any leftover `.tmp/selector-probe.spec.ts` from Phase 5 Step 2).
2. **Every fix passed Phase 6.** No `requires-human-judgment` entries should be on the push path — those are report-only.
3. **The branch is up-to-date with its base.** Rebase if `main` (or the PR's base ref) has moved during the local loop:
   ```bash
   git fetch origin
   git rebase "origin/$(gh pr view --json baseRefName -q .baseRefName)"
   ```
   If the rebase introduces conflicts, do not auto-resolve — surface to the user.

## Step 1 — One push

```bash
git push origin "<branch>"
```

If the PR is from a fork and the user lacks write access (see [`input-resolution.md`](./input-resolution.md)), skip the push and emit the report with `fix-uncommitted` status — the user can apply the patch manually.

This is the **only** push the skill makes.
If a re-push becomes necessary (rebase, etc.), document it explicitly in the report.

## Step 2 — Find and watch the new run

Allow GitHub Actions a few seconds to register the push, then list runs.

```bash
# 1. Find the new run triggered by this push.
gh run list --branch "<branch>" --limit 5 \
  --json databaseId,headSha,status,conclusion,createdAt,workflowName

# 2. Pick the most recent run whose headSha matches the new commit SHA.
NEW_RUN_ID=$(gh run list --branch "<branch>" --limit 5 \
  --json databaseId,headSha,status \
  --jq ".[] | select(.headSha == \"$(git rev-parse HEAD)\") | .databaseId" \
  | head -1)

# 3. Watch it to completion.
gh run watch "$NEW_RUN_ID" --exit-status
```

`--exit-status` makes `gh` exit non-zero on failure.
Do **not** interpret that as "re-enter Phase 5" automatically — see Step 5.

## Step 3 — Pull fresh telemetry

Once the run concludes (pass or fail), wait briefly for spans to land in Dash0 — E2E spans typically appear within 60–120 s of run completion — then re-run the Phase 1 query with the **same canonical filter set**, but restrict to this commit:

```jsonc
[
  { "key": "service.name",          "operator": "is",         "value":  "<service-name>" },
  { "key": "otel.parent.id",        "operator": "is_not_set" },
  { "key": "ci.is_ci",              "operator": "is_one_of",  "value":  "true" },
  { "key": "git.pull_request_link", "operator": "is_one_of",  "values": ["<PR_URL>"] },
  { "key": "vcs.ref.head.revision", "operator": "is_one_of",  "values": ["<head_sha after push>"] }
]
```

`<service-name>` is the same value resolved in Phase 1 ([`telemetry-driven-analysis.md`](./telemetry-driven-analysis.md)) — the `service.name` from the target repo's OTel exporter.

The `vcs.ref.head.revision` filter is essential — without it, the comparison includes the failing pre-fix attempts.

Aggregate by `test.name` using the same algorithm as Phase 1.

## Step 4 — Compare against baseline

For each test in the Phase 1 fix queue, compute the delta:

| Field | Baseline (Phase 1) | After (this run) | Verdict |
|-------|-------------------|------------------|---------|
| `failure_rate` | e.g. 0.33 | e.g. 0.00 | **fixed** if 0; **improved** if dropped ≥ 50 % but > 0; **unchanged** if within ±5 pp; **regressed** if higher. |
| `total_attempts` | | | Should typically drop — fewer retries means less flake. |
| `error_classes` | {A, B} | {} or {C} | A novel error class implies the fix moved the bug, not killed it. |

Treat the per-test verdict as the gate's decision input — not the overall CI conclusion, which can be red for unrelated reasons.

## Step 5 — Decide

Phase 7 is a **single** ratification, but the verdict it produces decides what the report says.

| Combined verdict | Action |
|------------------|--------|
| All targeted tests `fixed` and Phase 6 streak held | Move to Phase 8 — emit report as **success**. |
| All targeted tests `fixed` but CI red for non-E2E reasons (build, lint, unrelated jobs) | Move to Phase 8 — emit report as **success-with-unrelated-ci-failure** and surface the unrelated failure to the user. Do not auto-fix unrelated jobs (that is `/ci-auto-fix`'s job). |
| One or more targeted tests still `failed` / `improved` / `regressed` on CI despite Phase 6 passing locally | Escalate. Emit the report as **ci-local-divergence** with both local and CI evidence. Do **not** loop back to Phase 5 automatically — environment-coupled flakes need human judgment, not another guess. |
| Novel error class appeared | Treat as a regression caused by the previous fix. Suggest reverting the offending commit; surface to the user. |
| CI never finished (workflow not triggered, timed out) | Print `gh run list` output and stop. Emit the report as **ci-incomplete**. |

## Step 6 — Iteration accounting

Phase 7 itself does not iterate, but the report needs the full picture.
Print the local-iteration table from Phase 6 plus the CI-iteration row, side by side:

```text
test                            local streak  local attempts  ci verdict
organizations.spec.ts:47        3/3           5               fixed
projects.spec.ts:120            3/3           4               ci-local-divergence
```

The report template ([`stabilization-report.md`](../templates/stabilization-report.md)) consumes this verbatim.

## What this phase does **not** do

- **Does not iterate.** One push, one watch.
- **Does not re-pull historical Dash0 spans.** Only post-push spans matter here.
- **Does not weaken anything to make CI pass.** All guard-rails from [`guard-rails.md`](./guard-rails.md) still apply.
- **Does not auto-fix unrelated CI failures.** Surface them to the user and let `/ci-auto-fix` (or a human) handle them.

## When the local gate passed but CI does not

This is the most important non-success path.
A fix that passes 3 / 3 locally but fails on CI implies one of:

| Hypothesis | Evidence | Response |
|-----------|----------|----------|
| Environment divergence (CI parallelism, headless mode, network egress, browser version) | Trace from CI shows a different action timing than local | Pull the CI `trace.zip` for that test (yes, `gh run download` here is fine — Phase 2's fallback recipe). Compare to local trace. Surface the divergence to the user. |
| Shared-state pollution from another test in the suite | CI failure is in a different action than the local run, and other tests pass locally | The fix worked in isolation but broke under concurrency. Re-enter Phase 4 (not Phase 5) with the CI trace; the dossier needs a P4-shaped (state contamination) re-analysis. |
| Fixture or seed difference | CI uses a different seed dataset than local | Investigate `playwright.config.ts` and CI env vars. Often surfaces a real env-config issue worth filing. |

The skill never *auto-retries* the push after a CI divergence.
That is the explicit user-decision moment.

## Failure mode handling

| Symptom | Cause | Response |
|---------|-------|----------|
| New run never appears | Push blocked or workflow not triggered | Print `gh run list` output and stop. |
| `gh run watch` errors | Network or auth | Retry once; on second failure stop and report. |
| Telemetry pull returns 0 spans for the new run | Span landing latency or attribute drift | Wait 60 s, retry once. If still empty, mark the iteration `evidence-stale` and report. |
| Same test failed identically on CI as Phase 1 | Fix did not generalise to CI environment | Treat as `ci-local-divergence` — escalate, do not loop. |
| Dash0 MCP not configured (no `mcp__dash0-*` tools) | The session has no telemetry source | Per [`telemetry-driven-analysis.md`](./telemetry-driven-analysis.md): `stabilize` skipped Phase 1 and ran local-only in degraded mode — skip Steps 3–4 here, ratify on the CI run conclusion alone, and mark the report `degraded: no-telemetry`. `optimize` should have stopped at Phase 1; if you reach this phase in optimize mode without telemetry, something went wrong — stop. |
