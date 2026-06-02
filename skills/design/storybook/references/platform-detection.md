---
title: Platform Detection — Web vs Native
impact: REFERENCE
tags:
  - storybook
  - platform
  - frameworks
  - reference
---

# Platform Detection

How the skill decides whether a repo is web Storybook, React Native /
Expo Storybook, or both.
Load this reference only when Phase 0 preflight is ambiguous.

## Contents

- Detection signals
- Framework / adapter matrix
- Mixed-platform monorepos
- Edge cases

## Detection signals

Run all four checks in Phase 0; combine the signals.

| Signal                                                             | Implies                              |
| ------------------------------------------------------------------ | ------------------------------------ |
| `dependencies.react-native` or `peerDependencies.react-native`      | Native (RN bare or Expo).            |
| `dependencies.expo` or `peerDependencies.expo`                      | Native (Expo).                       |
| `devDependencies.@storybook/react-native`                           | Native — on-device Storybook.        |
| `devDependencies.@storybook/react-native-web`                       | Native — RN Web preview.             |
| `devDependencies.@storybook/react-vite`                             | Web — Vite + React.                  |
| `devDependencies.@storybook/nextjs` or `@storybook/nextjs-vite`     | Web — Next.js.                       |
| `app.json` with an `expo` block at the repo root                    | Native (Expo).                       |
| `.storybook/main.ts` exists                                         | Web — standard config dir.           |
| `.ondevice/` directory exists                                       | Native — on-device Storybook layout. |

Combining rules:

- `react-native` present **and** `@storybook/react-native-web` →
  Native, RN Web preview.
- `react-native` present **and** `@storybook/react-native` →
  Native, on-device.
- Neither → Web.
- Both web and native Storybook in the same package → ask the user
  which one to target; do not guess.

## Framework / adapter matrix

| Framework             | Builder         | Storybook adapter             | Test runner                       |
| --------------------- | --------------- | ----------------------------- | --------------------------------- |
| Vite + React          | Vite            | `@storybook/react-vite`       | `npm run test-storybook`          |
| Next.js (Vite default since SB 9) | Vite | `@storybook/nextjs-vite`      | `npm run test-storybook`          |
| Next.js (Webpack)     | Webpack         | `@storybook/nextjs`           | `npm run test-storybook`          |
| Remix                 | Vite            | `@storybook/react-vite`        | `npm run test-storybook`          |
| Astro (React island)  | Vite            | `@storybook/react-vite`        | `npm run test-storybook`          |
| React Native / Expo (on-device) | Metro | `@storybook/react-native`     | On-device runner (no Playwright).  |
| React Native Web      | Vite or Webpack | `@storybook/react-native-web`  | `npm run test-storybook`          |

The skill uses the adapter import path verbatim in the generated
template.
Read the version from `package.json` to avoid pinning to a removed
adapter.

## Mixed-platform monorepos

A monorepo can have one web Storybook (e.g. `apps/web`) and one
native Storybook (e.g. `apps/mobile`).
Detect by running Phase 0 inside the **package directory of the
component**, not the repo root.

If the component sits in `packages/ui` and is consumed by both apps,
ask the user which Storybook surface they want — usually the web one,
because that is where Chromatic is wired up.

## Edge cases

- **No package.json at all.** Halt; this skill only operates on
  npm/yarn/pnpm projects.
- **`@storybook/*` v6 or v7.** Halt; this skill emits CSF3 + tags +
  `storybook/test` imports that v6 / v7 do not understand.
  Suggest upgrading first.
- **A repo that uses `npm test` to run Storybook tests.** Inspect the
  `scripts` block; do not guess the runner.
- **A repo with a custom test runner wrapper (e.g. `bun test`,
  `vitest-storybook`).** Generated tests should still work, but the
  verification command in Phase 5 is the wrapper, not bare
  `test-storybook`.
