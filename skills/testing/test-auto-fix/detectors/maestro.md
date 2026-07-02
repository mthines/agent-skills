---
title: Maestro Detector
stack: maestro
tags:
  - maestro
  - mobile
  - react-native
  - expo
---

# Maestro Detector

Bootstrap template for projects using Maestro for mobile UI flow tests.

## Detection signals

- `.maestro/` directory in the project root
- `*.yaml` files containing Maestro `appId:` keys
- `maestro` binary on PATH

## Surface starter template

```yaml
---
project-key: <normalised-git-remote-key>
stack: maestro
detect-command: maestro test .maestro/
single-test-command: maestro test "{file}"
failure-parser: '^\s*(?:✗|FAILED|❌)\s+(.+?)\s*$'
# group 1 = flow step description or test name
# Note: Maestro output format varies by version. Adjust regex to match.
cache-bust-flag:
---
# Notes
# Maestro requires a running simulator/emulator.
# For iOS: ensure a booted simulator with the app installed.
# For Android: ensure an emulator with adb connected.
# For Maestro Cloud: maestro cloud .maestro/ --apiKey=$MAESTRO_CLOUD_API_KEY
# Adjust detect-command to target a subdirectory if flows are organized by feature.
```

## Failure output format

```
✗ Tap on "Sign In" button
  com.example.app - Unable to find element with id: "sign-in-button"
  
✗ Assert text "Welcome" is visible
  Expected "Welcome" to be visible, but it was not found
```

Maestro failures are step-level, not test-name-level like unit test runners.
The failure parser captures the step description.

## Single-test re-run

```bash
maestro test .maestro/flows/login.yaml
```

To run a specific flow file with verbose output:
```bash
maestro test .maestro/flows/login.yaml --debug-output /tmp/maestro-debug
```

## Common failure families

- **Element locator drift** — a `testID` or accessibility label was renamed in the app.
  Check the component's current `testID` value before updating the flow.
- **App state mismatch** — the flow assumes a logged-out state but the app is logged in.
  Add a `clearState: true` or logout flow before the test.
- **Timing** — an animation or network call takes longer than Maestro's default wait.
  Add `waitForAnimationToEnd` or increase `timeout` on the assertion step.
- **App version mismatch** — the installed build is outdated; reinstall from the latest build.
- **Simulator/emulator not ready** — check that the device is booted and the app is installed
  before running flows.

## Notes on Maestro's output format

Maestro's CLI output format has changed across versions.
The failure parser regex in the surface file may need adjustment for your installed version.
Run `maestro --version` and check the output of a failing test to confirm the format.
