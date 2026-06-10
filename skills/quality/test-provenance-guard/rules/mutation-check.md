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
- [Restore safety](#restore-safety)
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

### Step 2 — Record the SUT file's pre-state

Do **not** stash.
`git stash push -u` would stash away the uncommitted test under inspection too, so the test run in Step 4 errors and the result is uninterpretable.
Instead, record the SUT file's pre-state so Step 5 can restore it exactly:

```bash
if git diff --quiet -- <sut-file> && git diff --cached --quiet -- <sut-file>; then
  SUT_WAS_CLEAN=1                      # restore path: git restore
else
  SUT_WAS_CLEAN=0
  SUT_BACKUP="$(mktemp)"
  cp <sut-file> "$SUT_BACKUP"          # restore path: mv backup over the file
fi
git diff -- <sut-file> > /tmp/sut-pre-diff.txt   # recorded pre-state for Step 5 verification
```

Only the SUT file is touched by the sabotage; the test file and the rest of the working tree stay exactly as they are.

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

Restore the SUT file before doing anything else.
Restoration is **not optional**, even if the test command crashed.
Pick the restore path recorded in Step 2:

```bash
if [[ "$SUT_WAS_CLEAN" == "1" ]]; then
  git restore <sut-file>               # file was clean pre-mutation
else
  mv "$SUT_BACKUP" <sut-file>          # file had uncommitted changes pre-mutation
fi
```

Verify the SUT is back to its pre-mutation state by comparing against the recorded pre-state:

```bash
git diff -- <sut-file> | diff - /tmp/sut-pre-diff.txt   # must be empty output
```

For a pre-clean file both sides are empty; for a pre-dirty file both sides show the same pre-existing diff.
If the comparison is non-empty, stop and surface the discrepancy (and the backup path, if any) to the user — never leave a sabotaged tree behind.

### Step 6 — Interpret

| Test outcome after sabotage | Interpretation                                                  | Finding kind                |
| --------------------------- | --------------------------------------------------------------- | --------------------------- |
| FAIL — assertion mismatch   | Test correctly noticed the function is broken.                  | None.                       |
| FAIL — type / build error   | Sabotage stub did not type-check.                               | None — re-stub and retry.   |
| PASS                        | Test passed against a deliberately-broken function.             | `test-survives-sabotage`.   |
| ERROR — test or SUT file missing / unresolved import | The procedure itself broke (bad sabotage edit, premature restore) — NOT inconclusive. | None — restore (Step 5), fix the procedure, retry once from Step 2. |
| ERROR — test runner crashed for any other reason | Inconclusive.                                  | None — log and skip.        |

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

## Restore safety

Restoration is the most error-prone step.
A few rules:

1. **One sabotage per restore cycle.**
   Do not batch multiple mutations into one Step 2→5 cycle.
2. **Verify the pre-state was recorded** before sabotaging: `/tmp/sut-pre-diff.txt` exists, and `$SUT_BACKUP` exists when the file was dirty.
3. **Restore in `finally`-style code paths.**
   If the agent's mutation step crashes, the next thing the agent does — before any reporting, before any retry — is the Step 5 restore (`git restore <sut-file>` or `mv "$SUT_BACKUP" <sut-file>`).
4. **If the Step 5 verification comparison is non-empty**, do not retry blindly.
   Surface the discrepancy and the backup path; the autonomous-workflow stuck-loop protocol takes over.
5. **Never use `git stash` here.**
   `git stash push -u` stashes the uncommitted test under inspection along with everything else, so the run errors; `git stash pop` does not revert a sabotage edit made after the stash.

## Latency target

Phase 2 is the slow phase.
Per test file, target:

- Under 30 seconds for a JS/TS unit test (no integration setup).
- Under 60 seconds for an integration-style test.
- Skip with a note if the targeted test cannot be run in isolation.

If the suite cannot be run for a single test in under two minutes, that itself is a project-level issue worth surfacing — but it is out of scope for this skill.

## Common mistakes

- **Mutating without recording the pre-state.**
  Manual edit-and-undo loses changes if anything goes wrong. **Fix:** always run Step 2 (record clean/dirty state; `cp` to a `mktemp` backup when dirty) first.
- **Stashing instead of backing up.**
  `git stash push -u` stashes the uncommitted test under inspection, so the run errors and the result is uninterpretable. **Fix:** leave the tree alone; back up only the SUT file.
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
