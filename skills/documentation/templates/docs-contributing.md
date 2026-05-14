# `docs/how-to/contributing.md` Template

The new-contributor onboarding doc. Reads top-to-bottom on day one;
referenced periodically thereafter.

Diátaxis quadrant: **How-to**. Action-only. No teaching, no rationale.
If a contributor needs the *why*, link to `docs/explanation/`.

---

```markdown
# Contributing

Thanks for contributing. This doc covers how to set up the dev
environment, the branch workflow, and the PR conventions.

## Dev environment

### Prerequisites

| Tool        | Version    | Install                                              |
| ----------- | ---------- | ---------------------------------------------------- |
| Node        | ≥ 20       | <link to nvm / fnm>                                  |
| pnpm        | ≥ 9        | `corepack enable && corepack prepare pnpm@latest --activate` |
| <tool>      | <version>  | <install command>                                    |

### First-run setup

```bash
git clone <repo>
cd <repo>
pnpm install
cp .env.example .env
# Set <VAR>=<value> in .env — see docs/reference/env-vars.md
pnpm db:migrate
pnpm dev
```

The dev server is now running at <http://localhost:3000>.

### Required env vars

| Variable     | Purpose                                | Default |
| ------------ | -------------------------------------- | ------- |
| `<VAR>`      | <one-line purpose>                     | —       |
| `<VAR>`      | <one-line purpose>                     | <value> |

For the full list, see [reference/env-vars.md](../reference/env-vars.md).

## Workflow

### Branches

- Branch from `main`.
- Use the format `<type>/<short-description>` — e.g. `feat/add-login`,
  `fix/timezone-bug`.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
type(scope): subject

[optional body]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
`build`, `ci`.

### Pull requests

- Open a draft PR early; mark "ready for review" when CI is green.
- Squash on merge (the default in `.github/settings.yml`).
- The PR description includes a "Test plan" checklist — what you ran
  locally to verify.

## Local testing

```bash
pnpm test           # All tests
pnpm test:unit      # Unit only
pnpm test:e2e       # Playwright E2E
pnpm lint           # Biome / ESLint
pnpm typecheck      # tsc --noEmit
```

To debug a failing CI check locally:

```bash
gh run view --log <run-id>
gh run rerun <run-id>     # after pushing a fix
```

## Where this doc does **not** cover

- Architecture and module boundaries → [explanation/architecture.md](../explanation/architecture.md).
- Deployment → [how-to/deploy.md](./deploy.md).
- API reference → [reference/api.md](../reference/api.md).
```

---

## Author guidance

- This is **how-to** territory — action only. No "the system uses
  Postgres because…". Move rationale to `docs/explanation/`.
- Cross-check the commands every `update` run — they go stale faster
  than any other doc content.
- Keep the "Prerequisites" and "Required env vars" tables short. If
  there are 20 env vars, this is a pointer table — link to a full
  reference doc.
