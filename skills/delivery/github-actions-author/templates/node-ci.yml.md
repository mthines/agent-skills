# Node CI workflow template

Copy into `.github/workflows/ci.yml`. Replace SHAs with current ones
from each action's repo before committing.

```yaml
name: CI

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

permissions: {}

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  NODE_VERSION: '20'

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached npm
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npx eslint . --format github

  typecheck:
    name: Type-check
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached npm
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type-check
        run: npx tsc --noEmit

  test:
    name: Unit tests (Node ${{ matrix.node }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '22']
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached npm
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --reporter=github

      - name: Upload coverage summary
        if: always()
        run: |
          if [ -f coverage/coverage-summary.json ]; then
            {
              echo "## Coverage (Node ${{ matrix.node }})"
              node -e "const c=require('./coverage/coverage-summary.json').total; console.log('Lines: '+c.lines.pct+'% | Branches: '+c.branches.pct+'%');"
            } >> "$GITHUB_STEP_SUMMARY"
          fi

  build:
    name: Build
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached npm
        uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload build artifact
        uses: actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882 # v4.4.3
        with:
          name: dist-${{ github.sha }}
          path: dist/
          retention-days: 1
```
