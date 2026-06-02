---
name: storybook
description: >
  Scaffolds, audits, and tests Storybook stories for React (web) and React
  Native / Expo (native) component libraries. Generates three artefacts in
  two files per invocation: a visual regression `*.stories.tsx` file
  containing a `Default` story (variants grouped into a single snapshot)
  and a `Playground` story (interactive `args` / `argTypes`), plus a
  sibling `*.test.stories.tsx` interaction test file under a `/Tests`
  namespace. Supports an opt-in, per-pathname auth flow whose
  credentials live in the OS keychain (not in the repo). Iteration loop
  uses the Playwright CLI against the running Storybook URL; visual
  evidence delegates to the `reviewer` agent and the `screen-recorder`
  skill. Triggers on "scaffold stories", "add storybook", "story for this
  component", "interaction test for this story", "/storybook".
argument-hint: "[component-path] [--platform web|native] [--no-interactions] [--no-playground] [--auth <profile>]"
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - storybook
    - visual-regression
    - interaction-testing
    - playwright
    - react
    - react-native
    - expo
    - chromatic
    - auth-flow
    - keychain
---

# Storybook

Scaffold and test Storybook stories — **three artefacts in two files**
per component: a `Default` story and a `Playground` story (both in the
visual regression file) plus an interaction test file under a
`/Tests` namespace.
Works on React (web) and React Native / Expo (native).
Auth — when the running Storybook is gated — is opt-in and per-pathname,
with secrets stored in the OS keychain instead of the repo.

> **This `SKILL.md` is a thin index.**
> Concern-specific rules live in [`rules/*.md`](./rules) and load on
> demand.
> Reference material lives in [`references/*.md`](./references).
> Literal scaffolding lives in [`templates/*.md`](./templates).
> Do not preload every file — load only what the current phase asks for.

---

## When to use

Reach for this skill when any of the following is true:

- A component has no story file yet and needs visual regression coverage.
- An existing `*.stories.tsx` lacks an interaction test counterpart.
- A `Playground` story is missing or out of sync with current props.
- The Storybook target is gated by auth and the agent needs to log in.
- A flaky interaction test needs to be iterated against the running
  Storybook URL.

Do **not** reach for this skill when:

- The task is to build the component itself.
  Scaffold stories **after** the component is implemented and named.
- The repo has no Storybook installation at all.
  Halt and ask the user to install Storybook first — this skill does not
  bootstrap Storybook.
- The component is a hook or non-visual primitive with no rendered
  surface.
  Defer to [`tdd`](../../quality/tdd/SKILL.md).

---

## Arguments and defaults

Parse `$ARGUMENTS` in this order:

| Argument                   | Default                                                                    | Effect                                                                  |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `<component-path>`         | Prompt the user                                                            | Source file of the component to scaffold stories for.                   |
| `--platform web\|native`   | Auto-detect (see [`rules/react-native.md`](./rules/react-native.md))       | Web emits `.stories.tsx`; native emits the Expo / RN variant.           |
| `--no-interactions`        | Generate `<name>.test.stories.tsx`                                         | Skip the interaction test file.                                         |
| `--no-playground`          | Include a `Playground` story                                               | Skip the Playground story.                                              |
| `--no-default`             | Include a `Default` story with grouped variants                            | Skip the visual regression Default story (rare — only for test-only).   |
| `--auth <profile>`         | None                                                                       | Use the named auth profile when running Playwright against the URL.     |
| `--title <storybook-title>`| Inferred from the component path                                           | Override the Storybook `title` for the generated meta.                  |

Sub-commands:

```
/storybook auth list                # List configured auth profiles in this repo.
/storybook auth add <profile>       # Register a new profile (writes config + stores secret in OS keychain).
/storybook auth remove <profile>    # Remove a profile (deletes config entry + keychain item).
/storybook auth test <profile>      # Dry-run the login flow against the configured URL.
```

The full auth contract — config schema, keychain commands per OS, and
the `storageState` reuse loop — lives in [`rules/auth.md`](./rules/auth.md).

---

## Workflow (six phases)

Each phase has a single gate. Do not proceed until it passes.

| Phase | Name                       | Gate                                                                  |
| ----- | -------------------------- | --------------------------------------------------------------------- |
| 0     | Preflight                  | Storybook installed; platform detected; auth profile loaded if asked  |
| 1     | Component inspection       | Component file read; props and variants enumerated                    |
| 2     | Visual regression scaffold | `<name>.stories.tsx` written; variants grouped                        |
| 3     | Playground scaffold        | `Playground` story written with `args` + `argTypes`                   |
| 4     | Interaction test scaffold  | `<name>.test.stories.tsx` written under `/Tests` namespace            |
| 5     | Verification               | Storybook running; Playwright CLI iteration confirms rendering        |

### Phase 0 — Preflight

Run these read-only checks before writing anything:

```bash
# 1. Storybook installed?
jq '.devDependencies | keys[]' package.json | grep -E '@storybook/'

# 2. Storybook config dir present?
ls .storybook/ 2>/dev/null

# 3. Platform — web (Vite / Next) or native (Expo / RN)? Check
#    dependencies, devDependencies, AND peerDependencies — shared
#    component libraries (`packages/ui`) consumed by an Expo app
#    declare `react-native` as a peer.
jq '(.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}) | keys[]' package.json | grep -E '^(react-native|expo|@storybook/react-native)'
```

Decision table:

| State                                                    | Action                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Storybook installed + `.storybook/` present              | Proceed to Phase 1.                                                           |
| Storybook missing                                        | **Halt.** Ask user to install Storybook before invoking this skill again.     |
| `react-native` or `expo` in dependencies                 | Set `--platform native`. Load [`rules/react-native.md`](./rules/react-native.md). |
| Neither present                                          | Set `--platform web`.                                                         |
| `--auth <profile>` passed                                | Load [`rules/auth.md`](./rules/auth.md). Resolve secret before Phase 5.       |

### Phase 1 — Component inspection

Read the component file.
Enumerate, in this order:

1. The component's exported name.
2. Each prop, its TypeScript type, and whether it is optional.
3. Each visible state derivable from props (`isLoading`, `error`,
   `disabled`, `variant`, `size`).
4. Each callback prop that an interaction test will need to spy on
   (`onClick`, `onChange`, `onSubmit`, …).
5. Any context providers the component requires (theme, query client,
   router) — these go into the meta `decorators`.

Output the inventory inline before scaffolding.
The user reads it and corrects misinterpretations before any file is
written.

### Phase 2 — Visual regression scaffold

Write `<kebab-case-name>.stories.tsx` next to the component file.
Full rules and the variant-grouping pattern live in
[`rules/create-stories.md`](./rules/create-stories.md).

The shape, in one diagram:

```text
default export (Meta)
└── title: "<Inferred>/<ComponentName>"
└── component: <Component>
└── parameters: { layout: "padded" | "centered" | "fullscreen" }

export const Default: Story = {
  render: () => (
    <variants grouped — one Chromatic snapshot per file>
  ),
};
```

Use the literal scaffolding in:

- [`templates/component.stories.tsx`](./templates/component.stories.tsx)
  (web)
- [`templates/component.native.stories.tsx`](./templates/component.native.stories.tsx)
  (React Native / Expo)

If the repo already exports a `Stories` / `Stories.Entry` helper
(checked by `Grep "Stories\\.Entry"` against the repo), use it to group
variants into a single snapshot.
Otherwise emit a plain flex/stack wrapper.
The decision tree is in
[`rules/create-stories.md`](./rules/create-stories.md).

### Phase 3 — Playground scaffold

Append a `Playground` story to the same file.
Every prop becomes an `argTypes` control.
Mapping:

| TypeScript prop                          | `argTypes` control                                              |
| ---------------------------------------- | --------------------------------------------------------------- |
| `boolean`                                | `{ control: "boolean" }`                                        |
| `string`                                 | `{ control: "text" }`                                           |
| `number` with inferable min/max          | `{ control: { type: "range", min: <n>, max: <n>, step: <n> } }` |
| `number` without explicit clamps         | `{ control: "number" }`                                         |
| Union of string literals                 | `{ control: "select", options: [...] }`                         |
| Callback (`onClick`, `onChange`)         | `args: { onClick: fn() }` — imported from `storybook/test`      |
| `ReactNode` / children                   | `{ control: "text" }` with a default string                     |

Full example: see "Playground story" in
[`rules/create-stories.md`](./rules/create-stories.md).

### Phase 4 — Interaction test scaffold

Write `<kebab-case-name>.test.stories.tsx` next to the component file.

**Hard rules** (full reasoning in
[`rules/interaction-tests.md`](./rules/interaction-tests.md)):

- File suffix is `.test.stories.tsx`.
  Do not use `.interactions.stories.tsx`, `.spec.stories.tsx`, or
  anything else.
- Title is `<same-prefix>/Tests`.
  One Storybook namespace per file — CSF3 allows exactly one default
  export.
- `tags: ["test"]` is set on the meta so the test runner picks it up.
- `parameters.chromatic = { disableSnapshot: true }` keeps these stories
  out of visual regression.
- All `userEvent` calls are awaited; all `expect` calls are awaited.
- Locator priority: `getByRole` → `getByLabelText` →
  `getByPlaceholderText` → `getByText` → `getByTestId`.
  Never start with `getByTestId`.

Use the literal scaffolding in:

- [`templates/component.test.stories.tsx`](./templates/component.test.stories.tsx)
  (web)
- [`templates/component.native.test.stories.tsx`](./templates/component.native.test.stories.tsx)
  (React Native / Expo — uses `@storybook/react-native` test helpers)

### Phase 5 — Verification

Start Storybook in the background and iterate against the live URL.
Full Playwright CLI loop in
[`rules/playwright-cli.md`](./rules/playwright-cli.md).

Minimum verification, in this order:

1. Story compiles — Storybook prints no error in the terminal.
2. Story renders — Playwright CLI navigates to the story URL and the
   canvas root selector resolves.
3. Default story is reachable from the sidebar at the inferred title.
4. Interaction test passes via the Storybook test runner (e.g.
   `npm run test-storybook`) — if the runner is wired up.

For visual evidence (a screenshot or short clip of the rendered story),
delegate to the [`reviewer`](../../../agents/reviewer.md) agent or the
[`screen-recorder`](../../analysis/screen-recorder/SKILL.md) skill.
Full handoff rules in
[`rules/visual-verification.md`](./rules/visual-verification.md).

If the Storybook URL is gated and `--auth <profile>` was passed, the
Playwright CLI invocation reuses the `storageState.json` produced by
the auth profile's login flow.
The skill never types credentials into the Playwright CLI directly.

---

## Decision flow at a glance

| Signal                                                    | Do                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Component has no `.stories.tsx`                           | Run the full workflow (Phases 0–5).                                      |
| Component has `.stories.tsx` but no `.test.stories.tsx`   | Skip to Phase 4. Reuse the existing meta `title` for the `/Tests` peer.  |
| Repo has `react-native` or `expo`                         | Set `--platform native`. Load [`rules/react-native.md`](./rules/react-native.md). |
| Storybook URL is `http://localhost:6006/...` (or similar) | Iterate via Playwright CLI. No auth needed.                              |
| Storybook URL is gated (login form, SSO, basic auth)      | Resolve `--auth <profile>` first. Load [`rules/auth.md`](./rules/auth.md).|
| Visual evidence requested in the PR                       | Delegate to [`reviewer`](../../../agents/reviewer.md) or `screen-recorder`. |
| Component is a hook or non-visual                         | Stop. Defer to [`tdd`](../../quality/tdd/SKILL.md).                                 |
| Storybook isn't installed                                 | Halt. Ask the user to install Storybook before re-running.               |

---

## Composes with

- [`tdd`](../../quality/tdd/SKILL.md) — owns unit / hook tests.
  This skill defers below the visual surface to it.
- [`test-provenance-guard`](../../quality/test-provenance-guard/SKILL.md) —
  run on the generated `.test.stories.tsx` to ensure the test imports
  production component code, not a private shim.
- [`reviewer`](../../../agents/reviewer.md) — runs the visual check pass
  and posts screenshots on the PR (Critical / High motion findings,
  visual diffs).
- [`screen-recorder`](../../analysis/screen-recorder/SKILL.md) — captures short
  videos of multi-frame interactions where a still screenshot cannot
  prove the change (transitions, focus order, hover-revealed UI).
- [`ux`](../ux/SKILL.md) — call after stories are scaffolded to audit
  the rendered states for accessibility and microcopy.
- [`visual-design`](../visual-design/SKILL.md) — call **before**
  scaffolding when the component is new and the visual direction is
  not yet committed (palette, type, signature details). Call **after**
  scaffolding in `review` mode if the rendered variants look generic
  or drift from the chosen direction. Pairs with `ux` — `ux` audits
  the floor, `visual-design` shapes the ceiling.
- [`confidence`](../../quality/confidence/SKILL.md) — gate before declaring the
  scaffold done if the user disputes a generated variant.

---

## Rules

- [`rules/create-stories.md`](./rules/create-stories.md) — visual
  regression `*.stories.tsx` pattern: grouped variants, Playground
  story, layout parameter, static mock data only.
- [`rules/interaction-tests.md`](./rules/interaction-tests.md) —
  `*.test.stories.tsx` hard requirements: `/Tests` namespace, awaited
  `userEvent`, locator ladder, `fn()` spies, `step()` grouping.
- [`rules/react-native.md`](./rules/react-native.md) — Expo / React
  Native flavor: `@storybook/react-native` differences, native
  locators, mobile-only template paths.
- [`rules/auth.md`](./rules/auth.md) — opt-in per-pathname auth: config
  schema, OS-keychain commands, `storageState` reuse, multi-profile
  routing, secret rotation.
- [`rules/playwright-cli.md`](./rules/playwright-cli.md) — iteration
  loop against the running Storybook URL: snapshot mode, `--last-failed`,
  iframe routes, story permalinks, headed vs headless.
- [`rules/visual-verification.md`](./rules/visual-verification.md) —
  delegation rules for the `reviewer` agent and `screen-recorder`
  skill, when each is the right tool.
- [`rules/anti-patterns.md`](./rules/anti-patterns.md) — full list of
  patterns to refuse.

## References

- [`references/platform-detection.md`](./references/platform-detection.md)
  — how the skill decides web vs native, and the Storybook builder
  matrix per framework.
- [`references/flake-cookbook.md`](./references/flake-cookbook.md) —
  copy-paste decorator snippets for the five most common flake
  sources (animations, fonts, dates, random IDs, theme drift).
  Load only when an existing story has flaked or the user asks for
  deterministic snapshots — adding all five preemptively is
  cargo-culting.

## Templates

- [`templates/component.stories.tsx`](./templates/component.stories.tsx)
  — web visual regression scaffold.
- [`templates/component.test.stories.tsx`](./templates/component.test.stories.tsx)
  — web interaction test scaffold.
- [`templates/component.native.stories.tsx`](./templates/component.native.stories.tsx)
  — React Native / Expo visual regression scaffold.
- [`templates/component.native.test.stories.tsx`](./templates/component.native.test.stories.tsx)
  — React Native / Expo interaction test scaffold.
- [`templates/auth.config.example.json`](./templates/auth.config.example.json)
  — auth-profile config schema with two example profiles.

---

## Anti-patterns (one-liner — full list in [`rules/anti-patterns.md`](./rules/anti-patterns.md))

- Mixing visual regression stories and interaction tests in the same
  file.
- Naming interaction tests `*.interactions.stories.tsx` or
  `*.spec.stories.tsx` instead of `*.test.stories.tsx`.
- Dynamic values (`new Date()`, `Math.random()`) in story args —
  guarantees Chromatic / Loki false positives.
- Skipping the locator ladder and reaching straight for
  `getByTestId`.
- Storing Storybook credentials in `.env`, `package.json`, or the
  story file itself.
- Generating a `Playground` story whose `argTypes` do not match the
  component's actual prop types.
- Running Playwright CLI in headed mode in CI.

---

## Definition of done

- [ ] Phase 0 preflight passed; platform set; auth profile resolved if
      `--auth` was given.
- [ ] `<name>.stories.tsx` written with a `Default` story (grouped
      variants) and a `Playground` story (unless `--no-playground`).
- [ ] `<name>.test.stories.tsx` written under the `/Tests` namespace
      (unless `--no-interactions`).
- [ ] Storybook compiles with no terminal errors.
- [ ] Playwright CLI confirms the story URL renders.
- [ ] Interaction test passes via the Storybook test runner (if the
      runner is wired up in the repo).
- [ ] No credentials in the generated files.
- [ ] If `--auth <profile>` was used, `storageState.json` is written
      under `.agent/storybook/.auth/` and listed in `.gitignore`.
