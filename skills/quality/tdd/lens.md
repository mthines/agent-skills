---
for: pr-reviewer
lens-version: 1
applies-to: "**/*.test.*, **/*.spec.*, **/__tests__/**, **/test/**, **/tests/**, **/*_test.go, **/test_*.py"
auto: true
---

# Tests that test behaviour — Review Lens

## Trigger

Fires when the diff adds or changes a test file.
The `quality` checklist asks whether tests exist; this lens asks whether they would catch a regression, and whether they would survive a change that keeps the behaviour.

A test earns its place by doing both:

- it **fails** when the behaviour breaks;
- it **passes** when the code changes and the behaviour does not.

A test that fails on a valid refactor teaches the author to update tests until they pass, which is how regressions get through.

## Checklist

### Does it exercise the code? (`test-tautology`)

- [ ] **Imports the code under test:** the test imports the production module it claims to test and re-declares none of its exports; a copied function passes by construction.
- [ ] **Asserts something the code produced:** no assertion that only checks the value a mock or fixture was set up to return.
- [ ] **Expected values are literals, not re-derivations:** the expected value is written out or comes from an independent source, never computed with the same formula as the production code.
- [ ] **Tests this repo's code, not the framework:** no test whose only subject is a library or the language (React renders a prop, zod rejects a wrong type, `Array.map` maps, a getter returns its field).
- [ ] **Asserts the outcome:** every test checks a value, a rendered result, or a side effect; a test whose only assertion is "did not throw", `toBeDefined()`, or a snapshot of a whole object is flagged.

```typescript
// ✗ tautology — the mock's return value is the assertion
repo.findUser.mockResolvedValue({ id: "u1", name: "Ada" });
expect(await service.getUser("u1")).toEqual({ id: "u1", name: "Ada" });

// ✗ re-derivation — breaks in step with the code, so it never catches a wrong formula
expect(priceWithTax(100)).toBe(100 * (1 + TAX_RATE));

// ✓ the code's own work, against a literal
repo.findUser.mockResolvedValue({ id: "u1", first: "Ada", last: "Lovelace" });
expect((await service.getUser("u1")).displayName).toBe("Ada Lovelace");
expect(priceWithTax(100)).toBe(125);
```

### Does it survive a valid change? (`test-brittle`)

- [ ] **Public behaviour only:** assertions go through the exported API or the rendered output, never a private method, an internal field, a component's state, or a CSS class.
- [ ] **No interaction assertions on internals:** no assertion on call order, call count, or the arguments of the module's own collaborators, unless that call is the behaviour (a payment sent, an event emitted, a request made to an external service).
- [ ] **Mocks only at the boundary:** network, clock, filesystem, randomness, and third-party services are faked; the module's own helpers and sibling modules are not.
- [ ] **No over-specified matching:** exact error message text, full-object `toEqual` where two fields matter, and exact log lines are flagged unless that text is the contract (a user-facing message, a public error code).

```typescript
// ✗ brittle — inlining formatRow into render keeps the table identical and fails this test
expect(formatRow).toHaveBeenCalledTimes(3);

// ✓ asserts what the user sees
expect(screen.getAllByRole("row")).toHaveLength(3);
```

### Is it pulling its weight? (`test-redundant`, `test-gap`)

- [ ] **No near-duplicates:** two tests that take the same path with different literals, and could not fail independently, are one test (or one table-driven test).
- [ ] **Covers the new branch:** each new `if`, `catch`, or early return in the changed production code has a test that takes it. Missing → `test-gap`.
- [ ] **Effort matches risk:** many tests on trivial code while a new error branch or edge case in the same diff has none is flagged on the uncovered branch, citing the trivial tests as the effort spent instead.
- [ ] **Names the behaviour:** the test name states the outcome (`refund of an unpaid invoice is rejected`), not the method (`test refundInvoice`).

## Every finding names its breaking change

A brittleness or tautology finding without a concrete scenario cannot be verified, so the verifier will drop it.
Write `bad_outcome` as one of these sentences, naming real code:

| Class | `bad_outcome` must state | `verify_by` |
| --- | --- | --- |
| `test-brittle` | A behaviour-preserving change to the production code that makes this test fail: "inlining `formatRow` into `render` (same rendered rows) fails `table.test.tsx:42`." | Name the edit and the test to run after it. |
| `test-tautology` | A behaviour-breaking change the test does not catch: "making `getUser` return the repo row unchanged still passes `user.test.ts:18`." | Stub or break the function and run the test (the [`provenance`](./rules/test-provenance.md) mutation check). |
| `test-redundant` | The tests that fail and pass together: "`cart.test.ts:30` and `:41` take the same branch; no change fails one without the other." | Point at the shared branch. |
| `test-gap` | The branch with no test: "the new `catch` at `refund.ts:77` is taken by no test." | Name the branch. |

```text
✓ "test-brittle: renaming the private `#cache` field (no behaviour change) fails store.test.ts:55, which reads it through `as any`."
✗ "This test is coupled to the implementation."   # no change named; cannot be verified
```

## One rollup per file, not one per test

When **3 or more** tests in one file get findings of the same class, raise **one** finding on the file's first flagged test.
List the other line numbers in `evidence`, and state the share (`7 of 9 tests assert on mock calls`).
This replaces the per-test findings for that class in that file.

## Severity hints

- **Must-fix**: a test that re-declares the code it tests; a new error branch with no test; a file rollup where more than half the tests are `test-tautology`, since that file gives false confidence.
- **Should-fix**: a `test-brittle` finding with a named breaking change; a `test-tautology` finding on a single test; mocking the module's own helpers.
- **Nice-to-have**: `test-redundant`; a whole-object snapshot where two fields matter; a method-named test.

A lens finding cannot block on its own; these hints set the comment's category, not the verdict.
