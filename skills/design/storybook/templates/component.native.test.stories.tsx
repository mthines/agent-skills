// Target: React Native Web (`@storybook/react-native-web`).
// On-device target: replace `storybook/test` with
// `@testing-library/react-native` (keep `fn` and `expect` from
// `storybook/test`) and swap `userEvent.click` for `userEvent.press`.
import type { Meta, StoryObj } from "@storybook/react-native-web";
import { expect, fn, userEvent, within } from "storybook/test";
import { View } from "react-native";

import { Component } from "./component";

const meta: Meta<typeof Component> = {
  title: "Components/Component/Tests",
  component: Component,
  tags: ["test"],
  parameters: {
    chromatic: { disableSnapshot: true },
  },
  decorators: [
    (Story) => (
      <View style={{ padding: 16 }}>
        <Story />
      </View>
    ),
  ],
  args: {
    onPress: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const PressFiresOnPress: Story = {
  render: (args) => (
    <Component {...args} accessibilityRole="button" testID="component-pressable">
      Tap me
    </Component>
  ),
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("User taps the pressable", async () => {
      // Locator ladder: prefer accessibilityRole / accessibilityLabel
      // in the component source. `testID` is the escape hatch.
      const pressable = await canvas.findByRole("button", { name: /tap me/i });
      await userEvent.click(pressable);
    });

    await step("onPress fires exactly once", async () => {
      await expect(args.onPress).toHaveBeenCalledTimes(1);
    });
  },
};

export const DisabledBlocksPress: Story = {
  render: (args) => (
    <Component
      {...args}
      disabled
      accessibilityRole="button"
      testID="component-pressable"
    >
      Tap me
    </Component>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const pressable = await canvas.findByRole("button", { name: /tap me/i });
    await userEvent.click(pressable);
    await expect(args.onPress).not.toHaveBeenCalled();
  },
};
