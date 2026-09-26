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
- [Thoroughness budget](#thoroughness-budget)
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
`quick` override never seems to fire. Two things silently zero it, and the agent body's binding step
states both: reading a thread's `line` without falling back to `original_line` (GitHub nulls `line`
on an **outdated** thread, and a review-answering push is what outdates threads), and not binding it
at all.
It applies the **same ±5-line proximity test** Step 2.9c uses for thread reconciliation, but it is
not the same variable and cannot be read from that step: 2.9c's predicate is a per-thread boolean
over `SCANNED_FILES` and it runs eight steps *after* the tier is bound.
The agent body owns the binding — see its `Bind DEPTH_TIER` step — and an unbound `THREAD_OVERLAP`
must be read as `0`, which disables the override rather than crashing the routing.

That failure is quiet by construction, so it is worth stating where the guards do **not** reach it:
this rule file's rationale stays the single source of truth for WHY the routing works this way, but
the EXECUTABLE home of the table is
[`route-depth.mjs`](../scripts/route-depth.mjs)'s `routeDepth(i)` — a pure function taking every
input already bound (`threadOverlap` included) as a plain value. Its `--self-test` runs the 22
hand-converted records from `depth-routing.md`'s retired `shape-depth-routing` L2 suite
(`scripts/eval/fixtures/route-depth/cases.json`) on every L1 pass, and an L1 guard asserts this
file's D-IDs and refresh thresholds equal the script's constants (R4/D11). None of that reaches the
BINDING failure described above — a script executes correctly on whatever `threadOverlap` value it
is handed, so an unbound `THREAD_OVERLAP` silently read as `0` is a caller defect the routing table
itself has no way to see, executable or not.

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
triggers at all — neither of the two size triggers in the `deep` checklist below
(**`D12`** `DELTA_LINES > 100` and **`D13`** `NEW_FILES > 0`) nor the
`11 ≤ DELTA_LINES ≤ 100` band in the `standard` row.
Size there is measuring text nobody executes, and without the exclusion a 400-line generated-client
refresh routes `deep` on line count while reaching nothing — the exact wrong-proxy failure this
phase exists to fix, arriving through the phase's own table.
Such a delta still routes on **every other** row: a test file that imports a changed export still
has a blast radius, and a docs edit to a governing document is still `PROPAGATION`. It is excused
from size, not from review.

**The `deep` triggers are a checklist, not a sentence.** They are enumerated here rather than
packed into the table cell below, because that row is both the first one read and by far the
longest: a cell holding thirteen `·`-separated conditions gets scanned until something matches
and then abandoned, so the triggers that sat at the far end of it — `NEW_FILES > 0`, and the
*absence* of a prior `deep` pass, which was nested one level down inside the refresh clause —
were exactly the two the routing missed.
**ANY** one of these is `deep`. Check every one before moving to the `standard` row.

| # | Trigger |
| --- | --- |
| **D1** | first run on this PR |
| **D2** | `--full` |
| **D3** | `--effort high` |
| **D4** | `CUM_DELTA_LINES > FULL_REFRESH_DELTA` 150 |
| **D5** | `INCR_RUNS_SINCE_FULL ≥ FULL_REFRESH_RUNS` 3 — `≥`, so 3 of 3 fires |
| **D6** | **no** prior `deep` pass recorded |
| **D7** | `HIGH_STAKES_FILES` non-empty |
| **D8** | `PROPAGATION` |
| **D9** | `blast_radius.band ∈ {medium, high}` |
| **D10** | any `semver_delta == major` |
| **D11** | any changed symbol with `traffic_band: high` **and** `change ∈ {signature, removed}` |
| **D12** | `DELTA_LINES > 100` |
| **D13** | `NEW_FILES > 0` |

`D4`–`D6` are [the deep-lens refresh](#the-deep-lens-refresh), and they are three **independent**
triggers, not one condition with two qualifiers: a prior `deep` pass being on record satisfies
neither `D4` nor `D5`, and its *absence* is `D6` firing on its own.
`D12`/`D13` are the two size triggers, and the only two the exclusion above waives.

| Tier | Chosen when | Runs |
| --- | --- | --- |
| **deep** | **ANY** of `D1`–`D13` above | every finder over the **whole PR**; consumer-impact over **every** changed export with ≥ 1 consumer; dependency finder over every delta; verifier Tier 2 where available; optimality lens (report-only) |
| **standard** | `DELTA_RISKY_SHAPES` non-empty · `blast_radius.band == low` · any `semver_delta` **with ≥ 1 usage site** · an `overlaps[].kind == same-symbol` · `11 ≤ DELTA_LINES ≤ 100` | correctness + quality on the delta **with enclosing-function context**; consumer-impact over changed exports in the delta; dependency finder over this push's deltas; intent over the PR; standards on delta files; verifier Tier 1–2 |
| **quick** | otherwise (the `quick` override above reaches here directly) | correctness on delta hunks with enclosing-function context; thread reconciliation; gates; nothing else |

Re-running every lens over a review-answering push produces no new information and costs a full review's budget. It gets one finder.

**`blast_radius.band == none` is not a `quick` condition.** `otherwise` means *no row
above matched*, and the rows above are read top to bottom — so a delta that reaches
nothing still routes `deep` when a refresh counter fired, and still routes `standard`
on `11 ≤ DELTA_LINES ≤ 100`. Reaching nothing is the *default* state of most deltas;
if it were sufficient on its own, the `standard` size band and the refresh triggers
could never fire at all, and the two rows above would be dead text. The one place
`band == none` decides anything by itself is the `quick` override — and that needs
`THREAD_OVERLAP ≥ 0.8` alongside it.

The `semver_delta` row is qualified by usage because an unused bump has nothing to check: a
lockfile-only patch of a package this repo imports nowhere is a dependency delta with an empty
intersection, and routing it to `standard` makes every automated bump PR pay for a finder pass that
can only conclude `breaking-but-unused`. A bump with usage sites is the opposite case and stays in.

The inverse case is the one that justifies the whole phase:

```text
DELTA_LINES = 12 · blast_radius.band = high (retryRequest: 14 consumer files, 3 packages, signature)
→ deep

DELTA_LINES = 40 · shapes = [] · band = none · THREAD_OVERLAP = 0.0 · no counter fired
→ standard     (band = none is not a quick condition; 40 is inside standard's 11–100 band)

DELTA_LINES = 5 · shapes = [docs-only] · band = none · INCR_RUNS_SINCE_FULL = 3 · a prior deep pass IS recorded
→ deep         (D5 fired at 3 of 3. The recorded prior deep pass is D6's own subject,
                not a precondition on D4/D5; and the size exclusion waives D12/D13,
                not the other eleven)

DELTA_LINES = 22 · shapes = [] · band = none · one brand-new file · no counter fired
→ deep         (D13. A new file has no prior version to diff against and no consumers
                yet, so nothing else in the pipeline is measuring it — which is why
                the trigger is on the file's existence, not on its size or its reach)

DELTA_LINES = 340 · shapes = [docs-only] · band = none · no counter fired · no new files
→ quick        (the size exclusion applies, so D12 is waived, and 340 is outside
                standard's 11–100 band)
```

The third and the last examples are the pair worth reading together: the same
`docs-only`/`band: none` inputs route `deep` or `quick` depending only on a counter,
which is why the last example states `no counter fired` rather than leaving it implied.

## Announce the decision with its inputs

Every tier decision is stated with the inputs that produced it, in the report and in the terminal.

```text
Tier: deep — blast_radius=high (retryRequest: 14 consumer files across 3 packages,
signature change), semver_delta=major (stripe 14.2.0 → 16.0.1)
```

An unexplained tier is unauditable: a maintainer who thinks the routing is wrong needs to see *which* input was wrong, and `why[]` from the impact graph is exactly that list.

## The deep-lens refresh

An incremental run is promoted back to `deep` when any of these holds:

| # | Counter | Threshold | Read from |
| --- | --- | --- | --- |
| `D4` | cumulative churn since the last `deep` pass | `FULL_REFRESH_DELTA` = 150 lines | PR-state record |
| `D5` | incremental runs since the last `deep` pass | `FULL_REFRESH_RUNS` = 3 | PR-state record |
| `D6` | no prior `deep` pass recorded | always | PR-state record — **including every run on the recovery rung**, which recovers a baseline but no history |

Without this, a PR that grows by ninety lines a day never gets another holistic pass, because no single push is ever big enough to trigger one.

## `--effort`

```bash
/pr-review <PR> --effort high     # or `effort: high` in .github/review.yaml
```

`--effort high` forces `deep` **and** is an alias for `--thoroughness 1` — the ceiling on every
lever the section below describes, not only the two named here.
`--full` remains an alias for forcing `deep` only (`routedTier`, not thoroughness).

This is the explicit-cost lever: more findings per run at the same precision, paid for on purpose rather than triggered by a size heuristic.

## Thoroughness budget

`routeDepth()` above still decides `DEPTH_TIER` — nothing on this page changes that. What used to be
hard-coded *per tier* (which finders run as sub-agents, how many `correctness` votes, how deep the
verifier's evidence ladder goes, whether the optimality/measurability lenses fire) is now a single
continuous value, **thoroughness**, `t ∈ [0, 1]`, resolved by
[`route-depth.mjs`](../scripts/route-depth.mjs)'s `resolveBudget({ thoroughness, routedTier, shape,
dispatchAvailable })` — a second pure function, the same routing-vs-execution split as `routeDepth`
itself. The reason: an A/B dry run of two review arms on the same PR at the same commit found the
arm that ran `intent`/`standards`/`quality` in-context (a topology choice nothing prescribed) missed
the best-corroborated bug in the diff, while the arm that ran them as sub-agents caught it.
Hard-coding "always sub-agent" would have cost every quick/standard review the same fixed price;
making the price a knob, defaulted from the tier and overridable, is what lets the cost track risk
continuously instead of jumping at two tier boundaries.

**Input**, first match wins:

1. `--effort high` / `effort: high` → `t = 1`.
2. `--thoroughness <n>` / `thoroughness: <n>` (CLI wins over config) → `t = clamp(n, 0, 1)`. A
   non-finite or garbage value **fails closed to `t = 1`** — the safe direction for a broken override
   is maximum scrutiny, never a silent under-review.
3. Neither given → `t` defaults from `DEPTH_TIER`: **quick → 0.2, standard → 0.5, deep → 0.8.**

**Risk floor.** A diff carrying a high-stakes shape (`auth`, `payments`, `schema-migration`,
`secrets`, `infra`) **or** `impact.json`'s `blast_radius.band == "high"` floors the *effective*
thoroughness at **0.5**, whatever `t` resolved to above — this guards only the override path:
D7/D9 already route these shapes/bands to `deep` (default `t = 0.8`) through `routeDepth()`, so the
floor matters exactly when a low `--thoroughness` override or a repo-wide config default would
otherwise under-review one. `band == "high"` was the A/B round 2 gap: at `t = 0.3` on a band-high PR
(61 exports), `consumer-impact` never activated (its own breakpoint is 0.5) and the run found nothing
— the floor now catches this exactly as it already caught a high-stakes shape.

**Breakpoints.** Chosen so the three tier defaults (0.2 / 0.5 / 0.8) reproduce today's per-tier
behaviour, on every lever but two (noted below):

| Lever | `t < 0.4` | `0.4 ≤ t < 0.5` | `0.5 ≤ t < 0.7` | `0.7 ≤ t < 0.8` | `0.8 ≤ t < 0.95` | `t ≥ 0.95` |
| --- | --- | --- | --- | --- | --- | --- |
| Active finders | correctness, intent, quality | *(same)* | + consumer-impact (delta), dependency, standards (delta) | *(same)* | consumer-impact/standards widen to **all** files | *(same)* |
| Topology | in-context | **parallel**, one message per finder | *(same)* | *(same)* | *(same)* | *(same)* |
| `correctness` votes | 1 | *(same)* | *(same)* | *(same)* | **3** | **5** |
| Max verifier evidence tier | 1 | *(same)* | **2** | *(same)* | *(same)* | **3** |
| Optimality lens | off | *(same)* | *(same)* | **on** | *(same)* | *(same)* |
| Measurability lens | off | **on** | *(same)* | *(same)* | *(same)* | *(same)* |
| Holistic broad pass (Step 2.4) | off | **on** | *(same)* | *(same)* | *(same)* | *(same)* |
| Holistic escalation cap | `round(10t)` | *(same formula, every column)* | | | | |

`round(10t)` is the one lever that does **not** land on the old flat "cap 10" at deep's 0.8 default —
it gives 8. That is a deliberate, reported deviation: proportional scaling is what "escalation SCALES
with thoroughness" means, and `--effort high` (`t = 1`) restores the old flat 10 exactly.

**Holistic broad pass (item 3).** Step 2.4 used to run unconditionally — gated only by
[`holistic-review.md`](../../shared/rules/holistic-review.md)'s five `TRIVIAL_SKIP` conditions, never
by thoroughness — so whether a given budget intended it to run was ambiguous. `budget.holisticBroadPass`
is the explicit lever: `t ≥ 0.4` (reusing the topology breakpoint — below it there is no parallel
dispatch to run the pass as a sub-agent), **or always `true` when `routedTier == "deep"`**, regardless
of any thoroughness override, the same "always on" carve-out the risk floor uses. This is a second
deliberate, reported deviation from the pre-delta behaviour: at the very bottom of the quick tier
(`t = 0.2`) the pass is now off where it previously always ran.

Every other row reproduces the pre-delta quick/standard/deep behaviour bit-for-bit at `t = 0.2/0.5/0.8`,
which is what `route-depth.mjs --self-test` asserts directly (fixture-free — the assertions are inline,
since the whole point is that they never drift from the table above without the guard noticing).

**Budget vs. capability (item 3).** A `deep`-thoroughness budget whose materialized workspace cannot
support a finder is not a smaller budget — it is the same budget with that finder turned off, and the
reason recorded rather than left ambiguous. `resolveBudget({ …, depthCapability })` deactivates
`consumer-impact` (and sets its scope to `"none"`) whenever `depthCapability == "diff-only"`, per
[`finder-consumer-impact.md`](./finder-consumer-impact.md)'s own exclusion, and appends a human-readable
line to `budget.capabilityNotes[]` naming what was turned off and why. `dependency` and `standards`
carry no such exclusion in their own rule files today and are unaffected. A/B round 2 observed this
gap directly: under diff-only the pipeline still activated `consumer-impact`, which the finder's own
rule excludes, and produced a fully wasted dispatch.

**Topology and dispatch mechanics** — what "parallel, one message per finder" and "verification in
`PR_REVIEW_MAX_PARALLEL`-capped batches" mean operationally, and the `RUN_ANOMALY` line for a run
that requested parallel but held no `Task` — are
[`dispatch-topology.md`](./dispatch-topology.md#reading-a-budget-into-dispatch)'s job, not this
page's; this page owns the breakpoints, that one owns what a caller does with them.

`finders.md` and `finding-verifier.md` stay byte-identical through all of this — the budget changes
*how many dispatches* run and *how far* the verifier's evidence ladder goes, never the finder or
verifier rubric itself.

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
