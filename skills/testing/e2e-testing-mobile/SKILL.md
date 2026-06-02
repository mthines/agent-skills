---
name: e2e-testing-mobile
description: >
  Plans, generates, runs, and heals end-to-end tests for Expo and React
  Native mobile apps using Maestro (the 2026 standard for RN E2E, adopted
  by Meta, Microsoft, and DoorDash, and integrated with Expo via EAS
  Workflows). Drives a spec-first YAML-flow loop, proposes `testID`
  source diffs (never `accessibilityLabel` reuse), runs Maestro Cloud as
  an EAS job, and stays token-aware via `--shards`, `--retries`, and
  failure-only healing. Use for native flows in Expo / RN apps. Triggers
  on "test this RN flow", "add mobile e2e", "maestro flow", "expo e2e",
  "e2e for react native", "test the native app", "/e2e-testing-mobile".
  Defer to [`e2e-testing`](../e2e-testing/SKILL.md) for web flows and
  the WebView portion of hybrid apps.
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - e2e
    - mobile
    - expo
    - react-native
    - maestro
    - eas-workflows
    - maestro-mcp
    - spec-first
    - locators
    - token-economy
---

# E2E Testing — Mobile (Expo / React Native)

Drive native mobile end-to-end tests through Maestro and Maestro MCP.
The user writes (or approves) a Markdown feature spec; an agent emits a
Maestro YAML flow, runs it against a simulator or Maestro Cloud, and
self-heals when locators drift.

This is the **mobile** counterpart to [`e2e-testing`](../e2e-testing/SKILL.md).
Anything orthogonal to native (web flows, WebViews inside a hybrid app)
defers to that skill.
The two skills compose; they do not overlap.

> **This `SKILL.md` is a thin index.**
> Decision rules live in [`rules/*.md`](./rules) and load on demand.
> Worked references (Maestro CLI surface, MCP tool catalog, EAS Workflow
> wiring, Detox legacy notes, mobile pyramid math) live in
> [`references/*.md`](./references).
> Literal boilerplate the skill emits lives in
> [`templates/*.md`](./templates).
> Do not preload everything — load only what the current phase asks for.

---

## When to use

Reach for this skill when any of the following is true:

- An Expo or React Native app needs E2E coverage of a native user flow.
- A bug only repros across native navigation, deep links, push,
  permissions prompts, or a real device sensor.
- A flake needs a Maestro heal pass instead of a manual locator hunt.
- The repo has no `.maestro/` flows or EAS E2E build profile yet and
  needs Phase 0 setup.

Do **not** reach for this skill when:

- A unit or component test would catch the same bug — defer to
  [`tdd`](../../quality/tdd/SKILL.md) and the layer rule in
  [`rules/layer-decision.md`](./rules/layer-decision.md).
- The flow is browser-only — defer to
  [`e2e-testing`](../e2e-testing/SKILL.md).
- The flow lives entirely inside a WebView in a hybrid app — defer to
  [`e2e-testing`](../e2e-testing/SKILL.md), which automates the WebView
  via Playwright while Maestro handles native chrome around it.
- The change is a pure refactor with no behavioural surface.

---

## Phase 0 — Preflight (mandatory gate)

Before any agent loop, verify the repo is wired for Maestro on Expo / RN.
Halt and ask the user before installing anything or producing builds.

Run these checks (read-only):

```bash
# 1. Maestro CLI installed?
maestro --version 2>/dev/null

# 2. Flow directory present?
ls -d .maestro 2>/dev/null

# 3. EAS build profile for E2E exists?
jq '.build | has("e2e")' eas.json 2>/dev/null

# 4. Simulator / emulator available?
xcrun simctl list devices available 2>/dev/null | grep -E 'iPhone'
adb devices 2>/dev/null

# 5. Existing Detox install (legacy escape hatch)?
jq '.devDependencies | has("detox")' package.json 2>/dev/null
```

Decision table:

| State                                                       | Action                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Maestro CLI present + `.maestro/` exists + `eas.json` `e2e` profile | Proceed to Phase 1.                                                |
| Maestro CLI missing                                         | **Halt.** Print install plan ([`templates/install-plan.md`](./templates/install-plan.md)). Ask permission. |
| `.maestro/` missing                                         | **Halt.** Propose creating `.maestro/` with the [`templates/flow.yaml`](./templates/flow.yaml) starter. Ask first. |
| `eas.json` `e2e` build profile missing                      | **Halt.** Propose [`templates/eas-build-profile.json`](./templates/eas-build-profile.json). Ask first.            |
| No simulator / emulator running                             | **Halt.** Ask the user to boot one, or proceed with Maestro Cloud only.     |
| Existing Detox suite detected                               | Note it. Read [`references/detox-legacy.md`](./references/detox-legacy.md) before proposing migration. |
| Bare RN project (no `expo` / no `eas.json`)                 | Skip EAS-specific checks. Use Maestro CLI directly against a local build.   |

Print the exact commands; do not run them silently.
The full install plan template is in [`templates/install-plan.md`](./templates/install-plan.md).

---

## Phase 1 — Spec-first feature flow

The agent loop is **spec → emit-flow → run → heal**.
The spec is human-readable Markdown; the executable artefact is a
Maestro YAML flow.
Full rules: [`rules/spec-first-flow.md`](./rules/spec-first-flow.md).

```
specs/<flow>.md   ─┐
                   ├─→  emit  ─→  .maestro/<flow>.yaml  ─→  run  ─→  pass?
                   │                                                   │ no
                   │                                                   ▼
                   └─────────────────  heal  ←──────────────  failing flow + trace
                                          │
                                          ▼
                          patched flow or `testID` source-diff proposal
```

Two entry points:

1. **Spec already drafted by the user.**
   Skip exploration; emit the flow from `specs/<flow>.md`.
2. **App exists, no spec yet.**
   Run an exploratory pass against a running build (simulator) and
   draft `specs/<flow>.md`.
   The user reviews the Markdown before flow emission.

Use the Markdown template in
[`../e2e-testing/templates/spec.md`](../e2e-testing/templates/spec.md).
The spec format is identical across web and mobile — share it.

### Locator ladder for React Native (when generating or healing)

The Maestro flow walks the platform accessibility tree.
Pick locators in this order — never skip a rung:

1. `id: <testID>` — the source-of-truth selector for E2E.
   Mapped to `accessibilityIdentifier` on iOS and `resource-id` on
   Android (RN 0.64+). Stable across i18n and refactors.
2. `text: <visible string>` — only when the text is short, unique on
   screen, and not localised.
3. `accessibilityText: <label>` — last resort, with caveats.
   See [`rules/locator-strategy.md`](./rules/locator-strategy.md) for
   why `accessibilityLabel` should **not** double as a test selector.

`testID` is the standard fix, not an escape hatch.
When the Healer cannot find a stable element at rung 1, propose a
**source diff** that adds `testID` to the component (use the
`setTestId` helper in
[`templates/testid-helper.tsx`](./templates/testid-helper.tsx) to keep
iOS and Android consistent), and offer the diff for user approval
before patching the flow.
Full rules: [`rules/locator-strategy.md`](./rules/locator-strategy.md).

---

## Phase 2 — Token-aware execution

Maestro flows are YAML, not pixel snapshots — the per-step token cost
is already an order of magnitude below screenshot-driven runners.
Defaults the skill prescribes
(full rules: [`rules/token-budget.md`](./rules/token-budget.md)):

- Run only the changed flow on iteration: `maestro test .maestro/<flow>.yaml`.
- Use `--shards` only on Maestro Cloud, never on local iteration.
- `record_screen: false` by default; flip to `true` only when chasing a
  visual race.
- `retries: 1` for local, `retries: 2` for Maestro Cloud.
- Run the Healer **only on failure**, not on every save.
- Reuse a cached signed-in `app.app` / `app.apk` from the EAS E2E
  build profile — never rebuild on every flow run.
- Cap the heal loop at three attempts per failing flow before
  escalating.

---

## Phase 3 — Verification

After the agent emits a flow:

1. Run the flow once against a simulator or device.
   It must pass on first run, or the Healer must converge in ≤ 3 attempts.
2. Invoke [`test-provenance-guard`](../../quality/test-provenance-guard/SKILL.md) on
   any TypeScript helpers the flow imports (e.g. fixture builders) to
   ensure they call production code instead of a private re-implementation.
3. Open `.github/workflows/eas-e2e.yml` (or the EAS Workflow YAML) and
   confirm the `maestro-cloud` job is wired with `retries: 2` and
   `record_screen: false` per
   [`templates/eas-workflow.yaml`](./templates/eas-workflow.yaml).

If the heal loop fails to converge:

- Invoke `confidence(analysis)` on the flow failure.
- If confidence is below 90%, escalate to the user with the Maestro
  log, the spec, and the proposed locator changes — do **not** keep
  healing blindly.

---

## Decision flow at a glance

| Signal                                                            | Do                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Bug fixable by a unit or component test                           | Use [`tdd`](../../quality/tdd/SKILL.md), not this skill.                                       |
| Flow is browser-only or pure web                                  | Use [`e2e-testing`](../e2e-testing/SKILL.md), not this skill.                       |
| Flow lives inside a WebView in a hybrid RN app                    | Pair with [`e2e-testing`](../e2e-testing/SKILL.md) for the WebView; Maestro for the native chrome. |
| Multi-screen native flow, deep links, permissions, or push        | Spec-first feature flow (Phase 1).                                                  |
| Flaky existing flow                                               | Healer pass only; do not rewrite without spec context.                              |
| Locator unstable, no stable `testID`                              | Propose `testID` diff via the `setTestId` helper.                                   |
| Repo missing Maestro CLI or `.maestro/` or `eas.json` E2E profile | Phase 0 halt + ask permission.                                                      |
| Heal loop > 3 attempts                                            | Stop, run `confidence(analysis)`, escalate.                                     |
| Flow passes on first run, never seen failing                      | Verify any imported helpers via `test-provenance-guard` before declaring done.      |
| Existing Detox suite is green and stable                          | Keep it; see [`references/detox-legacy.md`](./references/detox-legacy.md).          |
| Detox suite is brittle through RN upgrades                        | Migrate flow-by-flow to Maestro; do not rewrite the whole suite at once.            |

---

## Composes with

- [`e2e-testing`](../e2e-testing/SKILL.md) — owns web E2E and the
  WebView half of hybrid mobile apps. This skill defers to it for
  anything browser-shaped.
- [`tdd`](../../quality/tdd/SKILL.md) — owns the unit and component layers
  (Jest + React Native Testing Library). This skill defers for
  anything below E2E.
- [`test-provenance-guard`](../../quality/test-provenance-guard/SKILL.md) — runs
  on TypeScript helpers imported by flows to catch tests-by-construction.
- [`confidence`](../../quality/confidence/SKILL.md) — gate when the heal loop fails.
- [`holistic-analysis`](../../analysis/holistic-analysis/SKILL.md) — if a flow is
  failing for reasons no flow rewrite can fix, step back instead of
  patching.
- [`ux`](../../design/ux/SKILL.md) — review accessibility labels separately from
  test IDs (the two should never share a value).

---

## References

- [`references/maestro-cli.md`](./references/maestro-cli.md) — CLI surface
  (`launchApp`, `tapOn`, `assertVisible`, `runFlow`, Studio, doctor).
- [`references/maestro-mcp.md`](./references/maestro-mcp.md) — Maestro
  MCP tools for agent-driven flow generation and healing.
- [`references/eas-workflows.md`](./references/eas-workflows.md) —
  `eas.json` E2E profile, `.maestro/` layout, `maestro-cloud` job
  parameters (`build_id`, `flow_path`, `shards`, `retries`,
  `record_screen`, `device_identifier`).
- [`references/detox-legacy.md`](./references/detox-legacy.md) — when
  to keep an existing Detox suite vs. migrate.
- [`references/pyramid-mobile.md`](./references/pyramid-mobile.md) —
  pyramid math for Expo / RN with Jest, React Native Testing Library,
  and Maestro.

## Templates

- [`templates/install-plan.md`](./templates/install-plan.md) — Phase 0
  halt message with the exact commands to install Maestro + EAS CLI
  and scaffold `.maestro/`.
- [`templates/flow.yaml`](./templates/flow.yaml) — sample Maestro flow
  with `launchApp`, `tapOn` (`id:` and `text:` forms), `assertVisible`,
  and `runFlow` includes.
- [`templates/eas-workflow.yaml`](./templates/eas-workflow.yaml) — EAS
  Workflow with a build job and a `maestro-cloud` job.
- [`templates/eas-build-profile.json`](./templates/eas-build-profile.json)
  — `eas.json` snippet for an `e2e` profile producing `.apk` and `.app`.
- [`templates/testid-helper.tsx`](./templates/testid-helper.tsx) —
  `setTestId` helper that maps `testID` and `accessibilityLabel`
  correctly per platform without conflating the two.

---

## Anti-patterns (one-liner — full list in [`rules/anti-patterns.md`](./rules/anti-patterns.md))

- Writing E2E for logic a unit or RNTL component test catches.
- Reusing `accessibilityLabel` as the test selector (it is for screen
  readers; doubling its purpose breaks accessibility).
- Patching the flow with absolute coordinates (`tapOn: { point: "50%, 80%" }`)
  instead of proposing a `testID` diff.
- Running the Healer on every save, or on a passing flow.
- Rebuilding the `.app` / `.apk` on every flow run.
- Generating flows against a stub server, not the real app stack.
- Migrating a stable Detox suite all at once instead of flow-by-flow.

---

## Definition of done

- [ ] Phase 0 preflight passed or installs were user-approved.
- [ ] `specs/<flow>.md` exists and the user reviewed it.
- [ ] `.maestro/<flow>.yaml` passes against a real build.
- [ ] Any imported TS helpers pass `test-provenance-guard`.
- [ ] EAS Workflow `maestro-cloud` job runs the flow on Cloud with
      `retries: 2` and `record_screen: false`.
- [ ] If a `testID` was added, it is in the source diff and committed,
      with no `accessibilityLabel` reuse.
