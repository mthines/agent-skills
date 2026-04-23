---
title: 'Test-After Mode — Add Tests for Existing Code'
impact: HIGH
tags:
  - tdd
  - test-after
  - coverage
---

# Test-After Mode

Write tests for code that already exists. Activated with `/tdd after`.

This mode is for adding coverage to untested code. It still follows disciplined testing principles but adapts the workflow since implementation already exists.

---

## Procedure

### 1. Read and Understand the Code

Before writing any tests:
- Read the entire module/file under test.
- Identify the **public interface** — exported functions, public methods, API endpoints.
- Map out the **behavior branches** — conditionals, error paths, edge cases.
- Note any **external dependencies** — what would need mocking.

### 2. Build a Behavior Inventory

List every observable behavior of the code:

```
## Behaviors for `createOrder()`
1. Creates order with valid items and returns order ID
2. Rejects empty item list with ValidationError
3. Calculates total including tax
4. Applies discount code when provided
5. Throws InsufficientInventoryError when item is out of stock
6. Persists order to database
```

Prioritize by business criticality (core flows first, edge cases second).

### 3. Write Tests One at a Time

For each behavior:

1. **Write ONE test** that describes the behavior
2. **Run it** — it should PASS (since the code exists)
3. **Mutate to verify** — temporarily break the implementation to confirm the test actually catches the failure. This is critical: a test that passes regardless of implementation is worthless.
4. **Restore** the implementation

If the test passes even after mutation, the test is not actually verifying the behavior — rewrite it.

### 4. Characterization Tests for Complex Logic

When code has complex logic that's hard to understand:

1. Write a test with the actual output as the assertion (capture current behavior)
2. Use this as a safety net for future refactoring
3. Add a comment: `// Characterization test: captures existing behavior, not necessarily correct behavior`

### 5. Coverage Gaps

After all behaviors are tested:
- Run coverage tooling if available
- Identify untested branches
- Add tests for critical untested paths
- Accept that 100% coverage is not the goal — meaningful coverage of business logic is

---

## Guardrails

- Do NOT refactor the code while adding tests. Tests first, refactoring later.
- Do NOT change the implementation to make it "more testable" before writing tests. Test the code as-is first, then refactor with test safety.
- The mutation verification step (step 3.3) is NOT optional. Without it, you're just writing tests that pass by construction.
- If the code is untestable without massive mocking, that's a design smell — note it but still write the best tests you can.
