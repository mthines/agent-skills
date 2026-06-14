---
title: Bootstrap — First-Run Surface Creation
impact: HIGH
tags:
  - bootstrap
  - surface
  - project-setup
---

# Bootstrap

## Contents

- [When bootstrap runs](#when-bootstrap-runs)
- [Step 1 — Compute the project key](#step-1--compute-the-project-key)
- [Step 2 — Detect the stack](#step-2--detect-the-stack)
- [Step 3 — Load the detector template](#step-3--load-the-detector-template)
- [Step 4 — Customize the template](#step-4--customize-the-template)
- [Step 5 — Propose the surface diff and wait for approval](#step-5--propose-the-surface-diff-and-wait-for-approval)
- [Step 6 — Write the surface file](#step-6--write-the-surface-file)
- [Edge cases](#edge-cases)

Bootstrap runs when no surface file exists for the current project.
Its job: detect the test stack, propose a surface file diff, wait for user
approval, then write the file.

Bootstrap does NOT run the tests. It only creates the surface file that tells
the skill how to run the tests on subsequent invocations.

## When bootstrap runs

In Phase 0 of [`../SKILL.md`](../SKILL.md), after the project key is computed
and the surface file is confirmed absent.

## Step 1 — Compute the project key

Per [`project-keying.md`](./project-keying.md).
The key becomes the filename: `surfaces/<project-key>.md`.

## Step 2 — Detect the stack

Look for these files in the project root (and common subdirectories):

| Stack | Detection signal |
| --- | --- |
| **Vitest** | `vitest.config.ts`, `vitest.config.js`, `vitest.config.mts`, or `"vitest"` in `package.json` devDependencies |
| **Jest** | `jest.config.ts`, `jest.config.js`, `jest.config.cjs`, or `"jest"` in `package.json` devDependencies |
| **Deno** | `deno.json`, `deno.jsonc`, or `deno.lock` present |
| **Playwright** | `playwright.config.ts`, `playwright.config.js`, or `"@playwright/test"` in devDependencies |
| **Pytest** | `pytest.ini`, `pyproject.toml` with `[tool.pytest.ist-options]`, `setup.cfg` with `[tool:pytest]`, or `pytest` in `requirements*.txt` |
| **Maestro** | `.maestro/` directory or `*.yaml` files with Maestro `appId:` keys |
| **Storybook** | `.storybook/` directory AND (`"@storybook/addon-vitest"` or `"@storybook/test-runner"`) in devDependencies |

Read `package.json` (or `pyproject.toml`, `deno.json`) to confirm detection.
For JavaScript/TypeScript monorepos, check the root AND all `apps/*/package.json` files.

### Dominant stack selection

If multiple stacks are detected:

1. Prefer the stack that has the most test files (glob `**/*.test.*`, `**/*.spec.*`).
2. If Storybook is detected alongside Vitest or Jest, create separate surfaces:
   one for unit tests and one for Storybook interaction tests.
3. Note all detected stacks in the surface file's free-text Notes section.

## Step 3 — Load the detector template

Load the matching detector from [`../detectors/`](../detectors/):

- Vitest → `detectors/vitest.md`
- Jest → `detectors/jest.md`
- Deno → `detectors/deno.md`
- Playwright → `detectors/playwright.md`
- Pytest → `detectors/pytest.md`
- Maestro → `detectors/maestro.md`
- Storybook → `detectors/storybook.md`

## Step 4 — Customize the template

Fill in the template's placeholder values based on the detected project:

- `project-key` — from Step 1.
- `detect-command` — from the project's `package.json` scripts, `Makefile`, or Nx targets (if present).
  Prefer the project's own canonical test command over a raw runner invocation.
  Example: if `package.json` has `"test": "vitest run"`, use that form.
- `single-test-command` — infer from the detect command. Most runners accept a file path and `-t "<name>"`.
- `failure-parser` — use the stack's canonical regex from the detector file.
  Adjust if the project uses a custom reporter that changes the output format.
- `cache-bust-flag` — include if the detect command goes through a caching layer (Nx, Turborepo, Bazel).

## Step 5 — Propose the surface diff and wait for approval

Present the proposed surface file to the user:

```
Bootstrap detected: <stack>
Project key: <key>
Surface file: surfaces/<key>.md

Proposed surface:
---
<full surface file content>
---

Please review and confirm. You can edit the commands before I write the file.
Confirm with "yes" or provide corrections.
```

**Do NOT write the file until the user confirms.**
If the user provides corrections, apply them and show the updated content before writing.

## Step 6 — Write the surface file

After approval:

1. Create the `surfaces/` directory if it does not exist.
2. Write the surface file to `surfaces/<project-key>.md`.
3. Confirm:
   ```
   Surface written: surfaces/<project-key>.md
   Proceeding to Phase 1.
   ```

## Edge cases

| Edge case | Handling |
| --- | --- |
| No stack detected | Ask the user which stack to use; fall back to `templates/surface.md` as a blank template |
| Multiple monorepo packages with different stacks | Create one surface per package; name them `<project-key>-<package>.md` |
| Private registry / custom runner | Fill `detect-command` with a placeholder and tell the user to complete it |
| `--surface <path>` passed | Skip bootstrap entirely; use the provided file directly |
