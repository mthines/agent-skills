---
title: verify-behavior — toolchain discovery
impact: HIGH
tags:
  - verify-behavior
  - toolchain
  - discovery
---

# Toolchain discovery

Never assume a global install.
A `tsc`, `go`, `cargo`, or `pytest` invocation that works on the author's machine can fail outright — or silently run the wrong version — in an agent's sandbox.
Resolve what to run, and how, before running anything.

## Discovery order

1. **`checks.yaml`** — if `.agent/{branch}/checks.yaml` exists (Full-Mode `autonomous-workflow` plans), its `setup:`/`run:` commands are the project's own declared, already-scoped verification commands.
   Prefer them over rediscovering a toolchain from scratch — they were authored against this exact repo.
2. **The `argent-environment-inspector` detection pattern** — the same "gather workspace data" approach used to detect build commands, test runners, and package manager: read `package.json` (`scripts`), `go.mod`, `Cargo.toml`, `pyproject.toml`/`setup.cfg`, `Makefile`, and any Nx (`project.json`, `nx.json`) or monorepo workspace config, before assuming a bare command works.
3. **Manifest scripts** — when neither of the above resolves a command, fall back to the manifest's own script definitions directly:
   - `package.json` → `scripts.test`, `scripts.build`, `scripts.typecheck`, `scripts.lint`.
   - `go.mod` + `Makefile` → a `Makefile` target (`make test`, `make build`) if present, else `go test ./...` / `go build ./...` / `go vet ./...`.
   - `nx` targets → `nx test <project>`, `nx build <project>`, `nx lint <project>` (project name from `project.json`).
   - `Cargo.toml` → `cargo check` / `cargo test` at the workspace or crate root.
   - `pyproject.toml` → whatever test/lint tool section is declared (`pytest`, `tox`, `nox`) rather than assuming `pytest` is installed globally.

Stop at the first source in this order that resolves a runnable command for the claim or check at hand — do not re-derive from a lower-priority source once a higher one has answered.

## Never assume a global install

Before invoking any Tier 2 or Tier 3 tool, confirm it resolves in **this** project's context, not just on `PATH` in general:

```bash
# Prefer a project-local binary over a global one.
[ -x node_modules/.bin/tsc ] && TSC=node_modules/.bin/tsc || TSC=$(command -v tsc || true)
[ -z "$TSC" ] && echo "tsc not found — check package.json devDependencies" && exit 1
```

The same rule applies to `go`, `cargo`, `pyright`/`mypy`, and any test runner: check the manifest declares the tool as a dependency (or that a version manager like `asdf`/`mise`/`rustup` pins one) before running it, and prefer the project-local binary (`node_modules/.bin/...`, a `venv`, a pinned toolchain) over whatever happens to be globally on `PATH`.
A global fallback that silently uses the wrong major version produces a receipt that looks confident and is wrong.

If no toolchain resolves at any step, the tier is **not decidable** here — report that as part of the receipt (see [`receipt.md`](./receipt.md)) rather than guessing with an unverified global binary.

## What this rule does not do

- It does not decide which tier to use — see [`ladder.md`](./ladder.md).
- It does not run the discovered command — that happens under [`isolation-safety.md`](./isolation-safety.md) for Tier 3, or directly for Tier 1/2.
