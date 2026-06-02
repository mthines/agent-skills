---
title: Parallelization — Matrix, Job Dependencies, and Artifacts
impact: HIGH
tags:
  - matrix
  - parallelization
  - artifacts
  - fail-fast
  - speed
---

# Parallelization

Most slow GitHub Actions workflows are slow because they run things
sequentially that have no reason to wait for each other. Cut wall-clock
time by splitting independent work into parallel jobs **before**
optimising any individual step.

## Decision flow

| Signal                                                    | Strategy                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Independent checks (lint, typecheck, unit, build)         | Separate jobs running in parallel.                                    |
| Same script across N versions / OSes / shards             | `strategy.matrix` inside one job.                                     |
| Build output consumed by downstream jobs                  | One `build` job + `needs:` + `upload-artifact`/`download-artifact`.   |
| Large test suite (> 5 min sequential)                     | Shard via matrix (`shard: [1, 2, 3, 4]`) or a test-splitter.          |
| Single linear pipeline (e.g. deploy)                      | Keep sequential. Parallel deploys are usually bugs.                   |

## Pattern A — independent parallel jobs

```yaml
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps: [...]               # ~30s

  typecheck:
    name: Type-check
    runs-on: ubuntu-latest
    steps: [...]               # ~45s

  test:
    name: Unit tests
    runs-on: ubuntu-latest
    steps: [...]               # ~3min

  build:
    name: Build
    runs-on: ubuntu-latest
    steps: [...]               # ~2min
```

Total wall-clock: max(30s, 45s, 3min, 2min) = **3 min** instead of
6m15s sequential. No `needs:` between them — they're independent.

## Pattern B — matrix for variants

```yaml
jobs:
  test:
    name: Unit tests (Node ${{ matrix.node }} / ${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false         # See "fail-fast" below.
      matrix:
        node: ['20', '22']
        os: [ubuntu-latest, windows-latest]
    steps: [...]
```

Produces four parallel jobs from one declaration. Keep the matrix
axes small — every axis multiplies cost.

## Pattern C — build once, fan out

```yaml
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>     # v4.x
      - run: npm ci
      - run: npm run build
      - name: Upload build artifact
        uses: actions/upload-artifact@b4b15b8c7c6ac21ea08fcf65892d2ee8f75cf882 # v4.4.3
        with:
          name: dist
          path: dist/
          retention-days: 1

  test:
    name: Unit tests
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - name: Download build artifact
        uses: actions/download-artifact@fa0a91b85d4f404e444e00e005971372dc801d16 # v4.1.8
        with:
          name: dist
          path: dist/
      - run: npm ci
      - run: npm test

  deploy:
    name: Deploy
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Download build artifact
        uses: actions/download-artifact@<sha>
        with:
          name: dist
      - run: ./deploy.sh
```

Build runs once; `test` and `deploy` consume the artifact. Set
`retention-days` low (1–7) — every artifact counts against storage.

## Pattern D — shard a slow test suite

```yaml
jobs:
  test:
    name: Tests (shard ${{ matrix.shard }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@<sha>
      - run: npm ci
      - run: npx jest --shard=${{ matrix.shard }}/4
```

Use the test runner's native sharding (`jest --shard`, `pytest-split`,
`go test -shuffle ... -parallel`). Manual shell-based splitting drifts.

## Job dependencies — `needs:` and outputs

```yaml
jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      changed: ${{ steps.diff.outputs.changed }}
    steps:
      - uses: actions/checkout@<sha>
      - id: diff
        run: echo "changed=$(git diff --name-only HEAD~1 | wc -l)" >> "$GITHUB_OUTPUT"

  test:
    needs: detect
    if: needs.detect.outputs.changed != '0'
    runs-on: ubuntu-latest
    steps: [...]
```

Outputs are how jobs talk. They are **strings**; serialise complex
shapes as JSON and parse downstream.

## `fail-fast` — when to disable

`strategy.fail-fast` defaults to `true`: GitHub cancels the rest of
the matrix as soon as any one job fails.

| Goal                                                  | `fail-fast` |
| ----------------------------------------------------- | ----------- |
| Fast feedback ("any failure means red")               | `true` (default) |
| Need full coverage across all variants                | `false`     |
| Flaky job in the matrix poisons unrelated runs        | `false`     |
| Cost-sensitive ("don't burn 8 runners on one error")  | `true`      |

```yaml
strategy:
  fail-fast: false
  matrix: {...}
```

## Matrix size discipline

Every axis multiplies cost.

- 2 OSes × 3 Node versions × 4 shards = **24 runners per push.**
- Trim to the essential combinations.
- Use `include:` to add one-off combos rather than expanding the cross
  product.
- Use `exclude:` to remove known-unsupported combos.

```yaml
strategy:
  matrix:
    node: ['20', '22']
    os: [ubuntu-latest]
    include:
      - node: '22'
        os: windows-latest    # Only test latest Node on Windows.
```

## Examples

### Good — parallel jobs with build artifact

```yaml
jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps: [...]

  test:
    name: Test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps: [...]

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps: [...]

  deploy:
    name: Deploy
    needs: [lint, test, build]   # Wait for ALL three.
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps: [...]
```

### Bad — one job, everything sequential

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run lint        # blocks everything below
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: ./deploy.sh         # runs on every PR
```

Why bad: a lint failure prevents you from learning whether tests pass
or build works. Wall-clock is the sum, not the max. Deploys on PRs
without an `if:`.

## Common mistakes

- **Sequential jobs that have no dependency.** Adding `needs: setup`
  to lint, test, and build serialises them. **Fix:** drop `needs:` for
  truly independent jobs.
- **Setup job that installs deps and uploads `node_modules`.** Slower
  than each job restoring from cache; `node_modules` is platform-
  specific anyway. **Fix:** let each job restore from
  `~/.npm`/`~/.cache/pip` via cache, then run `npm ci`/`pip install`.
- **Massive matrix.** 60+ runners per push burns billing minutes and
  human attention. **Fix:** trim axes; use `include:` for one-offs.
- **Forgetting `fail-fast: false` on a release-readiness matrix.**
  Half-green matrices on broken builds. **Fix:** set `fail-fast: false`
  when you need full evidence.
- **Artifacts with `retention-days: 90` (the default).** 100 builds ×
  500 MB = 50 GB stored for 3 months. **Fix:** set `retention-days: 1`
  for intra-workflow artifacts.
- **Treating `outputs:` as JSON / list.** They are strings. **Fix:**
  JSON-encode with `toJSON()` and `fromJSON()`.
