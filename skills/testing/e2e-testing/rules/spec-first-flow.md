---
title: Spec-First Flow — Planner, Generator, Healer
impact: HIGH
tags:
  - spec-first
  - planner
  - generator
  - healer
  - workflow
---

# Spec-First Flow

## Contents

- [Folder layout](#folder-layout)
- [Step 1 — Author or refresh the spec](#step-1--author-or-refresh-the-spec)
- [Step 2 — Generate](#step-2--generate)
- [Step 3 — Run](#step-3--run)
- [Step 4 — Heal (only on failure)](#step-4--heal-only-on-failure)
- [Spec template — minimum sections](#spec-template--minimum-sections)
- [When to update the spec](#when-to-update-the-spec)
- [Cross-references](#cross-references)

The agent loop has four steps: **spec → generate → run → heal**.
The spec is human-readable Markdown.
Tests are derived from the spec, not the other way round.

## Folder layout

```
repo/
├── specs/
│   ├── auth/
│   │   └── sign-in.md
│   └── dashboard/
│       └── create-project.md
├── tests/
│   ├── seed.spec.ts            # auth and storageState bootstrap
│   └── auth/
│       └── sign-in.spec.ts     # generated from specs/auth/sign-in.md
└── playwright.config.ts
```

Convention: a spec at `specs/<area>/<flow>.md` produces a test at
`tests/<area>/<flow>.spec.ts`.
One spec per user-visible flow.

## Step 1 — Author or refresh the spec

Two paths.
Pick based on whether the user already knows the flow.

### Path A — User-authored spec

The user writes `specs/<area>/<flow>.md` from the
[`templates/spec.md`](../templates/spec.md) template.
This is the default path when the feature is new.

### Path B — Planner explores the live app

When the feature already exists in the app and no spec captures it, run the
Planner agent against the live URL.
The Planner produces a Markdown plan in `specs/<area>/<flow>.md`.

Invocation pattern (from Claude Code with `@playwright/mcp` configured):

```
Planner: explore http://localhost:3000/dashboard, write a spec
for "create project" into specs/dashboard/create-project.md.
```

The user reviews the spec **before** generation.
The plan is in Markdown — the diff is readable.

## Step 2 — Generate

Run the Generator on the approved spec.
The Generator opens the live app, walks the spec step by step, picks
locators from the accessibility tree, and writes `tests/<area>/<flow>.spec.ts`.

Invocation pattern:

```
Generator: generate tests/dashboard/create-project.spec.ts
from specs/dashboard/create-project.md.
```

Constraints the Generator follows:

- Locator ladder — see [`rules/locator-strategy.md`](./locator-strategy.md).
- Reuses `storageState` from `tests/seed.spec.ts` — never re-implements auth.
- One assertion per spec assertion.
- No comments restating the spec — the spec is the comment.

## Step 3 — Run

```bash
npx playwright test tests/dashboard/create-project.spec.ts
```

If the test passes on the first run, run
[`test-provenance-guard`](../../../quality/test-provenance-guard/SKILL.md) before
declaring done.
A first-pass green is a signal the test may not exercise production code.

## Step 4 — Heal (only on failure)

The Healer runs only when a test fails.
Do not run it on every save.

Invocation pattern:

```
Healer: tests/dashboard/create-project.spec.ts is failing on
"create project" — inspect the page, propose a fix.
```

Heal-loop cap: **three attempts per failing test**.
At the cap:

1. Stop the loop.
2. Run `confidence(analysis)` on the failure.
3. If confidence ≥ 90% the locator change is correct, apply and re-run.
4. If confidence < 90%, escalate to the user with the trace, the spec, and
   the proposed diff.

When the Healer reaches a locator that has no stable role / label / text:

- Do **not** patch the test with brittle CSS selectors.
- Propose a `data-testid` source diff.
- See [`rules/locator-strategy.md`](./locator-strategy.md).

## Spec template — minimum sections

The [`templates/spec.md`](../templates/spec.md) file is the canonical form.
Every spec must have:

1. **Goal** — one sentence, user-facing outcome.
2. **Preconditions** — who is signed in, what data is seeded.
3. **Flow** — numbered, imperative steps (one user action per step).
4. **Assertions** — what must be true after the flow ends.
5. **Out of scope** — what this spec deliberately does **not** test.

## When to update the spec

Update the spec, not the test, when the user-facing flow changes.
Re-run the Generator after a spec edit.
The Generator will diff the existing test against the new spec and offer a
patch instead of regenerating from scratch.

## Cross-references

- Locator rules: [`rules/locator-strategy.md`](./locator-strategy.md).
- Token discipline: [`rules/token-budget.md`](./token-budget.md).
- Agent reference: [`references/playwright-agents.md`](../references/playwright-agents.md).
