---
title: Flake Cookbook — Copy-Paste Determinism Snippets
impact: REFERENCE
tags:
  - storybook
  - flake
  - determinism
  - decorators
  - preview
---

# Flake Cookbook

Copy-paste decorators and helpers that kill the five most common
sources of Storybook visual flake.
Load this reference when [`rules/playwright-cli.md`](../rules/playwright-cli.md)
"Flake-source checklist" sends you here.

Each snippet drops into the repo's `.storybook/preview.tsx` (or
`.tsx`) unless noted.
Apply only the ones the repo actually needs — every global decorator
runs on every story, so the cheapest fix is to not need one.

## Contents

- CSS animations and transitions
- Font loading
- Dates and timestamps
- `Math.random` and `crypto.randomUUID`
- Theme / color-scheme drift
- Global decorator wiring

## CSS animations and transitions

The Chromatic addon's `pauseAnimationAtEnd` parameter only works for
the **Chromatic snapshot service**.
For Playwright CLI or the Vitest addon, animations must be disabled
in CSS.

```ts
// .storybook/preview.tsx
import type { Preview } from "@storybook/react-vite";

const disableAnimations = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

const preview: Preview = {
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
  },
  decorators: [
    (Story) => (
      <>
        <style dangerouslySetInnerHTML={{ __html: disableAnimations }} />
        <Story />
      </>
    ),
  ],
};

export default preview;
```

Scope this to test stories only by checking `globals` or a
parameter:

```ts
decorators: [
  (Story, ctx) =>
    ctx.tags?.includes("test") || ctx.parameters?.disableAnimations ? (
      <>
        <style dangerouslySetInnerHTML={{ __html: disableAnimations }} />
        <Story />
      </>
    ) : (
      <Story />
    ),
];
```

## Font loading

A story snapshotted before a custom font has loaded shows fallback
glyphs and bleeds 1–3 pixels of width difference.
`document.fonts.ready` is the canonical wait.

```ts
// .storybook/preview.tsx
import { useEffect, useState } from "react";

const WaitForFonts = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    void document.fonts.ready.then(() => setReady(true));
  }, []);
  return ready ? <>{children}</> : null;
};

export default {
  decorators: [(Story) => <WaitForFonts><Story /></WaitForFonts>],
} satisfies Preview;
```

For Storybook test runner only (not Vitest addon), prefer the
built-in helper:

```ts
// .storybook/test-runner.ts
import { waitForPageReady } from "@storybook/test-runner";

export default {
  async preVisit(page) {
    await waitForPageReady(page);
  },
};
```

## Dates and timestamps

Wrap the entire story in a clock mock.
`mockdate` is the smallest dep (~1 KB).
Use a fixed ISO string — pick one date and reuse it across the repo.

```ts
// .storybook/preview.tsx
import MockDate from "mockdate";

export default {
  loaders: [
    async () => {
      MockDate.set("2026-01-15T12:00:00.000Z");
      return {};
    },
  ],
  // beforeEach is the modern alternative if your Storybook version
  // supports it (>=8.2):
  async beforeEach() {
    MockDate.set("2026-01-15T12:00:00.000Z");
    return () => MockDate.reset();
  },
} satisfies Preview;
```

For libraries that read the clock through `Intl.DateTimeFormat` or
the user's locale, also pin the locale:

```ts
import { setDefaultOptions } from "date-fns";
import { enUS } from "date-fns/locale";

setDefaultOptions({ locale: enUS });
```

## `Math.random` and `crypto.randomUUID`

Seeded replacements.
`seedrandom` for `Math.random`; a counting shim for `crypto.randomUUID`.

```ts
// .storybook/preview.tsx
import seedrandom from "seedrandom";

if (typeof window !== "undefined") {
  Math.random = seedrandom("storybook-fixed-seed");

  let uuidCounter = 0;
  // @ts-expect-error — overriding for visual determinism
  crypto.randomUUID = () => {
    uuidCounter += 1;
    return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, "0")}`;
  };
}
```

Only apply when at least one story uses these primitives
transitively (search with
`Grep pattern='Math\.random|crypto\.randomUUID' glob='**/*.{ts,tsx}'`).
Adding the override to a repo that does not need it is dead weight.

## Theme / color-scheme drift

Many design systems flip on `prefers-color-scheme` at runtime.
Pin to one scheme during tests.

```ts
// .storybook/preview.tsx
export default {
  parameters: {
    backgrounds: { default: "light" },
  },
  decorators: [
    (Story) => (
      <div data-theme="light" style={{ colorScheme: "light" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Preview;
```

If the design system uses `next-themes` or a custom provider, wrap
in the provider with a fixed theme rather than relying on the OS:

```ts
import { ThemeProvider } from "next-themes";

decorators: [
  (Story) => (
    <ThemeProvider forcedTheme="light" enableSystem={false}>
      <Story />
    </ThemeProvider>
  ),
];
```

The Playwright CLI flag `--color-scheme=light` from
[`rules/playwright-cli.md`](../rules/playwright-cli.md) is the
**outer** lock; the decorator is the **inner** lock.
Use both — Playwright sets the browser-level preference, the
decorator pins the React-tree-level one.

## Global decorator wiring

Compose all five into one preview when the repo needs them.
Order matters — innermost decorator runs last:

```ts
// .storybook/preview.tsx
import type { Preview } from "@storybook/react-vite";
import MockDate from "mockdate";
import seedrandom from "seedrandom";

import { ThemeProvider } from "./theme";
import { WaitForFonts } from "./wait-for-fonts";

const disableAnimations = `*, *::before, *::after {
  animation-duration: 0s !important;
  transition-duration: 0s !important;
}`;

if (typeof window !== "undefined") {
  Math.random = seedrandom("storybook-fixed-seed");
}

const preview: Preview = {
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
    backgrounds: { default: "light" },
  },
  async beforeEach() {
    MockDate.set("2026-01-15T12:00:00.000Z");
    return () => MockDate.reset();
  },
  decorators: [
    (Story) => (
      <ThemeProvider forcedTheme="light">
        <WaitForFonts>
          <style dangerouslySetInnerHTML={{ __html: disableAnimations }} />
          <Story />
        </WaitForFonts>
      </ThemeProvider>
    ),
  ],
};

export default preview;
```

## When **not** to wire these up

Every decorator is a recurring cost on every story.
Add a decorator only when:

- At least one existing story has flaked on the symptom it fixes.
- The repo's design system requires it (theme provider) or actively
  uses the primitive (`Math.random` in fixtures).
- The user explicitly asked for deterministic snapshots.

Refuse to add all five preemptively to a repo that has never run a
visual regression tool — that is cargo-culting, and a future
contributor will rip them out without understanding why they were
there.
