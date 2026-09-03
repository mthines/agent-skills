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
| `THREAD_OVERLAP` | **computed at Step 1.2b**, before the table is read — fraction of delta hunks within ±5 lines of a review thread open or resolved since the last reviewed SHA, any author | whether this push is *answering the review* |
| `traffic_band` | `impact.json.production` ([`telemetry.md`](./telemetry.md)) | whether the touched code is actually exercised |

`THREAD_OVERLAP` is the only input this phase introduced, and it is the one to check when the
`quick` override never seems to fire.
It applies the **same ±5-line proximity test** Step 2.9c uses for thread reconciliation, but it is
not the same variable and cannot be read from that step: 2.9c's predicate is a per-thread boolean
over `SCANNED_FILES` and it runs eight steps *after* the tier is bound.
The agent body owns the binding — see its `Bind DEPTH_TIER` step — and an unbound `THREAD_OVERLAP`
must be read as `0`, which disables the override rather than crashing the routing.

That failure is quiet by construction, so it is worth stating where the guards do **not** reach it:
the `shape-depth-routing` L2 suite hands every record its `THREAD_OVERLAP` value in the prompt, so
it measures whether the table orders correctly, never whether the input exists.

## The three tiers

**First match wins, top to bottom** — with two rules that run *before* the table, because
"first match wins" would otherwise let a lower row's broad condition outrank them.

**The `quick` override.** When `THREAD_OVERLAP ≥ 0.8` **and** `blast_radius.band == none`, the tier
is `quick`, whatever the table would say.
A push whose hunks sit almost entirely on top of existing review threads and which reaches nothing
is a developer answering the review; the `standard` row's `11 ≤ DELTA_LINES ≤ 100` band would
otherwise claim it and buy a full lens pass to re-read the reviewer's own asks.

**One exclusion runs before the table.** A delta whose shapes are exclusively `docs-only`,
`test-only`, or generated, **and** whose `blast_radius.band == none`, does not consider the size
triggers at all — neither `DELTA_LINES > 100` / `NEW_FILES > 0` in the `deep` row nor the
`11 ≤ DELTA_LINES ≤ 100` band in the `standard` row.
Size there is measuring text nobody executes, and without the exclusion a 400-line generated-client
refresh routes `deep` on line count while reaching nothing — the exact wrong-proxy failure this
phase exists to fix, arriving through the phase's own table.
Such a delta still routes on **every other** row: a test file that imports a changed export still
has a blast radius, and a docs edit to a governing document is still `PROPAGATION`. It is excused
from size, not from review.

| Tier | Chosen when | Runs |
| --- | --- | --- |
| **deep** | first run · `--full` · `--effort high` · a refresh counter fired · `HIGH_STAKES_FILES` non-empty · `PROPAGATION` · `blast_radius.band ∈ {medium, high}` · any `semver_delta == major` · any changed symbol with `traffic_band: high` **and** `change ∈ {signature, removed}` · `DELTA_LINES > 100` · `NEW_FILES > 0` | every finder over the **whole PR**; consumer-impact over **every** changed export with ≥ 1 consumer; dependency finder over every delta; verifier Tier 2 where available; optimality lens (report-only) |
| **standard** | `DELTA_RISKY_SHAPES` non-empty · `blast_radius.band == low` · any `semver_delta` **with ≥ 1 usage site** · an `overlaps[].kind == same-symbol` · `11 ≤ DELTA_LINES ≤ 100` | correctness + quality on the delta **with enclosing-function context**; consumer-impact over changed exports in the delta; dependency finder over this push's deltas; intent over the PR; standards on delta files; verifier Tier 1–2 |
| **quick** | otherwise (the `quick` override above reaches here directly) | correctness on delta hunks with enclosing-function context; thread reconciliation; gates; nothing else |

Re-running every lens over a review-answering push produces no new information and costs a full review's budget. It gets one finder.

The `semver_delta` row is qualified by usage because an unused bump has nothing to check: a
lockfile-only patch of a package this repo imports nowhere is a dependency delta with an empty
intersection, and routing it to `standard` makes every automated bump PR pay for a finder pass that
can only conclude `breaking-but-unused`. A bump with usage sites is the opposite case and stays in.

The inverse case is the one that justifies the whole phase:

```text
DELTA_LINES = 12 · blast_radius.band = high (retryRequest: 14 consumer files, 3 packages, signature)
→ deep

DELTA_LINES = 340 · shapes = [docs-only] · band = none
→ quick        (the size exclusion above applies, and 340 is outside standard's 11–100 band)
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

A push during the review is handled by **not looking for it**, and that is a deliberate choice
rather than an omission.

`HEAD_SHA` is read once, at Step 1.1 command A, and every downstream consumer — the review's
`commit_id`, the state record, the delta triage — uses that one value.
The agent body states the rule and the reason: a second read moments later opens a torn-state
window in which the diff and the SHA describe different commits, so **one read, one head**.
If the head moved, this run stays internally consistent and the next run reviews the newer commit.

So the run does **not** re-read `headRefOid` before posting, does not label itself superseded, and
needs no headline suffix:

```text
❌ WRONG — re-read headRefOid before Step 4 and add a `superseded by <sha7>` suffix
   Two failures at once. The second read is what the one-read rule forbids, and the suffix has no
   renderer slot: `render-report.mjs` fails closed on an unknown payload key, so a run that adds
   one exits 1 and posts no report at all — losing the whole review to gain a label.

✅ RIGHT — post against the reviewed SHA; the next run picks up the newer commit
```

What still holds from the moved-head case is the part that needs no second read:

- **Post the inline findings.** They are anchored to the reviewed `commit_id` and remain valid comments on the code that was reviewed, whatever landed after.
- **Write the state record** at the reviewed SHA, so the next run's delta starts there and the push that arrived mid-review is reviewed as delta rather than skipped.

A push burst therefore costs one incremental pass per run, with no run abandoned and no work thrown
away — the property the old second-read design was reaching for, reached without the torn state.

## Zero-delta

A zero authored delta short-circuits to the gates and the report, unchanged.

It **downgrades cost; it never predicts a clean pass.** A rebase with no authored change still gets its gates evaluated and its threads reconciled, and the report says the delta was empty rather than reporting a pass it did not test for.

## Capability cap

When `DEPTH_CAPABILITY = diff-only` ([`workspace.md`](./workspace.md)), the tier is capped at `standard` however the table above votes.

A `deep` tier whose deep lenses — consumer trace, type check, covering test — cannot run is a label on a review that did not happen.
Cap it, and say in the report that the cap was applied and why.
