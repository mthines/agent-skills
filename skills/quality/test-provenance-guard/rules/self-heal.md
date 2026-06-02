---
title: Self-Heal — Extract, Rewrite, Re-Verify
impact: HIGH
tags:
  - refactor
  - self-heal
  - extract
  - phase-3
---

# Self-Heal

Repair a tests-by-construction finding without human intervention.
The procedure is the same for both finding kinds:

| Finding from earlier phase  | What self-heal does                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `shadowed-export`           | Delete the local copy, import the real export, adapt the call sites to the export's signature. |
| `test-survives-sabotage`    | Trace why — usually a parallel inline implementation somewhere — and converge on a single export the test imports. |
| `no-sut-import`             | **Do not auto-heal.** Report only.  The test exercises nothing concrete — extracting an unrelated function is the wrong call. |

This rule covers the first two.
The third is reported and left to the stuck-loop / human review path.

## Contents

- [Procedure](#procedure)
- [Worked example — `pr-12340`](#worked-example--pr-12340)
- [Constraints](#constraints)
- [Common mistakes](#common-mistakes)

## Procedure

### Step 1 — Identify the canonical home for the extracted symbol

Most cases land in one of three patterns:

| Pattern                                                                                  | Canonical home                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Inline logic lives in a method of a class                                                | A new exported function in the **same file** as the class (top-level, side-by-side).           |
| Inline logic lives in a free function that already does something else                   | A new exported function in the same file (extracted from the original).                       |
| Inline logic lives across multiple files                                                 | A new exported function in the file with the densest cluster of usages; export it explicitly.   |

When in doubt, follow the surrounding file's existing pattern: if `url.ts` already exports `getUrlToPath`, the new helper goes alongside it.

### Step 2 — Choose the function signature

Use the **exact same signature** as the local copy from the test file.
This is the cheapest path to a clean rewrite — the test's call sites do not change.

If the local copy and the inline production usage have *different* shapes (e.g. local copy returns a string, production mutates a URL), choose the production shape and adapt the test.
The production shape is the source of truth; the test was the deviation.

Example — `pr-12340` had:

| Place                      | Signature                                                                |
| -------------------------- | ------------------------------------------------------------------------ |
| Local copy in test file    | `(currentUrl: string, targetUrl: string) => string`                      |
| Inline in production       | mutates a `URL` object in place                                          |
| Extracted export (chosen)  | `(currentHref: string, targetUrl: URL) => void` (matches production)     |

The test was rewritten with a small `apply()` helper that constructs the URL, calls the export, and reads `.href` — a 4-line adaptation, no logic change.

### Step 3 — Pre-heal confidence gate (MANDATORY when running inside autonomous-workflow)

Before mutating **any** file, score the proposed extraction with:

```
Skill("confidence", "code")
```

Pass the proposed change as the work-under-review:

- The chosen canonical home (Step 1)
- The chosen signature (Step 2)
- A dry-run description of the six edits planned in Step 4 below
- The list of production callers that will be updated

The skill returns a confidence score that the refactor preserves correctness without surfacing surprises (wrong abstraction, hidden caller, type-system drift, side-effect change).

| Score   | Action                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| ≥ 90 %  | Proceed to Step 4 (extract) and Step 5 (re-verify).                                             |
| < 90 %  | **Do not write any files.** Emit the finding as `heal-skipped-low-confidence` and exit with the score in the report. The autonomous-workflow stuck-loop protocol takes over (per-iteration self-check → `confidence(analysis)` → `holistic-analysis` auto-replan → user escalation). |

Outside the autonomous loop (slash invocation with `--fix`), the gate is still
recommended but the user can override with `--no-confidence-gate` to force the
heal — this is a manual override, not a default.

This pre-heal gate exists because the post-heal mechanical gates (Step 5) only
prove the refactor is *internally consistent* (build green, target test green,
mutation re-verifies). They cannot detect that the agent extracted the
*wrong* abstraction — e.g. a helper that fits this one test but breaks an
unrelated caller two files away. The confidence call grades exactly that
risk before any file is touched.

### Step 4 — Extract

1. **Read** the inline production usage and the local test copy.
2. **Pick** the canonical shape (Step 2).
3. **Write** the new exported function in the canonical home (Step 1).
4. **Update** the inline production caller to use the export.
5. **Delete** the local copy from the test file.
6. **Rewrite** the test imports to pull in the export.

Ordering matters: write the export first, then update the caller, then update the test.
That way the build and tests stay green between each step (no transient broken state in version control).

### Step 5 — Re-verify

Three gates, in order — proceed only if each passes:

1. **Type / build check.**
   `npx tsc --noEmit`, `go build ./...`, `mypy`, `cargo check`.
2. **The test under inspection passes.**
   Same scoped command from `mutation-check.md` Step 4.
3. **Mutation check now produces the right finding** — i.e. sabotaging the export now makes the test FAIL.
   This is the proof that the heal was effective: the test is now actually exercising production.

If any gate fails, **revert the heal** with `git restore` (or `git checkout -- <files>`) and emit the finding as `heal-failed`.
Do not iterate locally — the autonomous-workflow's Phase 4 stuck-loop protocol handles second attempts via `confidence(analysis)` and `holistic-analysis`.

### Step 6 — Commit (if running inside autonomous-workflow)

```bash
git add <prod-file> <test-file>
git commit -m "refactor: extract <symbol> for testability

test-provenance-guard: <test-file> previously tested a private copy of
<symbol>. Extracted the inline logic to <export-location>, rewired the
production caller, and pointed the test at the real export."
```

Use the conventional `refactor:` type — the heal does not change behaviour, only structure.

If running as a slash command (manual mode), do **not** commit; leave the changes staged and let the human review.

## Worked example — `pr-12340`

### Before

```typescript
// tests/e2e/src/lib/url.unit.ts (test file)
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
        const result = preserveOrgParam("…?org=a", "…");
        expect(result).toBe("…?org=a");
    });
});
```

```typescript
// tests/e2e/src/lib/views/navigateable-view.ts (production)
protected async goTo() {
    const targetUrl = new URL(getUrlToPath(this.viewUrl, this.page));
    const currentUrl = new URL(this.page.url());
    const orgParam = currentUrl.searchParams.get("org");
    if (orgParam && !targetUrl.searchParams.has("org")) {
        targetUrl.searchParams.set("org", orgParam);
    }
    // ...
}
```

### After self-heal

```typescript
// tests/e2e/src/lib/url.ts (production — new export)
export function preserveOrgParam(currentHref: string, targetUrl: URL): void {
    const orgParam = new URL(currentHref).searchParams.get("org");
    if (orgParam && !targetUrl.searchParams.has("org")) {
        targetUrl.searchParams.set("org", orgParam);
    }
}
```

```typescript
// tests/e2e/src/lib/views/navigateable-view.ts (production caller — updated)
import { getUrlToPath, preserveOrgParam } from "../url";

protected async goTo() {
    const targetUrl = new URL(getUrlToPath(this.viewUrl, this.page));
    preserveOrgParam(this.page.url(), targetUrl);
    // ...
}
```

```typescript
// tests/e2e/src/lib/url.unit.ts (test — rewritten)
import { preserveOrgParam } from "./url";

function apply(currentHref: string, target: string): string {
    const targetUrl = new URL(target);
    preserveOrgParam(currentHref, targetUrl);
    return targetUrl.href;
}

describe("preserveOrgParam", () => {
    test("…", () => {
        expect(apply("…?org=a", "…")).toBe("…?org=a");
    });
});
```

Notice:

- The test's **assertions** are unchanged — same expected values.
- A small `apply()` adapter reconciles the production signature (mutating `URL`) with the test's natural fixture style (string in, string out).
- The original `goTo()` keeps its behaviour identical — the extract is a pure refactor.

## Constraints

- **Do not redesign the function while extracting.**
  No renaming parameters for clarity, no rewording the docstring, no "while we're here" tweaks.
  The whole point is a pure structural change with the test's behaviour preserved.
- **Do not delete passing tests.**
  Self-heal rewrites tests; it does not prune them.
- **Do not introduce new dependencies.**
  The export should not pull in new runtime libraries; the inline logic was self-contained, so the export should be too.
- **Do not heal across module boundaries that the project considers private.**
  If the SUT lives behind a barrel that intentionally hides internal modules, respect the barrel.
  Surface the finding instead of rerouting imports through internal paths.

## Common mistakes

- **Renaming during extract.**
  Two refactors in one commit make the diff hard to review and the test changes ambiguous.
  **Fix:** rename in a follow-up commit.
- **Adapting the test before the extract is done.**
  Leaves the working tree in a half-state if the build then fails.
  **Fix:** export-first, caller-second, test-third.
- **Skipping the post-heal mutation re-check.**
  Without it, the heal is unproven.
  **Fix:** Step 4 gate 3 is non-negotiable; if it cannot run, fall back to `heal-failed`.
- **Healing a `no-sut-import` finding.**
  The skill cannot guess what the test should be testing.
  **Fix:** report and return; let the user decide.
