---
name: verify-behavior
description: >
  Owns a cheapest-first three-tier verification ladder — Tier 1 syntactic
  (grep / ast-grep / read), Tier 2 semantic-no-execution (typecheck / build /
  lint), Tier 3 execution (run the covering test, or a minimal synthesized
  repro) — and reports the result as an evidence receipt (confirms /
  contradicts / ambiguous / null). It never scores; `confidence(code)` owns
  the number. Two consumer shapes: claim-verification (read-only, feeds
  `confidence(code)`) and change-verification (post-apply green/red gate).
  Called by `verification-receipt.md` (pr-reviewer Tier 2/3), `bug-fix-verifier`,
  `feature-pr-verifier`, and the `aw-executor` Phase 4 checks loop. Use when a
  finding or a change needs executed proof, not just a plausible-sounding
  claim. Triggers on "verify this claim", "does this actually happen at
  runtime", "prove this behavior", "run this to confirm", "/verify-behavior".
disable-model-invocation: false
argument-hint: '[claim|change]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - verification
    - execution
    - receipt
    - toolchain
    - isolation
---

# Verify Behavior

Given a behavioral claim about code, or a change that was just applied, decide **the cheapest way to get executed proof**, run it in isolation, and report the raw result as a receipt.

This skill is the execution engine six-plus call sites in this repo used to hand-roll independently: "detect the toolchain, run something, read pass or fail."
It replaces the ad hoc version in each of those with one shared ladder.

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md` and load on demand.

---

## The execute-not-score boundary

This skill **does not score** — it never assigns a confidence score and never grades pass/fail against an intent.
It runs a command, captures the raw output, and classifies the result against the *claim itself* as `confirms` / `contradicts` / `ambiguous` / `null`.

- `confidence(code)` owns the number — this skill supplies sharper evidence to that gate, it does not replace it.
- A calling agent's own grading (e.g. `bug-fix-verifier`'s `FAIL_TO_PASS`, the `aw-executor` Phase 4 `expect` comparison) stays with the caller — this skill supplies the run-and-observe mechanic underneath that grading, not the grading itself.

See [`rules/receipt.md`](./rules/receipt.md) for the full contract, including the hard invariant that a null or non-reproducing result **drops or contradicts** a finding and is never confirmation.

---

## The two consumer shapes

| Shape | Question it answers | Consumers |
| --- | --- | --- |
| **Claim-verification** | "Is this specific behavioral assertion true?" — read-only, feeds `confidence(code)` as Evidence | `agents/shared/rules/verification-receipt.md` (pr-reviewer Tier 2/3) |
| **Change-verification** | "Did this applied change produce the expected green/red result?" — a post-apply gate | `bug-fix-verifier`, `feature-pr-verifier`, `aw-executor` Phase 4 checks loop |

Both shapes share the same core: toolchain discovery, isolated execution, and the receipt format.
Only the output framing differs — see [`rules/receipt.md`](./rules/receipt.md).

---

## Mode Detection

Parse the **first token** of `$ARGUMENTS`.

| Mode | Default | Trigger | What it does |
| --- | --- | --- | --- |
| `claim` | **yes** | No mode token, or `claim` | Verify one behavioral assertion. Returns a single receipt. Read-only. |
| `change` | | First token `change` | Verify a just-applied change against an expected outcome. Returns a green/red gate result with the same receipt shape underneath. |

## Inputs

- `claim` (claim mode) — the behavioral assertion in prose, e.g. "`validateAuth` throws on an invalid token."
- `target` — the file(s) or symbol the claim or change concerns.
- `expected` (change mode) — the expected post-change outcome (e.g. an `expect:` string from `checks.yaml`, or "the repro now passes").
- `review_relation` — `"self"` | `"cross"` | `"untrusted"` (default `"self"` for a caller's own branch).
  Governs the Tier 3 trust split — see [`rules/isolation-safety.md`](./rules/isolation-safety.md).
- `caller` — the invoking agent or skill, for logging only.

## The ladder (cheapest-first)

| Tier | Name | Cost | Example tools |
| --- | --- | --- | --- |
| Tier 1 | Syntactic | Lowest | `grep`, `ast-grep`, `Read` |
| Tier 2 | Semantic-no-execution | Low | `tsc --noEmit`, `go build`/`go vet`/`staticcheck`, `cargo check`/`clippy`, `pyright`/`mypy` |
| Tier 3 | Execution | Highest | Run the covering test, or synthesize and run a minimal repro |

Stop at the cheapest tier that can **decide** the claim — do not escalate to Tier 3 when Tier 1 or Tier 2 already confirms or contradicts it.
Full per-language mapping in [`rules/ladder.md`](./rules/ladder.md).

## Workflow

| Phase | Name | Rule file | Gate |
| --- | --- | --- | --- |
| V1 | Toolchain discovery | [`rules/toolchain-discovery.md`](./rules/toolchain-discovery.md) | Discovery order resolved; never assume a global install |
| V2 | Tier selection | [`rules/ladder.md`](./rules/ladder.md) | Cheapest tier that can decide the claim, per the per-language adapter table |
| V3 | Isolated execution | [`rules/isolation-safety.md`](./rules/isolation-safety.md) | Throwaway worktree (Tier 3), tracked files never modified, scratch deleted, relation-keyed trust split honored |
| V4 | Receipt | [`rules/receipt.md`](./rules/receipt.md) | `confirms`/`contradicts`/`ambiguous`/`null`; null-is-never-confirmation invariant |
| V5 | Report | this file + [`rules/receipt.md`](./rules/receipt.md) | Claim mode returns the receipt; change mode returns the receipt plus a green/red verdict |

### V1 — Toolchain discovery

Resolve what to run before deciding how to run it: `checks.yaml` first, then the `argent-environment-inspector` detection pattern, then manifest scripts.
Never assume a tool is globally installed.
See [`rules/toolchain-discovery.md`](./rules/toolchain-discovery.md).

### V2 — Tier selection

Walk the ladder Tier 1 → Tier 2 → Tier 3, stopping at the first tier that can decide the claim.
A claim about symbol absence or a missing guard is usually a Tier 1 grep.
A claim about a type contract is usually a Tier 2 typecheck.
A claim about runtime return value, thrown error, or side-effect ordering needs Tier 3.
See [`rules/ladder.md`](./rules/ladder.md) for the full per-language table.

### V3 — Isolated execution

Tier 3 runs in a throwaway worktree, never touches tracked files, deletes its scratch harness after, defaults to no network, and never pipes a remote script into a shell.
Tier 3 is default-on only for the caller's own code (`self` relation); cross/untrusted callers need an explicit sandbox opt-in.
See [`rules/isolation-safety.md`](./rules/isolation-safety.md).

### V4 — Receipt

Every run — regardless of tier or mode — produces a receipt: the raw command, its raw output, and one of four verdict tokens.
A null or empty result is dropped or contradicts; it is never read as confirmation.
See [`rules/receipt.md`](./rules/receipt.md).

### V5 — Report

- **claim mode** → return the receipt to the caller (typically `confidence(code)` Evidence).
- **change mode** → return the receipt plus a green/red verdict against the caller-supplied `expected` outcome.
  The caller keeps its own grading semantics on top (e.g. `checks.yaml`'s `expect:` comparison, `FAIL_TO_PASS`).

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files |
| --- | --- |
| V1 | [`rules/toolchain-discovery.md`](./rules/toolchain-discovery.md) |
| V2 | [`rules/ladder.md`](./rules/ladder.md) |
| V3 | [`rules/isolation-safety.md`](./rules/isolation-safety.md) |
| V4, V5 | [`rules/receipt.md`](./rules/receipt.md) |
| wiring | [`agents/shared/rules/verification-receipt.md`](../../../agents/shared/rules/verification-receipt.md) — how `pr-reviewer` calls this skill |
| diagnose | [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md) |

## Core Principles

1. **Cheapest-first, always.** Never reach for Tier 3 when Tier 1 or Tier 2 already decides the claim.
2. **Never assume a global install.** Discover the project's actual toolchain before running anything (`rules/toolchain-discovery.md`).
3. **Isolation is not optional for Tier 3.** A throwaway worktree, no tracked-file mutation, scratch cleanup, no network by default, never `curl | sh` (`rules/isolation-safety.md`).
4. **Trust is relation-keyed, not caller-configurable.** Tier 3 on cross/untrusted code requires an explicit sandbox opt-in; this is a hard safety boundary, not a tuning knob.
5. **Execute, never score.** The receipt reports what happened; it never assigns a confidence number or a pass/fail grade against intent — that stays with the caller.
6. **Null is never confirmation.** A non-reproducing Tier 3 repro or a clean Tier 2 build on a claim asserting a problem exists DROPS or contradicts the finding.

## Anti-patterns (one-liners — full list in the rules)

- Escalating straight to Tier 3 for a claim a `grep` could decide.
- Assuming `tsc`/`go`/`cargo`/`pyright` is on `PATH` without checking the project's actual toolchain.
- Running Tier 3 in the working tree instead of a throwaway worktree.
- Running Tier 3 on cross/untrusted code without an explicit sandbox opt-in.
- Treating a null or empty Tier 3 result as confirming the claim.
- Returning a confidence score or a verdict against intent instead of a receipt.

## Definition of Done

- [ ] Toolchain discovered per the documented order, never assumed global.
- [ ] Cheapest deciding tier used; no unnecessary Tier 3 escalation.
- [ ] Tier 3 (if run) executed in isolation, tracked files untouched, scratch deleted.
- [ ] Trust split honored — Tier 3 gated by `review_relation`.
- [ ] Receipt returned with a verdict token; null/contradicting results dropped, never confirmed.
- [ ] No confidence score or intent-grade emitted by this skill itself.
