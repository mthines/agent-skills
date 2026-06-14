---
title: Anti-Patterns
impact: HIGH
tags:
  - tests
  - guardrails
  - anti-patterns
---

# Anti-Patterns

The shortcuts this skill exists to prevent.
Every one of these makes tests green at the cost of correctness.
They are rejected by contract, not by judgement.

If you find yourself reaching for any of these, the verdict in
[`verdicts.md`](./verdicts.md) was wrong or the confidence gate in
[`confidence-gate.md`](./confidence-gate.md) was bypassed.
Re-classify, do not justify.

## Hard refusals

| Anti-pattern | Why it is rejected |
| --- | --- |
| Deleting a `test(...)`, `it(...)`, `describe(...)`, `Deno.test(...)`, or named story export | Test deletion in disguise. Losing the assertion means the regression it guarded against can silently re-enter. |
| Adding `.skip`, `.only`, `xit`, `xdescribe`, `fit`, `fdescribe` | Same as deletion — hides the failure behind a keyword. A skipped test is a failing test that nobody sees. |
| Adding `it.todo(...)`, `test.todo(...)`, `Deno.test.ignore(...)` | Marks the test as pending without fixing it. The production code can regress without any signal. |
| Replacing strict matchers with loose ones (`toBe` → `toBeTruthy`, `toEqual` → `toMatchObject`, removing `expect.objectContaining(...)`) | Weakens the assertion's specificity. Passes with more inputs than the original author intended; hides shape regressions. |
| Deleting `expect(...)` or `assert*()` calls | Removes the assertion entirely. An empty test body always passes. |
| Wrapping the failing assertion in `try`/`catch` to swallow it | The test reports green while the assertion silently fails inside the catch. |
| Mocking the System Under Test (the module being tested) instead of its dependencies | "Test by construction" — the test verifies the mock, not the code. The real module can be completely broken. |
| Replacing a specific expected value with `expect.anything()`, `any`, or `unknown` | Accepts any value; the assertion no longer validates the contract. |
| Updating a snapshot without visual review | A snapshot that captures wrong output and is accepted trains future reviewers to trust incorrect renders. |
| Patching production code to make a `test-bug` pass | Misclassification cover-up. If production code needs to change, re-classify as `prod-bug` and escalate. |
| Adding `console.error = () => {}` or suppressing error output to hide assertion noise | Masks the signal that indicates what is actually wrong. |
| Increasing timeouts or adding `sleep(N)` to fix a timing failure | Hides a race condition. Use `waitFor`, `findBy*`, or proper async coordination instead. |

## Detection patterns

Before any `Edit` or `Write` to a test file, scan the proposed new content
for these patterns and abort if any match:

```
\.skip\s*[\(\.]
\.only\s*[\(\.]
\bxit\s*\(
\bfit\s*\(
\bxdescribe\s*\(
\bfdescribe\s*\(
\bit\.todo\s*\(
\btest\.todo\s*\(
Deno\.test\.ignore\s*\(
```

Before any `Edit` or `Write` to a test file, compute:
`(new expect/assert count) - (old expect/assert count)`.
If negative, abort and re-diagnose.

## Soft refusals (require explicit user approval)

These are not hard-rejected, but cannot be applied silently:

- **Snapshot updates** — show the diff of old vs new snapshot; ask once for confirmation.
- **Updating a test fixture file** — the fixture's shape may be intentionally strict; surface the change and ask.
- **Adding a new test dependency** (test utility, mock library) — affects every test in the project; ask once.

## The shape of the trap

Every anti-pattern above shares the same shape:
*make the red go away without understanding why it was red.*

The verdict + confidence-gate pair exists to make that shape impossible to enter accidentally.
When the urge to take a shortcut appears, the urge is the signal — re-run [`verdicts.md`](./verdicts.md).
