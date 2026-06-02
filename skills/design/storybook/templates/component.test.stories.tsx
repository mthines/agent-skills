import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Component } from "./component";

const meta: Meta<typeof Component> = {
  title: "Components/Component/Tests",
  component: Component,
  tags: ["test"],
  parameters: {
    chromatic: { disableSnapshot: true },
    layout: "padded",
  },
  args: {
    onClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const ClickFiresOnClick: Story = {
  render: (args) => <Component {...args}>Click me</Component>,
  play: async ({ args, canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step("User clicks the button", async () => {
      const button = await canvas.findByRole("button", { name: /click me/i });
      await userEvent.click(button);
    });

    await step("onClick fires exactly once", async () => {
      await expect(args.onClick).toHaveBeenCalledTimes(1);
    });
  },
};

export const DisabledBlocksClicks: Story = {
  render: (args) => (
    <Component {...args} disabled>
      Click me
    </Component>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const button = await canvas.findByRole("button", { name: /click me/i });
    await expect(button).toBeDisabled();

    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// Only emit this story if the component actually disables interaction
// while loading (a spinner alone does NOT prevent clicks). Delete this
// block if `isLoading` is purely cosmetic on the component under test.
export const LoadingPreventsInteraction: Story = {
  render: (args) => (
    <Component {...args} isLoading>
      Saving…
    </Component>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    const button = await canvas.findByRole("button", { name: /saving/i });
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
