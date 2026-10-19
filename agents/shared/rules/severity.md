---
title: Severity — blast-radius tier for a finding or bug
impact: HIGH
tags:
  - pr-reviewer
  - branch-reviewer
  - severity
  - triage
  - blast-radius
---

# Severity

Rate how severe a finding or bug is **if it is real**, and emit one tier the caller acts on.
Apply this rule in-context, in the same pass as the finding's confidence rating — never as a separate per-finding call.

Severity is not confidence.
`confidence` answers *is this real*; severity answers *how bad is it if it is*.
A caller composes the two and never folds them into one number.

The rule is policy-free: it emits a tier and stops.
Numeric bars live in the consumer ([`review-config.md`](./review-config.md) § Severity-aware thresholds for reviewers).

| Mode | Rates | Typical caller |
| --- | --- | --- |
| `finding` (default) | one code-review finding | `pr-reviewer`, `branch-reviewer` |
| `bug` | a bug, defect, or incident | `fix-bug`, `ci-auto-fix`, `ui-verify` out-of-bounds judge |

The rubric is shared; the mode only changes what "impact" refers to (a finding's failure vs. a bug's user harm).

## Severity rubric

This section is self-contained: it is the exact rubric the `severity-tiering` eval extracts, and it is everything needed to produce a tier.

The four tiers, worst-case first:

| Tier         | Criteria (a finding is this tier if ANY line holds, on a reachable path)                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **critical** | Irreversible data loss, a security breach (authz bypass, secret exposure, RCE / injection), or an all-tenant outage. |
| **high**     | Data loss or corruption on an edge path; a security-relevant weakness (SSRF, fork / PR trust in a privileged context, removed integrity pin); or broken core behavior on a common path. |
| **medium**   | A functional bug with a workaround — single surface, recoverable. The default for a real, contained defect. |
| **low**      | Cosmetic, style, docs, parity, or nice-to-have. No functional impact.                                     |

Severity aggregates by **worst plausible case**, not average — one catastrophic axis sets the tier.

### Step 1 — Base tier from axes

Rate each axis, then pick the **highest tier whose criteria above are met**.
The axes are the evidence; the table is the mapping.

| Axis             | Levels (low → high)                                                          |
| ---------------- | --------------------------------------------------------------------------- |
| **Impact**       | cosmetic → functional → data-or-security → catastrophic (outage / breach)    |
| **Blast radius** | one call site → one user → one tenant → all tenants / stored data / money    |
| **Likelihood**   | rare / theoretical → edge case → common path → always                       |
| **Reversibility**| self-heals → manual fix → irreversible (lost data, sent money, leaked secret)|

**Reachability caps the base tier.**
A catastrophic-impact bug on a code path that is never reached (dead code, an unregistered handler, a `theoretical` likelihood) is **not** `critical` or `high` — rate it down to what its reachability supports.
This is the one place judgment overrides the impact axis, and it also gates whether Step 2 applies at all.

### Step 2 — Path floor and escalators

Both run only on **reachable production code**.
Neither applies to test, fixture, mock, generated, example, or reverse-migration paths — those are where destructive shapes live harmlessly and where a floor would manufacture nitpick noise.

**Exclusion gate (run first).**
If the finding's path matches any exclusion, skip both the floor and the escalators — the tier stays whatever Step 1 produced:

```bash
case "$path" in
  *_test.*|*.test.*|*.spec.*|*/test/*|*/tests/*|*/__mocks__/*|*/__fixtures__/*|\
  *.gen.*|*.generated.*|*/generated/*|*/fixtures/*|*/examples/*|*.down.sql|*.down.ts)
    floor=none ;;   # non-production path — Step 2 does not apply
esac
```

**Deterministic path floor (executable).**
If not excluded, this `case` sets a minimum tier purely from the path — no model judgment:

```bash
case "$path" in
  */auth/*|*/authn/*|*/authz/*|*/billing/*|*/payments/*|\
  *migrations/*|*/infra/*|*/deploy/*|*secret*|*credential*)
    floor=high ;;
  *) floor=none ;;
esac
```

**Heuristic escalators (LLM-judged — NOT deterministic).**
Read the changed code and apply a minimum tier only when the shape is concretely present, citing the line:

| Shape                                                                                          | Minimum |
| ---------------------------------------------------------------------------------------------- | ------- |
| Data loss: offset / ack committed before the durable write; silently swallowed error; unguarded destructive migration (`DROP` / `DELETE` / `TRUNCATE` on a populated table) | **high**     |
| Security breach: authz bypass, secret / token exposure, RCE, SQL / command injection            | **critical** |
| Security weakness: SSRF, trusting a fork / PR ref in a privileged or CI context, a removed integrity pin | **high**     |
| Concurrency on shared mutable state, money, or a counter: race, missing lock, double-dispatch, unbounded fan-out | **high**     |

The blanket "untrusted input" is intentionally absent — every endpoint reads untrusted input, so it is not a floor.
Only the concrete breach shapes above escalate.

### Step 3 — Combined tier

```text
severity = max(base_tier, path_floor, escalator_minimums)
```

over the order `low < medium < high < critical`, with `none` contributing nothing.
A matched floor or escalator raises the tier; it never lowers it.
Step 1's reachability cap has already run, so a floor can only apply to code that is actually reached.

## Output

The tier token is always lowercase — it is the machine-readable value, and a caller parses the token after `Severity: `.
When the caller asks for the full record (standalone triage, `fix-bug`), emit:

```text
## Severity: <critical|high|medium|low>

- Axes: impact <level>, blast radius <level>, likelihood <level>, reversibility <level>
- Exclusion: <✓ path | ✗>   Path floor: <✓ path → high | ✗>
- Escalator: <✓ file:line → tier | ✗>
- Base tier <tier> → floor/escalator <tier|none> → **Severity: <tier>**
```

A reviewer records only the tier, as the `<prefix> (<tier>):` label ([`conventional-comments.md`](./conventional-comments.md) § Severity decoration).

Do not inflate or deflate.
A matched floor is non-negotiable on a production path; an exclusion match is equally non-negotiable — never floor test or generated code.

```text
✗ Wrong — floors a destructive statement on a test path
  path: db/tests/reset.test.ts  shape: TRUNCATE users  → high
✓ Right — the exclusion gate runs first
  path: db/tests/reset.test.ts  shape: TRUNCATE users  → low (excluded, Step 1 base)
```

## Mapping to a reviewer's blocking flag

The tier feeds the reviewer's `(blocking)` decoration; it does not replace it, and it is orthogonal to the `issue` / `suggestion` / `nitpick` category ([`rubric-composition.md`](./rubric-composition.md) § Severity mapping).

| Tier         | Reviewer treatment                                                                 |
| ------------ | --------------------------------------------------------------------------------- |
| **critical** | `(blocking)` — cap-exempt, always inline.                                          |
| **high**     | `(blocking)` — cap-exempt, always inline.                                          |
| **medium**   | Non-blocking, material — inline subject to the caps, else deferred.                 |
| **low**      | Non-blocking, cosmetic / nice-to-have — materiality gate and relevance memory may suppress. |

**A floor-only tier is not blocking.**
If a finding is `high` or `critical` **only** because the Step 2 path floor raised it (its Step 1 base tier was `medium` / `low`), do not mark it `(blocking)`.
The floor lowers the confidence bar so the finding surfaces on a sensitive path; `(blocking)` follows the base-tier impact (broken behaviour, security, data loss, misimplemented intent).

## How callers consume the tier

- **A reviewer** gates each finding on a severity-aware confidence bar: `medium` anchors the profile's bar, `critical` / `high` get a lower bar, `low` a higher one.
  The numbers live in [`review-config.md`](./review-config.md).
  `scripts/record-comment-relevance.mjs` reads the tier from the label into the relevance record's `severity` field, so per-tier precision is measurable.
- **`fix-bug`** orders triage by tier.
- **`ci-auto-fix`** escalates a `critical` / `high` regression and defers a `low` one.

The rubric is regression-tested by the `severity-tiering` L2 suite (`scripts/eval/golden/severity-tiering.jsonl`).
When a floor or escalator changes, add a golden case so the change is locked.
