---
title: pr-reviewer — inline review pipeline (Step 2 through 2.6)
impact: HIGH
tags:
  - pr-reviewer
  - finders
  - inline-review
---

# pr-reviewer — inline review pipeline (Step 2 through 2.6)

**Read at Step 2 by every run that does not take the zero-delta short-circuit.** Owns `REVIEW_DIFF` scope, `SCANNED_FILES`, the finders and their tier table, the shape checklists, the gate order, the confidence-threshold rule, and Steps 2.3–2.6. Steps 2.6b–2.9b are in [`verify-and-render.md`](./verify-and-render.md); 2.7b is in [`memory-steps.md`](./memory-steps.md).

## Contents

- [Step 2: Inline review pipeline](#step-2-inline-review-pipeline)
  - [Confidence thresholds for inline findings](#confidence-thresholds-for-inline-findings)
  - [2.3 Filter suppression](#23-filter-suppression)
  - [2.4 Holistic review (default ON in `full` mode)](#24-holistic-review-default-on-in-full-mode)
  - [2.4b Targeted holistic escalation (default ON in `full` mode; shape-gated in incremental)](#24b-targeted-holistic-escalation-default-on-in-full-mode-shape-gated-in-incremental)
  - [2.4d Standards conformance (default ON at the `deep` and `standard` tiers)](#24d-standards-conformance-default-on-at-the-deep-and-standard-tiers)
  - [2.4e Measurability review (default ON at every tier)](#24e-measurability-review-default-on-at-every-tier)
  - [2.5 Dedupe + consolidate](#25-dedupe--consolidate)
  - [2.6 Finding grounding](#26-finding-grounding)

---

## Step 2: Inline review pipeline

**Skip this step entirely** if the zero-delta short-circuit fired, whether at Step 0.8's fast
path (`FAST_ZERO_DELTA == true`) or Step 1.2b's later check (`REVIEW_DIFF == ""`). Proceed to
Step 1.8 with no inline findings, then to Step 2.9c — which is a **top-level step, not part of
Step 2**, and runs whether or not Step 2 ran.

**Diff used for inline review (`REVIEW_DIFF`):**
- `RUN_MODE == "full"` entered directly (first run, `--full`, or any upgrade rule): `REVIEW_DIFF` = the full PR diff from Step 1.1 command B.
- `RUN_MODE == "incremental"` or `"incremental-quick"` (non-empty delta): `REVIEW_DIFF` = delta patches from `/tmp/pr-delta.json`, as set in Step 1.2b.

Gate checks (Step 1.8) always use the **full PR diff** regardless of `REVIEW_DIFF`. The inline
review pipeline below operates on `REVIEW_DIFF` only.

**Consistency-surface exemption (incremental modes).** A candidate whose claim spans **two files
that are both in the PR's changed-file set** is never suppressed, filtered, or left ungenerated for
being outside `REVIEW_DIFF` — the PR is answerable for both ends of a contradiction it contains, on
a propagation-shaped change (already upgraded to `full` by Step 1.2b) or any delta that tightens one
side of a contract restated elsewhere: the delta lands on the authority while the induced
contradiction sits at a line it never touched. Bounded to files the PR already touches — never a
license to re-review unchanged files generally — and a drop that would violate it is logged as the
miss it is, not routine bookkeeping.

**Bind `SCANNED_FILES` as the walk proceeds** — start empty, append each path the moment the
pipeline actually reads it. It is what this run *examined*, not `REVIEW_DIFF` (what it *could have*
examined), and the two diverge exactly where it matters: **Step 1.4 triage** skips auto-generated,
lock, and vendored files on a > 30-file PR (they stay in `REVIEW_DIFF` but must never enter
`SCANNED_FILES`); **budget exhaustion** stops the walk mid-way and `SCANNED_FILES` holds only the
`M` files reached (the only durable record of that fact — `PARTIAL_BANNER` is a rendered string, not
state); **zero-delta** never enters the pipeline, so it stays empty. Step 2.9c's re-scan predicate
reads it — without it that predicate degrades to a `REVIEW_DIFF` membership test, passing on a
partial/triaged run for files nobody read, reopening the hole the predicate exists to close.

Run the pipeline as defined in `agents/shared/rules/rubric-composition.md`:

1. Load the `quality` checklist (always, unless `REVIEW_DIFF` is trivial).
   UI files additionally get the checklist's accessibility item (labels, keyboard, focus, contrast).
2. Load `critical` (`--critical`, `context.reviewConfig.critical: always`, or auto-engage heuristic).
3. Load `--with` lenses (max 3).
4. Walk each rubric against `REVIEW_DIFF`. Each rubric emits raw findings.

**Independent finders (Phase D)** — run these alongside the rubrics.
See [`agents/pr-reviewer/rules/finders.md`](./finders.md) for the polarity rule,
the candidate record schema, and diversify-then-vote. Read it once, here.

Finder candidates enter the **same raw candidate stream** as rubric output and are subject to
every downstream gate, including the Step 2.5 dedupe — so the intent finder's candidates and
Gate 1's are deduped rather than posted twice.

**The polarity rule, because it is the whole point of the split.** A finder's job is to *flag*;
the verifier's job is to *filter*. A finder therefore never sees the confidence bar, the report
budget, the placement caps, or how many candidates the run already has — a finder that knows the
bar prunes against it in its own head, and a candidate pruned pre-verification is a defect nobody
ever adjudicated. Every candidate carries a `bad_outcome` (what breaks, concretely) and a
`verify_by` (the cheapest check that would settle it); those two fields are what make Phase E
possible, and a candidate missing either is malformed, not modest.

**Finder availability by depth tier:**

| Finder | `deep` | `standard` | `quick` |
|---|---|---|---|
| **correctness** — logic, edge cases, error paths, races, state assumptions | ✅ | ✅ | ✅ |
| **quality** — maintainability, tests, naming (**material only** outside `deep`) | ✅ | ✅ | ✅ |
| **intent** — description vs. diff, semantically; scope creep; unmentioned behaviour change | ✅ | ✅ | ✅ |
| **consumer-impact** — [`finder-consumer-impact.md`](./finder-consumer-impact.md) | ✅ all changed exports | ✅ delta exports only | ✗ skipped |
| **dependency** — [`finder-dependency.md`](./finder-dependency.md) | ✅ | ✅ | ✗ skipped |
| **standards** — [`standards-conformance.md`](../../shared/rules/standards-conformance.md) (Step 2.4d) | ✅ all files | ✅ delta files | ✗ skipped |
| **measurability** — [`measurability-review.md`](../../shared/rules/measurability-review.md) (Step 2.4e) | ✅ all files | ✅ delta files | ✅ delta files |

The **correctness finder** keeps the shape checklists verbatim — when the reviewed diff carries a
shape below, it additionally walks that shape's checklist against every touched hunk. The
checklist focuses attention; it never caps or replaces the general pass:

| Shape | Checklist |
|---|---|
| `auth` | Missing/weakened permission check on a new path; check ordering (authn before authz before effect); token/session lifetime or scope widened; a bypass header, flag, or debug escape hatch; identity read from a spoofable source. |
| `payments` | Rounding at tier/currency boundaries; idempotency of charge/refund paths; retry that double-charges; amounts in floats; missing currency unit; webhook trust without signature verification. |
| `concurrency` | Lock ordering and scope (an exclusive lock on a read-mostly path); check-then-act races; shared state captured by a goroutine/closure/loop variable; missing timeout/cancellation; `Promise.all` where one rejection must not abort the rest. |
| `schema-migration` | Irreversible change without a rollback path; column drop/rename racing deployed readers; missing backfill or default; index built without concurrency on a hot table. |
| `api-contract` | Field removed/renamed/retyped that a deployed consumer still sends or reads; required-vs-optional flipped; error shape changed; versioning skipped on a breaking change; webhook payload extended without tolerant parsing on the receiver. |
| `error-handling` | A catch that swallows and continues where the caller assumes success; error detail leaked to an external surface; retry without backoff or cap. |

Its hotspot and prior-human-catch inputs come from [`memory.md`](./memory.md) and
its telemetry leads from [`telemetry.md`](./telemetry.md). Each is **a pointer at
code to read**, never evidence: a candidate whose evidence is a memory record, a graph edge, or a
span count rather than a line of code is not a candidate yet.

**The dependency finder replaces Persona 4**, which resolved a version from the *manifest* — a
range, not a version — and so compared the diff against a contract the installed package may never
have had. [`finder-dependency.md`](./finder-dependency.md) resolves from the
**lockfile**, treats a `0.x` minor as a major (`zerover: true`), walks a five-rung changelog ladder,
and intersects the breaking surface with this repo's own `usage_sites` from the impact graph. Its
three outcomes are `breaking-and-used`, `breaking-but-unused`, and `no-breaking-change-found`, and
there is never a silent fourth: when the ladder cannot reach the changelog, the finding is withheld
as an `unobtainable` hypothesis (`WITHHELD` in Step 4), never asserted as verified.

Set the payload's **`INTEGRATIONS`** slot from the dependency finder's disposition — `not activated`
when the diff touches no manifest or lockfile, `skipped (tier: quick)` at `quick`, and otherwise the
rung that produced each result. The slot is **required**: `render-report.mjs` exits non-zero with
nothing on stdout when it is absent, so a run that leaves it unset posts no report at all. An "integrations checked" line never implies upstream release-note
verification unless a rung that reads the changelog actually ran.

**Finders and the verifier read the review packet first** — `context.packet.path`: the PR
description and every hunk widened against the head file, with head line numbers a candidate cites
directly ([`review-packet.mjs`](../scripts/review-packet.mjs)). Open a workspace file only
for what it does not show: a caller, a definition, or a file its index marks *listed*.

**Dispatch topology is budget-driven** — sub-agenting, vote count, and verification batching
all read `resolveBudget()` — [`dispatch-topology.md`](./dispatch-topology.md).

**Two things break finder independence even when the calls are parallel**, and both are forbidden:
passing one finder's candidates to another (the second then confirms the first rather than
looking), and sharing a running summary (`findings so far: 6` is enough to make the next finder
quieter). Give each finder the code, the graph, and its own scope — nothing about the run.
Cross-finder agreement is computed at Step 2.5a, from the emitted records, after every finder has
run.

After rubric + finder candidates are collected, the pipeline runs through these gates in
strict order. Each gate is a drop point; no retries.

```text
rubrics + finders produce raw candidates
  → 2.3  review-config.md § Filters   (drop findings in categories suppressed by review config)
  → 2.4  holistic-review.md           (in-context intent + system-fit pass — default on; may be skipped per 1.8 heuristic)
  → 2.4b holistic-review.md § Targeted escalation (parallel focused traces — default on)
  → 2.4d standards-conformance.md     (governing-docs enforcement — default on; skip via --no-standards or trivial-skip;
                                       findings cite governing-doc path:line and pass all downstream gates)
  → 2.4e measurability-review.md      (Skill("measurable", "audit") — default on; two gates keep it quiet;
                                       strict by default — a `missing` new failure mode reaches FAIL_REASONS, `unlinked` never blocks; opt down with `measurable: advisory`)
  → 2.5  rubric-composition § Consolidation (dedupe + group + sort — no cap, nothing dropped)
  → 2.5a rubric-composition § Cross-rubric agreement (agreement-promoted flag)
  → 2.5b prior-comment-awareness.md § Dedup (drop if already said in a prior review pass)
  → 2.5c prior-comment-awareness.md § Carry-forward of anchorless findings (dispose every
                                       PRIOR_DIAGNOSTICS entry: REPLACE / RESOLVE / CARRY / DROP;
                                       a RESOLVE requires the owning step to have run this pass)
  → 2.6  finding-grounding.md         (every backticked symbol grep-resolves)
  → 2.6b finding-verifier.md          (Phase E — re-derive from code; confirmed / contradicted /
                                       ambiguous / unobtainable. A contradicted candidate is DROPPED
                                       and LOGGED with its reason; unobtainable is RE-FRAMED, not dropped)
  → 2.7  finding-verifier.md § rubric (Reproducible 40 / Attributable 30 / Actionable 30 → the score;
                                       per-comment-confidence.md owns the threshold, defer band, and
                                       severity fan-out it is compared against)
  → 2.7b memory.md § Suppression      (relevance rules apply HERE, after verification — never before)
  → 2.8  comment-shape.md             (render-comment.mjs: ≤ 60-char title, ≤ 200 chars prose)
  → 2.9  conventional-comments.md     (prefix + decoration)
  → 2.9b rubric-composition § Placement (inline caps 5/file + 20 total; overflow DEFERRED to body, never dropped)
```

**Why memory suppression moved from 2.2 to 2.7b:** suppressing before verification drops a
recurring *real* defect on the strength of past resolution behaviour alone (see § 2.7b for the full
rationale and the two never-suppressible classes — standards findings and anything `(blocking)`).

### Confidence thresholds for inline findings

`agents/shared/rules/per-comment-confidence.md` owns every number. **Severity-aware thresholds are
the default**, so the effective inline bar is `severity_thresholds[tier]` for the tier
[`severity.md`](../../shared/rules/severity.md) emits (`per-comment-confidence.md` § Severity-aware threshold; `review-config.md`
§ Severity-aware thresholds); the flat per-finding-type table in that rule applies only under a
`per_comment_confidence_threshold` override. Do not restate either set here — a third copy of a
threshold is a third thing to keep in sync, and the two that already existed drifted.

Two rules hold under both schemes: `praise` is dropped entirely, and a near-miss `issue` or
`suggestion` (band `[max(threshold − 15, 50), threshold)`) is **deferred to the advisory body
surface, not dropped**, which is what stops a real-but-borderline finding from vanishing on one
review and resurfacing as "new" on the next. `question` and `nitpick` below threshold are dropped.

### 2.3 Filter suppression

See `agents/shared/rules/review-config.md § Filters`. Drop findings in suppressed categories.
Also drop cosmetic `nitpick` / `suggestion` findings on a docs/comment-only `incremental` or `incremental-quick` delta (the materiality filter, `rubric-composition.md § Materiality routing`), logged as `Materiality drops` — a pre-clearing drop, so it never enters `<CL>` and the `<CL> − <DEF> == <F>` identity is untouched.

### 2.4 Holistic review (default ON in `full` mode)

See `agents/shared/rules/holistic-review.md`. Runs after rubric composition and before
dedupe.

Skip when **any** of the following are true:
- `--no-holistic` was passed.
- The `TRIVIAL_SKIP` cache from Step 1.7b is true (conditions in `agents/shared/rules/holistic-review.md` § Trivial-skip set — do not recompute them here).
- The Step 1.8 token-economy skip triggered (≥ 3 gates failing).
- `RUN_MODE` is `incremental` or `incremental-quick` — holistic passes are expensive and the delta is small enough that system-fit issues are unlikely to have regressed.

For `pr-reviewer` (cross-review), map holistic finding types to:
- `intent-mismatch` → `issue` (blocker)
- `system-fit` (any severity) → `question` (respecting the cross-review context asymmetry)
- `scope-creep` → `question`

### 2.4b Targeted holistic escalation (default ON in `full` mode; shape-gated in incremental)

See `agents/shared/rules/holistic-review.md § Targeted escalation`. Runs after 2.4 and
before dedupe. Default ON for `pr-reviewer`. Skip via `--no-escalate`, or when 2.4 was
**trivially** skipped (trivial-skip heuristic or the Step 1.8 token-economy skip) — the
incremental-mode 2.4 skip is a run-mode policy, not a triviality verdict, and gets the
shape-gated exception below.
Selects context-dependent findings (changed exports whose correctness depends on caller
behaviour) and fans out parallel focused traces — one per finding, capped at
`budget.holisticEscalationCap` (depth-routing.md § Thoroughness budget).

**Incremental modes:** 2.4b runs even though the broad pass (2.4) is skipped, **when and only
when `ESCALATE_IN_INCREMENTAL` is true** (Step 1.2b — the delta carries a risky content shape:
concurrency, api-contract, or schema-migration by content). Cap **3** traces instead of 10,
seeded from the rubric/finder candidates on the delta (there is no broad-pass output to seed
from), highest-severity first. This is the depth lever for a small-but-dangerous delta: a
15-line mutex change gets its call-graph trace without paying for a whole-PR full pass. With
`ESCALATE_IN_INCREMENTAL` false, incremental runs skip 2.4b exactly as before
(`holistic-review.md § Risky-shape incremental escalation`).

### 2.4d Standards conformance (default ON at the `deep` and `standard` tiers)

See `agents/shared/rules/standards-conformance.md`. Skip via `--no-standards`, when the
`TRIVIAL_SKIP` cache from Step 1.7b is true, or when `!budget.finders.standards` (the delta is
too small to warrant governing-doc comparison), logged `skipped (t=<t>)`.

Scope follows `budget.finderScope.standards` (depth-routing.md § Thoroughness budget).

Uses the `STANDARDS_DOCS` cache built in Step 1.7b.
Emits `issue:` findings for violated "never" / "must" / "always" / "do not" / "forbidden" statements
and `suggestion:` findings for violated "prefer X over Y" statements.
Every finding carries the governing-doc `path:line` as grounding evidence and passes all downstream
gates (2.5–2.9b) unchanged.

Precedence: when a standards finding conflicts with the PR author's stated intent or a review-config
explicit override, the author-intent and config **win**; the conflict is surfaced in the diagnostics,
not silently enforced.

Emit the `Standards conformance (2.4d)` log block in the Quality Gate summary even when no findings
are emitted, so a skipped run and a silent run are distinguishable.

### 2.4e Measurability review (default ON at every tier)

See [`agents/shared/rules/measurability-review.md`](../../shared/rules/measurability-review.md).
The question is the one no other lens asks: **will this change's impact be provable, and will its
regressions be visible, after it merges?**

Skip via `--no-measurable`, when the `TRIVIAL_SKIP` cache from Step 1.7b is true, or when
`!budget.measurabilityLens`, logged `skipped (t=<t>)`.

Invoke `Skill("measurable", "audit")` — **`audit` mode only**. Never `implement`: this agent is
read-only in both relations, and a reviewer that instrumented the diff would be authoring the change
it then judged.

Two gates run before the call and both must pass, or the step is a **quiet no-op** rather than a
finding: (1) at least one changed path classifies `web` / `mobile` / `api` / `worker`, and (2) the
diff adds or alters observable behaviour — a new user-facing action, a new request-serving operation,
a **new failure mode**, or a performance characteristic the PR itself claims. A rename, a type-only
change, or a behaviour-identical refactor fails gate 2 by construction. The gates are the whole
reason this lens is worth having on by default: asked of every diff, "where's the telemetry" is noise
the author is right to dismiss.

Mapping (strict is the default): `missing` on a new failure mode → `issue:` under strict,
`suggestion:` under advisory; every other `missing` → `suggestion:`; `unlinked` → **one** aggregated
finding per run — a `suggestion:` under strict, a `nitpick:` under advisory — never an `issue:` and
never blocking in either level; `pass` → nothing at all. Findings name the **signal, not the
library**, and pass 2.5–2.9b unchanged with a Tier-1 receipt — "no emit call exists on this path" is
a `grep` claim, so it never needs Tier 3.

Strict is the **default** and advisory is the opt-down: a repository sets `measurable: advisory` in
the review config (or a run passes `--measurable-advisory`) to keep every measurability finding out
of `SEVERITY_TALLY` and `FAIL_REASONS`. The level is a repository claim about its release bar, never
the reviewer's own judgment. Under strict, only a `missing` signal on a new failure mode reaches
`FAIL_REASONS`; the lens never **lowers** a verdict, and `unlinked` never blocks under either level.
Strict is the default because a new failure mode that emits no signal is silently wrong in production
the first time it fires, and the review is the last cheap point to catch it — same invariant shape
[`telemetry.md`](./telemetry.md) holds, tuned to gate only that one case.

Do not confuse this lens with `telemetry.md`. That one reads what the touched code did **yesterday**
(an exposure input to priority); this one asks what the change will show **tomorrow**. The single
permitted composition: a `missing` finding on a path `telemetry.md` reports in a high `traffic_band`
says so, which raises priority and still does not block.

Emit the `Measurability review (2.4e)` log block even when the lens was quiet, so a skipped run and a
clean run are distinguishable.

### 2.5 Dedupe + consolidate

See `agents/shared/rules/rubric-composition.md § Consolidation`.
Dedupe, group by file, and sort by `(prefix priority, line)` — priority order `issue > suggestion > question > nitpick`.
**No cap fires here and nothing is discarded**; quantity is handled at Step 2.9b after the quality gates.
On `(file, line)` collision, holistic claim wins.
Consolidation also **collapses cross-surface parity findings into one enumerated finding** (`§ Consolidation pass`): a consistency issue ("documented here but not in the sibling") must name every surface to align rather than surface one-per-review, so fixing it never leaves a neighbour looking uneven for the next push to re-flag.

### 2.6 Finding grounding

See `agents/shared/rules/finding-grounding.md`. Every backticked symbol must grep-resolve.
This is the cheap pre-filter for the verifier: a candidate naming a symbol that does not exist
never reaches Phase E.
