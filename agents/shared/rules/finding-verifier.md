---
title: Finding verifier — the adversary of the finders
impact: HIGH
tags:
  - pr-reviewer
  - verification
  - confidence
---

# Finding verifier

Generation and verification were the same model, in the same context, in the same turn.
A generator asked to grade its own output grades the reasoning it just produced, and it agrees with itself.
That is the single largest source of low-quality findings in a review pipeline, and no amount of filter stacking downstream fixes it, because every filter is reading the same self-assessment.

Phase E is one pass over all candidates, framed as the **adversary** of the finders.

Its stance is not "is this plausible".
It is **"prove this wrong"**.

## Contents

- [What the verifier sees, and what it must not](#what-the-verifier-sees-and-what-it-must-not)
- [Step 1 — re-derive from the code](#step-1--re-derive-from-the-code)
- [Step 2 — execute the receipt](#step-2--execute-the-receipt)
- [Step 3 — the four-way verdict](#step-3--the-four-way-verdict)
- [Step 4 — score the finding, not the code](#step-4--score-the-finding-not-the-code)
- [Severity is a separate axis](#severity-is-a-separate-axis)
- [Where suppression applies](#where-suppression-applies)
- [Sub-agent isolation when available](#sub-agent-isolation-when-available)
- [Logging](#logging)

---

## What the verifier sees, and what it must not

| Sees | Never sees |
| --- | --- |
| the candidate record ([`finders.md`](../../pr-reviewer/rules/finders.md)) | the finder's reasoning or chain of thought |
| `$WORKDIR` — the code on disk | the finder's other candidates |
| `impact.json` | how many candidates were produced |
| the candidate's `verify_by` | the finder's confidence in itself |
| knowledge records for the touched symbol | |

The exclusion column is the mechanism, not an accident.
A structured record — claim, bad outcome, evidence paths, anchor — is a **falsifiable assertion**.
The reasoning that produced it is a persuasive narrative, and reading it is how a verifier ends up agreeing.

## Step 1 — re-derive from the code

Read the anchored lines and every path in `evidence[]`.
Then actively hunt for what would make the claim false:

| Look for | Because |
| --- | --- |
| a guard — a `try/catch`, a null check, an early return, a validation layer | the claimed bad outcome may be unreachable |
| a caller-side normalization or wrapper | the callee's change may be absorbed before it reaches the claimed consumer |
| a type that would have failed to compile | the claim may be impossible in a typed language |
| a covering test that already asserts the claimed-broken behavior | the behavior may be intentional and pinned |
| the same pattern elsewhere in the file, unchanged and working | the claim may be about a pre-existing convention, not this PR |

The last row is the attributability check, and it is where a large share of false positives die: the pattern is real, the code is arguably wrong, and **this PR did not do it**.

## Step 2 — execute the receipt

Cheapest first, the [`verify-behavior`](../../../skills/quality/verify-behavior/SKILL.md) ladder, through [`verification-receipt.md`](./verification-receipt.md):

| Tier | Means | Available when |
| --- | --- | --- |
| 1 — syntactic | `rg`, `ast-grep`, a read | always, given a workspace |
| 2 — semantic, no execution | `tsc --noEmit`, `go vet`, `cargo check`, `pyright` | the toolchain resolved, and install was allowed where types need it |
| 3 — execution | run the covering test | **self relation only** by default; cross relation requires the sandbox opt-in |

A behavioral `issue:` on a risky shape needs a Tier-2 receipt where one is obtainable.
`quick` tier findings get Tier 1.

**A null result is never a confirmation.** "I could not find a guard" is not "there is no guard"; it is `ambiguous`, and it scores as such.

## Step 3 — the four-way verdict

| Verdict | Meaning | Consequence |
| --- | --- | --- |
| `confirmed` | the bad outcome is reachable and the receipt supports it | score it |
| `contradicted` | a guard, a type, or a test makes the claim false | **drop**, and log the contradicting evidence |
| `ambiguous` | the receipt was inconclusive and the code does not settle it | score it, with the Reproducible dimension capped |
| `unobtainable` | the check could not run at all — upstream unreachable, no toolchain, no workspace, binary file | **not a drop**, see below |

`unobtainable` is the verdict that changed.
Previously an unverifiable claim was dropped, which meant the highest-value findings — the ones whose truth lives upstream, in a changelog or in a service this repo calls — were the ones most likely to vanish.

An `unobtainable` finding is **re-framed as the in-repo conditional it actually is**, decorated `(unverified: <reason>)`, and listed in the report's withheld section when it cannot be anchored:

```markdown
suggestion: `internal-sdk` 3 → 4 is a major bump whose release notes were not reachable
from this runner. The 4 usage sites are … — worth confirming before merge.
(unverified: upstream unreachable)
```

It is never an `issue`, because nothing was verified.
Logging the `contradicted` evidence matters for a second reason: it is exactly what a seeded-defect eval needs to diagnose a false negative. A dropped finding with no recorded reason is indistinguishable from a finding never generated.

## Step 4 — score the finding, not the code

The old gate called `Skill("confidence", "code")`, which asks whether a **code change** is sound.
A finding is not a code change, and the mismatch showed: a finding about correct-looking code scored high on "is this code good" grounds that had nothing to do with whether the finding was right.

The verifier returns a finding-specific score:

| Dimension | Weight | Question |
| --- | --- | --- |
| **Reproducible** | 40 % | Can the bad outcome be reached from the code as written, with concrete inputs or a concrete caller? |
| **Attributable** | 30 % | Is it introduced or exposed by **this PR** — not pre-existing, not already guarded? |
| **Actionable** | 30 % | Would the author know what to change from the comment alone? |

```text
Final = 0.4 × Reproducible + 0.3 × Attributable + 0.3 × Actionable
```

Scoring guidance per dimension:

- **Reproducible** — a named caller and a named input is full marks. "Under some conditions" is half. An `ambiguous` verdict caps this dimension at 60.
- **Attributable** — introduced by a line in the diff is full marks. Exposed by the diff (the diff makes reachable something that was latent) is high. A pre-existing pattern the diff merely touched is near zero, and near zero here should drop the finding on weight alone.
- **Actionable** — a concrete fix in the candidate is full marks. "Consider reviewing this" is near zero regardless of how right it is.

The threshold, the severity-aware fan-out, the near-miss defer band, and the path-instruction injection are **unchanged** and stay owned by [`per-comment-confidence.md`](./per-comment-confidence.md).
Only the score's **source** moves: from `Skill("confidence", "code")` on the code, to this rubric on the finding.

## Severity is a separate axis

Score and severity answer different questions and are never merged.

- **This rubric**: is the finding real? (`confidence`)
- **`Skill("severity", "finding")`**: how bad if it is? (`critical` / `high` / `medium` / `low`)

Both run in the same pass. The severity-tiered thresholds and the `(blocking)` crosswalk are unchanged.

A high-severity finding with a low confidence score is **still dropped or deferred**. Severity does not rescue a finding that is probably wrong — that is how a reviewer earns a reputation for scary noise.

## Where suppression applies

The relevance memory's `suppress` direction is applied **here, after this verdict** — never at find time.

| | Suppressed before verification | Suppressed after verification |
| --- | --- | --- |
| What was dropped | a candidate nobody looked at | a verified finding the repo has repeatedly declined |
| What that is | possibly a real defect | a maintainer preference |

Two exemptions, from [`memory.md`](../../pr-reviewer/rules/memory.md): a `standards` finding is never suppressible, and a `(blocking)` finding always posts with the rule match surfaced as context instead of applied.

## Sub-agent isolation when available

Where the harness dispatches `pr-reviewer` with `Task` in its grant, the verifier **may** run as a separate sub-agent, which gives true context isolation rather than a framing convention.

Both shapes are permitted, and the in-agent shape is not a degraded mode: the isolation that matters is **not seeing the finder's reasoning**, and that is achieved by passing only the candidate record. A sub-agent enforces it structurally; in-agent it is a rule the pass follows.

State which shape ran, in the report's run-mode line. A claim of independent verification should be checkable.

## Logging

Per candidate, log one line:

```text
[verify] consumer-impact:contract-break:retryRequest@src/jobs/sync.ts
         verdict=confirmed tier=2 (tsc) R=90 A=85 Ac=100 → 91  severity=high
[verify] correctness:nil-deref:-@src/config/load.ts
         verdict=contradicted (guard at load.ts:41 returns early on null) → dropped
```

The `contradicted` line's parenthetical is not optional.
A drop with no stated contradiction cannot be audited, cannot be turned into an eval case, and is indistinguishable from a finder that never fired.
