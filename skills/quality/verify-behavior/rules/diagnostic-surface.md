---
title: verify-behavior — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - verify-behavior
  - meta
---

# verify-behavior — Diagnostic Surface

This file declares the contract `/create-skill diagnose verify-behavior` reads to parameterize the generic Diagnose Mode procedure for this skill.

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

## Source root

`skills/quality/verify-behavior/`

`git apply` runs from the repo root against files under this directory. The skill body is `SKILL.md`; rules live under `rules/`. Adapters that call this skill (`agents/shared/rules/verification-receipt.md`, `agents/bug-fix-verifier.md`, `agents/feature-pr-verifier.md`, `skills/workflow/autonomous-workflow/rules/phase-4-testing.md`) live outside this source root — changes there are a coordinated multi-file edit (D6 in `plan.md`), not part of a diagnose apply against this skill alone.

---

## Phase model

| Phase | Name | Rule / section | Gate |
| --- | --- | --- | --- |
| V1 | Toolchain discovery | [`toolchain-discovery.md`](./toolchain-discovery.md) | Discovery order resolved (`checks.yaml` → `argent-environment-inspector` pattern → manifest scripts); never a global assumption |
| V2 | Tier selection | [`ladder.md`](./ladder.md) | Cheapest tier that can decide the claim, per the per-language adapter table |
| V3 | Isolated execution | [`isolation-safety.md`](./isolation-safety.md) | Throwaway worktree (Tier 3 only); tracked files untouched; scratch deleted; relation-keyed trust split honored |
| V4 | Receipt | [`receipt.md`](./receipt.md) | Verdict token assigned (`confirms`/`contradicts`/`ambiguous`/`null`); null-is-never-confirmation invariant held |
| V5 | Report | [`SKILL.md § V5`](../SKILL.md), [`receipt.md`](./receipt.md) | Claim mode returns the receipt; change mode returns the receipt plus a green/red gate result against the caller's `expected` |

---

## Existing guards per phase

| Phase | Existing guards | Typical gaps |
| --- | --- | --- |
| V1 | Three-source discovery order; project-local-binary preference over a global `PATH` hit | A tool assumed present without checking the manifest; a global binary used when a project-pinned version exists |
| V2 | Cheapest-first walk; per-language adapter table maps claim type → tier | Escalating to Tier 3 for a claim Tier 1/2 could decide; a language outside the table skipping straight to Tier 3 instead of finding its Tier 2 equivalent |
| V3 | Throwaway worktree + `trap … EXIT` cleanup; no-network default; relation-keyed Tier 3 gate | Tier 3 run directly in the caller's working tree; scratch harness left behind; Tier 3 run on `cross`/`untrusted` code without an explicit sandbox opt-in |
| V4 | Four-token verdict; null-is-never-confirmation invariant | A null/empty Tier 3 or Tier 2 result read as confirming the claim; an `ambiguous` result silently promoted to `confirms` |
| V5 | Two consumer-shape framings (claim vs. change); execute-not-score boundary | This skill emitting a confidence score or an intent-grade instead of leaving that to the caller |

---

## Failure taxonomy

| ID | Class | Symptom | Primary phase |
| --- | --- | --- | --- |
| `F-tier3-ran-untrusted-code-in-cross` | Trust-split violation | Tier 3 executed against `cross`/`untrusted` code without an explicit sandbox opt-in | V3 |
| `F-null-execution-treated-as-confirmation` | Receipt failure (execution) | A null or non-reproducing Tier 3/Tier 2 result was interpreted as confirming the claim instead of dropping/contradicting it | V4 |
| `F-tier3-modified-tracked-files` | Isolation-safety violation | A Tier 3 run wrote to a file `git` already tracks on the caller's branch, instead of the throwaway worktree | V3 |
| `F-unnecessary-tier3-escalation` | Cheapest-first bypass | Tier 3 executed for a claim Tier 1 or Tier 2 could already decide | V2 |
| `F-toolchain-assumed-global` | Discovery bypass | A Tier 2/3 tool was invoked without checking it resolves in the project's own manifest/toolchain | V1 |
| `F-verdict-score-leaked` | Execute-not-score violation | This skill returned a confidence score or an intent-level pass/fail grade instead of a receipt | V5 |
| `F-scratch-left-behind` | Isolation-safety violation | A synthesized Tier 3 repro or scratch harness was not deleted after the receipt was captured | V3 |
| `F-novel` | Novel mode | Does not match any existing row | — |

The taxonomy is **append-only**. New classes are added after confidence-gated, user-approved diagnoses surface them; a row is never deleted.

---

## Hard invariants

- **Cheapest-first is non-negotiable.** V2 must stop at the first tier that decides the claim; escalating past a deciding tier is a guard failure (`F-unnecessary-tier3-escalation`).
- **Never assume a global install.** Every Tier 2/3 invocation resolves against the project's own manifest/toolchain first (`toolchain-discovery.md`); a bare global-`PATH` invocation without that check is a guard failure (`F-toolchain-assumed-global`).
- **Tier 3 isolation is not optional.** Throwaway worktree, no tracked-file mutation, scratch deletion, no network by default, never `curl | sh` — every one of the five constraints in `isolation-safety.md` holds on every Tier 3 run.
- **The trust split is a hard safety boundary.** Tier 3 on `cross`/`untrusted` code requires an explicit sandbox opt-in; there is no caller-side override that raises trust for a single run without that opt-in (`F-tier3-ran-untrusted-code-in-cross`).
- **Null is never confirmation.** A null, empty, or non-reproducing result at any tier drops or contradicts the finding; it is never read as proof the claim holds (`F-null-execution-treated-as-confirmation`).
- **This skill never scores.** It returns a receipt with a verdict token, never a confidence score and never a pass/fail grade against intent — `confidence(code)` and the calling agent's own grading own those decisions (`F-verdict-score-leaked`).

---

## Artifacts

| File pattern | Produced by | When |
| --- | --- | --- |
| `[receipt] …` block (returned to caller, not written to disk) | V4 | Every run, either mode |
| `[gate] expected: … observed: … result: …` block | V5 (change mode only) | Change-verification runs |
| Throwaway worktree + scratch repro (deleted before return) | V3 | Tier 3 runs only |

The skill produces no durable repo artifact of its own and writes nothing outside a throwaway worktree it deletes before returning.

---

## Validators

- `node scripts/eval/l1.mjs` — G28 asserts the adapter wiring (delegation call, position, invariant preservation) in the real shipped files.
- Manual: verify a claim a `grep` can decide; confirm Tier 2/3 are never invoked.
- Manual: verify a claim requiring a runtime return value; confirm Tier 3 runs in a throwaway worktree and the scratch repro is gone afterward.
- Manual: verify a claim in the `cross` relation with no sandbox opt-in; confirm Tier 3 is refused and only Tier 1/2 run.
- Manual: verify a claim asserting a missing guard against code where the guard exists under different wording; confirm the `null`/`grep`-miss result drops the finding rather than confirming "guard is missing."
