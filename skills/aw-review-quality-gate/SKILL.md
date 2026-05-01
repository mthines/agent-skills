---
name: aw-review-quality-gate
description: >
  Self-check quality gate for review findings.
  Validates that each finding is actionable, evidence-backed, correctly located,
  not duplicating linter output, and not a false positive.
  Use after generating findings but before delivering them.
  Triggers on: "quality gate findings", "validate findings", "gate my review",
  "/aw-review-quality-gate".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
---

# Review Quality Gate

Run this gate on every finding you have generated, **before** formatting output or delivering results.
The gate catches false positives, noise, and miscalibrated severity — the most common failure modes of single-pass review.

---

## When to Use

- After the reviewer agent generates findings (Step 2.5).
- After DX or UX review skills produce their finding lists.
- Any time a skill produces actionable recommendations that a human will read.

---

## Gate Checklist

For **each finding**, answer every question.
Be honest — a dropped false positive is worth more than a delivered one.

| # | Question | Fail means |
|---|----------|------------|
| 1 | **Is it actionable?** The author can do something concrete. No "consider", "might want to", or "could be improved" without a specific fix. | Finding is vague noise |
| 2 | **Did I read the surrounding code?** Not just the diff hunk — the full function, the caller, the guard clause three lines up. | Finding may be wrong |
| 3 | **Is severity calibrated?** A style nit is never "required." A SQL injection is never "suggestion." Re-check the severity assignment against the actual impact. | Severity is misleading |
| 4 | **Are file path and line number accurate?** Verify the cited location against actual file content. A finding pointing to the wrong line is worse than no finding. | Finding is unlocatable |
| 5 | **Does this duplicate linter/formatter/type-checker output?** If the project's toolchain would catch this automatically, do not flag it. Focus on semantic issues the toolchain cannot see. | Finding is redundant |
| 6 | **Is this actually true?** Re-read the function in full context. Check: is the "bug" handled elsewhere? Is the "unused import" used in a type annotation? Is the "missing null check" guarded by the caller? Is the "race condition" prevented by a lock you didn't notice? | Finding is a false positive |

---

## Gate Rules

| Check failures | Action |
|----------------|--------|
| **2 or more** | **Drop the finding entirely.** It is not worth the reader's time. |
| **Exactly 1** | **Downgrade severity by one level** (required → suggestion, suggestion → nitpick). Note which check failed. |
| **0** | Finding passes. Deliver as-is. |

When downgrading, append a brief note so the reader knows why:
> _(Downgraded: severity recalibrated — style concern, not a correctness issue.)_

---

## Output

After running the gate on all findings, emit a brief summary before the findings themselves:

```
### Quality Gate
- Findings reviewed: N
- Dropped: N (reason per drop)
- Downgraded: N
- Passed: N
```

List each dropped finding with a one-line reason so the reviewer can audit the gate:

```
- Dropped: "Missing error handling in fetchUser" — false positive, error is caught by caller middleware (check 6)
- Dropped: "Unused variable `config`" — linter would catch this (check 5) + not actionable without context (check 1)
```

---

## Anti-Patterns

- Do NOT skip the gate because "all findings look fine." Run it mechanically on every finding.
- Do NOT pass findings that say "consider" or "might want to" without a concrete fix. Rewrite them or drop them.
- Do NOT inflate the passed count by being lenient. The gate's value comes from its strictness.
- Do NOT run the gate on pre-existing issues. Those are informational and bypass the gate entirely.
