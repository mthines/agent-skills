---
name: github-actions-author
description: >
  Authors fast, cheap, maintainable GitHub Actions workflows applying
  2026 best practices: caching with `hashFiles` + `restore-keys`,
  parallelization via matrix + artifacts, reusability (composite actions
  for steps, reusable workflows for jobs), security (SHA-pinned actions,
  least-privilege `GITHUB_TOKEN`, concurrency), and trackable errors
  (named steps, step summaries, annotations). Two modes: `scaffold`
  (default) generates workflow YAML; `review` audits an existing
  workflow against the same rules. Use when creating CI/CD pipelines,
  optimizing slow workflows, deduping copy-pasted YAML across repos, or
  auditing workflow security. Triggers on "github action",
  "github workflow", "ci pipeline", "create workflow", "speed up ci",
  "review my workflow", "/github-actions-author".
disable-model-invocation: true
argument-hint: '[scaffold|review] [<workflow-file>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: scaffolder
  tags:
    - github-actions
    - ci-cd
    - workflows
    - caching
    - reusable-workflows
    - composite-actions
    - matrix
    - security
    - oidc
---

# GitHub Actions Author

Generate or audit GitHub Actions workflow YAML against 2026 best
practices for speed, cost, reusability, and security.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> [`rules/*.md`](./rules/) and load on demand. Drop-in starters live in
> [`templates/*.md`](./templates/). The decision tree for picking a
> shape lives in [`references/decision-tree.md`](./references/decision-tree.md).

---

## Mode Detection

Parse `$ARGUMENTS` (first token):

| Mode       | Default | Trigger                                                       |
| ---------- | ------- | ------------------------------------------------------------- |
| `scaffold` | **yes** | Default. "create", "scaffold", "new workflow", or no token.   |
| `review`   |         | "review", "audit", path to an existing `.github/workflows/*`. |

State the detected mode and target in one line before continuing:

```
Mode: scaffold
Target: .github/workflows/ci.yml
```

---

## Scaffold Workflow

Five phases. Each has a gate; do not proceed until it passes.

| Phase | Name                  | Rule file                                                                     | Gate                                                              |
| ----- | --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0     | Intent + shape        | [`references/decision-tree.md`](./references/decision-tree.md)                | Trigger, stack, and shape (single / matrix / reusable) confirmed. |
| 1     | Anatomy + triggers    | [`rules/workflow-anatomy.md`](./rules/workflow-anatomy.md), [`rules/triggers-and-concurrency.md`](./rules/triggers-and-concurrency.md) | `on:` block scoped (branches + paths), concurrency set.           |
| 2     | Speed (cache + parallel) | [`rules/caching.md`](./rules/caching.md), [`rules/parallelization.md`](./rules/parallelization.md) | Cache key is `hashFiles`-based with `restore-keys`; independent jobs run in parallel. |
| 3     | Reusability           | [`rules/reusability.md`](./rules/reusability.md)                              | Any block used > 1 place is extracted to a composite action or reusable workflow. |
| 4     | Security + errors     | [`rules/security.md`](./rules/security.md), [`rules/observability.md`](./rules/observability.md) | Third-party actions SHA-pinned, `permissions:` minimal, every step named, failures surface a stack-trace path. |

### Phase 0 — Intent and shape

Ask in **one** batched message:

1. **Workflow purpose** — one sentence. CI, deploy, release, scheduled,
   manual, or composite/reusable shared piece?
2. **Trigger surface** — push, pull_request, schedule, workflow_dispatch,
   or workflow_call? Which branches? Which path globs (to skip irrelevant
   runs)?
3. **Stack** — Node (npm/yarn/pnpm/bun), Python (pip/uv/poetry), Go,
   Rust, Java/Gradle, Docker, mixed?
4. **Shape** — single job, matrix (axes?), build-then-test (artifact
   hand-off), or split jobs (lint / typecheck / test / build) running
   in parallel?
5. **Reuse** — is this YAML duplicated across repos or workflows? If so,
   refactor target is a composite action (steps) or reusable workflow
   (jobs) — see [`rules/reusability.md`](./rules/reusability.md).
6. **Secrets** — none, repo secrets, environment secrets, or OIDC to a
   cloud provider (AWS/GCP/Azure)?

Repeat the answers back before generating.

### Phase 1–4

Walk each phase using the linked rule file. Each rule is self-contained
and includes a decision table plus a good/bad example.

### Phase 5 — Self-check

Run the [Definition of Done](#definition-of-done) checklist below.

---

## Review Workflow

Read the target `.yml` and produce a structured report — do not mutate
unless asked.

1. Parse the workflow: triggers, jobs, steps, permissions, concurrency.
2. Measure the run metrics — **report each metric when computable; print
   `n/a (<reason>)` otherwise** (no runs yet, logs expired, no cache steps).

   Average run duration over the last 10 completed runs:

   ```bash
   gh run list --workflow <file>.yml --status completed --limit 10 \
     --json startedAt,updatedAt \
     --jq 'map((.updatedAt | fromdate) - (.startedAt | fromdate))
           | add / length | round
           | "\(. / 60 | floor)m\(. % 60)s"'
   ```

   Cache hit rate over the last 10 completed runs — count cache-restore
   outcomes in the logs (hit rate = `Cache restored` ÷ total restore
   attempts; logs older than the retention window return nothing, so
   report `n/a` rather than guessing):

   ```bash
   gh run list --workflow <file>.yml --status completed --limit 10 \
     --json databaseId --jq '.[].databaseId' \
     | while read -r id; do
         gh run view "$id" --log 2>/dev/null \
           | grep -hoE 'Cache restored from key|Cache not found'
       done | sort | uniq -c
   ```

3. For each rule file in [`rules/`](./rules/), mark **PASS / WARN /
   FAIL** with one line of evidence (`line N: <quote>`).
4. End with a prioritised "Top 3 fixes" list — biggest speed / cost /
   security wins first.
5. Offer to apply the fixes if the user wants — switch to `scaffold`
   mode for that section.

Format:

```
Workflow: .github/workflows/ci.yml
Lines: 142
Jobs: 4
Average run (last 10): 7m12s            # or: n/a (no completed runs)
Cache hit rate (last 10): 30%           # or: n/a (logs expired / no cache steps)

Anatomy: PASS
Triggers + concurrency: WARN — no `cancel-in-progress` on PR (line 8)
Caching: FAIL — primary key uses `github.sha`, no `restore-keys` (line 34)
Parallelization: PASS
Reusability: WARN — install-deps duplicated across 3 jobs (lines 28, 71, 94)
Security: FAIL — `actions/checkout@v4` tag-pinned, no SHA (line 22)
Observability: WARN — 4 unnamed steps (lines 31, 45, 68, 102)

Top 3 fixes:
1. Replace `github.sha` cache key with `${{ hashFiles('package-lock.json') }}` + restore-keys (line 34) — expected 60-80% faster on cache hits.
2. SHA-pin every third-party action, comment with the version (line 22, 38, 51).
3. Extract install-deps into `.github/actions/setup-node-deps/action.yml` (composite) — removes 2x 40 LOC duplication.
```

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------- |
| 0     | [`references/decision-tree.md`](./references/decision-tree.md)                                                              |
| 1     | [`rules/workflow-anatomy.md`](./rules/workflow-anatomy.md), [`rules/triggers-and-concurrency.md`](./rules/triggers-and-concurrency.md) |
| 2     | [`rules/caching.md`](./rules/caching.md), [`rules/parallelization.md`](./rules/parallelization.md)                          |
| 3     | [`rules/reusability.md`](./rules/reusability.md)                                                                            |
| 4     | [`rules/security.md`](./rules/security.md), [`rules/observability.md`](./rules/observability.md)                            |

Drop-in starters in [`templates/`](./templates/):

- [`node-ci.yml.md`](./templates/node-ci.yml.md) — Node.js CI with cache, matrix, parallel jobs.
- [`python-ci.yml.md`](./templates/python-ci.yml.md) — Python CI with pip cache.
- [`reusable-workflow.yml.md`](./templates/reusable-workflow.yml.md) — `workflow_call` callee + caller.
- [`composite-action.yml.md`](./templates/composite-action.yml.md) — `.github/actions/<name>/action.yml`.
- [`deploy-oidc.yml.md`](./templates/deploy-oidc.yml.md) — deploy with OIDC, no long-lived secrets.

---

## Core Principles

1. **Cache the package manager's global directory, not `node_modules`.**
   Use `actions/setup-node@<sha> { cache: 'npm' }` or `actions/cache@<sha>` keyed by `hashFiles('lockfile')` with `restore-keys` fallback.
2. **One responsibility per workflow file.** `ci.yml`, `deploy.yml`,
   `release.yml`, `scheduled.yml`. Resist the mega-workflow.
3. **Parallelize first, then cache.** Splitting lint / typecheck / test
   into separate jobs gives near-linear wins; cache reduces the cold
   tail.
4. **Composite actions for steps, reusable workflows for jobs.** Never
   put job orchestration into a composite action; never use a reusable
   workflow to wrap two shell lines.
5. **SHA-pin every third-party action.** Tags are mutable; SHAs are
   immutable. `actions/checkout@<40-hex> # v4.2.0`.
6. **Least-privilege `GITHUB_TOKEN`.** Start with `permissions: {}` at
   the workflow level; grant per-job. Read-only by default in
   2023+ repos — keep it that way.
7. **`concurrency` is mandatory.** PRs use `cancel-in-progress: true`;
   deploys use `cancel-in-progress: false`. No exceptions.
8. **Name every step.** Anonymous `run:` blocks are unsearchable in logs
   and unsourceable in failure annotations.

---

## Anti-patterns (one-liners — full list in each rule file)

- `@main` / `@latest` / unpinned third-party action.
- Primary cache key includes `${{ github.sha }}`.
- `permissions: write-all` (or the default, unset, on a pre-2023 repo).
- Lint, typecheck, and test glued sequentially in one job.
- Composite action that defines `jobs:` (it can't — that's a workflow).
- Reusable workflow used to wrap two shell steps.
- `cancel-in-progress: true` on a deploy workflow.
- Unscoped `on: push:` triggering on every branch and every path.
- 20 anonymous `run:` blocks with no `name:`.
- Secrets passed as workflow inputs instead of `secrets:` map.

---

## Definition of Done

A **scaffold** run is done when:

- [ ] Workflow purpose, triggers, stack, and shape were confirmed
      before any YAML was written.
- [ ] `on:` block is scoped to the relevant branches **and** paths.
- [ ] `concurrency` is set with the correct `cancel-in-progress` value
      for the workflow type.
- [ ] `permissions:` is set at the workflow level (or every job) and
      lists only what each job actually needs.
- [ ] Every third-party action is pinned to a full-length commit SHA
      with a `# vX.Y.Z` comment.
- [ ] Cache key uses `hashFiles(<lockfile>)` and includes `runner.os`
      (plus matrix axes); `restore-keys` is present.
- [ ] Independent jobs run in parallel; sequential dependencies are
      explicit via `needs:`.
- [ ] Repeated step blocks are extracted (composite action) or
      repeated job blocks are extracted (reusable workflow).
- [ ] Every step has a `name:` that reads as a sentence ("Install
      dependencies", not `npm-ci`).
- [ ] Failure paths surface to the PR via annotations or
      `$GITHUB_STEP_SUMMARY`.
- [ ] If using OIDC, `id-token: write` is set at the job level only.
- [ ] User received a one-paragraph summary of what was created and
      where to commit it.

A **review** run is done when:

- [ ] Every rule produced a PASS / WARN / FAIL with line evidence.
- [ ] Top 3 fixes are ranked by impact (speed, cost, or security).
- [ ] User received an offer to apply the fixes interactively.
