---
title: Storybook Interaction Test Detector
stack: storybook
tags:
  - storybook
  - vitest
  - playwright
  - component-testing
---

# Storybook Interaction Test Detector

Bootstrap template for projects using Storybook interaction tests
(`@storybook/addon-vitest` + Playwright Chromium, or `@storybook/test-runner`).

## Detection signals

- `.storybook/` directory in the project root
- `"@storybook/addon-vitest"` or `"@storybook/test-runner"` in `package.json` devDependencies
- Test files with the suffix `*.test.stories.tsx` or `*.stories.test.ts`

## Surface starter template

### Variant A: @storybook/addon-vitest (Vitest + Playwright Chromium)

```yaml
---
project-key: <normalised-git-remote-key>
stack: storybook
detect-command: pnpm exec vitest run --config vitest.config.storybook.ts
single-test-command: pnpm exec vitest run --config vitest.config.storybook.ts "{file}" -t "{name}"
failure-parser: '^\s*FAIL\s+(\S+\.test\.stories\.tsx?)\s*>\s*(.+?)\s*$'
# group 1 = file path, group 2 = namespace/story path (e.g., UI/Button/Tests > "renders correctly")
cache-bust-flag: --no-cache
---
# Notes
# Requires a running Playwright Chromium browser (installed via playwright install chromium).
# For Nx monorepos: pnpm exec nx run <project>:test-storybook-interaction
```

### Variant B: @storybook/test-runner

```yaml
---
project-key: <normalised-git-remote-key>
stack: storybook
detect-command: pnpm exec test-storybook --url http://localhost:6006
single-test-command: pnpm exec test-storybook --url http://localhost:6006 --testPathPattern="{file}"
failure-parser: '^\s*FAIL\s+(.+?)\s*>\s*(.+?)\s*$'
cache-bust-flag:
---
# Notes
# Requires Storybook to be running at --url before tests are invoked.
# Start Storybook: pnpm exec storybook dev -p 6006
```

## Failure output format (addon-vitest variant)

```
 FAIL  src/components/button/button.test.stories.tsx > UI/Button/Tests > "renders primary variant"
TestingLibraryElementError: Unable to find an element with the role "button" and name "Submit"
 ❯ play  src/components/button/button.test.stories.tsx:28:12
```

Parser regex: `^\s*FAIL\s+(\S+\.test\.stories\.tsx?)\s*>\s*(.+?)\s*$`

- Group 1: file path (e.g., `src/components/button/button.test.stories.tsx`)
- Group 2: full namespace + story name path

## Single-test re-run (addon-vitest)

```bash
pnpm exec vitest run --config vitest.config.storybook.ts \
  src/components/button/button.test.stories.tsx \
  -t "renders primary variant"
```

## Common failure families

- **Selector drift** — `getByRole`, `getByText`, `getByLabelText`, or `testID` no longer matches
  because copy, role, or accessibility attribute changed in the component.
- **`testID` drift** — a `testID` prop was renamed in the production component.
- **Async mounting** — a `userEvent.click` runs before the component finishes mounting.
  Use `findBy*` instead of `getBy*` for elements that appear after interaction.
- **`accessibilityLabel` removed** — React Native components sometimes drop `accessibilityLabel`
  during refactors; the locator can no longer find the element.
- **Spy callback expectations** — a `vi.fn()` expectation fails because debouncing or guards
  changed the number of times the callback is called.
- **Story args drift** — story `args` reference a prop that was renamed or removed from the component.

## Storybook-specific notes

Interaction tests (`play` functions) are component integration tests — they test the
component + its interactions, not the full app.
A failure here is almost always a `test-bug` (component API changed, copy updated,
accessibility attribute renamed) unless the component has a clear bug that a snapshot
could not catch.
