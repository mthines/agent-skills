---
title: Token Budget — Build Reuse, Heal Caps, Maestro Cloud
impact: HIGH
tags:
  - tokens
  - performance
  - maestro-cloud
  - sharding
  - heal-loop
  - eas-build
---

# Token Budget

## Contents

- [Defaults](#defaults)
- [The build-reuse rule](#the-build-reuse-rule)
- [Local iteration vs. CI](#local-iteration-vs-ci)
- [Heal loop economics](#heal-loop-economics)
- [Sharding on Maestro Cloud](#sharding-on-maestro-cloud)
- [Recording video](#recording-video)
- [Anti-patterns](#anti-patterns)
- [Cross-references](#cross-references)

The mobile token budget is dominated by **build minutes**, not flow
steps.
A Maestro flow runs in 10–20 seconds.
Producing the `.app` or `.apk` it runs against takes 8–25 minutes on
EAS Build.
Optimise for build reuse first; everything else is rounding.

## Defaults

| Setting                                   | Default                                        | Override only when                                                |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Build reuse                               | Reuse the cached `e2e` build artefact          | Source files in `app/` or `components/` changed since last build. |
| Healer trigger                            | Failure only                                   | Never on every save, never on green.                              |
| Flow selection on iteration               | Single failing flow path                       | Initial CI run uses the full `.maestro/` tree.                    |
| `retries` (local)                         | 1                                              | Track flake stats; bump to 2 only if the flake is intrinsic.      |
| `retries` (Maestro Cloud)                 | 2                                              | 3 only for paid revenue paths during a release week.              |
| `record_screen`                           | `false`                                        | Chasing a visual race or a layout flake.                          |
| Heal-loop cap per failing flow            | 3 attempts                                     | Never raise without user approval — escalate via `confidence`.    |
| Auth bootstrap                            | `runFlow: shared/sign-in.yaml` reusing storage | First run after credential rotation or app data wipe.             |

## The build-reuse rule

The single biggest token leak in mobile E2E is rebuilding the app on
every iteration.
A fresh EAS build burns 8–25 minutes; reusing a cached artefact takes
seconds.

Decision rule for whether to rebuild:

| Signal                                                | Rebuild?           |
| ----------------------------------------------------- | ------------------ |
| Spec changed, source unchanged                        | **No.** Re-emit YAML, re-run flow against existing build.  |
| Component touched (`app/**`, `components/**`)         | **Yes.** Trigger the `e2e` EAS build profile.              |
| Native code touched (`ios/`, `android/`, plugins)     | **Yes.**                                                   |
| `package.json` deps changed                           | **Yes.**                                                   |
| Only `.maestro/**.yaml` changed                       | **No.**                                                    |
| Only `specs/**.md` changed                            | **No.**                                                    |

The EAS build profile that produces the artefact lives in
[`../templates/eas-build-profile.json`](../templates/eas-build-profile.json).

## Local iteration vs. CI

```bash
# Local iteration on a single failing flow — fastest feedback.
maestro test .maestro/workout/start-workout.yaml

# Local — full mobile suite against the booted simulator.
maestro test .maestro

# CI — Maestro Cloud, parallel shards, on the EAS-built artefact.
# (Wired via the EAS Workflow `maestro-cloud` job.)
```

The full-suite local run is the rough equivalent of the web skill's
`--last-failed` shortcut: scoped enough to be cheap, broad enough to
catch cross-flow interference.
On Maestro Cloud, parallelism comes from `shards`, not from flag
combinations.

## Heal loop economics

A single Healer attempt typically:

1. Reads the failing flow (`.yaml`) and the spec (`.md`).
2. Reads the Maestro run log.
3. Reads the OS accessibility-tree snapshot at the failing step.
4. Proposes a patch (flow edit or `testID` source diff).
5. Re-runs the flow.

Three attempts is enough to either converge or expose a structural
problem.
Beyond three, the agent is usually guessing.
[`spec-first-flow.md`](./spec-first-flow.md) escalates via
`confidence(analysis)` at the cap — do not raise the cap silently.

## Sharding on Maestro Cloud

Maestro Cloud runs flows in parallel across shards.
Default to **2 shards** for suites with 10–30 flows; bump to 4 for
suites with 30+.

```yaml
# .eas/workflows/e2e.yml — maestro-cloud job
- name: maestro-cloud
  with:
    flow_path: .maestro
    shards: 2
    retries: 2
    record_screen: false
```

Do not shard a single flow.
Shards split flows across runners; they do not split steps within a
flow.

## Recording video

`record_screen: true` doubles the cost of every flow run on Maestro
Cloud.
Enable it deliberately:

- Chasing a visual race the log doesn't expose.
- Investigating a layout regression on a specific device profile.
- One-off triage of a CI-only failure that won't repro locally.

Keep it off in steady state.
The Maestro log is usually enough to root-cause failures at rungs
1 and 2 of the locator ladder.

## Anti-patterns

- Rebuilding the `.app` or `.apk` on every flow run.
  Cache the artefact; rebuild only when source / native / deps change.
- Running the full suite on every save.
  Run a single flow until it goes green.
- Setting `record_screen: true` "just in case".
  The minute cost is real — opt in deliberately.
- Letting the heal loop run unbounded.
  Three attempts then escalate.
- Sharding a single flow.
  Sharding splits across flows, not within them.

## Cross-references

- Spec-first loop: [`spec-first-flow.md`](./spec-first-flow.md).
- EAS Workflow surface:
  [`../references/eas-workflows.md`](../references/eas-workflows.md).
- Maestro CLI surface:
  [`../references/maestro-cli.md`](../references/maestro-cli.md).
