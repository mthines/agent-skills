---
title: Triggers and Concurrency — Scoping `on:` and `concurrency:`
impact: HIGH
tags:
  - triggers
  - on
  - paths
  - concurrency
  - cancel-in-progress
---

# Triggers and Concurrency

A workflow that fires on every push to every branch on every file is
the single biggest source of GitHub Actions cost. Scope the trigger
first; you'll save more money than any caching trick.

## Triggers — the four common shapes

| Shape           | When                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| CI              | `pull_request` + `push: branches: [main]`. Paths filter applied.              |
| Deploy          | `push: branches: [main]` only, or `workflow_dispatch`. No `pull_request`.     |
| Release         | `push: tags: ['v*']` or `release: types: [published]`.                        |
| Scheduled       | `schedule: cron: '...'` plus a manual `workflow_dispatch:` for re-runs.       |
| Reusable        | `workflow_call: {}` only.                                                     |

## Scoped CI trigger

```yaml
on:
  pull_request:
    branches: [main]
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/ci.yml'
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'tests/**'
      - 'package.json'
      - 'package-lock.json'
      - '.github/workflows/ci.yml'
```

Rules:

- Branch filter on every event. `pull_request: branches: [main]` runs
  the workflow only for PRs **targeting** `main`.
- Paths filter on every event. A docs-only PR shouldn't trigger
  unit tests.
- Always include the workflow file itself (`.github/workflows/ci.yml`)
  in `paths:` — when you edit it, you want it to run.

## `paths-ignore` — the inverse

```yaml
on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'
```

Use when the include list is impractically long. Mutually exclusive
with `paths:` — never both on the same event.

## `workflow_dispatch` — manual triggers

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        type: choice
        options: [staging, production]
        required: true
      dry-run:
        description: Dry run only
        type: boolean
        default: true
```

Adds a "Run workflow" button to the Actions UI. Always add to deploy
and release workflows for re-runs without pushing a tag.

## Schedule

```yaml
on:
  schedule:
    - cron: '0 3 * * *'     # 03:00 UTC daily
  workflow_dispatch: {}     # Always add a manual escape hatch.
```

Notes:

- Cron is in **UTC**.
- GitHub may delay scheduled runs under load. Don't depend on minute
  precision.
- Scheduled workflows on inactive repos are disabled after 60 days of
  no commits. To keep them alive, push or use `workflow_dispatch`.

## Concurrency — always set, always two values

`concurrency:` groups runs that should not run in parallel. The group
key decides what counts as "the same kind of run". `cancel-in-progress`
decides whether a new run replaces a running one.

### Workflow-level concurrency

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

| Goal                                       | Group key                                                          | cancel-in-progress |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------ |
| PR: cancel the previous run on new push    | `${{ github.workflow }}-${{ github.ref }}`                         | `true`             |
| Main / branch: serialize but don't cancel  | `${{ github.workflow }}-${{ github.ref }}`                         | `false`            |
| Deploy: never overlap, never cancel        | `deploy-${{ github.ref }}` (or `deploy-prod`)                      | `false`            |
| Release: one at a time, queue              | `release-${{ github.ref }}`                                        | `false`            |
| Scheduled: skip if one already running     | `${{ github.workflow }}`                                           | `false`            |

### Job-level concurrency

Set per-job when only some jobs in a workflow need serialisation:

```yaml
jobs:
  build:                              # Cancellable.
    concurrency:
      group: build-${{ github.ref }}
      cancel-in-progress: true
    runs-on: ubuntu-latest
    steps: [...]

  deploy:                             # Not cancellable.
    needs: build
    concurrency:
      group: deploy-${{ github.ref }}
      cancel-in-progress: false
    runs-on: ubuntu-latest
    steps: [...]
```

## Examples

### Good — CI: scoped triggers, paths, PR-cancel

```yaml
name: CI
on:
  pull_request:
    branches: [main]
    paths: ['src/**', 'tests/**', 'package*.json', '.github/workflows/ci.yml']
  push:
    branches: [main]
    paths: ['src/**', 'tests/**', 'package*.json', '.github/workflows/ci.yml']

permissions: {}
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

### Good — Deploy: main-only, never cancel

```yaml
name: Deploy
on:
  push:
    branches: [main]
    paths: ['src/**', '.github/workflows/deploy.yml']
  workflow_dispatch: {}

permissions: {}
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false
```

### Bad — fires on every event everywhere

```yaml
on: [push, pull_request]            # every branch, every file, every event
```

```yaml
on:
  pull_request: {}                  # every PR target, every file
  push: {}                          # every push to every branch
```

Why bad: docs PRs trigger CI. Branches with experiment names trigger
deploy attempts. Cost balloons; signal-to-noise drops.

### Bad — concurrency missing on a deploy

```yaml
on:
  push:
    branches: [main]
# no concurrency: ; rapid commits to main spawn overlapping deploys
```

## Common mistakes

- **`on:` without `branches:` or `paths:` filters.** Triggers on
  everything. **Fix:** filter both.
- **`cancel-in-progress: true` on a deploy.** Mid-deploy cancel = half-
  rolled state. **Fix:** `false`.
- **No `workflow_dispatch:` on deploy / release.** Can't re-run
  without a synthetic commit. **Fix:** always add one.
- **`pull_request_target` instead of `pull_request`.** Hands write
  access + secrets to fork PRs. **Fix:** use `pull_request` unless you
  have a specific, audited reason.
- **Forgetting the workflow file in `paths:`.** Editing the workflow
  doesn't trigger it. **Fix:** include `.github/workflows/<file>.yml`
  in the paths list.
- **Cron in local time.** GitHub uses UTC. **Fix:** convert; document
  the local equivalent in a comment.
