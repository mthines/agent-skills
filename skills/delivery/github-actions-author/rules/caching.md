---
title: Caching — Keys, Restore-Keys, and What to Cache
impact: HIGH
tags:
  - caching
  - actions-cache
  - setup-actions
  - speed
---

# Caching

A correctly-keyed cache cuts dependency-install time by 60–90%.
A badly-keyed cache wastes runner time **and** GitHub's 10 GB
per-repo storage budget.

## The cache-matching rule

`actions/cache` walks four checks in order. The first hit wins.

1. **Exact match on `key`** on the current branch → reports `cache-hit: true`.
2. **Exact match on `key`** on the default branch (if PR / branch).
3. **Prefix match** through `restore-keys` (in order), current branch
   → reports `cache-hit: false` but a partial cache is restored.
4. **Prefix match** through `restore-keys`, default branch.

If you do not provide `restore-keys`, only step 1 + 2 run. Most cache
misses on feature branches are caused by missing `restore-keys`.

## The canonical cache key

```
<purpose>-<runner.os>-<matrix-axes>-<hashFiles(lockfile)>
```

| Segment              | Required | Why                                                              |
| -------------------- | -------- | ---------------------------------------------------------------- |
| `<purpose>`          | yes      | Disambiguates caches in the same repo (`npm`, `pip`, `cargo`).   |
| `${{ runner.os }}`   | yes      | OS-specific binaries don't transfer (linux ↔ windows ↔ macos).   |
| Matrix axes          | when matrixing | Prevents concurrent jobs corrupting each other's cache.    |
| `hashFiles('lock*')` | yes      | Invalidate only when dependencies actually change.               |

## Decision flow

| Signal                                              | Strategy                                              |
| --------------------------------------------------- | ----------------------------------------------------- |
| Package manager has an official `setup-*` action    | Use the action's built-in `cache:` parameter.         |
| Custom paths or multi-language repo                 | Use `actions/cache@<sha>` directly.                   |
| Build artifacts you also want to reuse              | `actions/cache` keyed on source-file hash.            |
| Cross-job artifact passing (build → test → deploy)  | `actions/upload-artifact` + `actions/download-artifact`, **not** the cache. |
| Files > 500 MB or churning every commit             | **Don't cache.** It's slower than rebuilding.         |

## Pattern A — setup-action with built-in cache (Node, Python, Go, Java, Ruby)

```yaml
- name: Setup Node
  uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
  with:
    node-version: '20'
    cache: 'npm'                  # or 'yarn', 'pnpm'
    cache-dependency-path: package-lock.json
- name: Install dependencies
  run: npm ci
```

This caches `~/.npm` (the global download cache), not `node_modules`.
`npm ci` then assembles `node_modules` from the cached tarballs. That
combination is 5–10× faster than re-downloading.

For pip:

```yaml
- name: Setup Python
  uses: actions/setup-python@39cd14951b08e74b54015e9e001cdefcf80e669f # v5.1.1
  with:
    python-version: '3.13'
    cache: 'pip'
    cache-dependency-path: requirements.txt
- name: Install dependencies
  run: pip install -r requirements.txt
```

## Pattern B — `actions/cache` directly

```yaml
- name: Cache Cargo registry + build
  uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4.2.0
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      target
    key: cargo-${{ runner.os }}-${{ hashFiles('**/Cargo.lock') }}
    restore-keys: |
      cargo-${{ runner.os }}-
```

`restore-keys` is **mandatory**. It is the only fallback when the
exact lockfile hash misses (e.g., a single dependency bump on a
feature branch).

## Matrix caching — include the axes in the key

```yaml
strategy:
  matrix:
    node: ['20', '22']
steps:
  - uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4.2.0
    with:
      path: ~/.npm
      key: npm-${{ runner.os }}-node${{ matrix.node }}-${{ hashFiles('**/package-lock.json') }}
      restore-keys: |
        npm-${{ runner.os }}-node${{ matrix.node }}-
```

Without `node${{ matrix.node }}` in the key, the two matrix jobs race
to write the same cache and one overwrites the other.

## Examples

### Good — Node CI with cache + restore fallback

```yaml
- name: Cache npm
  uses: actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57 # v4.2.0
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      npm-${{ runner.os }}-
- name: Install dependencies
  run: npm ci
```

Cache only the package manager's global directory (`~/.npm`) and let `npm ci` assemble `node_modules` — never cache `node_modules` itself (see the Bad example below and Core Principle 1 in [`SKILL.md`](../SKILL.md)).

### Bad — primary key uses `github.sha`

```yaml
- uses: actions/cache@v4               # tag-pinned (mutable)
  with:
    path: node_modules
    key: ${{ runner.os }}-npm-${{ github.sha }}
    # no restore-keys
```

Why bad: every commit produces a unique cache entry that no future
commit can hit. Cache hit rate ≈ 0%. Burns through the 10 GB quota in
weeks. **Fix:** use `hashFiles('**/package-lock.json')` and add
`restore-keys`.

### Bad — caching `node_modules` only, no `~/.npm`

```yaml
- uses: actions/cache@<sha>
  with:
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
```

Why bad: `node_modules` is platform-specific and brittle —
post-install scripts and native modules can break after restore.
**Fix:** cache `~/.npm` and let `npm ci` assemble.

## Branch scoping (gotcha)

Caches are scoped per branch:

- A branch reads from **its own** cache and **the default branch's**
  cache. It cannot read from sibling branches.
- If `main` never runs the workflow, feature branches have no
  fallback. **Fix:** ensure the workflow runs on `push: branches:
  [main]` to warm the cache.

## Storage budget

- 10 GB per repo (free); 7-day LRU eviction.
- Each unique key creates a new entry; never deleted by the workflow.
- A cache key like `<purpose>-<os>-<lockfile-hash>` typically produces
  ≤ 10 entries per repo. A key with `${{ github.sha }}` produces one
  per commit.
- Audit: `gh cache list` or `actions/cache/list`.

## `cache-hit` output (conditional steps)

```yaml
- id: cache
  uses: actions/cache@<sha>
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
- name: Install dependencies (cache miss only)
  if: steps.cache.outputs.cache-hit != 'true'
  run: npm ci
```

Note: `cache-hit == 'true'` only on **exact** key match. Partial
restore via `restore-keys` reports `false`.

## Security

- Anyone with read access can write to the cache via a PR.
- A malicious PR can poison the cache; subsequent `main` runs may
  restore poisoned bytes.
- **Never cache secrets, tokens, or credentials.**
- For high-sensitivity workflows, omit `restore-keys` so an exact
  cache match is required.

## Common mistakes

- **Primary key uses `github.sha`, `github.run_id`, or a timestamp.**
  No future run can hit it. **Fix:** key on `hashFiles(<lockfile>)`.
- **No `restore-keys`.** Every lockfile bump = full cold install.
  **Fix:** add a prefix `restore-keys:` line.
- **Caching `node_modules` only.** Platform-specific; fragile.
  **Fix:** cache the package manager's global directory.
- **Forgetting matrix axes in the key.** Concurrent matrix jobs
  corrupt each other's cache. **Fix:** include every matrix variable.
- **Caching giant build outputs that change every commit.** Net
  slowdown vs rebuild. **Fix:** measure; only cache if `restore + skip
  rebuild` < `cold rebuild`.
