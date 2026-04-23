---
name: tdd
description: >
  Test-Driven Development skill enforcing strict RED-GREEN-REFACTOR cycles.
  Writes one failing test at a time, implements minimal code to pass, then
  refactors. Uses subagent isolation to prevent tests-by-construction.
  Triggers on: "tdd", "write tests", "test this", "add test coverage",
  "test driven", "red green refactor", "/tdd".
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: test-driven-development
  modes:
    - tdd-full
    - test-first
    - test-after
---

# Test-Driven Development

Enforce strict RED-GREEN-REFACTOR discipline. One test at a time. Tests describe WHAT the system does, never HOW.

---

## Input

Check `$ARGUMENTS` for the feature or behavior description.

- If `$ARGUMENTS` contains a feature description, use it directly.
- If `$ARGUMENTS` contains **"after"** (e.g., `/tdd after`), run in **Test-After Mode** — write tests for existing code. See `rules/test-after.md`.
- If `$ARGUMENTS` is empty, ask the user what behavior they want to implement or test.

---

## Step 0: Discover Project Test Setup

Before writing any tests:

1. **Find existing tests** — glob for `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`, `**/test_*.*`, `**/tests/**` to identify the test framework, naming conventions, and directory structure.
2. **Find the test runner** — check `package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or similar for the test command.
3. **Adopt existing patterns** — match the project's test style exactly: same imports, same assertion library, same file naming, same directory placement. Never introduce a new test framework or pattern.
4. **Identify the run command** — store it mentally as `TEST_CMD` for use throughout the cycle. If you can run a single test file or test case, prefer that over the full suite.

If no tests exist yet, ask the user which framework to use before proceeding.

---

## Step 1: Prioritize by Business Criticality

Before diving into implementation, identify what matters most:

1. **Core user flows first** — what are the primary actions users perform? Test those before edge cases.
2. **Ask if unclear** — if the feature has multiple behaviors, ask the user to rank them or list the critical paths.
3. **Build a test list** — write a numbered list of behaviors to test, ordered by importance. Each item should be a single, specific behavior (not "test the login flow" but "reject login with expired password").

Present the test list to the user for confirmation before starting the cycle.

---

## Step 2: RED-GREEN-REFACTOR Cycle

For each item in the test list, execute one full cycle. Follow the rules strictly:

### RED Phase
See `rules/red.md`

Write exactly ONE failing test. Run it. Confirm it fails with the expected error. Do NOT write implementation code.

### GREEN Phase
See `rules/green.md`

Write the MINIMUM code to make the failing test pass. No more. Run the test. Confirm it passes. Run the full relevant test suite to check for regressions.

### REFACTOR Phase
See `rules/refactor.md`

Evaluate whether refactoring is needed. If yes, refactor while keeping all tests green. If no, move to the next cycle.

---

## Step 3: Cycle Completion Check

After each RED-GREEN-REFACTOR cycle:

1. Run the full relevant test suite (not just the new test).
2. If all tests pass, move to the next item on the test list.
3. If a test fails, **stop and fix it before proceeding**. Never accumulate broken tests.
4. After every 3 cycles, briefly report progress to the user.

---

## Step 4: Final Verification

After all items in the test list are complete:

1. Run the full test suite one final time.
2. Check test coverage if the project has coverage tooling — report any critical paths that are uncovered.
3. Provide a summary of what was tested and what was implemented.

---

## Critical Rules (apply to ALL phases)

### Test Quality
- **Test behavior, not implementation** — tests must exercise public interfaces only. A test must survive a complete internal refactor unchanged.
- **One behavior per test** — each test should verify exactly one thing. The test name should describe that behavior.
- **No testing framework internals** — never test that `setTimeout` works, that React renders, or that Go's `http.ListenAndServe` starts. Test YOUR code.
- **Maximum 10-15 tests per file** — if you need more, split by behavior group.
- **Factory functions for test data** — use `buildUser(overrides?)` patterns instead of inline object literals scattered across tests.

### Mocking Strategy
- **DO mock:** external HTTP APIs, third-party services, file system (when testing logic, not I/O), time/dates, randomness.
- **DO NOT mock:** your own code, framework features, database (prefer test DB or in-memory), internal modules (unless crossing a major boundary).
- **Never mock what you don't own** — if you don't control the interface, write an adapter and mock that.
- **If the test needs more than 3 mocks, the design is wrong** — refactor the code under test first.

### Naming Convention
Follow the project's existing convention. If none exists, use:
- **describe** block: the unit under test (function, class, component)
- **it/test** block: `should [expected behavior] when [condition]`
- Example: `describe('createOrder')` → `it('should reject order when inventory is zero')`

### Anti-Patterns to Avoid
| Anti-Pattern | Why It's Bad | What to Do Instead |
|---|---|---|
| Writing tests in bulk | Tests imagined behavior, not observed | One test per cycle |
| Testing and implementing together | Unconsciously designs tests around implementation | Strict phase separation |
| "Make sure tests pass" prompt | Encourages implementation-first thinking | "Write a FAILING test" |
| Changing test expectations to pass | Masks real bugs | Fix the source code |
| Testing private methods | Couples tests to implementation | Test through public API |
| Copy-pasting mock setup | Brittle, hard to maintain | Extract shared fixtures |

### When Things Go Wrong
- **Test won't fail (RED phase):** The behavior already exists or the test is wrong. Investigate before proceeding.
- **Can't make test pass without large changes (GREEN phase):** The test step is too big. Break it into smaller behaviors.
- **Refactoring breaks tests:** The tests were testing implementation details. Rewrite the test to test behavior, then refactor.
- **After 2 failed attempts to fix:** Clear context and start the cycle fresh with a better-scoped test.
