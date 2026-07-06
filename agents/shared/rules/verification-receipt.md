---
title: Verification receipt — behavioral claims need executed proof
impact: HIGH
tags:
  - reviewer
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

> **Future work:** Once generation-aggression tuning (prompt reframing) is in place, the threshold on what triggers a receipt check can be relaxed for lower-severity findings.
> The receipt gate is the *shippable static* version of code-execution verification — similar in spirit to CodeRabbit's generate-then-judge grounding, which runs sandbox execution to verify behavioral claims.
> Bugbot does not do this today; execution verification is on their roadmap.
> This rule gives both agents the static analogue without requiring a runtime sandbox.

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

> **Hard rule: a null or empty proof result DROPS the finding.**
> It is never interpreted as "confirmed bug."
> The grounding step (2.6) already confirmed the symbol exists; if a behavioral claim about that symbol returns no evidence, the claim is unverified noise.

---

## Receipt format

Attach the receipt to the finding as an internal annotation (not emitted to GitHub):

```
[receipt] grep -n 'return null' src/auth.ts → line 47: return null; (confirms claim)
[receipt] grep -n 'if (!user)' src/auth.ts → (no output) → DROP: missing-guard claim unverified
```

Receipts are consumed by Step 2.7 as part of the `Evidence` input to `Skill("confidence", "code")`:

```
Evidence: <patch hunk> + receipt: <raw tool output>
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
- **Behavioral claims that are correct but whose proof requires runtime execution.**
  Static grep cannot run the program.
  Findings in this class survive with a partial receipt; the confidence step (2.7) adjusts the score accordingly.
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
  → comment-shape.md      (≤ 240 chars, shape?)    [2.8]
  → conventional-comments.md (prefix + decoration) [2.9]
  → (PR Mode only) line-validity.md               [3.5]
```
