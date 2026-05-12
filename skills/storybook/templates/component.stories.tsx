import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Component } from "./component";

const meta: Meta<typeof Component> = {
  title: "Components/Component",
  component: Component,
  parameters: {
    layout: "padded",
  },
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const Default: Story = {
  render: (args) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
    </div>
  ),
};

// `Playground` keeps the same `StoryObj<typeof Component>` type as
// `Default` so a prop rename in `Component` produces a TypeScript
// error in this file — never redeclare a parallel `PlaygroundArgs`
// type, that severs the link and the controls drift silently.
export const Playground: Story = {
  args: {
    variant: "default",
    size: "md",
    disabled: false,
    isLoading: false,
    children: "Click me",
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "primary", "secondary"],
      description: "Visual variant.",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "Component size.",
    },
    disabled: { control: "boolean" },
    isLoading: { control: "boolean" },
    children: { control: "text", description: "Label text." },
  },
};
