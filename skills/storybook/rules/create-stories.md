---
title: Create Stories — Visual Regression + Playground
impact: HIGH
tags:
  - storybook
  - visual-regression
  - playground
  - csf3
---

# Create Stories

Generates `<kebab-case-name>.stories.tsx` for a component.
Every file contains two stories:

1. **`Default`** — all visible variants grouped into a single render
   tree, so visual regression tooling (Chromatic, Loki, Storyshots)
   captures one snapshot per file rather than N.
2. **`Playground`** — interactive `args` + `argTypes` controls so a
   developer can change props in the UI without editing the file.

Skip the `Default` story only when `--no-default` is passed.
Skip the `Playground` story only when `--no-playground` is passed.

## Hard requirements

- File suffix is exactly `.stories.tsx`.
- Exactly one `export default meta` per file (CSF3 rule).
- `meta.title` is inferred from the component path
  (e.g. `src/components/Button/Button.tsx` →
  `"Components/Button"`).
  Override via `--title`.
- `meta.parameters.layout` is one of `padded`, `centered`,
  `fullscreen`. Default `padded`.
- Stories use `StoryObj<typeof Component>` with a `render` function —
  not args-only — so adding `play` later is a trivial diff.
- Variants are static. No `new Date()`, `Date.now()`, `Math.random()`,
  `crypto.randomUUID()`, or live API calls in args or render bodies.

## Decision: how to group variants

Walk this table once per file.
The first matching row wins.

| Signal                                                                 | Wrapper                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Repo exports a `Stories` / `Stories.Entry` helper                       | Use it. Each variant becomes a `<Stories.Entry title=…>` block.  |
| Component is laid out horizontally (button, badge, chip)                | `<div style="display:flex; gap:1rem; flex-wrap:wrap">`           |
| Component is laid out vertically (card, alert, list item)               | `<div style="display:flex; flex-direction:column; gap:1rem">`    |
| Component is a full-page layout                                         | Stack vertically; set `layout: "fullscreen"`.                    |

Check for an existing `Stories` helper with:

```bash
# Look for an exported Stories component anywhere in the repo.
Grep pattern="export (const|function) Stories" glob="**/*.{ts,tsx}"
```

If found, import it and use it.
If not found, fall back to the inline flex wrapper.
Do not invent a new helper without user approval.

## Template — `Default` story

Substitute `$STORYBOOK_ADAPTER` with the detected adapter from Phase 0
(see table below).
Do not emit the placeholder verbatim.

```tsx
// $STORYBOOK_ADAPTER is the detected adapter import path.
// Example values: "@storybook/react-vite", "@storybook/nextjs-vite",
// "@storybook/nextjs", "@storybook/react-native-web",
// "@storybook/react-native".
import type { Meta, StoryObj } from "$STORYBOOK_ADAPTER";

import { Component } from "./component";

const meta: Meta<typeof Component> = {
  title: "Components/Component",
  component: Component,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Component>;

export const Default: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Component>Default</Component>
      <Component variant="primary">Primary</Component>
      <Component variant="secondary">Secondary</Component>
      <Component disabled>Disabled</Component>
      <Component isLoading>Loading</Component>
    </div>
  ),
};
```

Replace `@storybook/react-vite` with the framework adapter the repo
uses:

| Framework                | Adapter                          |
| ------------------------ | -------------------------------- |
| Vite + React             | `@storybook/react-vite`          |
| Next.js + Vite (default) | `@storybook/nextjs-vite`         |
| Next.js (Webpack)        | `@storybook/nextjs`              |
| React Native / Expo      | `@storybook/react-native` (see [`react-native.md`](./react-native.md)) |

## Template — `Playground` story

Map every prop to an `argTypes` control.
Reuse `StoryObj<typeof Component>` — do **not** redeclare a parallel
`PlaygroundArgs` interface (that severs the type link and lets the
controls drift silently when a component prop is renamed).

```tsx
// Reuses the `Story` alias declared next to the `Default` story.
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
```

### Number control fallback

For `number` props whose range cannot be inferred from the TypeScript
type, fall back to a plain numeric input (`control: "number"`).
Use `range` only when the source declares an explicit clamp (a `Zod`
schema, a JSDoc `@min/@max`, or hard-coded constants the component
imports).
The mapping is then:

| Type                              | Control                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `number` with explicit min/max    | `{ control: { type: "range", min: <n>, max: <n>, step: <n> } }` |
| `number` without explicit min/max | `{ control: "number" }`                                    |

## Decorators

Add decorators only when the component cannot render in isolation:

- Theme provider (`<ThemeProvider>`).
- Query client (`<QueryClientProvider client={…}>`).
- Router (`<MemoryRouter>` for React Router; `<RouterContext.Provider>`
  for Next.js App Router).
- Form context (`<FormProvider>`).

Use the global decorator slot in `.storybook/preview.tsx` for repo-wide
providers.
Use `meta.decorators` for component-specific ones only.
Never wrap a single story in `decorators` if the meta already has it.

## Mock data

Static fixtures only.
If the component fetches data, set up an MSW handler in
`meta.parameters` or pass the data as a prop.

```tsx
const mockUsers = [
  { id: "user-1", name: "Ada Lovelace" },
  { id: "user-2", name: "Grace Hopper" },
];

export const Default: Story = {
  render: () => (
    <div>
      <UserList users={mockUsers} />
    </div>
  ),
};
```

If a separate `<name>.mock.ts` file is the project convention (check
with `Glob pattern="**/*.mock.ts"`), put the fixture there and import
it.
Otherwise inline static values directly.

## Naming

| Item                          | Convention                            |
| ----------------------------- | ------------------------------------- |
| File                          | `<kebab-case-component>.stories.tsx`  |
| `meta.title`                  | `"Inferred/Path/<ComponentName>"`     |
| `Default` story export        | `Default`                             |
| `Playground` story export     | `Playground`                          |
| Extra grouped variant stories | PascalCase (`WithLongText`, `Empty`)  |

## Validation checklist

Before declaring the file done:

- [ ] One `export default meta` only.
- [ ] `meta.title` matches the component path inference.
- [ ] `meta.parameters.layout` set.
- [ ] `Default` uses `render` (not `args` only).
- [ ] `Playground` exists with `args` + `argTypes` (unless
      `--no-playground`).
- [ ] All variants visible in the `Default` story.
- [ ] No dynamic values (`new Date()`, `Math.random()`, `Date.now()`).
- [ ] No credentials, tokens, or production URLs.
- [ ] Decorators only where the component cannot render without them.
