---
title: Failure Verdicts
impact: HIGH
tags:
  - tests
  - classification
  - guardrails
---

# Failure Verdicts

Every failure gets exactly one verdict before any fix is drafted.
The verdict binds behavior — `prod-bug` and `unsure` escalate; `test-bug` continues to the confidence gate.

Do not skip this step.
Do not leave the verdict implicit.
Record it in the plan artifact (see [`../templates/plan-artifact.md`](../templates/plan-artifact.md)).

## Decision table

| Verdict | What it means | Action |
| --- | --- | --- |
| `test-bug` | Production code is correct; the test drifted (renamed selector, stale snapshot, changed copy, updated API signature, new required arg, schema change) | Continue to the confidence gate ([`confidence-gate.md`](./confidence-gate.md)) |
| `prod-bug` | Production code regressed; the test caught it correctly. The test is doing its job | **Escalate.** Do not touch the test. Propose a production-code fix and stop. |
| `unsure` | Diagnostic confidence < 80%, or the failure could plausibly be in more than one bucket | **Escalate.** Surface what you saw and what you couldn't decide between. Stop. |

## Per-verdict notes

### `test-bug`

Read both the test file and the production module it exercises before proposing a fix.
Never propose a test change from the error message alone.

Sub-classify the failure shape before fixing:

- **Snapshot drift** — a snapshot was rendered with outdated fixtures or a copy change updated the UI.
  Only update the snapshot after visually confirming the new output is correct.
  Never update a snapshot you have not reviewed.
- **Selector drift** — a `getByRole`, `getByText`, `getByLabelText`, or `testID` no longer matches because
  the component's copy, role, or accessibility attribute changed.
- **Type / signature drift** — the production function renamed an argument or changed its return shape;
  the test is still using the old call signature.
- **Timing issue** — an async operation completes after the assertion runs; add `findBy*` / `waitFor`
  instead of `.only` or a sleep.
- **Import/module drift** — a renamed export or moved file causes the test to import a stale reference.
- **Mock stub mismatch** — an external dependency mock returns a shape that no longer matches what
  production sends; update the mock, not the assertion.

A `test-bug` fix may only touch the test file (and its direct test fixtures).
If fixing the test requires editing production code, stop and re-classify as `prod-bug` or `unsure`.

### `prod-bug`

Escalate.
Do not auto-apply a production-code fix from this skill — the user must approve before any production edit.

Report:
1. Which test failed and what the test asserts.
2. What the production code currently does.
3. The one-line discrepancy between them.
4. A proposed production-code fix (for the user to review, not auto-applied).

The test is the specification. Do not weaken the test to match incorrect production behavior.

### `unsure`

Escalate with three things:
1. The failure message and the two (or more) verdicts that fit.
2. The section of the test and production code you cannot resolve.
3. The evidence you would need to decide (e.g., recent commit that changed the contract, missing type annotation, undocumented side effect).

Asking once is cheaper than a wrong fix that corrupts the test suite.
