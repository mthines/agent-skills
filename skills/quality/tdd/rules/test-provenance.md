---
title: Test provenance — the test must exercise the production code
impact: HIGH
tags:
  - tdd
  - provenance
  - mutation
---

# Test provenance

A test passes **by construction** when it checks a private copy of the code under test instead of the production code: it stays green whatever production does.
Run this check on every new or extended test file, after the suite is green.
Run it alone with `Skill("tdd", "provenance [--base <ref>] [<test files>]")`; with no files, check the test files changed since `--base` (default `main`).

## 1. Static check

The test file imports the module under test, and defines none of the names that module exports.

```typescript
// ✗ Wrong — the test re-declares the function it claims to test
function applyDiscount(total: number, code: string): number { /* copied logic */ }
test("SAVE10 takes 10% off", () => expect(applyDiscount(100, "SAVE10")).toBe(90));

// ✓ Right — the test imports the production export
import { applyDiscount } from "../src/cart";
test("SAVE10 takes 10% off", () => expect(applyDiscount(100, "SAVE10")).toBe(90));
```

No import of the module under test, or a shadowed export → finding `by-construction`; skip step 2 for that file.

## 2. Mutation check

Break the production function and expect the test to fail.

1. Record the production file's state. Never `git stash`: it would stash the test under inspection too.

   ```bash
   SUT=<production file>
   if git diff --quiet -- "$SUT" && git diff --cached --quiet -- "$SUT"; then CLEAN=1; else CLEAN=0; BACKUP="$(mktemp)"; cp "$SUT" "$BACKUP"; fi
   git diff -- "$SUT" > "${TMPDIR:-/tmp}/sut-pre.diff"
   ```

2. Replace the function body with an inert stub of the right type: `return null as unknown as T;`, `return;` for `void`, `return None` in Python, the zero value in Go, `Default::default()` in Rust.
3. Run only that test file with the project's test command.
4. **Restore, always — even when the run crashed:**

   ```bash
   if [ "$CLEAN" = 1 ]; then git restore -- "$SUT"; else mv "$BACKUP" "$SUT"; fi
   git diff -- "$SUT" | diff - "${TMPDIR:-/tmp}/sut-pre.diff"   # must print nothing
   ```

   Output from that `diff` → stop and report the file and the backup path; never leave a sabotaged file behind.

| Result after the stub | Meaning |
| --- | --- |
| Assertion failure | The test exercises production. Pass. |
| Test still passes | Finding `by-construction`. |
| Build or type error from the stub | Re-stub so it type-checks; retry once. |
| Runner crashed for another reason | Inconclusive; log it and move on. |

One stub per restore cycle.

## 3. Fix

For a `by-construction` finding, move the copied logic into an exported production function, make the production caller and the test import it, then re-run steps 1 and 2.
Inside an autonomous run, apply the fix only when `Skill("confidence", "code")` ≥ 90; below that, report the finding and leave the code unchanged.

Report one line per run: `provenance: <N> file(s), <M> finding(s), <K> fixed`.
