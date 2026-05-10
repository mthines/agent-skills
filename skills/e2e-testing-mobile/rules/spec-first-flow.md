---
title: Spec-First Flow — Markdown Spec to Maestro YAML
impact: HIGH
tags:
  - spec-first
  - maestro
  - workflow
  - heal-loop
---

# Spec-First Flow

## Contents

- [Folder layout](#folder-layout)
- [Step 1 — Author or refresh the spec](#step-1--author-or-refresh-the-spec)
- [Step 2 — Emit the Maestro flow](#step-2--emit-the-maestro-flow)
- [Step 3 — Run](#step-3--run)
- [Step 4 — Heal (only on failure)](#step-4--heal-only-on-failure)
- [Spec template — minimum sections](#spec-template--minimum-sections)
- [When to update the spec](#when-to-update-the-spec)
- [Cross-references](#cross-references)

The agent loop has four steps: **spec → emit → run → heal**.
The spec is human-readable Markdown.
The executable artefact is YAML (`.maestro/<flow>.yaml`).
Flows are derived from the spec, not the other way round.

## Folder layout

```
repo/
├── specs/
│   ├── auth/
│   │   └── sign-in.md
│   └── workout/
│       └── start-workout.md
├── .maestro/
│   ├── shared/
│   │   └── sign-in.yaml          # reusable, included via runFlow
│   ├── auth/
│   │   └── sign-in.yaml          # emitted from specs/auth/sign-in.md
│   └── workout/
│       └── start-workout.yaml
├── eas.json                      # E2E build profile
└── .github/workflows/eas-e2e.yml # or .eas/workflows/e2e.yml
```

Convention: a spec at `specs/<area>/<flow>.md` produces a flow at
`.maestro/<area>/<flow>.yaml`.
One spec per user-visible flow.
Reusable sub-flows (sign-in, seed data) live under `.maestro/shared/`
and are pulled in via `runFlow`.

## Step 1 — Author or refresh the spec

Two paths.
Pick based on whether the user already knows the flow.

### Path A — User-authored spec

The user writes `specs/<area>/<flow>.md`.
The skill reuses the **same Markdown spec template** as the web
counterpart — see
[`../../e2e-testing/templates/spec.md`](../../e2e-testing/templates/spec.md).
This is the default path when the feature is new.

### Path B — Exploratory pass on a running build

When the feature already exists in the app and no spec captures it,
launch the build on a simulator and walk the flow with Maestro Studio:

```bash
# Boot simulator, install the dev or e2e build, then:
maestro studio
```

Studio is an interactive recorder.
The user clicks through the flow; Maestro emits a draft YAML.
Convert the draft into a Markdown spec **before** committing the flow —
the spec is the human-readable contract; the YAML is the executable.

The user reviews the spec **before** flow emission.
The plan is in Markdown — the diff is readable.

## Step 2 — Emit the Maestro flow

Translate the approved spec into `.maestro/<area>/<flow>.yaml`.
The agent walks the spec step by step and picks locators from the
ladder in [`locator-strategy.md`](./locator-strategy.md).

Constraints the agent follows:

- Locator ladder — see [`locator-strategy.md`](./locator-strategy.md).
- Reuses sign-in via `runFlow: ../shared/sign-in.yaml` — never
  re-implements auth.
- One `assertVisible` (or `assertNotVisible`) per spec assertion.
- No comments restating the spec — the spec is the comment.
- Prefer `extendedWaitUntil` over fixed `waitForAnimationToEnd: 5000`
  — Maestro's smart waits read the OS event loop.

Example structure (full sample in
[`../templates/flow.yaml`](../templates/flow.yaml)):

```yaml
appId: com.example.fit
---
- runFlow: ../shared/sign-in.yaml
- tapOn:
    id: 'start-workout'
- extendedWaitUntil:
    visible:
      id: 'workout-timer'
    timeout: 5000
- assertVisible:
    text: '00:00'
```

## Step 3 — Run

```bash
# Local — single flow against a booted simulator.
maestro test .maestro/workout/start-workout.yaml

# Local — full suite (Maestro discovers all .yaml under .maestro/).
maestro test .maestro
```

Build prerequisites:

- iOS simulator: an `.app` produced by the `e2e` EAS build profile.
- Android emulator: an `.apk` produced by the same profile.
- Maestro auto-detects the booted simulator/emulator. If multiple are
  running, pass `--device <id>`.

If the flow passes on the first run, run
[`test-provenance-guard`](../../test-provenance-guard/SKILL.md) on any
TypeScript helpers the flow imports (fixture builders, deep-link
generators) before declaring done.
A first-pass green is a signal those helpers may not exercise
production code.

## Step 4 — Heal (only on failure)

The Healer runs only when a flow fails.
Do not run it on every save.

Inputs the Healer receives:

- The failing flow (`.yaml`).
- The Maestro run log.
- The screen recording (only if `record_screen: true` was on for the
  failing run — off by default).
- The spec (`.md`).

Heal-loop cap: **three attempts per failing flow**.
At the cap:

1. Stop the loop.
2. Run `confidence(bug-analysis)` on the failure.
3. If confidence ≥ 90% the locator change is correct, apply and re-run.
4. If confidence < 90%, escalate to the user with the log, the spec,
   and the proposed diff.

When the Healer reaches an element with no stable `testID`:

- Do **not** patch the flow with a coordinate or a localised string.
- Propose a `testID` source diff per
  [`locator-strategy.md`](./locator-strategy.md).

## Spec template — minimum sections

Reuse the canonical template from the web skill:
[`../../e2e-testing/templates/spec.md`](../../e2e-testing/templates/spec.md).

Required sections (identical to web):

1. **Goal** — one sentence, user-facing outcome.
2. **Preconditions** — who is signed in, what data is seeded, which
   build (`e2e` profile, debug, release).
3. **Flow** — numbered, imperative steps (one user action per step).
4. **Assertions** — what must be true after the flow ends.
5. **Out of scope** — what this spec deliberately does **not** test.

Add a mobile-specific section when relevant:

6. **Platform notes** — iOS-only, Android-only, or behaviour that
   differs between the two (e.g. permission prompts, deep-link schemes,
   back-gesture vs. hardware back).

## When to update the spec

Update the spec, not the flow, when the user-facing flow changes.
Re-emit the YAML after a spec edit.
The agent will diff the existing YAML against the new spec and offer a
patch instead of regenerating from scratch.

## Cross-references

- Locator rules: [`locator-strategy.md`](./locator-strategy.md).
- Token discipline: [`token-budget.md`](./token-budget.md).
- Maestro CLI surface:
  [`../references/maestro-cli.md`](../references/maestro-cli.md).
- Maestro MCP surface (for agent-driven generation):
  [`../references/maestro-mcp.md`](../references/maestro-mcp.md).
