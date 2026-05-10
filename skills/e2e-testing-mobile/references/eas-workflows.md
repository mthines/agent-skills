---
title: EAS Workflows + Maestro Cloud — Reference
impact: HIGH
tags:
  - expo
  - eas
  - eas-workflows
  - maestro-cloud
  - ci
  - reference
---

# EAS Workflows + Maestro Cloud — Reference

## Contents

- [What it is](#what-it-is)
- [Wiring overview](#wiring-overview)
- [`eas.json` E2E build profile](#easjson-e2e-build-profile)
- [`.maestro/` layout](#maestro-layout)
- [`maestro-cloud` job parameters](#maestro-cloud-job-parameters)
- [End-to-end workflow YAML](#end-to-end-workflow-yaml)
- [Bare RN (no EAS)](#bare-rn-no-eas)
- [Sources](#sources)

## What it is

EAS Workflows is Expo's CI/CD service.
It runs as part of EAS — the same managed service that produces builds
and submits to app stores.
In late 2025 / early 2026, Expo added a first-class `maestro-cloud`
job, eliminating the GitHub Actions glue code that previously wired
Maestro and EAS Build together.

This reference assumes the project uses Expo + EAS.
For bare RN with no EAS, see the section at the end.

## Wiring overview

Three artefacts collaborate:

1. **`.maestro/` flows** — checked-in `.yaml` files at the repo root.
2. **`eas.json` `e2e` build profile** — produces a debug-style `.app`
   (iOS) and `.apk` (Android) suitable for instrumentation.
3. **EAS Workflow YAML** with two jobs:
   - A `build` job using the `e2e` profile.
   - A `maestro-cloud` job referencing `${{ jobs.build.outputs.build_id }}`.

The full template lives in
[`../templates/eas-workflow.yaml`](../templates/eas-workflow.yaml).

## `eas.json` E2E build profile

The `e2e` profile produces an instrumentation-ready binary.
Key differences from `production`:

- Internal distribution (no app-store signing required).
- Simulator builds for iOS (`simulator: true`) so flows can run
  against `xcrun simctl`.
- APK output for Android (`buildType: "apk"`) instead of AAB.
- Development client disabled — the Maestro flow drives the real app
  shell.

Full snippet:
[`../templates/eas-build-profile.json`](../templates/eas-build-profile.json).

## `.maestro/` layout

```
repo/
├── .maestro/
│   ├── shared/
│   │   ├── sign-in.yaml          # reusable, included via runFlow
│   │   └── seed-data.yaml
│   ├── auth/
│   │   └── sign-in.yaml          # one flow per spec
│   └── workout/
│       └── start-workout.yaml
└── eas.json
```

Convention: keep flows shallow.
A two-level tree (`<area>/<flow>.yaml`) keeps `flow_path` filters
readable.
Cross-cutting flows (auth, fixtures) live under `shared/`.

## `maestro-cloud` job parameters

The job is documented under
[Pre-packaged jobs](https://docs.expo.dev/eas/workflows/pre-packaged-jobs/)
in the Expo docs.
Maestro tests in EAS Workflows are still tagged **alpha** as of early
2026 — pin the workflow file's `apiVersion` and audit it after each
EAS minor release.

| Parameter           | Type     | Purpose                                                              |
| ------------------- | -------- | -------------------------------------------------------------------- |
| `build_id`          | string   | Output of the upstream EAS Build job. Required.                       |
| `flow_path`         | string   | Path to a flow file or a directory under `.maestro/`. Defaults to `.maestro`. |
| `shards`            | integer  | Number of parallel runners. Default: 1.                              |
| `retries`           | integer  | Per-flow retries on Cloud. Default: 0; this skill prescribes 2.      |
| `record_screen`     | boolean  | Capture screen video into the report. Default: `false` (this skill keeps it off). |
| `device_identifier` | string   | Pin to a specific Cloud device profile (e.g. `iPhone 15 Pro, iOS 17.4`). |

Any parameter not listed inherits its default.
Do not pin a `device_identifier` without a reason — Maestro Cloud
auto-selects compatible devices.

## End-to-end workflow YAML

A complete example with the `build → maestro-cloud` chain lives in
[`../templates/eas-workflow.yaml`](../templates/eas-workflow.yaml).
Read it before drafting your own — the inter-job `outputs` wiring is
the part most people get wrong.

## Bare RN (no EAS)

If the project is bare RN without EAS, replace the EAS Workflow with a
local script and a CI runner of your choice (GitHub Actions, CircleCI,
Bitrise).
The Maestro half is identical — only the build half changes.

```bash
# Local script — produces an iOS simulator build.
xcodebuild \
  -workspace ios/MyApp.xcworkspace \
  -scheme MyApp \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath build \
  build

# Then run flows against the booted simulator.
maestro test .maestro
```

For Maestro Cloud upload from a non-EAS CI, use `maestro cloud`
directly:

```bash
maestro cloud \
  --apiKey "$MAESTRO_API_KEY" \
  --device-locale "en_US" \
  build/Build/Products/Debug-iphonesimulator/MyApp.app \
  .maestro
```

## Sources

- [Expo — Maestro on EAS Workflows](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)
- [Expo — Pre-packaged jobs](https://docs.expo.dev/eas/workflows/pre-packaged-jobs/)
- [Expo blog — Maestro Cloud + EAS Workflows](https://expo.dev/blog/expo-now-supports-maestro-cloud-testing-in-your-ci-workflow)
- [`react-native-eas-maestro` reference repo](https://github.com/lingvano/react-native-eas-maestro)
