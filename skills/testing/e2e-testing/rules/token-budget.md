---
title: Token Budget — Snapshot Mode, --last-failed, Heal Caps
impact: HIGH
tags:
  - tokens
  - performance
  - snapshot-mode
  - vision-mode
  - ci
---

# Token Budget

## Contents

- [Defaults](#defaults)
- [Snapshot vs vision mode](#snapshot-vs-vision-mode)
- [CI vs local iteration](#ci-vs-local-iteration)
- [Heal loop economics](#heal-loop-economics)
- [Reusing storage state](#reusing-storage-state)
- [When to enable vision mode](#when-to-enable-vision-mode---capsvision)
- [Anti-patterns](#anti-patterns)
- [Cross-references](#cross-references)

Every agent call against a live page reads a page representation.
In snapshot mode that representation is text (the accessibility tree).
In vision mode it is pixels.
Pixels cost orders of magnitude more.

This file lists the defaults the skill prescribes and when each may be
overridden.

## Defaults

| Setting                       | Default                              | Override only when                                                 |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| MCP mode                      | Snapshot (`--caps=` not set)         | Visual regression check on a static layout.                        |
| Healer trigger                | Failure only                         | Never on every save, never on green.                               |
| Test selection on iteration   | `--last-failed`                      | Initial CI run uses the full suite.                                |
| Auth bootstrap                | `storageState` from `tests/seed.spec.ts` | First run after credential rotation.                            |
| Heal-loop cap per failing test | 3 attempts                          | Never raise without user approval — escalate via `confidence`.     |
| Trace                         | `'on-first-retry'`                   | `'on'` only when chasing a confirmed flake.                        |

## Snapshot vs vision mode

**Snapshot (default).**
The MCP server returns the accessibility tree.
Each element has a role, name, and reference id.
The agent picks elements by ref id, not by pixel coordinate.

**Vision (`--caps=vision`).**
The agent receives a screenshot and returns coordinates.
Use only when:

- The element is rendered to canvas with no DOM presence.
- The test is a visual regression check.
- A pixel-level concern (color, position) is the actual assertion.

For everything else, snapshot mode is faster, cheaper, and more reliable.

## CI vs local iteration

```bash
# Local iteration on a single failing test.
npx playwright test --last-failed

# CI — full suite, multi-browser project.
npx playwright test --reporter=blob
```

`--last-failed` only runs tests that failed in the last run.
Use it during the heal loop.
Never use it in CI — CI must run the full suite.

## Heal loop economics

A single Healer attempt typically:

1. Reads the failing test.
2. Reads the spec.
3. Snapshots the live page (text, accessibility tree).
4. Proposes a patch.
5. Re-runs the test.

Three attempts is enough to either converge or expose a structural problem.
Beyond three, the agent is usually guessing.
The skill's [`rules/spec-first-flow.md`](./spec-first-flow.md) escalates via
`confidence(analysis)` at the cap — do not raise the cap silently.

## Reusing storage state

`tests/seed.spec.ts` runs once per project and saves authenticated cookies
and local storage to `storageState.json`.
Every other test reuses it via `playwright.config.ts`:

```ts
// playwright.config.ts (excerpt)
use: {
  storageState: 'storageState.json',
}
```

Without this, every test re-runs sign-in.
That is the single biggest token leak in an agent-driven E2E suite.

## When to enable vision mode (`--caps=vision`)

Concrete triggers:

- Asserting an SVG chart renders a specific shape.
- Asserting a canvas-rendered editor cursor is in the right place.
- Visual regression — the test is "this page looks right".

In every other case, snapshot mode wins.

## Anti-patterns

- Running the full suite on every save.
  Use `--last-failed` until the failing test goes green.
- Enabling vision mode "just in case".
  The token cost is real — opt in deliberately.
- Capturing traces on every test run.
  `'on-first-retry'` already captures every failure once.
- Letting the heal loop run unbounded.
  Three attempts then escalate.

## Cross-references

- Spec-first loop: [`rules/spec-first-flow.md`](./spec-first-flow.md).
- MCP tool surface: [`references/mcp-tool-catalog.md`](../references/mcp-tool-catalog.md).
