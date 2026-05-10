---
title: Anti-patterns — Things to Refuse
impact: MEDIUM
tags:
  - anti-patterns
  - refusal
  - quality
  - react-native
  - maestro
---

# Anti-patterns

## Contents

- [Refuse to test logic an RNTL component test catches](#refuse-to-test-logic-an-rntl-component-test-catches)
- [Refuse coordinate-based taps as a Healer fix](#refuse-coordinate-based-taps-as-a-healer-fix)
- [Refuse to reuse `accessibilityLabel` as the test selector](#refuse-to-reuse-accessibilitylabel-as-the-test-selector)
- [Refuse to skip a Healer suggestion silently](#refuse-to-skip-a-healer-suggestion-silently)
- [Refuse to generate flows against a stub server](#refuse-to-generate-flows-against-a-stub-server)
- [Refuse to rebuild the app on every flow run](#refuse-to-rebuild-the-app-on-every-flow-run)
- [Refuse to raise the heal-loop cap](#refuse-to-raise-the-heal-loop-cap)
- [Refuse to run Healer on green](#refuse-to-run-healer-on-green)
- [Refuse to commit `testID` changes without the source diff](#refuse-to-commit-testid-changes-without-the-source-diff)
- [Refuse to migrate a stable Detox suite all at once](#refuse-to-migrate-a-stable-detox-suite-all-at-once)
- [Refuse to use Maestro for browser-only flows](#refuse-to-use-maestro-for-browser-only-flows)

Refuse these — or fix them on sight.
Each entry has a one-line rule and a concrete example.

## Refuse to test logic an RNTL component test catches

```yaml
# ❌ E2E for a price formatter.
- launchApp
- tapOn: { id: 'cart' }
- assertVisible:
    text: '$12.34'
```

Move to a unit test for `formatCurrency`, or an RNTL test for the
component that renders it.
See [`layer-decision.md`](./layer-decision.md).

## Refuse coordinate-based taps as a Healer fix

```yaml
# ❌ Healer patched the flow with a screen-relative coordinate.
- tapOn:
    point: '50%, 80%'
```

Propose a `testID` source diff instead via the `setTestId` helper.
See [`locator-strategy.md`](./locator-strategy.md).

## Refuse to reuse `accessibilityLabel` as the test selector

```tsx
// ❌ Component has only an accessibilityLabel — flow targets it.
<Pressable accessibilityLabel="Sign in" onPress={onSignIn}>
  <Text>Sign in</Text>
</Pressable>
```

```yaml
# ❌ Flow reads the screen-reader string.
- tapOn:
    accessibilityText: 'Sign in'
```

The label belongs to accessibility; localisation will break the flow,
and a copy edit will silently break it without anyone noticing.
Add a separate `testID` via `setTestId('sign-in-button')`.
See [`locator-strategy.md`](./locator-strategy.md).

## Refuse to skip a Healer suggestion silently

```yaml
# ❌ Hides the failure under a `disabled` flag.
disabled: true
- launchApp
- ...
```

If a flow is genuinely flaky, file the cause.
If the Healer cannot converge, escalate via `confidence(bug-analysis)`.
Never disable a flow to make CI green.

## Refuse to generate flows against a stub server

```yaml
# ❌ Flow runs against a build pointing at a mocked backend.
env:
  API_BASE_URL: http://localhost:9999/mock
```

E2E means real app, real device or simulator, and real backend.
If the API is mocked, this is an integration test — write it as such.

## Refuse to rebuild the app on every flow run

```bash
# ❌ Wastes 10–25 minutes per iteration.
eas build --profile e2e --platform ios && \
  maestro test .maestro/workout/start-workout.yaml
```

Reuse the cached artefact unless source / native / deps changed.
See the build-reuse rule in [`token-budget.md`](./token-budget.md).

## Refuse to raise the heal-loop cap

```
Healer: attempt 4 of 4...
```

The skill caps at 3.
At the cap, escalate.
Raising the cap without user approval wastes Cloud minutes on guesses.

## Refuse to run Healer on green

```bash
# ❌ Self-healing on a passing flow.
maestro test .maestro --heal
```

Healer is for failures.
On green, the flow is the contract — leave it alone.

## Refuse to commit `testID` changes without the source diff

```yaml
# ❌ Flow references a testID that does not exist in the source.
- tapOn:
    id: 'create-project'
```

If the flow uses a `testID`, the source change adding it must be in the
same commit.

## Refuse to migrate a stable Detox suite all at once

```bash
# ❌ Big-bang migration — gambles a working safety net.
rm -rf e2e/  # delete Detox
mkdir .maestro
```

Migrate flow-by-flow.
Keep the Detox suite green until the matching Maestro flow is
established.
See [`../references/detox-legacy.md`](../references/detox-legacy.md)
for migration sequencing.

## Refuse to use Maestro for browser-only flows

```yaml
# ❌ Wrapping a webview-only flow in a launchApp shell.
- launchApp
- tapOn: { text: 'Open in browser' }
- tapOn: { text: 'Sign in' }   # … inside Safari now.
```

Defer to [`e2e-testing`](../../e2e-testing/SKILL.md).
For hybrid apps, run a Maestro flow for the native chrome, then a
Playwright flow for the WebView.
The two run sequentially.

## Cross-references

- Layer decisions: [`layer-decision.md`](./layer-decision.md).
- Locator ladder: [`locator-strategy.md`](./locator-strategy.md).
- Token discipline: [`token-budget.md`](./token-budget.md).
- Detox legacy:
  [`../references/detox-legacy.md`](../references/detox-legacy.md).
