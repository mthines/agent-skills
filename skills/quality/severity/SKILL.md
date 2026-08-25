---
name: severity
description: >
  Rates how severe a finding or bug is if it is real — the blast-radius axis,
  complementary to confidence's is-it-real axis. Emits a lowercase tier
  (critical / high / medium / low) from a fixed axis rubric, then applies one
  deterministic, executable path floor (auth / billing / migration / infra /
  secrets paths) plus heuristic escalators (data-loss, security, concurrency
  shapes) — both scoped to reachable production code, never test / fixture /
  generated paths. Callers own how they gate on the tier and map it to their
  own blocking rules; the skill stays policy-free. Use to triage a review
  finding or a bug. Triggers on "how severe", "rate severity", "severity check",
  "triage this finding", "how bad is this", "/severity".
disable-model-invocation: false
argument-hint: '[finding|bug]'
license: MIT
metadata:
  author: mthines
  version: '0.1.0'
  workflow_type: advisory
  tags:
    - severity
    - triage
    - blast-radius
    - code-review
    - bug-triage
    - risk
    - multi-signal
---

# Severity Assessment

Rate how severe a finding or bug is **if it is real**, and emit one tier the caller acts on.

> **Severity is not confidence.** `confidence` answers *is this real / correct*.
> `severity` answers *how bad is it if it is*. The two are orthogonal — a caller
> composes them (surface when severity clears the caller's bar for its tier AND
> confidence clears that bar). Never fold them into one number.

> **What is actually deterministic here.** One thing: the **path floor** in Step 2
> is an executable glob against the file path (a real `case` match), so it never
> depends on model judgment. The **escalators** (data-loss / security / concurrency
> shapes) are heuristic — an LLM reads the code shape. This is the honest split;
> do not call the escalators deterministic. It mirrors `confidence`'s executable
> rule checks only for the path floor.

## Contents

- [Mode Detection](#mode-detection)
- [Severity rubric](#severity-rubric)
  - [Step 1 — Base tier from axes](#step-1--base-tier-from-axes)
  - [Step 2 — Path floor and escalators](#step-2--path-floor-and-escalators)
  - [Step 3 — Combined tier](#step-3--combined-tier)
- [Output Format](#output-format)
- [Mapping to a reviewer's blocking flag](#mapping-to-a-reviewers-blocking-flag)
- [How Callers Consume the Tier](#how-callers-consume-the-tier)
- [Evals](#evals)

---

## Mode Detection

Check the arguments: `$ARGUMENTS`

| Argument  | Default | Rates the severity of        | Typical caller                                |
| --------- | ------- | ---------------------------- | --------------------------------------------- |
| `finding` | **yes** | A single code-review finding | A reviewer, to route and gate one finding      |
| `bug`     |         | A bug, defect, or incident   | `fix-bug` / `ci-auto-fix` / `batch-linear-tickets` triage |

If no argument is provided, default to `finding`. The rubric is shared; the mode
only changes what "impact" refers to (a finding's failure vs. a bug's user harm).

A `change` / whole-diff mode is deliberately out of scope: blast-radius of a whole
change is already `critical`'s and `optimize-approach`'s job. Add it only when a
consumer needs it.

---

## Severity rubric

This section is self-contained: it is the exact rubric the eval extracts, and it is
everything needed to produce a tier.

The four tiers, worst-case first:

| Tier         | Criteria (a finding is this tier if ANY line holds, on a reachable path)                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **critical** | Irreversible data loss, a security breach (authz bypass, secret exposure, RCE / injection), or an all-tenant outage. |
| **high**     | Data loss or corruption on an edge path; a security-relevant weakness (SSRF, fork / PR trust in a privileged context, removed integrity pin); or broken core behavior on a common path. |
| **medium**   | A functional bug with a workaround — single surface, recoverable. The default for a real, contained defect. |
| **low**      | Cosmetic, style, docs, parity, or nice-to-have. No functional impact.                                     |

Severity aggregates by **worst plausible case**, not average — one catastrophic axis
sets the tier.

### Step 1 — Base tier from axes

Rate each axis, then pick the **highest tier whose criteria above are met**. The axes
are the evidence; the table is the mapping.

| Axis             | Levels (low → high)                                                          |
| ---------------- | --------------------------------------------------------------------------- |
| **Impact**       | cosmetic → functional → data-or-security → catastrophic (outage / breach)    |
| **Blast radius** | one call site → one user → one tenant → all tenants / stored data / money    |
| **Likelihood**   | rare / theoretical → edge case → common path → always                       |
| **Reversibility**| self-heals → manual fix → irreversible (lost data, sent money, leaked secret)|

**Reachability caps the base tier.** A catastrophic-impact bug on a code path that is
never reached (dead code, an unregistered handler, a `theoretical` likelihood) is **not**
`critical` or `high` — rate it down to what its reachability supports, the same way
`confidence` refuses to inflate on weak evidence. This is the one place judgment
overrides the impact axis, and it also gates whether Step 2 applies at all.

### Step 2 — Path floor and escalators

Both run only on **reachable production code**. Neither applies to test, fixture, mock,
generated, example, or reverse-migration paths — those are where destructive shapes
live harmlessly and where a floor would manufacture the exact nitpick noise this skill
exists to avoid.

**Exclusion gate (run first).** If the finding's path matches any exclusion, skip both
the floor and the escalators — the tier stays whatever Step 1 produced:

```bash
case "$path" in
  *_test.*|*.test.*|*.spec.*|*/test/*|*/tests/*|*/__mocks__/*|*/__fixtures__/*|\
  *.gen.*|*.generated.*|*/generated/*|*/fixtures/*|*/examples/*|*.down.sql|*.down.ts)
    floor=none ;;   # non-production path — Step 2 does not apply
esac
```

**Deterministic path floor (executable).** If not excluded, this `case` sets a minimum
tier purely from the path — no model judgment:

```bash
case "$path" in
  */auth/*|*/authn/*|*/authz/*|*/billing/*|*/payments/*|\
  *migrations/*|*/infra/*|*/deploy/*|*secret*|*credential*)
    floor=high ;;
  *) floor=none ;;
esac
```

**Heuristic escalators (LLM-judged — NOT deterministic).** Read the changed code and
apply a minimum tier only when the shape is concretely present, citing the line:

| Shape                                                                                          | Minimum |
| ---------------------------------------------------------------------------------------------- | ------- |
| Data loss: offset / ack committed before the durable write; silently swallowed error; unguarded destructive migration (`DROP` / `DELETE` / `TRUNCATE` on a populated table) | **high**     |
| Security breach: authz bypass, secret / token exposure, RCE, SQL / command injection            | **critical** |
| Security weakness: SSRF, trusting a fork / PR ref in a privileged or CI context, a removed integrity pin | **high**     |
| Concurrency on shared mutable state, money, or a counter: race, missing lock, double-dispatch, unbounded fan-out | **high**     |

The blanket "untrusted input" is intentionally absent — every endpoint reads untrusted
input, so it is not a floor. Only the concrete breach shapes above escalate.

### Step 3 — Combined tier

```text
severity = max(base_tier, path_floor, escalator_minimums)
```

over the order `low < medium < high < critical`, with `none` contributing nothing. A
matched floor or escalator raises the tier; it never lowers it. Step 1's reachability
cap has already run, so a floor can only apply to code that is actually reached.

---

## Output Format

**You MUST output in this exact format. The tier token is always lowercase — it is
the machine-readable value; a caller parses the token after `## Severity: `.**

```text
## Severity: <critical|high|medium|low>

### Axes

| Axis          | Level            | Notes |
|---------------|------------------|-------|
| Impact        | <level>          | ...   |
| Blast radius  | <level>          | ...   |
| Likelihood    | <level>          | ...   |
| Reversibility | <level>          | ...   |

### Floor and escalators

| Signal                        | Match                          | Minimum  |
|-------------------------------|--------------------------------|----------|
| exclusion (test/gen/fixture)  | <✓ path… | ✗>                  | n/a      |
| path floor                    | <✓ path… | ✗>                  | high | — |
| data-loss shape               | <✓ file:line | ✗>              | high | — |
| security shape                | <✓ file:line | ✗>              | critical/high | — |
| concurrency shape             | <✓ file:line | ✗>              | high | — |

### Result

- Base tier (Step 1): <tier>
- Floor / escalator applied: <tier or none> (<matched signal>)
- **Severity: <tier>**
```

**Be honest — do not inflate or deflate. A `low` with clear reasoning beats a reflexive
`high`. A matched floor is non-negotiable on a production path; an exclusion match is
equally non-negotiable — do not floor test or generated code.**

---

## Mapping to a reviewer's blocking flag

A reviewer already has a binary `(blocking)` decoration
(`agents/shared/rules/conventional-comments.md`), a cap-exemption that always posts a
`(blocking)` finding inline (`rubric-composition.md § Placement`), and an orthogonal
`materiality` dimension. This skill does not replace them — it feeds the `(blocking)`
decision. The crosswalk (note: a tier is orthogonal to the `issue`/`suggestion`/`nitpick`
category, which `rubric-composition.md § Severity mapping` still assigns separately):

| Tier         | Reviewer treatment                                                                 |
| ------------ | --------------------------------------------------------------------------------- |
| **critical** | `(blocking)` — cap-exempt, always inline.                                          |
| **high**     | `(blocking)` — cap-exempt, always inline.                                          |
| **medium**   | Non-blocking, material — inline subject to the caps, else deferred.                 |
| **low**      | Non-blocking, cosmetic / nice-to-have — materiality gate + relevance-memory may suppress. |

The tier is the source; the reviewer decorates `(blocking)` from it per the crosswalk
above. Do not encode a second, divergent blocking rule in the consumer.

**One exception — a floor-only tier is not blocking.** If a finding is `high` or `critical`
**only** because the Step 2 path floor raised it (its Step 1 base tier was `medium`/`low`), do
not mark it `(blocking)`: a cosmetic nitpick on a `billing/` or `migrations/` path is still a
nitpick. The floor raises the confidence bar so the finding surfaces on a sensitive path; it does
not convert a non-blocking finding into a blocker. `(blocking)` follows the base-tier impact
(broken behaviour, security, data loss, misimplemented intent), not the floor.

---

## How Callers Consume the Tier

This skill emits a value and stops. It never posts, applies, blocks, or gates on its own
— it is advisory, like `confidence`, and it is **policy-free**: the numeric bars a
consumer uses live in the consumer, not here.

- **A reviewer** gates each finding on a severity-aware confidence bar **by default**:
  `medium` anchors the profile's historical bar, `critical` / `high` get a lower bar
  (surface a probable serious bug even at moderate confidence), `low` a higher bar
  (advisory or suppressed). The numbers live in `review-config.md`, not in this skill —
  it emits only the tier.
- **`fix-bug` / `batch-linear-tickets`** order triage by tier.
- **`ci-auto-fix`** escalates a `critical` / `high` regression and defers a `low` one.

**Cost.** Assess severity in the **same pass** as the finding's confidence rating, or
batch all findings into one call. Do not spawn a separate per-finding invocation — on a
20-finding PR that doubles the per-finding LLM round-trips for no benefit.

The reviewer shows the emitted tier as a `<prefix> (<tier>):` label on each finding
(`agents/shared/rules/conventional-comments.md` § Severity decoration) and records it per
outcome: `scripts/record-comment-relevance.mjs` reads the tier into the
`reviewer-comment-relevance` record's `severity` field — so per-tier precision is
measurable over time, the same way a reviewer tracks whether its findings were acted on.

---

## Evals

The rubric above is regression-tested. `scripts/eval/golden/severity-tiering.jsonl`
holds labelled findings spanning all four tiers plus the tricky cases this skill is
built for: a destructive statement on a test path (excluded → `low`), a one-line change
on a `billing/` path (path floor → `high`), and a catastrophic bug on a dead path
(reachability cap → `low`). The `severity-tiering` suite in `scripts/eval/l2.mjs`
extracts the [Severity rubric](#severity-rubric) section verbatim and exact-matches the
model's tier. When a floor or escalator changes, add a golden case so the change is
locked.
