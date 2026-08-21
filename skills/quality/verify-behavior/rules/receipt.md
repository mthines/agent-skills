---
title: verify-behavior — the receipt contract
impact: HIGH
tags:
  - verify-behavior
  - receipt
  - execute-not-score
---

# The receipt contract

Every run of this skill — any tier, either consumer shape — produces exactly one artifact: a **receipt**.
A receipt is evidence, not a verdict on intent.

## Receipt format

```text
[receipt] tier: 2 | tool: tsc --noEmit | target: src/auth.ts
[receipt] command: node_modules/.bin/tsc --noEmit src/auth.ts
[receipt] output: src/auth.ts(47,3): error TS2322: Type 'null' is not assignable to type 'string'.
[receipt] verdict: confirms
```

```text
[receipt] tier: 1 | tool: grep | target: src/auth.ts
[receipt] command: grep -n "if (!user)" src/auth.ts
[receipt] output: (no output)
[receipt] verdict: null — claim asserted a guard exists; none found; DROP
```

## The four verdict tokens

| Token | Meaning | Effect on the finding |
| --- | --- | --- |
| `confirms` | The output supports the claim (pattern found where claimed, absent where claimed absent, test fails-then-passes as expected) | Finding **survives** with the receipt attached as evidence |
| `contradicts` | The output actively disagrees with the claim (the opposite pattern is present, the test result is the reverse of what was claimed) | Finding is **DROPPED** — the claim was wrong |
| `ambiguous` | The pattern is present but in a different code path, or the tool signal is inconclusive on the exact assertion | Finding is **downgraded** (a caller in `pr-reviewer`'s pipeline downgrades to `question:`) with the receipt attached |
| `null` | The proof tool produced no output / an empty result, and the claim asserted presence of something | Finding is **DROPPED** as unverified |

## The null-is-never-confirmation invariant

**A null or empty proof result is never read as confirmation of the claim it was meant to verify.**

This is the single most important rule in this file.
A claim like "there is no null check before `user.id` is accessed" that produces no `grep` match for a null check is *not* proof the guard is missing — it might mean the guard uses different wording, or the file wasn't the right one, or the pattern was wrong.
The absence of contrary evidence is not presence of confirming evidence.

The same invariant holds at Tier 3: a synthesized repro that does not reproduce a claimed bug **DROPS or contradicts** the finding — it never counts as "the bug wasn't found, so the fix must have worked."
A Tier 2 build that does not flag a claimed type violation **DROPS** the finding for the same reason.
Silence is not proof.

This mirrors the invariant `verification-receipt.md` already enforces at Tier 1 for `pr-reviewer` — this skill's Tier 2/3 delegation must never weaken it.

## The two consumer-shape output framings

Both shapes share the receipt above; they differ only in what the caller does with it.

### Claim-verification (read-only)

Returns the receipt as-is.
The typical consumer is `Skill("confidence", "code")`'s `Evidence` input:

```text
Evidence: <patch hunk> + receipt: <raw tool output> + verdict: <confirms|contradicts|ambiguous|null>
```

This is the shape `agents/shared/rules/verification-receipt.md` (pr-reviewer Step 2.6b) delegates Tier 2/3 to.

### Change-verification (post-apply gate)

Returns the receipt **plus** a green/red verdict against a caller-supplied `expected` outcome:

```text
[receipt] ... (as above)
[gate] expected: "exit 0" | observed: "exit 0" | result: green
```

The caller keeps its own grading semantics on top of this result — `bug-fix-verifier`'s `FAIL_TO_PASS` still decides what a green/red result *means* for the PR; the `aw-executor` Phase 4 checks loop still compares against its own `expect:` field and still owns the `pass`/`fail`/`unsatisfiable` status.
This skill supplies the run-and-observe mechanic; it does not replace the caller's grading.

## The execute-not-score boundary (recap)

This skill's receipt is scoped strictly to **what happened when the command ran**.
It never:

- assigns a numeric confidence score,
- decides whether a finding is severe enough to post,
- grades whether the overall PR or fix is "good enough."

Those decisions belong to `confidence(code)`, to the calling agent's own verdict logic, or to the human reviewing the result. `confidence(code)` owns the number — always.

## What this rule does not do

- It does not decide which tier produced the receipt — see [`ladder.md`](./ladder.md).
- It does not decide whether Tier 3 was safe to run — see [`isolation-safety.md`](./isolation-safety.md).
- It does not decide toolchain resolution — see [`toolchain-discovery.md`](./toolchain-discovery.md).
