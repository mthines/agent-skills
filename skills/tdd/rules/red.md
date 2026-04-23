---
title: 'RED Phase — Write a Failing Test'
impact: CRITICAL
tags:
  - tdd
  - red
  - test-first
---

# RED Phase

Write exactly ONE failing test. Confirm it fails. Do NOT write any implementation code.

---

## Procedure

### 1. Pick the Next Behavior

Take the next item from the test list. It should be a single, specific, observable behavior:
- "returns 404 when user ID does not exist"
- "calculates total with tax for items in cart"
- "emits 'connection_lost' event when heartbeat times out"

NOT:
- "test the user service" (too vague)
- "handle errors" (which errors? what handling?)

### 2. Write the Test

Write ONE test that:
- Describes the expected behavior in its name
- Sets up the minimum preconditions (arrange)
- Performs the action (act)
- Asserts the expected outcome (assert)
- Uses real objects where possible, mocks only for external boundaries

```
// GOOD: Tests observable behavior
it('should return 404 when user does not exist', async () => {
  const response = await getUser('nonexistent-id');
  expect(response.status).toBe(404);
});

// BAD: Tests implementation detail
it('should call database.findById with the user id', async () => {
  await getUser('123');
  expect(database.findById).toHaveBeenCalledWith('123');
});
```

### 3. Run the Test

Run ONLY the new test (single test or test file, not the full suite):

```
# Use the most specific test command possible
npm test -- --testPathPattern="user.test" --testNamePattern="404"
go test -run TestGetUser_NotFound ./...
pytest tests/test_user.py::test_get_user_not_found -x
```

### 4. Verify Failure

The test MUST fail. Check that:

- **It fails for the RIGHT reason** — a missing function, unimplemented behavior, or wrong return value. NOT a syntax error, import error, or test setup bug.
- **The error message is meaningful** — it should tell you what behavior is missing.

If the test passes: the behavior already exists. Remove the test and pick a different behavior.
If the test fails for the wrong reason: fix the test setup, not the implementation.

### 5. Report

Output:
```
RED: [test name] — fails with: [brief error description]
```

Then proceed to GREEN phase. Do NOT touch any source code yet.

---

## Guardrails

- NEVER write more than one test in this phase.
- NEVER write implementation code in this phase.
- NEVER write a test that you know will pass — that defeats the purpose.
- If you realize the test requires infrastructure (test DB, fixtures, helpers) that doesn't exist yet, set that up FIRST as a separate step, then write the test.
- If the test file doesn't exist yet, create it with proper imports and a single test. Do not scaffold multiple empty test blocks.
