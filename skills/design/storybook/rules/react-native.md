---
title: React Native / Expo — `@storybook/react-native`
impact: HIGH
tags:
  - storybook
  - react-native
  - expo
  - on-device
---

# React Native / Expo

Native Storybook runs differently from web Storybook.
The renderer is `@storybook/react-native` (on-device) or
`@storybook/react-native-web` (browser-rendered preview).
Stories themselves stay close to the web shape, but the imports,
locators, and test runner change.

## Detection

The skill picks `--platform native` automatically when any of these is
true in `package.json`:

- `dependencies.react-native` is present.
- `dependencies.expo` is present.
- `devDependencies['@storybook/react-native']` is present.

Override with `--platform web` or `--platform native` explicitly.

## Two flavours

`@storybook/react-native` ships two layouts.
Detect which the repo uses before scaffolding:

| Layout                  | Signal                                                                                | Notes                                                  |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| On-device (Expo / RN)   | `.ondevice/` directory or `.storybook/index.tsx` with a `getStorybookUI` call.        | Runs inside the app on a simulator / device.           |
| React Native Web        | `@storybook/react-native-web` in `devDependencies`; a `.storybook/main.ts` like web.  | Renders RN components in a browser via `react-native-web`. |

The on-device layout is the canonical 2024+ recommendation.
React Native Web is supported but does not exercise native gesture
behaviour.

## Imports

Imports diverge by layout.
The shared barrel (`storybook/test`) only re-exports for the **React
Native Web** path, not for on-device.

| Concern              | Web                                              | RN Web                                              | On-device                                                          |
| -------------------- | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------ |
| `Meta` / `StoryObj`  | `@storybook/react-vite`                          | `@storybook/react-native-web`                       | `@storybook/react-native`                                          |
| Test utilities       | `storybook/test`                                 | `storybook/test`                                    | `@testing-library/react-native` + `storybook/test` (split — see below) |
| `userEvent` gesture  | `userEvent.click(...)`                            | `userEvent.click(...)`                              | `userEvent.press(...)` (`@testing-library/react-native` v12+)      |
| Canvas locator       | `within(canvasElement)`                          | `within(canvasElement)`                             | `screen` from `@testing-library/react-native`                       |
| Layout parameter     | `parameters.layout: "padded"`                    | `parameters.layout: "padded"`                       | Ignored — wrap in a `View` decorator instead.                       |

**On-device note**: the on-device runner does not share `storybook/test`
with the web stack.
Pull `userEvent`, `within`, and matchers from `@testing-library/react-native`;
pull `fn` and `expect` from `storybook/test` (these are renderer-agnostic).
If `@testing-library/react-native` is not installed, halt and ask the
user to install it before generating interaction tests for on-device.

## Visual regression file

The shape is the same as web; only the import and the wrapper change.

```tsx
import type { Meta, StoryObj } from "@storybook/react-native";
import { View } from "react-native";

import { Component } from "./component";

const meta: Meta<typeof Component> = {
  title: "Components/Component",
  component: Component,
  decorators: [
    (Story) => (
      <View style={{ padding: 16, gap: 8 }}>
        <Story />
      </View>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Component>;

export const Default: Story = {
  render: () => (
    <View style={{ gap: 12 }}>
      <Component>Default</Component>
      <Component variant="primary">Primary</Component>
      <Component disabled>Disabled</Component>
    </View>
  ),
};
```

Full template:
[`templates/component.native.stories.tsx`](../templates/component.native.stories.tsx).

## Interaction tests

Same file convention as web — `.test.stories.tsx` — but the locator API
is different.
React Native components do not expose ARIA roles in the same way.
The locator ladder shifts:

| # | API                                                     | Notes                                                          |
| - | ------------------------------------------------------- | -------------------------------------------------------------- |
| 1 | `await canvas.findByRole("button", { name: /save/i })`  | Works if the component uses `accessibilityRole="button"`.      |
| 2 | `await canvas.findByLabelText("Email")`                 | Reads `accessibilityLabel`.                                    |
| 3 | `await canvas.findByText("Save draft")`                 | Reads visible text from `<Text>`.                              |
| 4 | `await canvas.findByTestId("save-button")`              | Reads the `testID` prop. Acceptable fallback in native.        |

**Hard rule**: `accessibilityLabel` is for assistive tech, not for test
selectors.
Use `testID` for tests.
Do **not** double-purpose `accessibilityLabel` as a locator hook — see
[`e2e-testing-mobile`](../../../testing/e2e-testing-mobile/SKILL.md) for the same
rule applied to Maestro.

Full template:
[`templates/component.native.test.stories.tsx`](../templates/component.native.test.stories.tsx).

The shipped template targets **React Native Web** by default — it
imports from `storybook/test` and uses `userEvent.click`.
For on-device, replace the imports per the table above and swap
`userEvent.click` for `userEvent.press`.
Do not run the RN Web template against the on-device runner; it
compiles but fails at runtime.

## Decorators

Native stories almost always need at least one wrapping `View` for
padding and background colour.
Apply it via `meta.decorators` so every story in the file gets it.

If the app uses a theme provider (`@shopify/restyle`, `tamagui`,
`nativewind`, `react-native-paper`), wrap globally in
`.storybook/preview.tsx` rather than per-story.

## Running

| Layout              | Run command                                  | Verification target                              |
| ------------------- | -------------------------------------------- | ------------------------------------------------ |
| On-device           | `npx expo start` and load the Storybook UI   | Simulator or physical device.                    |
| React Native Web    | `npm run storybook` (Storybook dev server)   | Browser at `http://localhost:6006`.              |

Playwright CLI iteration in
[`rules/playwright-cli.md`](./playwright-cli.md) only applies to React
Native Web.
On-device stories cannot be driven by Playwright — defer interaction
verification to the Storybook test runner running against the
on-device target.

## Validation checklist

- [ ] Detected layout (on-device vs RN Web) declared inline before
      writing.
- [ ] Imports use `@storybook/react-native` (not the web adapter).
- [ ] Visual regression file wraps stories in a `View` decorator.
- [ ] Interaction tests use `testID` for the escape-hatch locator —
      never `accessibilityLabel`.
- [ ] `accessibilityLabel` and `accessibilityRole` are added to source
      where stable role-based locators would otherwise fail.
- [ ] If RN Web is used, the Playwright CLI loop is wired up.
- [ ] If on-device, the Storybook test runner is the verification
      target, not Playwright.
