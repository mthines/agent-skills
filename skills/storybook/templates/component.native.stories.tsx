// Target: React Native Web (`@storybook/react-native-web`).
// On-device: import from `@storybook/react-native` instead and drop
// `fn` from `storybook/test` if the on-device renderer does not
// re-export it.
import type { Meta, StoryObj } from "@storybook/react-native-web";
import { fn } from "storybook/test";
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
  args: {
    onPress: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const Default: Story = {
  render: (args) => (
    <View style={{ gap: 12 }}>
      <Component {...args}>Default</Component>
      <Component {...args} variant="primary">
        Primary
      </Component>
      <Component {...args} variant="secondary">
        Secondary
      </Component>
      <Component {...args} disabled>
        Disabled
      </Component>
      <Component {...args} isLoading>
        Loading
      </Component>
    </View>
  ),
};

// Reuse `StoryObj<typeof Component>` so a prop rename surfaces here
// as a TypeScript error. Do not redeclare a parallel `PlaygroundArgs`
// type — that severs the link and lets the controls drift silently.
export const Playground: Story = {
  args: {
    variant: "default",
    size: "md",
    disabled: false,
    isLoading: false,
    children: "Tap me",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "primary", "secondary"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
    disabled: { control: "boolean" },
    isLoading: { control: "boolean" },
    children: { control: "text" },
  },
};
