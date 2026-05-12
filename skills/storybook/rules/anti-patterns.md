---
title: Anti-Patterns — Refuse These Shapes
impact: HIGH
tags:
  - storybook
  - anti-patterns
  - refuse
---

# Anti-Patterns

Refuse to emit any of these.
If the user explicitly asks for one, explain the consequence and offer
the canonical alternative.

## Story files

| Anti-pattern                                                                | Why it is wrong                                                                                | Do instead                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Visual stories + interaction tests in the same file.                        | CSF3 allows one default export — title applies to all stories.                                  | Two files: `<x>.stories.tsx` + `<x>.test.stories.tsx`.                       |
| Interaction file named `*.interactions.stories.tsx` or `*.spec.stories.tsx`. | Repo convention is `.test.stories.tsx`. Inconsistency confuses test runners and globs.          | Rename to `*.test.stories.tsx`.                                              |
| `args`-only `Default` story.                                                | Hard to extend with a `play` function later; each variant becomes a separate snapshot.          | `StoryObj` with a `render` function grouping variants.                       |
| Dynamic values in args (`new Date()`, `Math.random()`, `Date.now()`).       | Guaranteed false positives in any pixel-diff tool (Chromatic, Loki).                            | Static ISO strings, static IDs, static numbers.                              |
| `Math.random()` IDs in mock data.                                           | Same problem — re-renders produce a new pixel.                                                  | Static strings: `"user-1"`, `"item-abc"`.                                    |
| Skipping the locator ladder; reaching for `getByTestId` first.              | Couples the test to source structure; weakens accessibility coverage.                           | `getByRole` → `getByLabelText` → `getByText` → `getByTestId`.                |
| `accessibilityLabel` used as a test selector on native.                     | Doubles assistive-tech metadata as test infra; one change breaks both.                          | Use `testID` for tests; keep `accessibilityLabel` for screen readers.        |

## `play` functions

| Anti-pattern                                                          | Why it is wrong                                                                          | Do instead                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Un-awaited `userEvent.click(...)`.                                    | Flake. Storybook's Interactions panel logs the wrong order.                              | `await userEvent.click(...)`.                                             |
| Un-awaited `expect(...)`.                                             | Same flake risk. Race between assertion and re-render.                                   | `await expect(...)`.                                                      |
| Imports from `@testing-library/*` or `vitest` directly.                | Bypasses Storybook's auto-reset of `fn()` and step instrumentation.                      | Import from `"storybook/test"`.                                           |
| `.only` or `.skip` left on a story.                                   | Silently disables sibling tests in the runner.                                           | Remove before commit. CI should fail if either is present.                |
| Catch-all `try { … } catch {}` around the play body.                  | Swallows assertion failures; the runner sees a "pass" that wasn't one.                   | Let the play function throw. The runner reports the failure.              |
| Composing `play` by calling `Story.play({ canvasElement })` only.     | The play API expects the full context (`step`, `args`).                                  | Pass the full context: `await Other.play!(context)`.                       |

## Auth

| Anti-pattern                                                                  | Why it is wrong                                                                              | Do instead                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Credentials in `.env`, `package.json`, or any committed file.                 | Leaks the secret into git history forever.                                                   | OS keychain via [`rules/auth.md`](./auth.md).                              |
| Logging the password to the terminal during the login flow.                   | Leaks into shell history, CI logs, and any terminal-recording tool.                          | Read from keychain in-process; pass directly to `page.fill`.              |
| One `auth.config.json` per machine.                                            | Breaks team collaboration; profiles drift.                                                   | One config file per repo; keychain holds the per-machine secret.          |
| Storing `storageState.json` outside `.agent/storybook/.auth/`.                | Easy to accidentally commit; harder to gitignore selectively.                                | Always under `.agent/storybook/.auth/` with the dir in `.gitignore`.      |
| Reusing one keychain service name across multiple profiles.                   | A `delete` removes the wrong profile's secret.                                               | `agent-skills.storybook.<repo-slug>.<profile-name>` — unique per profile. |

## Playwright CLI

| Anti-pattern                                                                  | Why it is wrong                                                                              | Do instead                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Headed mode (`playwright open`) in CI.                                        | Requires a display server. CI containers do not have one.                                    | Headless `playwright screenshot` in CI; headed only locally for debugging. |
| Installing Playwright silently when it is missing.                            | Heavy dependency; downloads browsers; the user may not want it.                              | Halt, ask, install only with permission.                                  |
| Leaving the background Storybook process running after the skill exits.       | Stale port. Stale resources. Confuses the next agent run.                                    | Track the PID; kill on exit.                                              |
| Iterating more than twice against the same failing story.                      | Diminishing returns. By round 3 the premise (selector, story id, auth) is almost always wrong, not the impl. | Cap at two; escalate via `confidence(bug-analysis)`.                      |

## Workflow

| Anti-pattern                                                                  | Why it is wrong                                                                              | Do instead                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Scaffolding stories before the component exists.                              | The skill needs to read prop types and variants.                                             | Refuse. Ask the user to point at an existing component.                   |
| Generating an `argTypes` set that does not match the component's prop types.  | Storybook Controls then crash; users lose trust in the Playground.                           | Read the component's `interface`; mirror exactly.                         |
| Skipping Phase 0 preflight and assuming Storybook is installed.               | Some repos have Storybook in a workspace package and not the root.                           | Always run the preflight; halt if `.storybook/` is missing.               |
| Treating the Storybook test runner as optional.                               | Without it, interaction tests never run in CI.                                               | If `test-storybook` is not wired up, propose adding it (separate PR).      |
| Renaming `meta.title` on an existing story file.                              | Every Chromatic / Loki baseline is keyed by the story id derived from the title — the rename orphans them all and the next CI run pays for fresh baselines on every variant. | Warn before renaming. If renaming is genuinely required, mention it explicitly in the PR description and accept the baseline reset. |
