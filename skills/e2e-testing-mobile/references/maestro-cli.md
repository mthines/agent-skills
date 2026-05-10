---
title: Maestro CLI — Reference
impact: HIGH
tags:
  - maestro
  - cli
  - flow-commands
  - reference
---

# Maestro CLI — Reference

## Contents

- [Origin and adoption](#origin-and-adoption)
- [Install](#install)
- [Flow command surface](#flow-command-surface)
- [CLI surface](#cli-surface)
- [Maestro Studio](#maestro-studio)
- [Maestro Doctor](#maestro-doctor)
- [Sources](#sources)

## Origin and adoption

Maestro is an open-source mobile-and-web E2E framework from
mobile.dev.
By 2026 it is the de-facto standard for React Native E2E:

- **Meta** uses Maestro for end-to-end testing of the React Native
  framework itself.
- **Microsoft** and **DoorDash** adopted Maestro over Detox / Appium.
- **Expo** ships first-class support via the
  [`maestro-cloud` EAS Workflow job](./eas-workflows.md).

Maestro takes a black-box approach: it interacts with the app via the
OS accessibility layer (UIAutomator on Android, XCUITest on iOS), so
it does not require modifying the app under test.
Reported flake rates are < 1% on production RN suites with a few
hundred flows.

## Install

```bash
# macOS / Linux.
curl -Ls "https://get.maestro.mobile.dev" | bash

# Verify.
maestro --version
```

No native code modifications are required in the React Native app.
Compare with Detox, which patches the build — see
[`detox-legacy.md`](./detox-legacy.md).

## Flow command surface

A Maestro flow is a YAML file that declares the `appId` once and then
lists steps.
The most useful commands:

| Command                           | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `launchApp`                       | Cold-launch the app. Optional `clearState`, `arguments`, `permissions`. |
| `tapOn`                           | Tap an element by `id`, `text`, `accessibilityText`, `index`, or `point` (avoid `point`). |
| `inputText`                       | Type into a focused input.                                     |
| `eraseText`                       | Clear an input.                                                |
| `pressKey`                        | Hardware-style key (`Home`, `Back`, `Enter`).                  |
| `swipe`                           | Directional swipe between two anchors or coordinates.          |
| `scroll` / `scrollUntilVisible`   | Scroll within a list; `scrollUntilVisible` accepts a target.  |
| `assertVisible`                   | Assert an element is on screen.                                |
| `assertNotVisible`                | Assert an element is not on screen.                            |
| `assertTrue`                      | Assert a JS expression evaluated against the app context.      |
| `extendedWaitUntil`               | Smart wait with a `visible` / `notVisible` predicate.          |
| `waitForAnimationToEnd`           | Wait for animations to settle (cap with `timeout`).            |
| `runFlow`                         | Inline-include another YAML flow (use for sign-in, fixtures). |
| `runScript`                       | Run a JS snippet in Maestro's JS engine for setup or assertions. |
| `openLink`                        | Open a deep link (`myapp://...`) or a universal link.         |
| `evalScript`                      | Evaluate JS and store the result for later steps.             |

A worked example lives in
[`../templates/flow.yaml`](../templates/flow.yaml).

## CLI surface

```bash
# Run a single flow.
maestro test .maestro/auth/sign-in.yaml

# Run a directory tree (all .yaml files under .maestro/).
maestro test .maestro

# Pick a specific simulator / emulator.
maestro test --device <udid> .maestro/auth/sign-in.yaml

# Local retries for one run.
maestro test --retry 1 .maestro/auth/sign-in.yaml

# Record a screen video into the report.
maestro test --output report.html --record-video .maestro/

# Dry-run a flow (parse + lint, no execution).
maestro test --debug-output --no-run .maestro/auth/sign-in.yaml
```

For Maestro Cloud sharding and CI parameters, see
[`eas-workflows.md`](./eas-workflows.md).

## Maestro Studio

Studio is an interactive recorder.
It opens a window showing the booted app, lets the user click through
a flow, and emits a draft YAML.

```bash
maestro studio
```

Use Studio for the **exploratory pass** in
[`../rules/spec-first-flow.md`](../rules/spec-first-flow.md) Path B.
Always convert the recorded YAML into a Markdown spec before
committing the flow — the spec is the human contract.

## Maestro Doctor

`maestro doctor` checks the local environment (Java, ADB,
xcrun simctl, available simulators) and reports issues.
Run it whenever a flow fails for a non-flow reason.

```bash
maestro doctor
```

## Sources

- [Maestro docs](https://docs.maestro.dev/)
- [Maestro on GitHub](https://github.com/mobile-dev-inc/Maestro)
- [Maestro vs. Detox flake comparison](https://maestro.dev/insights/detox-vs-maestro-reducing-flakiness-react-native)
- [Meta adoption note](https://maestro.dev/blog/how-maestro-is-reinventing-mobile-test-automation)
