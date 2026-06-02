---
title: Anti-patterns — Things to Refuse
impact: MEDIUM
tags:
  - anti-patterns
  - refusal
  - quality
---

# Anti-patterns

## Contents

- [Refuse to test logic an integration test catches](#refuse-to-test-logic-an-integration-test-catches)
- [Refuse brittle CSS selectors as a Healer fix](#refuse-brittle-css-selectors-as-a-healer-fix)
- [Refuse `--caps=vision` without a pixel-level assertion](#refuse---capsvision-without-a-pixel-level-assertion)
- [Refuse to skip a Healer suggestion silently](#refuse-to-skip-a-healer-suggestion-silently)
- [Refuse to generate against a stub server](#refuse-to-generate-against-a-stub-server)
- [Refuse `.spec.ts` files that re-implement production logic](#refuse-spects-files-that-re-implement-production-logic)
- [Refuse to raise the heal-loop cap](#refuse-to-raise-the-heal-loop-cap)
- [Refuse to run Healer on green](#refuse-to-run-healer-on-green)
- [Refuse to commit `data-testid` changes without the source diff](#refuse-to-commit-data-testid-changes-without-the-source-diff)

Refuse these — or fix them on sight.
Each entry has a one-line rule and a concrete example.

## Refuse to test logic an integration test catches

```ts
// ❌ E2E for a price formatter.
test('formats price', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByTestId('total')).toHaveText('$12.34');
});
```

Move to a unit test.
See [`rules/layer-decision.md`](./layer-decision.md).

## Refuse brittle CSS selectors as a Healer fix

```ts
// ❌ Healer patched the test with class soup.
await page.locator('button.btn-primary.lg-only').click();
```

Propose a `data-testid` source diff instead.
See [`rules/locator-strategy.md`](./locator-strategy.md).

## Refuse `--caps=vision` without a pixel-level assertion

```bash
# ❌ Vision mode for a form-fill test.
npx playwright mcp --caps=vision
```

Snapshot mode does the same job for a tenth of the tokens.
Enable vision only when the assertion is pixel-shaped.

## Refuse to skip a Healer suggestion silently

```ts
// ❌ Hides the failure under .skip().
test.skip('checkout completes after 3DS', async ({ page }) => { /* ... */ });
```

If a test is genuinely flaky, file the cause.
If the Healer cannot converge, escalate via `confidence(analysis)`.
Never `.skip()` to make CI green.

## Refuse to generate against a stub server

```ts
// ❌ Mocked the entire backend, called it E2E.
await page.route('**/api/**', (route) => route.fulfill({ ... }));
```

E2E means real browser **and** real app stack.
If the API is mocked, this is an integration test — write it as such.

## Refuse `.spec.ts` files that re-implement production logic

```ts
// ❌ Local helper duplicates the production formatter.
function formatPrice(cents: number) { return `$${(cents / 100).toFixed(2)}`; }
```

Run [`test-provenance-guard`](../../../quality/test-provenance-guard/SKILL.md) and
import the production export instead.

## Refuse to raise the heal-loop cap

```
Healer: attempt 4 of 4...
```

The skill caps at 3.
At the cap, escalate.
Raising the cap without user approval wastes tokens on guesses.

## Refuse to run Healer on green

```bash
# ❌ Self-healing on a passing test.
npx playwright test --healer
```

Healer is for failures.
On green, the test is the contract — leave it alone.

## Refuse to commit `data-testid` changes without the source diff

```diff
+ // ❌ Test references data-testid that does not exist in the source.
+ await page.getByTestId('create-project').click();
```

If the test uses a `data-testid`, the source change adding it must be in the
same commit.

## Cross-references

- Layer decisions: [`rules/layer-decision.md`](./layer-decision.md).
- Locator ladder: [`rules/locator-strategy.md`](./locator-strategy.md).
- Token discipline: [`rules/token-budget.md`](./token-budget.md).
