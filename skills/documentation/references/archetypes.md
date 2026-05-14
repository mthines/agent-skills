# Documentation Archetypes

Worked examples of the three project tiers — the per-tier file matrix,
the line budgets, and a concrete sample for each.

## 1. Complexity Tiers

| Metric                  | Small | Medium  | Large |
| ----------------------- | ----- | ------- | ----- |
| Source files            | < 50  | 50–250  | 250+  |
| Directories             | < 20  | 20–60   | 60+   |
| Monorepo packages       | 0     | 0–1     | 2+    |
| Has CI/CD               | No    | Yes     | Yes   |

Auto-routing by tier:

| Tier        | `CLAUDE.md`    | `.claude/rules/` | `README.md` | Root `docs/` | Nested `docs/` per package |
| ----------- | -------------- | ---------------- | ----------- | ------------ | -------------------------- |
| **Small**   | yes            | no               | yes         | no           | no                         |
| **Medium**  | yes            | yes              | yes         | yes          | no                         |
| **Large**   | yes (root + nested per package) | yes          | yes         | yes          | yes (per package)          |

## 2. Small Project — Single CLI Tool

A 30-file TypeScript CLI, no monorepo, single test suite.

### Files

```
my-cli/
├── CLAUDE.md              # ~80 lines — all the agent needs
├── README.md              # ~120 lines — humans
├── CHANGELOG.md           # generated
├── package.json
└── src/
```

### `CLAUDE.md` skeleton

```markdown
# my-cli

A TypeScript CLI for X.

## Commands

```bash
pnpm dev          # Watch mode
pnpm test         # Run all tests
pnpm lint         # Biome
pnpm build        # tsup
```

## Code Style

- ES modules; named exports only.
- Use `node:` prefix for built-ins (`import fs from "node:fs"`).
- No `any`; prefer `unknown` and narrow with type guards.

## Architecture

- `src/commands/` — one file per CLI subcommand.
- `src/lib/` — shared helpers; no I/O.
- `src/index.ts` — entry; wires up the command dispatcher.

## Gotchas

- The `--json` flag bypasses every spinner. Don't gate logic on TTY detection.
- `process.env.NO_COLOR` is respected globally — do not override it.
```

### `README.md` opens with

```markdown
# my-cli

> Lint and format TypeScript projects with one command.

[![npm](https://img.shields.io/npm/v/my-cli.svg)](https://www.npmjs.com/package/my-cli)
[![CI](https://github.com/me/my-cli/actions/workflows/test.yml/badge.svg)](...)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npm install -g my-cli
my-cli lint ./src
```

![demo](./docs/demo.gif)
```

Above-the-fold checklist passes in 12 lines of source.

## 3. Medium Project — Web App with API + Frontend

A 120-file Next.js app, with backend API routes, Prisma database, and
Playwright tests. Single repository, single deploy target.

### Files

```
my-app/
├── CLAUDE.md                              # ~150 lines
├── README.md                              # ~200 lines
├── CHANGELOG.md
├── .claude/
│   ├── rules/
│   │   ├── api.md                         # paths: ["src/api/**"]
│   │   ├── testing.md                     # paths: ["**/*.test.ts"]
│   │   └── database.md                    # paths: ["prisma/**"]
│   └── settings.json
├── docs/
│   ├── README.md                          # index
│   ├── explanation/
│   │   ├── architecture.md
│   │   └── data-model.md
│   ├── how-to/
│   │   ├── contributing.md
│   │   ├── deploy.md
│   │   └── add-a-migration.md
│   └── reference/
│       └── env-vars.md
└── src/
```

### `CLAUDE.md` carries

- Commands (`pnpm dev`, `pnpm test`, `pnpm db:migrate`).
- Top-level architecture (one paragraph).
- Critical gotchas ("Never edit `prisma/migrations/` by hand").
- `@docs/architecture.md` and `@docs/contributing.md` imports.

### Path-scoped rules

`.claude/rules/api.md`:

```markdown
---
description: API route conventions
paths:
  - "src/api/**/*.ts"
---

# API Routes

- All routes validate input via `zod` before any database call.
- Return errors as `{ ok: false, error: { code, message } }`.
- Document with OpenAPI comments above the handler.
```

`.claude/rules/database.md`:

```markdown
---
description: Database schema and migration rules
paths:
  - "prisma/**"
  - "src/db/**"
---

# Database

- Never edit a migration file after it has been merged. Make a new one.
- Run `pnpm db:migrate dev --name <name>` to create migrations.
- Every model needs a `createdAt` and `updatedAt` timestamp.
```

### `docs/explanation/architecture.md` covers

- Directory layout (one paragraph per top-level dir).
- Module boundaries (which package depends on which).
- Key design decisions (ADR-style: context, decision, consequences).

## 4. Large Project — Monorepo (Turborepo / Nx / pnpm workspaces)

A 600-file monorepo with five packages (`api`, `web`, `mobile`,
`shared`, `cli`), shared TypeScript config, and CI per package.

### Files

```
my-monorepo/
├── CLAUDE.md                              # ~120 lines — workspace-level
├── README.md                              # ~250 lines — workspace overview
├── CHANGELOG.md
├── .claude/
│   ├── rules/
│   │   ├── commit-style.md
│   │   └── workspace.md                   # paths: ["package.json", "pnpm-workspace.yaml"]
│   └── settings.json
├── docs/                                  # workspace-wide narrative
│   ├── README.md
│   ├── explanation/
│   │   ├── architecture.md                # how packages connect
│   │   └── monorepo-philosophy.md
│   └── how-to/
│       ├── add-a-package.md
│       └── contributing.md
├── packages/
│   ├── api/
│   │   ├── CLAUDE.md                      # ~80 lines — api-specific
│   │   ├── README.md                      # api as OSS package
│   │   ├── docs/
│   │   │   ├── README.md
│   │   │   └── architecture.md            # api-internal design
│   │   └── src/
│   ├── web/
│   │   ├── CLAUDE.md
│   │   ├── README.md
│   │   ├── docs/
│   │   └── src/
│   ├── mobile/
│   ├── shared/
│   └── cli/
└── turbo.json
```

### Root `CLAUDE.md` carries

- Workspace-level commands (`pnpm install`, `pnpm turbo run test`).
- One-paragraph orientation: what each package does, where to look.
- Cross-package gotchas ("Never import from `web` in `api` — they
  deploy separately").
- A pointer to each package's nested `CLAUDE.md`.

### Per-package `CLAUDE.md` carries

- That package's commands (`pnpm --filter=api test`).
- Package-specific architecture.
- Package-specific gotchas.
- `@docs/architecture.md` (the package's own `docs/`).

### Root `README.md` covers

- Workspace overview (what is this monorepo).
- One-table summary of every package with links to per-package READMEs.
- Monorepo setup (single install, single test, single build command).
- Tooling versions (Node, pnpm, Turbo).

### Per-package `README.md` covers

- That package as if it were standalone OSS — what it does, install,
  usage, link to its docs.

### Innermost-wins example

A rule about every API handler validating input belongs in
`packages/api/CLAUDE.md`, not the root. A web-only convention about
Server Components belongs in `packages/web/CLAUDE.md`. Only cross-package
rules ("commits use Conventional Commits", "every package ships a
`README.md`") live in root.

## 5. Tier Comparison Summary

| Surface              | Small        | Medium                            | Large                                                |
| -------------------- | ------------ | --------------------------------- | ---------------------------------------------------- |
| `CLAUDE.md`          | Root, ~80 ln | Root, ~150 ln                     | Root ~120 ln + per-package ~80 ln each               |
| `.claude/rules/`     | —            | 2–4 path-scoped files             | Cross-cutting only; package-internal rules live in package `CLAUDE.md` |
| `README.md`          | One file     | One file                          | Root + per-package                                    |
| `docs/`              | —            | Flat (or shallow Diátaxis)        | Full Diátaxis + per-package nested `docs/`           |
| CHANGELOG            | Generated    | Generated                         | Generated, per-package or workspace-wide              |

## 6. When to Promote a Tier

| Promote when…                                                                           | Direction          |
| --------------------------------------------------------------------------------------- | ------------------ |
| `CLAUDE.md` exceeds 200 lines                                                            | Small → Medium     |
| You add a second buildable workspace (`packages/`, `apps/`)                              | Medium → Large     |
| You hit > 50 doc pages                                                                   | Add a doc site     |
| You ship breaking changes to a public API                                                | Versioned docs     |
| `.claude/rules/` files keep needing the same `paths:` glob                              | Move to nested CLAUDE.md |
