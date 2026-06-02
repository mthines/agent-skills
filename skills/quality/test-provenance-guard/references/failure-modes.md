---
title: Failure Mode Taxonomy — Tests-by-Construction
impact: REFERENCE
tags:
  - failure-modes
  - taxonomy
  - tests-by-construction
---

# Failure Modes — Tests-by-Construction

A catalogue of patterns where the test is **structurally guaranteed** to pass — not because the production code is correct, but because the test verifies a re-statement of the expected behaviour.
Each entry includes detection cues and remediation.

## Contents

- [Taxonomy](#taxonomy)
- [Severity ranking](#severity-ranking)
- [Why these patterns exist](#why-these-patterns-exist)

## Taxonomy

### 1. Local Function Copy

The test file declares a function with the same name as the SUT export and asserts against the local copy.
This is the canonical case the skill was built for (PR #12340).

**Detection.**
Phase 1 static check; matches `shadowed-export`.

**Cues.**
- Test imports `vitest` / `jest` / etc but does NOT import from the sibling production file.
- Top-level `function` declaration whose name matches an export of the candidate SUT.
- Header comment hand-waves: `// Mirrors the X logic` / `// Pure version for testing`.

**Remediation.**
Self-heal extracts the inline production logic to an export, points the test at it.

### 2. Hand-Rewritten Helper

The test file does not literally copy the production code — it re-implements the same algorithm by hand.
Inputs are translated, outputs compared, but the logic was *re-derived* by the agent during the test write.

**Detection.**
Phase 1 may miss this when the helper is named differently (e.g. test-side `verifyOrgParam` vs production `preserveOrgParam`).
Phase 2 catches it because mutating the production function leaves the test green.

**Cues.**
- Test file has a non-trivial function (more than 5 lines of logic) that is only used inside `expect()`.
- The function's branches mirror the SUT's branches almost 1-to-1.

**Remediation.**
Same as #1 — extract a single source of truth.

### 3. Mock-Wholesale Substitution

The test mocks the SUT (e.g. with `vi.mock("./url")` or `jest.mock(...)`) and then asserts against the mock.
The "test" verifies that the mock returns what the test told it to return.

**Detection.**
Phase 1: scan for `vi.mock` / `jest.mock` / equivalent that targets the SUT's path.
Phase 2: the mutation has no effect because the mock replaces the export at runtime.

**Cues.**
- `vi.mock("./url")` or similar at top of test file targeting the SUT.
- Mock factory returns canned values that the assertions then compare against.

**Remediation.**
Remove the mock; let the real export run.
If the real export has external dependencies, mock *those* (HTTP, file system, time) — never the SUT itself.
This pattern is sometimes legitimate when the SUT is the boundary to an external system; in that case, surface the finding for human review.

### 4. Tautological Assertions

The test asserts that the SUT returns the constant the test passed in, with the SUT acting as identity.

```typescript
// SUT
export const echo = (x: T): T => x;

// Test
test("echo returns input", () => {
    expect(echo({ id: 1 })).toEqual({ id: 1 });
});
```

This is genuinely a tautology — the SUT cannot fail this assertion regardless of implementation, short of throwing.

**Detection.**
Heuristic only — not in the static or mutation check.
Consider this when reviewing.

**Cues.**
- The SUT under test is a pure pass-through.
- The assertion compares to a literal constructed inline in the test.

**Remediation.**
Either the function is genuinely trivial and the test is fine, or the test should be deleted as zero-signal.
Use the call site's actual usage to decide.

### 5. Snapshot-Lock-In

The test snapshots the current output and asserts equality.
Any change to the SUT produces a snapshot mismatch — but the snapshot was authored from the SUT's current output, not from a specification.

**Detection.**
Phase 1: scan for `toMatchSnapshot` / `toMatchInlineSnapshot`.
Phase 2: mutating the SUT changes the snapshot, so the test does fail — *but* the test passes regardless of the snapshot's correctness.

**Cues.**
- Snapshot files written without prior expected-value review.
- Snapshots updated mechanically with `--update-snapshots` whenever they break.

**Remediation.**
Out of scope for this skill — characterisation tests are sometimes the right call (see `tdd/rules/test-after.md` Step 4).
Surface as informational, do not auto-heal.

### 6. Missing Assertion

The test file calls the SUT but has no assertion (or only `expect(true).toBe(true)` / equivalent).

**Detection.**
Phase 1: scan for tests with no `expect` call.
Phase 2: mutating the SUT does not fail the test — there is no assertion to fail.

**Cues.**
- Test functions that only `await sut.run()` with no follow-up `expect`.
- Assertions that compare a constant to itself.

**Remediation.**
Surface as `missing-assertion` finding.
Do not auto-heal — the user must decide what behaviour matters.

## Severity ranking

For the autonomous-workflow's Phase 4 gate, treat findings in this order:

| Severity | Findings                                                        | Default action when `--fix` is on |
| -------- | --------------------------------------------------------------- | --------------------------------- |
| Blocking | `shadowed-export`, `test-survives-sabotage`                     | Self-heal.                        |
| Blocking | `mock-wholesale-substitution` *(when SUT is mocked entirely)*  | Report; do not auto-heal.         |
| Warn     | `no-sut-import`, `missing-assertion`                            | Report.                           |
| Info     | `tautological`, `snapshot-lock-in`                              | Report.                           |

Blocking findings prevent the autonomous loop from declaring Phase 4 done.
Warnings are noted in `plan.md` but do not block.
Info entries are surfaced in the report but not in the Progress Log.

## Why these patterns exist

LLMs writing test code often default to "verify the algorithm matches my mental model".
That mental model becomes a local copy of the function — not by malice, but because copying is the easiest way to demonstrate the expected behaviour without a real reference.

The static check defeats the literal copy.
The mutation check defeats the hand-rewrite.
Together they cover the patterns that account for the vast majority of by-construction findings observed in autonomous coding workflows.
