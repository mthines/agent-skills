---
title: Static Check — Imports and Symbol Shadowing
impact: HIGH
tags:
  - static-analysis
  - imports
  - shadowing
  - phase-1
---

# Static Check

Detects two failure modes by inspecting the test file's source — no execution required.
This is the cheap, fast first line of defence.
Run before mutation; mutation is wasted work if the static check already produced a finding.

## Contents

- [What it detects](#what-it-detects)
- [Resolving the SUT (System Under Test) module](#resolving-the-sut-system-under-test-module)
- [Decision flow](#decision-flow)
- [Examples](#examples)
- [Language support matrix](#language-support-matrix)
- [Heuristic shortcuts](#heuristic-shortcuts)
- [Common mistakes](#common-mistakes)
- [Implementation notes for the executing agent](#implementation-notes-for-the-executing-agent)

## What it detects

| Finding kind          | Evidence                                                                                     | Why it matters                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `shadowed-export`     | The test file declares a function/class/const whose name matches an exported symbol of the SUT module, *and* the test asserts against the local declaration. | The test exercises the local copy, not the export. The exported symbol could be deleted and the tests stay green. |
| `no-sut-import`       | The test file does not import any symbol from a candidate SUT module (see resolution table below). | The test exercises something other than the module it claims to test, or the SUT does not exist as a module yet. |

A clean Phase 1 means: the test file imports at least one symbol from a module under the project's source tree, and none of the test file's local declarations shadow an exported name of that module.

## Resolving the SUT (System Under Test) module

The SUT is the production module the test file claims to cover.
Resolve in this order:

| Test file path                                | Candidate SUT(s)                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `<dir>/<name>.test.<ext>`                     | `<dir>/<name>.<ext>`                                                      |
| `<dir>/<name>.spec.<ext>`                     | `<dir>/<name>.<ext>`                                                      |
| `<dir>/<name>.unit.<ext>`                     | `<dir>/<name>.<ext>`                                                      |
| `<dir>/__tests__/<name>.<ext>`                | `<dir>/<name>.<ext>` (sibling)                                            |
| `tests/**/<name>.<ext>`                       | The first `<name>.<ext>` reachable from `src/**` that the test imports.   |

If none of the candidates exist on disk, fall back to: any module the test file *does* import via a relative path.
That is the SUT.

If no relative imports exist either, the finding is `no-sut-import` and Phase 2 is skipped.

## Decision flow

```
1. Locate the test file's SUT (table above).
2. Parse the test file imports:
   - Collect every symbol imported from a relative path or from a path
     resolving inside the project (no node_modules / stdlib).
3. Parse the test file declarations:
   - Top-level function, class, const, let declarations.
   - Inner-scope declarations are NOT findings (test fixtures are fine).
4. Parse the SUT exports:
   - export function / class / const / let, named re-exports, default
     exports.
5. Cross-check:
   - If declaration_name ∈ sut_exports AND declaration is referenced
     by an `expect()` / `assert()` / equivalent assertion in the same
     file → finding: shadowed-export.
   - If sut_imports = ∅ → finding: no-sut-import.
6. Emit findings (file, line, kind, evidence).
```

The "referenced by an assertion" qualifier matters.
A test fixture named `User` that happens to match an exported `User` type but is only used inside `beforeEach` is not a finding — it never runs against an assertion.
The bug pattern is *the assertion targets the local copy*.

## Examples

### Bad — `shadowed-export`

```typescript
// src/lib/url.unit.ts
import { describe, expect, test } from "vitest";

// ← Local copy. The production version lives in ./url.ts but is never imported.
function preserveOrgParam(currentUrl: string, targetUrl: string): string {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);
    const orgParam = current.searchParams.get("org");
    if (orgParam && !target.searchParams.has("org")) {
        target.searchParams.set("org", orgParam);
    }
    return target.href;
}

describe("preserveOrgParam", () => {
    test("…", () => {
        expect(preserveOrgParam("…", "…")).toBe("…");  // ← asserts against local copy
    });
});
```

Evidence the static check records:
- `src/lib/url.unit.ts:9` — declares `preserveOrgParam` at top level.
- `src/lib/url.ts:11` — exports `preserveOrgParam`.
- `src/lib/url.unit.ts:23` — `expect(preserveOrgParam(...))` calls the local declaration.

Finding kind: `shadowed-export`.

### Bad — `no-sut-import`

```typescript
// src/lib/url.unit.ts
import { describe, expect, test } from "vitest";  // ← only third-party imports

describe("…", () => {
    test("…", () => {
        expect(2 + 2).toBe(4);
    });
});
```

No relative imports, no project imports.
The test exercises nothing the project owns.
Either the test belongs deleted or the SUT is missing — either way the autonomous loop should not declare victory.

### Good

```typescript
// src/lib/url.unit.ts
import { describe, expect, test } from "vitest";

import { preserveOrgParam } from "./url";  // ← imports from the SUT

describe("preserveOrgParam", () => {
    test("…", () => {
        const target = new URL("…");
        preserveOrgParam("…", target);
        expect(target.href).toBe("…");
    });
});
```

The exported `preserveOrgParam` is imported and called inside the assertion.
No shadowing.
No finding.

## Language support matrix

| Language        | Import syntax to scan                                            | Declaration syntax to scan                                |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| TypeScript / JS | `import { X } from "..."`, `import X from "..."`, dynamic `import()` | `function`, `class`, `const`, `let`, `var` at top level   |
| Python          | `from x import y`, `import x.y as z`                             | `def`, `class`, top-level assignment                      |
| Go              | `import "x"`                                                     | `func`, top-level `var` / `const`                         |
| Rust            | `use crate::x::y`                                                | `fn`, `struct`, `enum`, top-level `let` (rare)            |
| Other           | Skip with a one-line note: `language not supported, skipping`.   | —                                                         |

The skill does not need to fully parse the language; a regex or tree-sitter scan is enough to surface candidate symbols, and a string match against the SUT's exported names is the actual decision.

## Heuristic shortcuts

When a full scan is overkill (e.g. very large files), these heuristics are good enough:

- **Imports:** grep for `from\s+['"]` (TS), `^import\s+` (Python, Go), `^use\s+` (Rust).
- **Declarations:** grep for `^(export\s+)?(function|class|const|let)\s+(\w+)` (TS), `^def\s+(\w+)|^class\s+(\w+)` (Python).
- **SUT exports:** scan the SUT for `^export\s+(function|class|const|let|default)`.

Cross-reference the captured names.
If a top-level test-file declaration name appears in the SUT's export list, mark `shadowed-export`.

## Common mistakes

- **Treating type imports as proof of SUT coverage.**
  `import type { Foo } from "./sut"` is not a value import — it cannot exercise the SUT's logic.
  Only count value imports (no `type` modifier) toward "the test imports the SUT".
- **Counting test-helper duplications as findings.**
  Test fixtures, builders, and mocks frequently re-declare types — only declarations referenced by `expect()` / `assert()` count.
- **Failing on re-exports.**
  A test that imports `preserveOrgParam` from a barrel file (`./index.ts`) which re-exports from `./url.ts` is fine.
  Resolve re-exports transitively when possible.
- **Skipping the test-files-in-tests/-folder pattern.**
  Some projects keep tests outside `src/`, e.g. `tests/e2e/src/lib/url.unit.ts` (the dash0 layout).
  The "first matching name in `src/**`" fallback covers this.

## Implementation notes for the executing agent

1. Use `Grep` to extract imports and declarations rather than firing up a full TS compiler — orders of magnitude cheaper.
2. Use `Read` to fetch the SUT exports list once per test file; cache when multiple test files share an SUT.
3. Emit one `<file>:<line> — <kind>` line per finding; aggregate them in the structured report at the end.
4. Phase 1 latency target: under 2 seconds per test file in a JS/TS project, under 5 seconds in larger languages.
   If you exceed this, the project is large enough that a build-graph tool would be more appropriate — note it and continue.
