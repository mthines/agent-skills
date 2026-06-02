---
title: Mutation Check — Sabotage and Restore
impact: HIGH
tags:
  - mutation-testing
  - sabotage
  - phase-2
---

# Mutation Check

When the static check is clean, run one targeted sabotage on the production code and re-run the test.
A test that **claims** to cover a function must **fail** when that function is broken.
If the test still passes, the test is not exercising the code it claims to — even though the imports look correct.

This is a focused, single-mutation operation — not full mutation testing.
The goal is a tripwire, not a coverage score.

## Contents

- [Pre-conditions](#pre-conditions)
- [Procedure](#procedure)
- [Examples](#examples)
- [Stash safety](#stash-safety)
- [Latency target](#latency-target)
- [Common mistakes](#common-mistakes)

## Pre-conditions

- Phase 1 (`static-check`) returned no findings for this test file.
- The test file imports at least one symbol from the SUT.
- The original test passed on first run (otherwise we have nothing to mutate against — skip).

If any pre-condition fails, skip Phase 2 with a one-line note.

## Procedure

### Step 1 — Identify the target function

For each test in the file:

1. Resolve the assertion target — the function or method most-frequently called inside `expect()` / `assert()` blocks of that test.
2. Map it back to its definition in the SUT (`Grep` for `export function <name>` / `export const <name>` / `export class <name>`).
3. The mapped definition is the **mutation target**.

If the test asserts against a chain of three or more functions, mutate the most upstream call (the one that produces the value the assertion ultimately checks).

### Step 2 — Save the original

Use `git stash` to preserve the working state — never edit-and-undo by hand.

```bash
git stash push -u -m "test-provenance-guard: pre-mutation snapshot"
```

The `-u` flag includes untracked files.
The stash gives a clean rollback path even if subsequent steps fail.

### Step 3 — Sabotage

Replace the function body with a deterministic neutral stub.
The stub MUST:

- Compile / type-check (so the failure isolates the test, not the build).
- Return a value of the correct shape (use `null`, `undefined`, an empty object/array, or zero — whichever satisfies the return type).
- Not call any of the original function's collaborators (purely inert).
- For `void`-returning functions, simply `return` immediately.
- For functions that mutate input arguments (like `preserveOrgParam(currentHref, targetUrl)`), do **nothing** to the inputs — the stub returns without mutating.

**Sabotage by language:**

| Language        | Original body                                | Sabotaged body                                          |
| --------------- | -------------------------------------------- | ------------------------------------------------------- |
| TS — value-returning | `function f(): T { ... real logic ... }`    | `function f(): T { return null as unknown as T; }`      |
| TS — `void`     | `function f(...): void { ... }`              | `function f(...): void { return; }`                     |
| TS — mutating   | `function f(input): void { input.x = 1; }`   | `function f(input): void { return; }`                   |
| Python          | `def f(): ... real ...`                      | `def f(*args, **kwargs): return None`                   |
| Go              | `func F(...) T { ... }`                      | `func F(...) T { var z T; return z }`                   |
| Rust            | `pub fn f(...) -> T { ... }`                 | `pub fn f(...) -> T { Default::default() }`             |

If the original function uses generics or dependent types where a neutral stub does not type-check, fall back to `// @ts-expect-error` (TS) / `# type: ignore` (Python) on the stub line.
Note this in the report so reviewers understand the workaround.

### Step 4 — Re-run the test

Run the **single** failing test, not the full suite.
Use the project's test command, scoped as narrowly as possible:

```bash
# Examples — adapt to the project's actual TEST_CMD
pnpm vitest run path/to/file.unit.ts -t "test name"
go test -run TestX_Y ./pkg/...
pytest tests/test_x.py::test_y -x
```

Capture the exit code.

### Step 5 — Restore — ALWAYS

Restore the working tree before doing anything else.
Restoration is **not optional**, even if the test command crashed:

```bash
git stash pop
```

Verify the SUT is back to its pre-mutation state:

```bash
git status                  # should be clean of mutation changes
git diff <sut-file>          # should be empty
```

If `git stash pop` fails (e.g. merge conflict against fresh edits in the working tree), abort and surface the stash ref to the user — never leave a sabotaged tree behind.

### Step 6 — Interpret

| Test outcome after sabotage | Interpretation                                                  | Finding kind                |
| --------------------------- | --------------------------------------------------------------- | --------------------------- |
| FAIL — assertion mismatch   | Test correctly noticed the function is broken.                  | None.                       |
| FAIL — type / build error   | Sabotage stub did not type-check.                               | None — re-stub and retry.   |
| PASS                        | Test passed against a deliberately-broken function.             | `test-survives-sabotage`.   |
| ERROR — test runner crashed | Inconclusive.                                                   | None — log and skip.        |

A `test-survives-sabotage` finding has the same severity as a `shadowed-export` finding from Phase 1.
Both indicate the test is by-construction.

## Examples

### Mutation that yields `test-survives-sabotage`

Original `src/lib/url.ts`:

```typescript
export function preserveOrgParam(currentHref: string, targetUrl: URL): void {
    const orgParam = new URL(currentHref).searchParams.get("org");
    if (orgParam && !targetUrl.searchParams.has("org")) {
        targetUrl.searchParams.set("org", orgParam);
    }
}
```

Sabotaged `src/lib/url.ts`:

```typescript
export function preserveOrgParam(currentHref: string, targetUrl: URL): void {
    return;
}
```

If the test was structured as:

```typescript
function preserveOrgParam(currentHref, targetUrl) { /* local copy */ }
test("…", () => { expect(preserveOrgParam("…?org=a", "…")).toBe("…?org=a"); });
```

…the test PASSES even with the production stub, because it called the local copy.
That is the by-construction signature.

### Mutation that yields a clean PASS (no finding)

Same sabotage, but the test imports the real symbol:

```typescript
import { preserveOrgParam } from "./url";
test("…", () => {
    const target = new URL("https://x/y");
    preserveOrgParam("https://x/y?org=a", target);
    expect(target.href).toBe("https://x/y?org=a");
});
```

The stub mutates nothing.
`target.href` stays `https://x/y`.
The assertion fails.
The test correctly notices the broken function.

## Stash safety

Restoration is the most error-prone step.
A few rules:

1. **One stash per mutation.**
   Do not batch multiple mutations into one stash entry.
2. **Verify the stash exists** before mutating: `git stash list | head -1`.
3. **Restore in `finally`-style code paths.**
   If the agent's mutation step crashes, the next thing the agent does — before any reporting, before any retry — is `git stash pop`.
4. **If `git stash pop` fails**, do not retry blindly.
   Surface the stash ref and the conflict; the autonomous-workflow stuck-loop protocol takes over.

## Latency target

Phase 2 is the slow phase.
Per test file, target:

- Under 30 seconds for a JS/TS unit test (no integration setup).
- Under 60 seconds for an integration-style test.
- Skip with a note if the targeted test cannot be run in isolation.

If the suite cannot be run for a single test in under two minutes, that itself is a project-level issue worth surfacing — but it is out of scope for this skill.

## Common mistakes

- **Mutating without a stash.**
  Manual edit-and-undo loses changes if anything goes wrong. **Fix:** always stash first.
- **Mutating multiple functions in one go.**
  You lose the signal — was *this* function the one the test claims to cover, or that other one?
  **Fix:** one mutation at a time.
- **Running the full test suite.**
  Wasteful and slow.
  **Fix:** scope to the single test under inspection.
- **Forgetting to restore.**
  The whole working tree is now sabotaged.
  **Fix:** restore in a `try/finally`-equivalent pattern; verify with `git diff` after.
- **Using the wrong stub for return type.**
  Sabotage stubs that throw a build error make the test fail for the wrong reason.
  **Fix:** match return type; allow `// @ts-expect-error` if necessary.
