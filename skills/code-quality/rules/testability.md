---
title: 'Testability — Hard-to-Test Code Is Badly Factored'
impact: HIGH
tags:
  - testability
  - tdd
  - dependency-injection
  - functional-core
---

# Testability

Testability is a leading indicator of maintainability.
If a function is hard to test, the design is wrong.
This rule covers the design levers that make tests cheap, and the integration with the `tdd` skill for authoring new code.

## Compose with the `tdd` Skill When Authoring

When the user is **creating new code** — a new function, a new module, a new behaviour — invoke the [`tdd` skill](../../tdd/SKILL.md) to drive the implementation through a strict RED → GREEN → REFACTOR cycle.
The two skills compose:

- `tdd` decides what to build next and writes the failing test first.
- `code-quality` ensures the GREEN and REFACTOR passes meet the readability and maintainability bar in this skill.

### When to invoke `tdd`

| Situation | Action |
|---|---|
| User asks to implement a new function or feature from scratch | Invoke `tdd` first; apply `code-quality` rules in GREEN and REFACTOR |
| User asks to add a new behaviour to an existing module | Invoke `tdd` for the new behaviour; modifications to surrounding code follow `code-quality` directly |
| User asks to refactor / clean up existing code | Stay in `code-quality`; ensure existing tests still pass |
| User asks for a one-line tweak / typo / config change | Stay in `code-quality`; tests not always required for trivial edits |
| User explicitly opts out ("no tests", "just write the code") | Honour the request; note that this skill normally pairs with `tdd` |

### How the integration works

```
User: "add a function that calculates next billing date"
  │
  ▼
code-quality skill detects: new function authoring
  │
  ▼
Skill('tdd')   ◄── invokes the tdd skill
  │
  ▼ tdd runs RED → write a failing test
  ▼ tdd runs GREEN → minimal implementation (code-quality rules apply silently)
  ▼ tdd runs REFACTOR → improve until clean (code-quality rules apply explicitly)
  │
  ▼
Both skills complete; result is tested, clean code
```

The composition is silent: the agent does not narrate the handoff; the user sees a clean diff with the test and the implementation.

## Testability as a Quality Signal

A function that is hard to test is signalling a design problem.
Common shapes and their fixes:

| Symptom | Likely Cause | Fix |
|---|---|---|
| Test needs >5 mocks | Too many collaborators / wrong abstraction level | Extract pure core; mock only the shell |
| Test reads `Date.now()` / `Math.random()` indirectly | Hidden non-determinism | Inject the clock / RNG (see `correctness.md` §7) |
| Test depends on a real DB / network | I/O tangled with logic | Push impurity outward (see `architecture.md` §3) |
| Test is >50 lines for a 30-line function | Function under test does too much | Split by responsibility |
| Test must run in a specific order | Shared mutable state | Give each test fresh state (see `architecture.md` §6) |
| Test changes whenever an internal helper changes | Tests coupled to implementation | Test the public behaviour, not the internals |

If a test is hard to write, fix the *design* before writing a more elaborate test.

## Design Levers for Cheap Tests

### 1. Inject I/O dependencies

Pass the clock, RNG, fetcher, logger, and ID generator as parameters or constructor arguments.
The composition root resolves the real implementations; tests pass fakes.

```typescript
type Clock = { now(): Date };

class TrialService {
  constructor(private readonly clock: Clock) {}

  expiresAt(ttlMs: number): Date {
    return new Date(this.clock.now().getTime() + ttlMs);
  }
}

// Production wiring
const service = new TrialService({ now: () => new Date() });

// Test
const fixed: Clock = { now: () => new Date('2030-01-01') };
const service = new TrialService(fixed);
expect(service.expiresAt(86_400_000)).toEqual(new Date('2030-01-02'));
```

### 2. Pure functions are free to test

A pure function (no I/O, no time, no randomness, no mutation of external state) requires no setup and no mocks.
The test is `expect(f(input)).toEqual(output)`.

Maximise the surface that is pure (see `architecture.md` §3).

### 3. Test behaviour, not implementation

Tests should bind to the public API, not to internal helpers.
A test that breaks every time an internal function is renamed is a maintenance tax that punishes refactoring.

### 4. Total functions test exhaustively

A function that returns `User | null` is covered by two tests: present and absent.
A function that throws for "not found" needs a third test for the throw path — and that path is easy to forget.

See `api-design.md` §4 — total functions are also more testable functions.

### 5. Small surface, broad coverage

Test the module's public API.
Trust the internals through it.
A unit test per private helper is overhead with low signal — and it pins the implementation, fighting future refactors.

## What Tests Are Not For

- **Documentation that has to read like prose.**
  Tests document behaviour, not English.
- **Exercising every internal helper.**
  See "small surface, broad coverage" above.
- **Coverage targets as a goal.**
  100% coverage of trivial code with no assertions is worse than 80% coverage of meaningful behaviour.
  Coverage is a signal, not a goal.
- **Replacing types.**
  A test cannot prove "this is always a `User`"; the type system can.
  Use both.

## Working with `tdd`'s RED-GREEN-REFACTOR

When invoked under `tdd`, this skill applies in two phases:

- **GREEN**: write the simplest implementation that passes.
  Apply *all* critical rules (no defensive code, no premature abstraction, no parallel maps), but do not yet polish.
- **REFACTOR**: tighten naming, extract where the rule of three has fired, consolidate parallel maps, push impurity outward.
  The tests are the safety net for the cleanup.

Do not skip REFACTOR.
GREEN code that ships without REFACTOR accumulates the debt this skill exists to prevent.
