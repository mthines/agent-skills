---
for: pr-reviewer
lens-version: 1
applies-to: "**/*.test.*, **/*.spec.*, **/__tests__/**, **/test/**, **/tests/**, **/*_test.go, **/test_*.py"
auto: true
---

# Tests that test behaviour — Review Lens

## Trigger

Fires when the diff adds or changes a test file.
The `quality` checklist asks whether tests exist; this lens asks whether they would catch a regression.

## Checklist

- [ ] **Imports the code under test:** the test imports the production module it claims to test and re-declares none of its exports; a copied function passes by construction.
- [ ] **Public behaviour only:** assertions go through the exported API or the rendered output, never a private method, an internal field, or a component's state.
- [ ] **Survives a refactor:** no assertion on call order, call count, or the arguments of an internal collaborator, unless that call is the behaviour (a payment sent, an event emitted).
- [ ] **Mocks only at the boundary:** network, clock, filesystem, and third-party services are faked; the module's own helpers are not.
- [ ] **Asserts the outcome:** every test checks a value, a rendered result, or a side effect; a test whose only assertion is "did not throw" or a snapshot of a whole object is flagged.
- [ ] **Covers the new branch:** each new `if`, `catch`, or early return in the changed production code has a test that takes it.
- [ ] **Names the behaviour:** the test name states the outcome (`refund of an unpaid invoice is rejected`), not the method (`test refundInvoice`).

## Severity hints

- **Must-fix**: a test that re-declares the code it tests; a new error branch with no test.
- **Should-fix**: assertions on private state or internal call order; mocking the module's own helpers.
- **Nice-to-have**: a whole-object snapshot where two fields matter; a method-named test.
