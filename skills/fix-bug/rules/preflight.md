---
title: Pre-Flight Sweep — Cheap Localisation Before Heavy Analysis
impact: HIGH
tags:
  - preflight
  - localisation
  - regression
  - git-history
  - dependency-diff
---

# Pre-Flight Sweep

Phase 1 step 1b. Run **after** evidence resolution (1a), **before** Source Mapping (Phase 2).
Cheap, deterministic probes that often name the bug in seconds without holistic analysis.

Source: [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
— "agents should always read context before acting."

## Contents

- [Probe checklist](#probe-checklist)
- [Output format](#output-format)
- [Short-circuit criteria](#short-circuit-criteria)
- [Regression window detection](#regression-window-detection)

---

## Probe checklist

Run all six in parallel where possible. Append findings to the Evidence Record.

| # | Probe | Command | Signal |
|---|-------|---------|--------|
| 1 | Recent commits to affected files | `git log -20 --oneline -- <file1> <file2> ...` (one per file in the affected-code table) | A single recent commit touching the failing line is highly suspicious |
| 2 | Last-known-green deploy SHA | Pull from telemetry: Dash0 span attribute `deployment.version` or `service.version` from a known-passing time. Else: latest `git tag` matching `v*` / `release-*` | Establishes the regression window |
| 3 | Diff vs last-green | `git diff <last_green_sha>..HEAD -- <affected files>` | Localises the change set |
| 4 | Lockfile diff | `git diff <last_green_sha>..HEAD -- package-lock.json pnpm-lock.yaml yarn.lock Cargo.lock Pipfile.lock go.sum` | Dependency upgrades are a top regression source |
| 5 | Env / config diff | `git diff <last_green_sha>..HEAD -- .env.example config/ *.yaml *.toml` | Config drift between envs |
| 6 | CI status on affected files | Recent CI runs touching the affected paths — pass/fail history | A recently flipped check often pins the cause |

Skip any probe whose inputs are unavailable (e.g., no `last_green_sha` if telemetry didn't supply
one and no recent tag exists). Note the skip in the output.

---

## Output format

Append a `Pre-flight findings` section to the Evidence Record:

```markdown
### Pre-flight findings

| Probe | Result | Suspicion |
|-------|--------|-----------|
| Recent commits | f3a2b1c (3 days ago) — "refactor null check in UserService" | High — touches the failing line |
| Last-known-green | v2.4.1 (5 days ago) | — |
| Diff vs last-green | 47 lines across 3 files | — |
| Lockfile diff | None | — |
| Env diff | None | — |
| CI flips | userservice.test.ts started failing 3 days ago | High — same window as commit f3a2b1c |
```

If a probe produces no signal, write `None` rather than omitting the row — absence of signal is
itself information for Phase 3.

---

## Short-circuit criteria

If **all three** of these hold, skip Phase 3 (holistic analysis) and route directly to Phase 5
with a high-confidence proposal:

1. A single commit in probe #1 touches the failing line.
2. The same commit's date matches the CI flip window in probe #6.
3. The commit's diff is ≤ 50 lines.

The proposed fix is "revert or amend commit `<sha>`". Phase 5 still runs `confidence(bug-analysis)`
— do not bypass the gate, just skip the heavy analysis.

If short-circuit fires, log the decision in the bug-notes ledger as a `confirmed` hypothesis
(`hypotheses[0].state = confirmed; evidence-for: pre-flight probes 1+6`). See
[`bug-notes-ledger.md`](./bug-notes-ledger.md).

---

## Regression window detection

If probe #2 produced a `last_green_sha` AND no short-circuit fired, mark the regression window in
the Evidence Record:

```markdown
### Regression window
- last_green_sha: <sha>
- failing_sha: HEAD
- candidate commits: <count> (from probe #3)
```

This window is the input to the **bisect fast-path** in Phase 2.5 (see
[`reproduction.md`](./reproduction.md#bisect-fast-path)). Bisect cannot run yet — it requires the
deterministic repro produced in Phase 2.5.

If no `last_green_sha` is recoverable (no deploy tags, no telemetry version), skip regression
window detection and let Phase 3 proceed normally. Bisect is a fast-path, not a requirement.
