---
title: Reusability — Composite Actions vs Reusable Workflows
impact: HIGH
tags:
  - reusability
  - composite-actions
  - reusable-workflows
  - dry
---

# Reusability

Two reuse primitives. They look similar; their use cases are not.
Picking the wrong one produces YAML that is awkward to maintain and
costs runner time.

## The 30-second rule

| Reusing…                                | Use                       |
| --------------------------------------- | ------------------------- |
| A series of **steps** inside a job      | Composite action          |
| A series of **jobs** (a whole pipeline) | Reusable workflow         |

If you find yourself unsure, ask: *does the reused block need its own
runner / `runs-on:` / job-level outputs?* Yes → reusable workflow. No
→ composite action.

## Decision matrix

| Need                                           | Composite action | Reusable workflow |
| ---------------------------------------------- | ---------------- | ----------------- |
| Different `runs-on:` than the caller           |                  | ✓                 |
| Direct access to `secrets.<NAME>`              |                  | ✓                 |
| Matrix strategy **at the caller**              | ✓                |                   |
| Multiple steps before AND after in same job    | ✓                |                   |
| Multiple parallel jobs                         |                  | ✓                 |
| Distinct job entry in the Actions UI          |                  | ✓                 |
| Nest up to 10 deep                             | ✓                |                   |
| Pass typed inputs (`type: number`, `boolean`)  |                  | ✓ (composite is strings only) |

## Pattern A — composite action

`.github/actions/setup-node-deps/action.yml`:

```yaml
name: 'Setup Node + cached deps'
description: 'Checkout, install Node, restore npm cache, run npm ci.'

inputs:
  node-version:
    description: 'Node version'
    required: false
    default: '20'

runs:
  using: 'composite'
  steps:
    - name: Setup Node
      uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
    - name: Install dependencies
      shell: bash               # REQUIRED for `run:` steps in composites.
      run: npm ci
```

Caller:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: ./.github/actions/setup-node-deps
        with:
          node-version: '22'
      - run: npm test
```

**Gotchas:**

- Every `run:` step inside a composite **must** declare `shell:`. There
  is no default. Skipping it is the most common composite bug.
- Composite inputs are always strings (`type:` is not supported).
  Convert with `fromJSON()`/`toJSON()` if you need structured data.
- Logs for composite steps collapse under the calling step — hard to
  debug. If debuggability matters, use a reusable workflow.

## Pattern B — reusable workflow (callee)

`.github/workflows/reusable-test.yml`:

```yaml
name: Reusable Test

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        required: false
        default: '20'
      coverage:
        type: boolean
        required: false
        default: false
    secrets:
      CODECOV_TOKEN:
        required: false
    outputs:
      coverage-percentage:
        description: 'Test coverage as a number.'
        value: ${{ jobs.test.outputs.coverage }}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 15
    outputs:
      coverage: ${{ steps.cov.outputs.pct }}
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'
      - run: npm ci
      - name: Run tests
        run: npm test
      - id: cov
        if: inputs.coverage
        run: echo "pct=$(cat coverage/percent.txt)" >> "$GITHUB_OUTPUT"
      - if: inputs.coverage && secrets.CODECOV_TOKEN != ''
        uses: codecov/codecov-action@e28ff129e5465c2c0dcc6f003fc735cb6ae0c673 # v4.5.0
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
```

## Pattern B — reusable workflow (caller)

```yaml
jobs:
  test-node-20:
    uses: ./.github/workflows/reusable-test.yml    # same repo
    with:
      node-version: '20'
      coverage: true
    secrets:
      CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}  # Explicit forward.

  test-node-22:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '22'
```

Cross-repo callers **must SHA-pin** the reusable workflow:

```yaml
uses: my-org/shared-workflows/.github/workflows/reusable-test.yml@692973e3d937129bcbf40652eb9f2f61becf3332 # v1.4.0
```

A branch reference (`@main`) is a supply-chain attack waiting to happen.

## Gotchas — reusable workflows

- **Secrets do not forward automatically.** You must list them in the
  caller's `secrets:` block (or use `secrets: inherit` if every secret
  should pass through).
- **Matrix at the caller is not propagatable as an input.** If the
  callee needs to matrix on something, the matrix declares inside the
  callee — or pass a JSON string and matrix on `fromJSON(inputs.x)`.
- **`needs:` works as expected** — chain reusable workflows like
  ordinary jobs.
- **Permissions are not inherited.** Set them in the callee (or
  per-job in the callee).
- **A job that calls a reusable workflow cannot have other steps.**
  Wrap the workflow_call in its own job.

## Where to put each

```text
.github/
├── actions/                          # Composite actions
│   ├── setup-node-deps/
│   │   └── action.yml
│   └── upload-coverage/
│       └── action.yml
└── workflows/
    ├── ci.yml                        # Calls the reusable workflow below.
    └── reusable-test.yml             # workflow_call only.
```

Composite actions live in `.github/actions/<name>/action.yml`.
Reusable workflows live in `.github/workflows/<name>.yml` like any
other workflow.

## Examples

### Good — composite for shared steps inside one job

```yaml
# .github/actions/setup-node-deps/action.yml
name: Setup Node deps
runs:
  using: composite
  steps:
    - uses: actions/setup-node@<sha>
      with:
        node-version: '20'
        cache: 'npm'
    - shell: bash
      run: npm ci
```

Three jobs (lint, test, build) each call it as a single step.

### Bad — composite trying to be a workflow

```yaml
# action.yml
runs:
  using: composite
  jobs:                              # NOT VALID — composites have no jobs.
    test:
      steps: [...]
```

### Bad — reusable workflow for two shell lines

```yaml
# reusable-greet.yml
on:
  workflow_call: {}
jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - run: echo "hello"
      - run: echo "world"
```

Why bad: spawns a fresh runner, adds 30–60s of overhead, separate job
in the UI for two `echo`s. **Fix:** composite action — or just inline.

## Common mistakes

- **Composite action missing `shell:` on `run:` steps.** Workflow
  fails to parse. **Fix:** add `shell: bash` to every `run:` step.
- **Reusable workflow with secrets accessed directly inside the
  callee.** The secrets aren't passed unless declared in
  `workflow_call.secrets:`. **Fix:** declare each secret, then pass in
  `secrets:` from the caller (or use `secrets: inherit`).
- **Branch-pinned cross-repo reusable workflow.** A force-push to
  `main` of the shared repo runs in your CI. **Fix:** SHA-pin.
- **One mega-composite that does too much.** Hard to reason about,
  hard to override. **Fix:** keep composites focused (setup, install,
  upload). Compose multiple composites if needed.
- **Wrapping a single `uses:` in a composite or reusable workflow.**
  The wrapping itself is the duplication. **Fix:** call the action
  directly.
