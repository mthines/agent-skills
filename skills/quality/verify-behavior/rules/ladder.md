---
title: verify-behavior — the three-tier ladder
impact: HIGH
tags:
  - verify-behavior
  - ladder
  - execution
---

# The three-tier ladder

The ladder is cheapest-first: walk Tier 1 → Tier 2 → Tier 3 and stop at the first tier that can **decide** the claim. Escalating past a deciding tier wastes cost for no additional certainty.

## Tier 1 — Syntactic

Cheapest. No compiler, no execution — just read the source.

| Tool | When to use |
| --- | --- |
| `grep -n` / `grep -c` | Symbol presence/absence, guard presence, control-flow keywords |
| `ast-grep` (if installed) | AST-level claims: function return type, parameter count, call shape |
| `Read` | Ordering or sequencing claims across a function body |

Decides: symbol exists/absent, a guard is present/missing, a literal pattern is present in a given order.
Does not decide: what the code does at runtime, whether a type contract holds, whether a test passes.

## Tier 2 — Semantic, no execution

Low cost. Runs the language's own static analyzer without executing any code path.

| Tool | When to use |
| --- | --- |
| `tsc --noEmit` | TS/JS type-contract claims (return type, parameter type, null-safety) |
| `go build` / `go vet` / `staticcheck` | Go type-contract and static-analysis claims |
| `cargo check` / `cargo clippy` | Rust type-contract and lint-level claims |
| `pyright` / `mypy` | Python type-contract claims (only decisive on a typed codebase) |

Decides: whether a type contract holds, whether a static analyzer flags a pattern, whether the code compiles/vets clean.
Does not decide: runtime return value, thrown/rejected error at runtime, side-effect ordering, data flow through a running program.

Tier 2 is **safe for anyone** — it never executes the code under test, so it is available in cross-review with no trust-split gate (see [`isolation-safety.md`](./isolation-safety.md)).

## Tier 3 — Execution

Highest cost, highest certainty. Runs the covering test if one exists; otherwise synthesizes a minimal repro and runs it.

| Approach | When to use |
| --- | --- |
| Run the existing covering test | A test already exercises the claimed behavior — cheapest Tier 3 path |
| Synthesize a minimal repro | No covering test exists; write the smallest script/test that exercises exactly the claim, run it, then delete it (per [`isolation-safety.md`](./isolation-safety.md)) |

Decides: actual runtime return value, actual thrown/rejected error, actual side-effect ordering, actual data flow.
This is the only tier that can decide a genuinely dynamic claim.

Tier 3 is gated by the relation-keyed trust split in [`isolation-safety.md`](./isolation-safety.md) — default-on only for the caller's own code.

## Per-language adapter table

Maps a claim type to the cheapest tier that can decide it, per language. A row's Tier 3 column is the fallback when Tier 1/2 cannot decide — not the default starting point.

| Claim type | Go | TS/JS | Python | Rust |
| --- | --- | --- | --- | --- |
| Symbol / guard exists | Tier 1 `grep` | Tier 1 `grep` | Tier 1 `grep` | Tier 1 `grep` |
| Return type / parameter contract | Tier 2 `go vet` / `staticcheck` | Tier 2 `tsc --noEmit` | Tier 2 `pyright`/`mypy` (typed code only) | Tier 2 `cargo check` |
| Lint-level pattern (unused var, dead code) | Tier 2 `staticcheck` | Tier 2 `tsc --noEmit` + linter | Tier 2 `pyright`/`mypy` | Tier 2 `cargo clippy` |
| Actual runtime return value | Tier 3 `go test` (covering test or minimal repro) | Tier 3 `<test-runner>` (covering test or minimal repro) | Tier 3 `pytest` (covering test or minimal repro) | Tier 3 `cargo test` (covering test or minimal repro) |
| Thrown / rejected error at runtime | Tier 3 (Go: explicit `error` returns, so often Tier 2 if the signature already returns `error`) | Tier 3 (unless the type signature already declares the throw — then Tier 2) | Tier 3 (unless the signature is typed to raise — Tier 2 partial) | Tier 3 (unless `Result<T, E>` already types the error — then Tier 2) |
| Side-effect ordering / data flow | Tier 3 | Tier 3 | Tier 3 | Tier 3 |
| Condition reachability (`else` unreachable) | Tier 2 `go vet` (some cases) or Tier 3 | Tier 1 `grep` for a type-narrowing guard, else Tier 3 | Tier 3 (dynamic typing rarely lets static tools decide) | Tier 2 `cargo check` (exhaustiveness) or Tier 3 |

A language not listed here (e.g. Ruby, Java, Kotlin) still follows the same ladder shape — find that language's equivalent static analyzer for Tier 2 (e.g. `sorbet`/`rbs` for Ruby, `javac`/`errorprone` for Java) via [`toolchain-discovery.md`](./toolchain-discovery.md) rather than skipping straight to Tier 3.

## What this rule does not do

- It does not decide *whether* to verify at all — that is the caller's decision (a behavioral claim per `verification-receipt.md`, or a `checks.yaml` entry per the Phase 4 loop).
- It does not grade the result against intent — see [`receipt.md`](./receipt.md) for the execute-not-score boundary.
- It does not own toolchain discovery mechanics — see [`toolchain-discovery.md`](./toolchain-discovery.md).
