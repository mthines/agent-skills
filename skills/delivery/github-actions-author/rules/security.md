---
title: Security — Permissions, SHA Pinning, Secrets, OIDC
impact: HIGH
tags:
  - security
  - permissions
  - sha-pinning
  - secrets
  - oidc
  - supply-chain
---

# Security

The single highest-impact change you can make to any workflow:
lock down `permissions:` and SHA-pin every third-party action. These
two changes alone prevent the great majority of GitHub Actions supply-
chain incidents.

## The four pillars

| Pillar             | Concrete rule                                                                  |
| ------------------ | ------------------------------------------------------------------------------ |
| Least privilege    | `permissions: {}` at workflow level; grant per-job.                            |
| SHA pinning        | Every third-party action pinned to a 40-char SHA + `# vX.Y.Z` comment.         |
| Secret hygiene     | Secrets pass via `secrets:` blocks. Never `echo "$TOKEN"`. Never cache them.    |
| Identity, not keys | Use OIDC to cloud providers. No long-lived `AWS_ACCESS_KEY_ID` in repo secrets. |

## Permissions — least privilege

`GITHUB_TOKEN` has implicit scopes. The default depends on repo age:

- Repos created after Feb 2023 default to **read** on `contents`.
- Older repos default to **write** on everything.

**Always be explicit.** Set `permissions: {}` at the workflow level
and grant per-job exactly what the job needs.

```yaml
permissions: {}              # Workflow level — empty.

jobs:
  test:
    permissions:
      contents: read         # for actions/checkout
    runs-on: ubuntu-latest
    steps: [...]

  deploy:
    permissions:
      contents: read
      id-token: write        # for OIDC to the cloud provider
      deployments: write     # to record a Deployment
    runs-on: ubuntu-latest
    steps: [...]

  comment-on-pr:
    permissions:
      pull-requests: write
      issues: write
    runs-on: ubuntu-latest
    steps: [...]
```

### Common scope patterns

| What the job does                | Permissions                                                  |
| -------------------------------- | ------------------------------------------------------------ |
| `actions/checkout` (private)     | `contents: read`                                             |
| Push to repo (commit/tag)        | `contents: write`                                            |
| Create a GitHub Release          | `contents: write`                                            |
| Push container to GHCR           | `contents: read`, `packages: write`                          |
| Comment on / label a PR          | `pull-requests: write`                                       |
| Comment on / label an issue      | `issues: write`                                              |
| Deploy to GitHub Pages           | `pages: write`, `id-token: write`                            |
| OIDC to AWS / GCP / Azure        | `id-token: write` (+ `contents: read` for checkout)          |
| Update a Check Run               | `checks: write`                                              |

Any scope not listed is implicitly `none` once `permissions:` is set.

## SHA pinning — third-party actions

Tags (`@v4`) are **mutable**. A tag can be moved, deleted, or
re-pointed without warning — and has been, in real incidents. SHAs
are immutable.

```yaml
# Bad — mutable
- uses: actions/checkout@v4

# Good — immutable, with version comment for humans + Dependabot
- uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
```

**Rules:**

1. **Every** third-party `uses:` reference is SHA-pinned. No
   exceptions for "trusted" actions — the 2025 `tj-actions/changed-files`
   compromise hit ~23,000 repos including ones using `@v45`.
2. Include the human-readable version in a trailing comment.
   Dependabot needs the comment to propose upgrades.
3. Verify the SHA comes from the **action's own repo**, not a fork.
4. First-party `actions/<x>` (maintained by GitHub) should also be
   SHA-pinned in 2026 — GitHub introduced an org-level policy that
   enforces it.

### How to get the SHA

```bash
gh api repos/actions/checkout/git/refs/tags/v4.1.7 --jq '.object.sha'
# or, for a release that points at a tag:
gh release view v4.1.7 --repo actions/checkout --json tagName,targetCommitish
```

Tools that automate this: `pinact`, `ratchet`, Dependabot (proposes
SHA bumps if you already SHA-pin).

### Reusable workflows from other repos

Same rule. Pin to a SHA:

```yaml
uses: my-org/shared-workflows/.github/workflows/test.yml@<40-hex> # v1.4.0
```

A branch-pinned cross-repo reusable workflow (`@main`) means a force-
push to that repo runs in your CI.

## Secrets

```yaml
# Good — read into env once, scoped to one step
- name: Publish to npm
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
  run: npm publish

# Bad — interpolated directly into the shell
- run: npm publish --token ${{ secrets.NPM_TOKEN }}
```

Why bad: shell interpolation can leak via `set -x`, error messages, or
malicious tool output. `env:` is masked in logs.

Rules:

- Never log a secret. GitHub masks them only if they came from the
  `secrets:` context — derived values are unmasked.
- Never write a secret to a path that gets cached or uploaded as an
  artifact.
- For PRs from forks, `secrets.*` and `GITHUB_TOKEN` are read-only.
  Don't try to work around this; design around it.
- Use **environment secrets** (Settings → Environments) for
  per-environment values; they support required reviewers and wait
  timers.

## OIDC — no long-lived cloud keys

OIDC lets a workflow exchange a short-lived JWT for cloud credentials.
No `AWS_ACCESS_KEY_ID` in repo secrets.

```yaml
permissions:
  id-token: write          # Required to request the OIDC token.
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>     # v4.x
      - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-deploy
          aws-region: us-east-1
      - run: aws s3 sync ./dist s3://my-bucket/
```

Equivalents:

- GCP — `google-github-actions/auth@<sha>` with Workload Identity
  Federation.
- Azure — `azure/login@<sha>` with federated credentials.

Set up the cloud-side trust policy to require:

- `repo:<org>/<repo>:ref:refs/heads/main` (or environment / tag).
- `iss: https://token.actions.githubusercontent.com`.

Never grant a workflow OIDC trust without **at least** scoping to a
ref. `repo:<org>/<repo>:*` lets any PR from any branch assume the role.

## Workflow trigger surface

| Trigger                                                          | Risk                                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `pull_request` from a fork                                       | Untrusted code; `GITHUB_TOKEN` is read-only by default. |
| `pull_request_target`                                            | Runs in the **base** repo with write access — dangerous. Audit carefully. |
| `workflow_run`                                                   | Runs after another workflow; secrets available. Same audit care. |
| `issue_comment` / `pull_request_review_comment`                  | Anyone with read access can trigger. Gate by author / labels. |

For `pull_request_target` and `workflow_run`, never check out the PR's
`HEAD` SHA without explicit guardrails — that's the
[GitHub-classic supply-chain hole](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/).

## Concurrency — denial-of-wallet defence

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

PRs cancel in-progress runs (a PR push fires 3 times in a minute);
`main` / `release` does not (`cancel-in-progress: false`).

## Examples

### Good — minimal, OIDC, SHA-pinned

```yaml
name: Deploy
on:
  push:
    branches: [main]

permissions: {}
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false       # Never cancel an in-flight deploy.

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production       # Required reviewers, wait timers, etc.
    permissions:
      contents: read
      id-token: write
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
      - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gh-deploy
          aws-region: us-east-1
      - run: ./deploy.sh
```

### Bad — write-everywhere, tag-pinned, secret echoed

```yaml
permissions: write-all
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4         # mutable tag
      - run: echo "Deploying with ${{ secrets.AWS_KEY }}"   # leaks
      - uses: some-org/deploy@main        # mutable + cross-repo
```

## Common mistakes

- **`permissions:` omitted.** Inherits broad defaults. **Fix:** set
  `permissions: {}` at workflow level; grant per-job.
- **Third-party action pinned to a tag.** Mutable. **Fix:** SHA-pin
  with a version comment.
- **Secret interpolated in `run:`.** Risk of leak via `set -x`,
  stderr, or tool output. **Fix:** read into `env:` for the step.
- **OIDC trust policy not ref-scoped.** Any fork PR can assume the
  role. **Fix:** scope the IAM trust policy to
  `repo:<org>/<repo>:ref:refs/heads/main` or by environment.
- **`pull_request_target` + checkout PR HEAD.** Untrusted code runs
  with secrets. **Fix:** check out the base sha, or use
  `pull_request` instead.
- **Cross-repo reusable workflow on `@main`.** Force-push lands in
  your CI. **Fix:** SHA-pin.
- **Dependabot disabled.** Pinned SHAs go stale; vulnerabilities
  don't get auto-bumped. **Fix:** enable Dependabot for `github-
  actions` ecosystem.
