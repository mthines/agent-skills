---
title: Interaction Tests — `*.test.stories.tsx` Pattern
impact: HIGH
tags:
  - storybook
  - interaction-testing
  - play-function
  - csf3
  - test-runner
---

# Interaction Tests

Generates `<kebab-case-name>.test.stories.tsx` next to the component
file.
The file holds only interaction tests under a `/Tests` namespace.
Visual regression stories stay in the sibling `.stories.tsx` file.

## ⛔ Hard requirements

These are blocking.
Do not write the file until each is satisfied.

- File suffix is exactly `.test.stories.tsx`.
  Do not use `.interactions.stories.tsx`, `.spec.stories.tsx`,
  `.stories.test.tsx`, or any other variant.
- `meta.title` ends with `/Tests`.
  Example: visual title `"Components/Button"` → test title
  `"Components/Button/Tests"`.
- `meta.tags` includes the **repo's runner tag** (see "Detect the
  runner tag" below).
  Do not hardcode `"test"` — the right value depends on which
  Storybook test runner the repo uses.
- `meta.parameters.chromatic.disableSnapshot` is `true`.
  Interaction-test stories must not enter visual regression.
  If the repo uses the legacy `chromatic` addon (`< 1.0`), use
  `chromatic: { disable: true }` instead — see "Chromatic compatibility"
  below.
- Every `userEvent.*` call is `await`-ed.
- Every `expect(...)` call is `await`-ed.
- Test utilities are imported from `"storybook/test"`, not from
  `@testing-library/*` or `vitest` directly.

## Detect the runner

Storybook 9 ships **two** runners for play functions:

| Runner                                                        | Detect by                                                                       | Tag convention                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **`@storybook/addon-vitest`** (canonical 2026; Vite only)     | `devDependencies.@storybook/addon-vitest`, or `vitest.config.*` referencing `@storybook/addon-vitest/vitest-plugin`. | No tag required — every CSF story with `play` is picked up. Set `tags: ["!test"]` to opt **out**. |
| **`@storybook/test-runner`** (legacy; Jest + Playwright)      | `devDependencies.@storybook/test-runner`; `scripts.test-storybook` invokes it.  | Tag varies by repo. Read `--tags <name>` from the script.   |
| Neither installed                                              | Halt. Ask the user which to wire up before scaffolding interaction tests.       | —                                                           |

Detection order:

1. Prefer `@storybook/addon-vitest` if present.
   Emit no `tags` block (or `tags: ["autodocs"]` only) — Vitest picks up
   any story with a `play` function automatically.
2. Else, if `@storybook/test-runner` is the active runner:
   ```bash
   jq -r '.scripts | to_entries[] | select(.value | test("test-storybook|storybook test")) | .value' package.json
   ```
   If the script passes `--tags <name>`, use that exact value.
3. Else, search existing test stories for the convention already in
   use:
   ```bash
   Grep pattern='tags:\s*\[.*"(test|interaction|ui-test|interaction-test)"' glob="**/*.test.stories.tsx" output_mode="content"
   ```
4. If still ambiguous, default to `tags: ["test"]` and print one line
   warning the user to confirm.

Never silently emit `["test"]` on a repo that uses `--tags ui-test` —
the runner will skip the generated tests and CI will go green on tests
that never ran.

## Webpack-only repos

`@storybook/addon-vitest` requires Vite. Webpack-based Storybook
installs (`@storybook/nextjs`, custom Webpack builders) must keep
`@storybook/test-runner`. The detection above handles this — but warn
the user when the legacy runner is the only option, because some
features (coverage, in-browser test UI) are addon-only.

## Chromatic compatibility

The Chromatic addon parameter shape changed between versions.
Detect once in Phase 0:

```bash
jq -r '.devDependencies | with_entries(select(.key | test("chromatic"))) | keys[]' package.json
```

| Package present                         | Use parameter shape                          |
| --------------------------------------- | -------------------------------------------- |
| `@chromatic-com/storybook` (≥ 1.0)      | `chromatic: { disableSnapshot: true }`        |
| `chromatic` (legacy, no addon)          | `chromatic: { disable: true }`                |
| Neither                                 | Same as `@chromatic-com/storybook` — safe default. |

If the legacy package is detected, emit `disable: true`; otherwise emit
`disableSnapshot: true`.

## Out of scope: accessibility tests

Do not emit a third `*.a11y.stories.tsx` file.
Both runners (Vitest addon, test-runner) integrate
`@storybook/addon-a11y` automatically when it is installed — a11y
violations then surface in the runner's own output for every story
without any extra scaffolding.
For deeper a11y review (WCAG 2.2 coverage, microcopy, focus order),
delegate to the [`ux`](../../ux/SKILL.md) skill.
This skill stops at interaction semantics.

## Why a separate file

CSF3 allows exactly **one** default export per file, and `meta.title`
applies to every story in that file.
You cannot put `"Components/Button"` and `"Components/Button/Tests"` in
one file.
The standard fix is two files with shared imports:

```
button.stories.tsx          # title: "Components/Button"
button.test.stories.tsx     # title: "Components/Button/Tests", tags: ["test"]
```

## Locator ladder

Walk this list per locator.
The first match wins; never start at the bottom.

| # | API                                                | Use for                                                 |
| - | -------------------------------------------------- | ------------------------------------------------------- |
| 1 | `canvas.getByRole("button", { name: /submit/i })`  | Anything with a semantic role (button, link, input).    |
| 2 | `canvas.getByLabelText("Email")`                   | Form fields with a visible or `<label>`-attached label. |
| 3 | `canvas.getByPlaceholderText("you@example.com")`   | Inputs with a placeholder but no label.                 |
| 4 | `canvas.getByText("Save draft")`                   | Static, non-interactive copy.                           |
| 5 | `canvas.getByTestId("editor-root")`                | Escape hatch only. Requires a `data-testid` in source.  |

If rungs 1–4 cannot locate the element, propose a source diff that adds
the missing label or role to the component, **not** a `data-testid` to
the test.
Only when the source diff is rejected, fall back to rung 5.

## `getBy` vs `findBy` vs `queryBy`

| Variant     | 0 matches | 1 match  | >1 matches | Async? |
| ----------- | --------- | -------- | ---------- | ------ |
| `getBy...`  | Throws    | Element  | Throws     | No     |
| `findBy...` | Throws    | Element  | Throws     | Yes    |
| `queryBy...`| `null`    | Element  | Throws     | No     |

Use `findBy` for anything that appears after a `userEvent` interaction.
Use `queryBy` only when asserting absence (`expect(x).toBeNull()`).

## Template

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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
```

## `fn()` spies

Pass `fn()` (from `storybook/test`) as default `args` on the meta when
you need to assert callbacks were called.
Storybook auto-resets `fn()` mocks between stories — no manual cleanup.

```tsx
const meta: Meta<typeof Form> = {
  args: {
    onSubmit: fn(),
    onCancel: fn(),
  },
};

export const SubmitFiresOnce: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /submit/i }));
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
  },
};
```

## `step()` grouping

Wrap related interactions in `step()` blocks.
Steps appear as collapsible groups in the Storybook Interactions panel,
which makes debugging a failing test much faster.

```tsx
play: async ({ canvasElement, step }) => {
  const canvas = within(canvasElement);

  await step("Fill credentials", async () => {
    await userEvent.type(canvas.getByLabelText("Email"), "user@example.com");
    await userEvent.type(canvas.getByLabelText("Password"), "hunter2");
  });

  await step("Submit and assert welcome screen", async () => {
    await userEvent.click(canvas.getByRole("button", { name: /sign in/i }));
    await expect(await canvas.findByText("Welcome back")).toBeVisible();
  });
},
```

## Composing tests

Reuse a sibling story's `play` function rather than copy-pasting setup:

```tsx
export const Logout: Story = {
  play: async (context) => {
    // Run the login flow first; MUST pass the full context.
    await SubmitFiresOnce.play!(context);

    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /sign out/i }));
    await expect(canvas.getByText("Signed out")).toBeVisible();
  },
};
```

## When to add a new test

Match the symptom to the test type:

| Question                                                   | Story type                              |
| ---------------------------------------------------------- | --------------------------------------- |
| "Does it _look_ right in state X?"                          | Visual regression — add a variant.      |
| "Does clicking X call callback Y?"                          | Interaction — `fn()` spy.               |
| "Does typing X show validation message Y?"                  | Interaction — `findByText`.             |
| "Does opening the dialog focus the right element?"          | Interaction — `expect(el).toHaveFocus()`.|
| "Does the keyboard tab order go A → B → C?"                 | Interaction — `userEvent.tab()`.        |
| "Does the layout collapse correctly at width 320?"          | Visual regression — add a variant.      |

## Validation checklist

- [ ] File suffix `.test.stories.tsx`.
- [ ] `meta.title` ends with `/Tests`.
- [ ] `meta.tags` includes `"test"`.
- [ ] `parameters.chromatic.disableSnapshot` is `true`.
- [ ] Imports come from `"storybook/test"`.
- [ ] Every `userEvent` and `expect` is awaited.
- [ ] Locator ladder respected — no `getByTestId` before trying
      semantic queries.
- [ ] `fn()` spies declared in meta `args` for every callback the tests
      assert on.
- [ ] `step()` used for multi-stage interactions.
- [ ] No `.only` or `.skip` left in.
- [ ] Test passes via the Storybook test runner (e.g.
      `npm run test-storybook`).
