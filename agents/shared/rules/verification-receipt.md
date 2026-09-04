---
title: Verification receipt — behavioral claims need executed proof
impact: HIGH
tags:
  - pr-reviewer
  - grounding
  - false-positive-control
  - verification
---

# Verification receipt

`finding-grounding.md` (Step 2.6) proves a symbol *exists* in the changed file.
That is a necessary but insufficient guard: a comment that correctly names `validateAuth` but wrongly claims "returns `null` on failure when the code shows it throws" still passes grounding.
Verification receipts close that gap by requiring an *executed proof* for every finding that makes a behavioral claim.

This step sits at **Step 2.6b** — after `finding-grounding.md` (2.6, existence) and before `per-comment-confidence.md` (2.7).
Findings that survive produce a receipt that feeds directly into the `confidence(code)` Evidence input at 2.7, making that gate sharper.

## Contents

- [Tier delegation to `verify-behavior`](#tier-delegation-to-verify-behavior)
- [What is a behavioral claim?](#what-is-a-behavioral-claim)
- [The check](#the-check)
- [Receipt format](#receipt-format)
- [Logging](#logging)
- [What this check does not catch](#what-this-check-does-not-catch)
- [Order in the pipeline](#order-in-the-pipeline)

---

## Tier delegation to `verify-behavior`

Tier 1 (the static proof tools below — `grep`, `ast-grep`, `Read`) stays **inline in this rule**.
Tier 2 (semantic-no-execution — `tsc --noEmit`, `go vet`, `cargo check`, `pyright`) and Tier 3 (execution — run the covering test, or a minimal synthesized repro) **delegate to `Skill("verify-behavior", "claim")`**, which owns the cheapest-first ladder and the isolated-execution safety model those tiers need:

```text
Skill("verify-behavior", "claim")
  claim: <the behavioral assertion from the finding>
  target: <file(s) / symbol the claim concerns>
  review_relation: "self" | "cross"
  caller: "pr-reviewer"
```

The skill returns a receipt whose final line reads `[receipt] verdict: <confirms|contradicts|ambiguous|null|unobtainable>` — the same shape this rule already produces at Tier 1 — see [`skills/quality/verify-behavior/rules/receipt.md`](../../../skills/quality/verify-behavior/rules/receipt.md) for the full contract. That receipt is consumed by Step 2.7 exactly like a Tier 1 receipt; the 2.6 → 2.6b → 2.7 pipeline order does not change, and the null-drop invariant below applies identically regardless of which tier produced the receipt.

**When `verify-behavior` is unavailable:** log `verify-behavior — not available, continuing` and degrade to today's static-only behavior — Tier 1 proof tools decide what they can, and a claim that needs Tier 2/3 to decide survives with only a partial (Tier 1) receipt, exactly as before this rule delegated. Do not block the review on a missing skill.

> **Future work:** Once generation-aggression tuning (prompt reframing) is in place, the threshold on what triggers a receipt check can be relaxed for lower-severity findings.
> The receipt gate is the *shippable static* version of code-execution verification — similar in spirit to CodeRabbit's generate-then-judge grounding, which runs sandbox execution to verify behavioral claims.
> Bugbot does not do this today; execution verification is on their roadmap.
> `verify-behavior`'s Tier 2/3 delegation is exactly that upgrade, wired through this rule the same way `holistic-analysis` is wired through `holistic-review.md`.

---

## What is a behavioral claim?

A finding makes a behavioral claim when its prose asserts something about **runtime behavior**, **data flow**, **control flow**, or **contract**:

| Claim type | Examples |
| --- | --- |
| Return value / absence | "`foo` returns `null` on error" |
| Thrown / rejected error | "`validateAuth` throws on invalid token" |
| Side effect | "this mutates `cache` before the guard runs" |
| Ordering | "the abort check fires after the `await`" |
| Missing guard | "no null check before `user.id` is accessed" |
| Condition reachability | "`else` branch is unreachable here" |

A finding that is a **pure style or naming nit** (e.g. "`ids` reads clearer as `userIds`", "prefer `const` over `let`") is **exempt** — proceed directly to 2.7.

---

## The check

For every non-exempt finding, before Step 2.7:

1. Identify the behavioral claim in the comment body.
2. Execute one or more of the proof tools listed below against the changed file or the repo.
3. Capture the raw output.
4. Evaluate: does the output support the claim?

### Proof tools

Use the cheapest tool that can verify the claim.
In order of preference:

| Tool | When to use | Example |
| --- | --- | --- |
| `grep -n` / `grep -c` | Control flow, guard presence, symbol absence | `grep -n 'return null' src/auth.ts` |
| `grep -A 5` / `grep -B 3` | Context around a pattern | `grep -A 5 'validateAuth' src/auth.ts` |
| `ast-grep` (if installed) | AST-level claims (function return type, parameter count) | `ast-grep --pattern 'function $F($_): null { $$$ }' src/auth.ts` |
| `Read` (file read) | Ordering or sequencing claims across a function body | Read the full function body, confirm the order |
| `gh api .../pulls/{n}/files` (already cached) | Claims about what lines were changed | Read `/tmp/pr-files.json` entries for the file |

Commands are run with `Bash`.
Store the raw output as the receipt.

### Proof evaluation

| Output | Decision |
| --- | --- |
| Output **confirms** the claim (pattern found where claimed, absent where claimed absent) | Finding **survives** with receipt attached |
| Output is **ambiguous** (pattern present but in a different code path) | Downgrade the finding to a `question:` and attach receipt |
| Output is **null / empty** and the claim asserts presence | **DROP** the finding as unverified — a null result is NOT confirmation |
| Output **contradicts** the claim | **DROP** the finding — the model was wrong |
| The check **could not run at all** | `unobtainable` — **re-frame, do not drop.** See below. |

> **Hard rule: a null or empty proof result DROPS the finding.**
> It is never interpreted as "confirmed bug."
> The grounding step (2.6) already confirmed the symbol exists; if a behavioral claim about that symbol returns no evidence, the claim is unverified noise.

### `unobtainable` is not `null`

The two look alike and mean opposite things.

| Verdict | The check | The claim |
| --- | --- | --- |
| `null` | **ran**, and found no evidence for the claim | unsupported ⇒ drop |
| `unobtainable` | **could not run** | untested ⇒ re-frame |

`unobtainable` is the honest verdict when the proof was never available: the upstream changelog is
unreachable, no type-checker resolved for this language, `workspace.install` is off and the receipt
needed resolved types, the target is a binary or generated file, or `DEPTH_CAPABILITY = diff-only`
and the claim is about a file the run never had.

Collapsing it into `null` is what made the pipeline **systematically drop its highest-value
findings**. The claims whose truth lives outside the repo — a breaking change in a dependency, a
contract in a service this code calls — are exactly the ones no in-repo grep can confirm, so a rule
that drops on "no proof" drops precisely those and keeps the ones a grep happens to reach.

An `unobtainable` finding is therefore:

1. **Re-framed as the in-repo conditional it actually is** — what the code does, plus what would
   have to be true elsewhere for it to be a defect.
2. **Decorated `(unverified: <reason>)`**, with the reason naming which rung was unavailable.
3. **Capped at `suggestion:` or `question:`** — never `issue:`, never `(blocking)`. Nothing was
   verified, so nothing is asserted.
4. **Listed in the report's withheld section** when it has no valid anchor.

```text
[receipt] tier: 2 | tool: none | target: node_modules/internal-sdk
[receipt] command: (registry, GitHub releases, changelog, clone — all failed)
[receipt] verdict: unobtainable — upstream release notes unreachable; RE-FRAME, do not drop
```

```markdown
suggestion: `internal-sdk` 3.1.0 → 4.0.0 is a major bump whose release notes were not
reachable from this runner. The 4 usage sites are `src/auth/session.ts:22`, `…:41`,
`src/api/mw.ts:9`, `src/api/mw.ts:57`. (unverified: upstream unreachable)
```

**Never reach `unobtainable` without trying.** It is a verdict about the *tooling*, established by
exhausting the ladder, not a shortcut past a check that was merely inconvenient. A receipt claiming
`unobtainable` names the rungs it attempted, as the example above does.

---

## Receipt format

Attach the receipt to the finding as an internal annotation (not emitted to GitHub):

```
[receipt] tier: 1 | tool: grep | target: src/auth.ts
[receipt] command: grep -n 'return null' src/auth.ts
[receipt] output: line 47: return null;
[receipt] verdict: confirms

[receipt] tier: 1 | tool: grep | target: src/auth.ts
[receipt] command: grep -n 'if (!user)' src/auth.ts
[receipt] output: (no output)
[receipt] verdict: null — missing-guard claim unverified; DROP
```

Receipts are consumed by Step 2.7 as part of the `Evidence` input to `Skill("confidence", "code")`:

```
Evidence: <patch hunk> + receipt: <raw tool output> + verdict: <confirms|contradicts|ambiguous|null|unobtainable>
```

This makes the confidence score sharper — the skill is scoring a claim + its own proof, not a claim alone.

---

## Logging

The Quality Gate summary in the terminal output reports a dedicated line:

```
Receipt drops:    N  (behavioral claims with null/contradicting proof)
Receipt downgrades: M (ambiguous proof → downgraded to question:)
```

A run with `Receipt drops: 0` does not mean all claims were proven — it may mean most findings were pure style nits (exempt).
A run with `Receipt drops: 5` out of 8 behavioral claims is healthy — those five were hallucinated behavioral assertions the static grep could not support.

---

## What this check does not catch

- **Style or naming nits** — exempt by design.
  These do not need behavioral proof; they need only grounding (2.6) and confidence (2.7).
- **Behavioral claims whose proof requires runtime execution.**
  These now delegate to `Skill("verify-behavior", "claim")` Tier 2/3 (see § Tier delegation above) rather than surviving on a static-only partial receipt.
  When the skill is unavailable, or Tier 3 is withheld by the relation-keyed trust split (cross-review does not default-on Tier 3), the finding survives with a partial (Tier 1/2) receipt and the confidence step (2.7) adjusts the score accordingly.
- **Claims about deleted lines** (`-`-prefix in the diff).
  Deleted code is not in the changed file; receipts only apply to claims about the post-diff state.
- **Claims about files not in the diff.**
  Those are system-fit claims handled by `holistic-review.md` (Step 2.4 / 2.4b), not this rule.

---

## Order in the pipeline

```
review pass
  → rubric-composition.md (dedupe + cap)          [2.5]
  → finding-grounding.md  (symbol exists?)         [2.6]
  → verification-receipt.md (claim proven?)        [2.6b]  ← this rule
  → per-comment-confidence (confidence ≥ 80?)      [2.7]
  → comment-shape.md      (render-comment.mjs?)    [2.8]
  → conventional-comments.md (prefix + decoration) [2.9]
  → (PR Mode only) line-validity.md               [3.5]
```
