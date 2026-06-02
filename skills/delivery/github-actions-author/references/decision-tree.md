# Decision Tree — Picking a Workflow Shape

## Contents

- [Pick a workflow shape](#pick-a-workflow-shape)
- [Pick a reuse primitive](#pick-a-reuse-primitive)
- [Pick a caching strategy](#pick-a-caching-strategy)
- [Pick a permissions model](#pick-a-permissions-model)
- [Pick a concurrency setting](#pick-a-concurrency-setting)
- [Pick a trigger surface](#pick-a-trigger-surface)
- [Worked example — typical Node SaaS repo](#worked-example--typical-node-saas-repo)

## Pick a workflow shape

| Goal                                            | File                       | Triggers                                 |
| ----------------------------------------------- | -------------------------- | ---------------------------------------- |
| PR feedback (lint, type, test, build)           | `ci.yml`                   | `pull_request`, `push: branches:[main]`  |
| Deploy on green main                            | `deploy.yml`               | `push: branches:[main]`, `workflow_dispatch` |
| Release on tag                                  | `release.yml`              | `push: tags:['v*']` or `release`         |
| Nightly maintenance                             | `scheduled.yml`            | `schedule: cron`, `workflow_dispatch`    |
| Manual ops (smoke test, rollback, runbook)      | `ops-<name>.yml`           | `workflow_dispatch` only                 |
| Shared piece called from many workflows         | `reusable-<scope>.yml`     | `workflow_call:` only                    |

## Pick a reuse primitive

```
Are you reusing steps inside one job?
├─ Yes → composite action (.github/actions/<name>/action.yml)
└─ No, you're reusing a whole job or pipeline
   ├─ Different runs-on, secrets, or parallel jobs needed?
   │  └─ Yes → reusable workflow (.github/workflows/<name>.yml with workflow_call)
   └─ No, it's < 5 steps and runs in one job → composite action
```

## Pick a caching strategy

| Stack                          | Action                                  | Path(s)                                       |
| ------------------------------ | --------------------------------------- | --------------------------------------------- |
| Node (npm, yarn, pnpm)         | `actions/setup-node@<sha>` with `cache:` | (handled internally — `~/.npm` etc.)          |
| Python (pip)                   | `actions/setup-python@<sha>` with `cache:` | `~/.cache/pip`                              |
| Python (poetry, uv)            | `actions/cache@<sha>`                   | `~/.cache/pypoetry`, `.venv` (poetry); `~/.cache/uv` (uv) |
| Go                             | `actions/setup-go@<sha>` with `cache:`  | `~/.cache/go-build`, `~/go/pkg/mod`           |
| Rust (cargo)                   | `Swatinem/rust-cache@<sha>`             | `~/.cargo/registry`, `~/.cargo/git`, `target` |
| Java (Maven, Gradle)           | `actions/setup-java@<sha>` with `cache:` | (handled internally)                         |
| Docker layer cache             | `docker/build-push-action@<sha>` with `cache-from`/`cache-to: type=gha` | (GHA-backed) |

Cache-key template: `<purpose>-${{ runner.os }}-<matrix-axes>-${{ hashFiles('<lockfile>') }}`.
Always add `restore-keys:` with the same prefix minus the hash.

## Pick a permissions model

Start: `permissions: {}` at workflow level. Then per job:

| Job action                              | Permissions                                                  |
| --------------------------------------- | ------------------------------------------------------------ |
| Read code only (lint, test, build)      | `contents: read`                                             |
| Push to repo (commit, tag, branch)      | `contents: write`                                            |
| Create / update Release                 | `contents: write`                                            |
| Push container to GHCR                  | `contents: read`, `packages: write`                          |
| Comment on / label PR                   | `pull-requests: write`                                       |
| Comment on / label issue                | `issues: write`                                              |
| Deploy GitHub Pages                     | `pages: write`, `id-token: write`                            |
| OIDC to cloud                           | `id-token: write` (+ `contents: read` for checkout)          |

Anything not listed → omit. Implicit grants are `none` once
`permissions:` is set.

## Pick a concurrency setting

| Workflow type   | `group:`                                                     | `cancel-in-progress:`                              |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| CI (PR + push)  | `${{ github.workflow }}-${{ github.ref }}`                   | `${{ github.event_name == 'pull_request' }}`       |
| Deploy          | `deploy-${{ github.ref }}` or per-environment                | `false`                                            |
| Release         | `release-${{ github.ref }}`                                  | `false`                                            |
| Scheduled       | `${{ github.workflow }}`                                     | `false`                                            |
| Reusable callee | (inherit from caller — typically omit)                       | n/a                                                |

## Pick a trigger surface

| Want…                                       | `on:`                                          |
| ------------------------------------------- | ---------------------------------------------- |
| PR feedback                                 | `pull_request: branches:[main] paths:[...]`    |
| Main-branch validation + cache warming      | `push: branches:[main] paths:[...]`            |
| Manual button in UI                         | `workflow_dispatch:` (with typed inputs)       |
| Cron                                        | `schedule: cron: '0 3 * * *'`                  |
| Tag release                                 | `push: tags:['v*']` or `release: types:[published]` |
| Cross-workflow callability                  | `workflow_call:` (defines the public API)      |
| Run after another workflow                  | `workflow_run:` (advanced — audit security)    |

Avoid: `on: [push, pull_request]` (unscoped), `pull_request_target`
(security risk unless audited).

## Worked example — typical Node SaaS repo

Files:

```
.github/
├── workflows/
│   ├── ci.yml                  PR + push to main, paths-filtered
│   ├── deploy.yml              push to main, no PR, OIDC to AWS
│   ├── release.yml             push tags vX, GitHub Release
│   ├── scheduled.yml           nightly deps + security audit
│   └── reusable-test.yml       workflow_call only
└── actions/
    └── setup-node-deps/
        └── action.yml
```

Shape:

| Workflow         | Jobs                                          | Reuses                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------ |
| `ci.yml`         | lint, typecheck, test (matrix), build         | `setup-node-deps` composite; calls `reusable-test.yml` |
| `deploy.yml`     | deploy                                        | `setup-node-deps`                                      |
| `release.yml`    | tag, build, publish, release                  | `setup-node-deps`                                      |
| `scheduled.yml`  | dep-audit, license-scan                       | `setup-node-deps`                                      |

Each workflow:

- Has `permissions: {}` at the top.
- Sets `concurrency` (PR cancel-in-progress, others don't).
- Filters `paths:` to skip docs-only changes.
- Pins every third-party action by SHA.
