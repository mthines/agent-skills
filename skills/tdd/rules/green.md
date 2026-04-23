---
title: 'GREEN Phase — Implement Minimum to Pass'
impact: CRITICAL
tags:
  - tdd
  - green
  - implementation
---

# GREEN Phase

Write the MINIMUM code to make the failing test pass. Nothing more.

---

## Procedure

### 1. Analyze the Failure

Read the test error from the RED phase. Identify exactly what is needed:
- A missing function or method?
- A wrong return value?
- A missing condition or branch?

### 2. Write Minimal Implementation

Implement ONLY what the test requires. This means:

- **If the test expects a function to return a value:** write that function with the simplest logic that produces the correct output.
- **If the test expects error handling:** add only the specific error case being tested.
- **If the test expects a side effect:** implement only that side effect.

"Minimal" means:
- No additional error handling beyond what the test checks
- No additional branches beyond what the test exercises
- No optimization
- No future-proofing
- Hardcoded values are acceptable if only one test exists for that case (the next RED phase will force generalization)

```
// Test expects: createUser({name: 'Alice'}) returns {id: string, name: 'Alice'}

// GOOD (minimal):
function createUser(input) {
  return { id: crypto.randomUUID(), name: input.name };
}

// BAD (over-engineered for one test):
function createUser(input) {
  if (!input) throw new ValidationError('Input required');
  if (!input.name) throw new ValidationError('Name required');
  if (input.name.length > 255) throw new ValidationError('Name too long');
  const user = { id: crypto.randomUUID(), name: input.name.trim() };
  logger.info('User created', { userId: user.id });
  return user;
}
```

### 3. Run the Test

Run the specific failing test:
- It MUST now pass.
- If it doesn't pass, read the error carefully and adjust the implementation.
- Do NOT adjust the test to match the implementation.

### 4. Run the Full Relevant Suite

After the single test passes, run the broader test suite for the module/package:
- All existing tests must still pass (no regressions).
- If a previously passing test now fails, you broke something — fix the implementation, not the old test.

### 5. Report

Output:
```
GREEN: [test name] — passes. [N] total tests passing, 0 failing.
```

Then proceed to REFACTOR phase.

---

## Guardrails

- NEVER add functionality that no test requires. "But we'll need it later" is not a valid reason — the next RED phase will ask for it.
- NEVER modify the test in this phase. The test was locked in during RED.
- NEVER add logging, metrics, comments, or documentation in this phase. That's for REFACTOR.
- If the test seems wrong after trying to implement: go back to RED and rewrite the test. Do not force a bad test to pass.
- If implementation requires touching 5+ files to make one test pass: the test step is too large. Go back to RED and write a smaller, more focused test.
