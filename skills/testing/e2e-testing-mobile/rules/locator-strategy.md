---
title: Locator Strategy — testID, Text, accessibilityLabel
impact: HIGH
tags:
  - locators
  - testID
  - accessibilityLabel
  - accessibility
  - react-native
  - maestro
---

# Locator Strategy

## Contents

- [The ladder](#the-ladder)
- [Why `testID` is rung 1, not an escape hatch](#why-testid-is-rung-1-not-an-escape-hatch)
- [Why `accessibilityLabel` must not double as a test selector](#why-accessibilitylabel-must-not-double-as-a-test-selector)
- [How `testID` maps per platform](#how-testid-maps-per-platform)
- [How to add `testID` correctly](#how-to-add-testid-correctly)
- [Naming conventions](#naming-conventions)
- [Forbidden locators](#forbidden-locators)
- [Cross-references](#cross-references)

Pick locators from the top of the ladder down.
Every step skipped is a future flake.
On mobile the ladder is **inverted** relative to web: `testID` is the
primary selector for E2E flows, not an escape hatch.

## The ladder

| Rung | Maestro locator                                                  | When to use                                                                                                         |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1    | `tapOn: { id: 'sign-in-button' }`                                | Default. The component has a `testID` prop. Stable across i18n, re-renders, and refactors.                          |
| 2    | `tapOn: { text: 'Sign in' }`                                     | Visible label, short, unique on screen, **not** localised. Avoid for translated apps.                               |
| 3    | `tapOn: { accessibilityText: 'Sign in, button' }`                | Last resort, with caveats below. Almost always means the component lacks a `testID` — propose a source diff first.  |

## Why `testID` is rung 1, not an escape hatch

On web, `getByRole` works because the DOM exposes an accessibility tree
already shaped by HTML semantics.
React Native does **not** have that automatic mapping.
Native views expose either an `accessibilityIdentifier` (iOS) or a
`resource-id` (Android), and React Native 0.64+ pipes the `testID` prop
through to both — making `testID` the only stable, cross-platform,
i18n-proof selector.

`text:` locators read the visible label.
They break the moment the app supports a second locale or the copy
changes.

`accessibilityText:` reads the screen-reader announcement string.
That string is owned by accessibility, not by tests — see the next
section.

## Why `accessibilityLabel` must not double as a test selector

`accessibilityLabel` is the string a screen reader speaks to a blind
user.
It must read naturally in the user's language, follow VoiceOver and
TalkBack conventions ("Submit, button"), and change with locale.

If you reuse it as your test selector:

- A copy edit by a designer breaks the test silently.
- The label gets shortened, generalised, or stripped of punctuation to
  pass an a11y review — and the test fails for a non-bug reason.
- A11y reviewers can no longer freely rewrite labels without coordinating
  with the test suite.
- Localisation breaks every flow that hard-codes an English label.

The fix is not to rename `accessibilityLabel`; it is to add a separate
`testID` and let the two diverge.
The `setTestId` helper in
[`../templates/testid-helper.tsx`](../templates/testid-helper.tsx) keeps
the boundary clean.

## How `testID` maps per platform

React Native's bridge handles each side differently — be aware of the
quirks:

### iOS

`testID` becomes `accessibilityIdentifier`.
Maestro reads it directly via the `id:` matcher.
No package-prefix concerns.

### Android

`testID` becomes the View's `resource-id`.
Older Appium docs say Android requires the application package as a
prefix (`com.example:id/sign-in-button`).
**Maestro does not**: it accepts the bare `testID` value and resolves
the package internally.
If you ever drop down to raw Appium for the same flow, re-add the
prefix there — but keep the Maestro flow free of it.

## How to add `testID` correctly

`testID` is a **source diff**, not a flow edit.
The Healer must propose the diff and offer it for user approval before
patching the flow.

### Correct flow

1. Healer detects a flow step with no `id:` rung-1 match.
2. Healer outputs a unified diff that adds `testID` to the component
   (using the `setTestId` helper for cross-platform consistency).
3. User approves.
4. Source change committed alongside the flow.

### Example diff

```diff
--- a/components/SignInButton.tsx
+++ b/components/SignInButton.tsx
@@ -1,9 +1,14 @@
 import { Pressable, Text } from 'react-native';
+import { setTestId } from '../testing/setTestId';

 export function SignInButton({ onPress }: Props) {
   return (
-    <Pressable onPress={onPress} accessibilityLabel="Sign in">
+    <Pressable
+      onPress={onPress}
+      accessibilityLabel="Sign in"
+      {...setTestId('sign-in-button')}
+    >
       <Text>Sign in</Text>
     </Pressable>
   );
 }
```

```yaml
# .maestro/auth/sign-in.yaml
- tapOn:
    id: 'sign-in-button'
```

Note the two props live side by side, with different values:

- `accessibilityLabel="Sign in"` — what the screen reader speaks.
- `testID="sign-in-button"` — what the flow targets.

### Wrong flow

Patching the flow with a coordinate or a CSS-like selector:

```yaml
# ❌ Don't do this.
- tapOn:
    point: '50%, 80%'
```

Why wrong: the layout shifts on every device size; a font change moves
the button by one rem and every flow breaks.

```yaml
# ❌ Also don't do this.
- tapOn:
    text: 'Sign in'
```

…in a localised app.
The first time a user runs the flow on a Spanish-locale simulator,
Maestro can't find "Sign in".

## Naming conventions

- Kebab-case: `sign-in-button`, not `signInButton` or `SignInButton`.
- Action-oriented for buttons: `submit-order`, `cancel-edit`.
- Object-oriented for containers: `cart-summary`, `pricing-table`.
- Scope when needed: `dashboard-create-project` — only if a global
  `create-project` already exists elsewhere.
- Never include the platform: don't write `ios-sign-in`. The same
  `testID` resolves on both platforms via the helper.

## Forbidden locators

- `tapOn: { point: '50%, 80%' }` — coordinate-based.
- `tapOn: { index: 3 }` standalone — positional, breaks on reorder.
  Allowed only when scoped under a `runFlow` block that disambiguates
  by container.
- Custom XPath via `tapOn: { xpath: ... }` — last-ditch only.
- `tapOn: { accessibilityText: '<English string>' }` in a localised app.

## Cross-references

- Spec-first flow:
  [`spec-first-flow.md`](./spec-first-flow.md).
- `setTestId` helper:
  [`../templates/testid-helper.tsx`](../templates/testid-helper.tsx).
- Maestro CLI surface:
  [`../references/maestro-cli.md`](../references/maestro-cli.md).
- Web counterpart (for hybrid apps):
  [`../../e2e-testing/rules/locator-strategy.md`](../../e2e-testing/rules/locator-strategy.md).
