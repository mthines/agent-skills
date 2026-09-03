---
title: Depth routing — three tiers from five inputs
impact: HIGH
tags:
  - pr-reviewer
  - routing
  - cost
---

# Depth routing

The reviewer has to be cheap enough to run on every commit and thorough enough to be worth running at all.
Those pull in opposite directions, and the only honest resolution is to spend the effort where the change is actually risky.

Size is the wrong proxy for risk, and it is the proxy the pipeline used.
A twelve-line diff that changes a function signature with fourteen callers is a bigger change than a four-hundred-line diff that renames a variable.
This phase routes on **what the change reaches**, not how much of it there is.

## Contents

- [Five inputs](#five-inputs)
- [The three tiers](#the-three-tiers)
- [Announce the decision with its inputs](#announce-the-decision-with-its-inputs)
- [The deep-lens refresh](#the-deep-lens-refresh)
- [`--effort`](#--effort)
- [Superseded head](#superseded-head)
- [Zero-delta](#zero-delta)
- [Capability cap](#capability-cap)

---

## Five inputs

| Input | Source | What it captures |
| --- | --- | --- |
| `DELTA_LINES`, `NEW_FILES` | Step 1.2b delta triage, divergence-safe | how much changed since the last reviewed SHA |
| `DELTA_SHAPES`, `HIGH_STAKES_FILES`, `PROPAGATION` | `classify-shape.mjs` | *what kind* of change it is — auth, payments, migration, concurrency, api-contract, infra, secrets, propagation |
| `blast_radius.band`, `dependencies[].semver_delta` | `impact.json` ([`impact-graph.md`](./impact-graph.md)) | what the change reaches |
| `THREAD_OVERLAP` | fraction of delta hunks within ±5 lines of an open or recently resolved reviewer thread (the Step 2.9c predicate, reused) | whether this push is *answering the review* |
| `traffic_band` | `impact.json.production` ([`telemetry.md`](./telemetry.md)) | whether the touched code is actually exercised |

Nothing here is new machinery except the middle row. `THREAD_OVERLAP` reuses a predicate the agent already computes for thread reconciliation.

## The three tiers

**First match wins, top to bottom.**

| Tier | Chosen when | Runs |
| --- | --- | --- |
| **deep** | first run · `--full` · `--effort high` · a refresh counter fired · `HIGH_STAKES_FILES` non-empty · `PROPAGATION` · `blast_radius.band ∈ {medium, high}` · any `semver_delta == major` · any changed symbol with `traffic_band: high` **and** `change ∈ {signature, removed}` · `DELTA_LINES > 100` · `NEW_FILES > 0` | every finder over the **whole PR**; consumer-impact over **every** changed export with ≥ 1 consumer; dependency finder over every delta; verifier Tier 2 where available; optimality lens (report-only) |
| **standard** | `DELTA_RISKY_SHAPES` non-empty · `blast_radius.band == low` · any `semver_delta` · an `overlaps[].kind == same-symbol` · `11 ≤ DELTA_LINES ≤ 100` | correctness + quality on the delta **with enclosing-function context**; consumer-impact over changed exports in the delta; dependency finder over this push's deltas; intent over the PR; standards on delta files; verifier Tier 1–2 |
| **quick** | otherwise — and **always** when `THREAD_OVERLAP ≥ 0.8` and `blast_radius.band == none` | correctness on delta hunks with enclosing-function context; thread reconciliation; gates; nothing else |

The `quick` override is the case worth naming: a push whose hunks sit almost entirely on top of existing review threads and which reaches nothing is a developer answering the review.
Re-running every lens over it produces no new information and costs a full review's budget. It gets one finder.

The inverse case is the one that justifies the whole phase:

```text
DELTA_LINES = 12 · blast_radius.band = high (retryRequest: 14 consumer files, 3 packages, signature)
→ deep

DELTA_LINES = 340 · shapes = [docs-only] · band = none
→ quick
```

## Announce the decision with its inputs

Every tier decision is stated with the inputs that produced it, in the report and in the terminal.

```text
Tier: deep — blast_radius=high (retryRequest: 14 consumer files across 3 packages,
signature change), semver_delta=major (stripe 14.2.0 → 16.0.1)
```

An unexplained tier is unauditable: a maintainer who thinks the routing is wrong needs to see *which* input was wrong, and `why[]` from the impact graph is exactly that list.

## The deep-lens refresh

An incremental run is promoted back to `deep` when any of these holds:

| Counter | Threshold | Read from |
| --- | --- | --- |
| cumulative churn since the last `deep` pass | `FULL_REFRESH_DELTA` = 150 lines | PR-state record |
| incremental runs since the last `deep` pass | `FULL_REFRESH_RUNS` = 3 | PR-state record |
| no prior `deep` pass recorded | always | PR-state record — **including every run on the recovery rung**, which recovers a baseline but no history |

Without this, a PR that grows by ninety lines a day never gets another holistic pass, because no single push is ever big enough to trigger one.

## `--effort`

```bash
/pr-review <PR> --effort high     # or `effort: high` in .github/review.yaml
```

`--effort high` forces `deep`, enables Tier-2 and Tier-3 receipts where the toolchain allows, and raises the diversify-then-vote finder count from 3 to 5 where `Task` is available.
`--full` remains an alias for forcing `deep` only.

This is the explicit-cost lever: more findings per run at the same precision, paid for on purpose rather than triggered by a size heuristic.

## Superseded head

**Immediately before Step 4 posts**, re-read `headRefOid`.

If it moved since the review started:

- **Post the inline findings anyway.** They are anchored to the reviewed `commit_id` and remain valid comments on the code that was reviewed.
- **Write the state record**, so the next run's delta starts from this run's SHA.
- **Render the headline with a `superseded by <sha7>` suffix.**
- **Do not** count this run toward the deep-lens refresh counters.

The alternative — abandoning the run — means a push burst produces no review at all, and each cancelled run's work is thrown away. This way a burst costs one incremental pass.

## Zero-delta

A zero authored delta short-circuits to the gates and the report, unchanged.

It **downgrades cost; it never predicts a clean pass.** A rebase with no authored change still gets its gates evaluated and its threads reconciled, and the report says the delta was empty rather than reporting a pass it did not test for.

## Capability cap

When `DEPTH_CAPABILITY = diff-only` ([`workspace.md`](./workspace.md)), the tier is capped at `standard` however the table above votes.

A `deep` tier whose deep lenses — consumer trace, type check, covering test — cannot run is a label on a review that did not happen.
Cap it, and say in the report that the cap was applied and why.
