# Reusable workflow template

Two files: the callee (`workflow_call:` only) and the caller.

## Callee — `.github/workflows/reusable-test.yml`

```yaml
name: Reusable Test

on:
  workflow_call:
    inputs:
      node-version:
        description: 'Node version to test against'
        type: string
        required: false
        default: '20'
      coverage:
        description: 'Upload coverage to Codecov'
        type: boolean
        required: false
        default: false
    secrets:
      CODECOV_TOKEN:
        description: 'Codecov upload token'
        required: false
    outputs:
      coverage-percentage:
        description: 'Total coverage percentage'
        value: ${{ jobs.test.outputs.coverage }}

jobs:
  test:
    name: Test (Node ${{ inputs.node-version }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 15
    outputs:
      coverage: ${{ steps.cov.outputs.pct }}
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached npm
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Extract coverage
        if: inputs.coverage && hashFiles('coverage/coverage-summary.json') != ''
        id: cov
        run: |
          PCT=$(node -e "console.log(require('./coverage/coverage-summary.json').total.lines.pct)")
          echo "pct=$PCT" >> "$GITHUB_OUTPUT"

      - name: Upload to Codecov
        if: inputs.coverage && secrets.CODECOV_TOKEN != ''
        uses: codecov/codecov-action@e28ff129e5465c2c0dcc6f003fc735cb6ae0c673 # v4.5.0
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
```

## Caller — same repo

```yaml
name: CI

on:
  pull_request:
    branches: [main]

permissions: {}

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-20:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '20'
      coverage: true
    secrets:
      CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}

  test-22:
    uses: ./.github/workflows/reusable-test.yml
    with:
      node-version: '22'
      coverage: false

  summary:
    needs: [test-20, test-22]
    runs-on: ubuntu-latest
    steps:
      - name: Coverage summary
        run: |
          echo "## Coverage" >> "$GITHUB_STEP_SUMMARY"
          echo "Node 20: ${{ needs.test-20.outputs.coverage-percentage }}%" >> "$GITHUB_STEP_SUMMARY"
```

## Caller — cross-repo (SHA-pinned)

```yaml
jobs:
  test:
    uses: my-org/shared-workflows/.github/workflows/reusable-test.yml@692973e3d937129bcbf40652eb9f2f61becf3332 # v1.4.0
    with:
      node-version: '20'
    secrets: inherit              # Or list each secret explicitly.
```
