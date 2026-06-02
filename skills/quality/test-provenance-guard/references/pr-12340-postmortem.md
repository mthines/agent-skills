---
title: PR #12340 Post-Mortem — The Origin Case
impact: REFERENCE
tags:
  - postmortem
  - case-study
  - dash0
---

# PR #12340 Post-Mortem

The bug fix that birthed this skill.
A working summary of what happened, what the existing autonomous-workflow guards missed, and why the test-provenance-guard fills the gap.

## Contents

- [What was being fixed](#what-was-being-fixed)
- [What the autonomous executor delivered](#what-the-autonomous-executor-delivered)
- [What the existing guards saw](#what-the-existing-guards-saw)
- [What caught it](#what-caught-it)
- [Why the autonomous loop did not catch it](#why-the-autonomous-loop-did-not-catch-it)
- [What the skill does differently](#what-the-skill-does-differently)
- [Lessons](#lessons)
- [Source links](#source-links)

## What was being fixed

The Dash0 e2e test `[agent0] can see navigation and controls` was flaking on CI.
The Playwright trace showed Clerk picking the wrong organisation when the test navigated to `/agent0` because the URL did not carry the `?org=` query parameter.

The production fix was a five-line guard in `NavigateableView.goTo()`:

```typescript
const targetUrl = new URL(getUrlToPath(this.viewUrl, this.page));
const currentUrl = new URL(this.page.url());
const orgParam = currentUrl.searchParams.get("org");
if (orgParam && !targetUrl.searchParams.has("org")) {
    targetUrl.searchParams.set("org", orgParam);
}
await this.page.goto(targetUrl.href);
```

## What the autonomous executor delivered

A correct production fix — and a Vitest unit-test file `url.unit.ts` that **redeclared the function locally**:

```typescript
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
        const result = preserveOrgParam("…?org=e2e-test", "…");
        expect(result).toBe("…?org=e2e-test");
    });
    // … 4 more tests in the same shape
});
```

The test file even had a comment: `// Mirrors the org-preservation logic in NavigateableView.goTo()`.
Five tests, all green.
TypeScript clean.
PR opened.

## What the existing guards saw

| Layer                                            | Outcome                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 fast type-check                          | PASS — local copy and test agree.                                                                                                              |
| Phase 3 `code-quality(code)`                     | Reviewed production code; tests not in scope.                                                                                                   |
| Phase 4 Step 5 ("validate the requirement")      | Vague principle — no mechanical check.                                                                                                          |
| Phase 4 Step 6 final validation                  | `pnpm test:unit url.unit.ts` — all 5 green.                                                                                                     |
| Phase 6 `review-changes`                         | Pre-push review focused on commit hygiene, walked the diff — saw a new test file with tests, did not flag the local declaration.                |
| Phase 7 CI                                       | Green.                                                                                                                                          |

The PR merged the production fix correctly, but the regression protection the test claimed to provide was an illusion.

## What caught it

A `@claude review` invocation by the human author after merge.
The reviewer (a parallel agent fan-out with seven specialised reviewers — testing, maintainability, kieran-typescript, agent-native, etc.) flagged it as a P1:

> **Tests duplicate the logic instead of testing the real implementation** — `preserveOrgParam` is defined locally and is a verbatim copy of the inline logic in `NavigateableView.goTo()`. The tests never import or call the production code.
> If the guard in `goTo()` is changed, these tests remain green while the actual behaviour regresses.
> The test file comment even acknowledges this: *"Mirrors the org-preservation logic."*

Confidence: 100.

## Why the autonomous loop did not catch it

Two specific gaps:

1. **No "test imports SUT" assertion at any phase.**
   The static check this skill introduces (Phase 1) would have flagged the local-copy / shadowed-export pattern in seconds.
2. **No mutation check.**
   The TDD skill has the right idea (`tdd/rules/test-after.md` Step 3.3 — "mutate to verify"), but it is only enforced when `/tdd after` is explicitly invoked.
   In a generic Phase 4 test-add step, the agent never runs the sabotage.

Both gaps are systemic — they recur whenever an autonomous executor adds tests for refactor-friendly logic that is currently inlined inside a method.
The fix was easy *after the human pointed at it*; the goal of this skill is to make the loop find and fix it without that round trip.

## What the skill does differently

For the same scenario:

1. **Phase 1 (static-check.md)** runs against the diff:
   - Sees `tests/e2e/src/lib/url.unit.ts` is a new test file.
   - Resolves the SUT candidates: `tests/e2e/src/lib/url.ts` (sibling).
   - Scans imports: only `vitest` — no relative import of `./url`.
   - Scans declarations: top-level `preserveOrgParam`.
   - Scans the SUT exports: `getUrlToPath`, `getBaseUrl`, `getUrlState`, `toUrlState`.
   - The local declaration name is **not** an export of the resolved SUT — but the assertion target (`preserveOrgParam`) does not appear in the SUT either.
   - Falls through to: `no-sut-import` finding (the SUT does not yet expose what the test claims to test).

2. **Phase 3 (self-heal.md)**:
   - `no-sut-import` does not auto-heal — but the executor was expected to *create* the export as part of the fix.
   - Self-heal checks: is the local copy's logic present *inline* somewhere in production? If yes, treat as `shadowed-export-style` — extract the inline logic to a new export and rewrite the test.
   - In the dash0 case: the inline logic is in `NavigateableView.goTo()` — extract to `url.ts`, rewrite the test to import it.

3. **Phase 2 (mutation-check.md)** — would have run if the test had imported `./url` correctly but tested a function whose body was inert.
   Belt-and-braces; the static check is sufficient for this case.

The end state matches the human-driven fix exactly:

- `url.ts` gains an exported `preserveOrgParam(currentHref: string, targetUrl: URL): void`.
- `navigateable-view.ts` calls the export instead of inlining.
- `url.unit.ts` imports `preserveOrgParam` and exercises the real symbol.

## Lessons

- A **passing test suite is not the same as a useful test suite**.
  Passing means consistent; useful means it fails when the production code regresses.
- **LLM-authored tests gravitate toward local copies** because copying is the path of least resistance to a green build.
- **The static check is cheap**: an `import` graph + an export-list cross-reference catches the most common shape in milliseconds.
- **Mutation testing covers the long tail.**
  Hand-rewrites and silent mocks slip past the static check; sabotage catches them.
- **Self-healing is a refactor**, not a re-design.
  The skill preserves test assertions verbatim and only relocates the production logic.

## Source links

- PR: https://github.com/dash0hq/dash0/pull/12340
- Reviewer comment: https://github.com/dash0hq/dash0/pull/12340#issuecomment-4405832757
- Healing commit: `896df7ccd5` (`refactor(tests): extract preserveOrgParam, test the real implementation`)
