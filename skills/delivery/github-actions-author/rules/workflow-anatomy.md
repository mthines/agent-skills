---
title: Workflow Anatomy — Skeleton, Naming, and Layout
impact: HIGH
tags:
  - anatomy
  - structure
  - naming
  - layout
---

# Workflow Anatomy

Every well-formed GitHub Actions workflow has the same shape. Lay it
out in this order — readers (and reviewers) expect it.

## Skeleton

```yaml
name: CI                      # Human-readable, shown in the Actions UI.

on:                           # Scoped triggers — branches AND paths.
  push:
    branches: [main]
  pull_request:
    branches: [main]
    paths:
      - 'src/**'
      - 'package.json'
      - 'package-lock.json'

permissions: {}               # Start empty. Grant per-job below.

concurrency:                  # Always set. See triggers-and-concurrency.md.
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:                          # Cross-job constants. Keep short.
  NODE_VERSION: '20'

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    permissions:
      contents: read          # Per-job. Minimal grant.
    timeout-minutes: 10       # Hard cap. Never omit.
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
        with:
          fetch-depth: 1      # Shallow unless you need git history.
      - name: Setup Node
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'        # Built-in cache; see caching.md.
      - name: Install dependencies
        run: npm ci
      - name: Run linter
        run: npm run lint
```

## File layout

Put related workflows in `.github/workflows/`. One file per
responsibility — never glue unrelated triggers into one workflow.

```text
.github/
├── workflows/
│   ├── ci.yml            # lint + typecheck + test + build, on PR + push
│   ├── deploy.yml        # deploy to prod, on push to main
│   ├── release.yml       # cut releases, on tag
│   ├── scheduled.yml     # nightly chores, on cron
│   └── reusable-test.yml # workflow_call only — invoked by ci.yml
└── actions/
    ├── setup-node-deps/  # composite action: install + cache + restore
    │   └── action.yml
    └── upload-coverage/
        └── action.yml
```

**Why split:** independent triggers, independent failure surfaces,
independent reruns. A flaky deploy run does not bury the lint result.

## Required keys per job

| Key                | Why                                                                    |
| ------------------ | ---------------------------------------------------------------------- |
| `name:`            | Shows in the Checks tab and the PR status list. **Not optional.**      |
| `runs-on:`         | Pin to `ubuntu-latest` or a specific version. Avoid `latest` drift if you care. |
| `permissions:`     | Per-job, minimal. Inherit-by-omission is the silent default-grant trap. |
| `timeout-minutes:` | Default is 360 (6 hours). Always set a real number — 10–30 is typical. |
| `steps:`           | Every step `name:`d, see [`observability.md`](./observability.md).      |

## Step ordering

Inside a job, order steps so the cheapest failure is first:

1. **Checkout** — fast, sets the working directory.
2. **Setup language / runtime** — usually cached.
3. **Install dependencies** — the slow step; restore from cache.
4. **Lint / format check** — seconds, fails fast.
5. **Type-check** — seconds, fails fast on the next class of error.
6. **Build** — minutes, only worth running if lint + type-check pass.
7. **Test** — slowest; runs only if everything above is green.

A failing lint should not consume the test budget.

## Naming

| Element                | Convention                                  | Example                                  |
| ---------------------- | ------------------------------------------- | ---------------------------------------- |
| Workflow file          | `kebab-case.yml`                            | `release-please.yml`                     |
| Workflow `name:`       | Sentence Case                               | `Release Please`                         |
| Job key                | `snake_case` or `kebab-case`                | `integration_test`                       |
| Job `name:`            | Sentence Case, describes outcome            | `Integration tests (postgres-15)`        |
| Step `name:`           | Sentence Case, imperative                   | `Install dependencies`                   |
| Composite action dir   | `kebab-case`                                | `.github/actions/setup-node-deps/`       |
| Reusable workflow file | `reusable-<scope>.yml`                      | `reusable-test.yml`                      |

## Examples

### Good — scoped, named, capped

```yaml
name: CI
on:
  pull_request:
    branches: [main]
    paths: ['src/**', 'package*.json']
permissions: {}
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  test:
    name: Unit tests (Node ${{ matrix.node }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    strategy:
      matrix:
        node: ['20', '22']
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      # ...
```

### Bad — unscoped, unnamed, unbounded

```yaml
name: ci
on: [push, pull_request]    # every branch, every path
jobs:
  test:                     # no name:, no timeout, no permissions
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # tag-pinned (mutable)
      - run: npm install            # not `npm ci`
      - run: npm test
```

Why bad: triggers on every push to every branch, ignores `permissions`,
has no timeout (could hang for 6h), pins a mutable tag, uses `npm
install` (writes to `package-lock.json`) instead of `npm ci`.

## Common mistakes

- **Missing `timeout-minutes:`.** Default of 360 means a hung step
  burns six runner-hours. **Fix:** set 10–30 explicitly.
- **`permissions:` set at workflow level only, not per-job.** Every job
  inherits the broadest grant. **Fix:** start with `permissions: {}`
  at workflow level, grant per-job.
- **Multiple unrelated triggers in one workflow.** PR runs and nightly
  cron in `ci.yml` make reruns and history confusing. **Fix:** split
  into `ci.yml` and `scheduled.yml`.
- **No `fetch-depth:` set on `actions/checkout`.** Default is `1`
  (shallow) — fine. But explicit is clearer; set `fetch-depth: 0` only
  if you need full history (release notes, blame).
- **Anonymous `run:` blocks.** They make logs and Slack failure pings
  read like "Step 5 failed". **Fix:** every step gets a `name:`.
