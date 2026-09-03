---
title: Workspace — establish access to the code before reviewing it
impact: HIGH
tags:
  - pr-reviewer
  - workspace
  - depth-capability
---

# Workspace

Every deep lens in this agent presumes the code is readable: a consumer trace, a type check, a covering test, a claim about a guard three files away.
None of that is possible from a diff.
This phase is what makes it possible, and — when it cannot — what makes the *absence* visible instead of silent.

The failure this rule exists to prevent is not "the review was shallow".
It is **a shallow review that renders the same report as a deep one**, so nobody can tell which they got.

## Contents

- [Run once, before any finder](#run-once-before-any-finder)
- [The capability ladder](#the-capability-ladder)
- [What each capability costs you](#what-each-capability-costs-you)
- [Toolchain detection](#toolchain-detection)
- [Dependency install is opt-in](#dependency-install-is-opt-in)
- [Declare the capability in the report](#declare-the-capability-in-the-report)
- [Cleanup](#cleanup)

---

## Run once, before any finder

Phase A runs after the PR is resolved and before Phase B.
It is not re-run per finder, per file, or per re-review pass within one invocation.

```bash
WORKDIR="$(mktemp -d)"
```

Everything downstream — the impact graph, every finder, every verification receipt — reads from `$WORKDIR`.
A finder that reaches for `gh api` to read a file is a bug: the file is on disk.

## The capability ladder

Try each rung in order. Stop at the first that succeeds.

```bash
# Rung 1 — a real checkout. Depth 50 is enough for blame and for a base..head diff
# on any PR a human would review, and bounded so a monorepo does not cost minutes.
if git clone --depth 50 --branch "$HEAD_REF" \
     "https://github.com/$RESOLVED_REPO.git" "$WORKDIR" 2>/dev/null; then
  DEPTH_CAPABILITY=checkout

# Rung 2 — a tarball of the head tree. No git history, so anything blame- or
# log-based is unavailable, but every file is readable.
elif gh api "repos/$RESOLVED_REPO/tarball/$HEAD_SHA" > "$WORKDIR/head.tgz" \
     && tar -xzf "$WORKDIR/head.tgz" -C "$WORKDIR" --strip-components=1; then
  DEPTH_CAPABILITY=tarball

# Rung 3 — the diff and nothing else.
else
  DEPTH_CAPABILITY=diff-only
fi
```

`diff-only` is a **real** state, not an error: a private fork, a revoked token, or a network-restricted runner all land here.
The rule is that the run continues, degraded, and says so.

**Never fabricate the rung.** If the clone failed, the capability is not `checkout` because a later step happened to read one file successfully.

## What each capability costs you

| Capability | Consumer trace | Type check | Covering test | Blame / log | Report line |
| --- | --- | --- | --- | --- | --- |
| `checkout` | yes | yes, if the toolchain resolves | yes, in self relation | yes | `Depth: checkout` |
| `tarball` | yes | yes, if the toolchain resolves | yes, in self relation | **no** — declare `unobtainable` | `Depth: tarball (no git history)` |
| `diff-only` | **no** — the graph degrades to declared symbols with no consumers | **no** | **no** | no | `Depth: diff-only — consumer, type, and test verification unavailable` |

A `diff-only` run may still post findings.
What it may not do is present a claim about code it never read as though it had read it: on `diff-only`, a behavioral `issue:` needs its receipt marked `unobtainable (no workspace)` per [`verification-receipt.md`](../../shared/rules/verification-receipt.md), and the depth tier is capped at `standard` regardless of what Phase C would otherwise choose — a `deep` tier whose deep lenses cannot run is a label, not a review.

## Toolchain detection

One pass over `$WORKDIR`'s root and, in a monorepo, the changed packages' nearest manifest:

| Marker | Semantic check (Tier 2) | Test runner |
| --- | --- | --- |
| `tsconfig.json` | `tsc --noEmit -p <path>` | `package.json` `scripts.test` |
| `go.mod` | `go vet ./...` | `go test` |
| `Cargo.toml` | `cargo check` | `cargo test` |
| `pyproject.toml` / `setup.cfg` | `pyright` or `mypy`, whichever is configured | `pytest` |
| `package.json` with no `tsconfig.json` | none — declare Tier 2 `unobtainable (no type system)` | `scripts.test` |

Record what resolved as `TOOLCHAIN`, and record what did **not**.
"No type check available" is information the verifier needs; a silently skipped Tier 2 is indistinguishable from a passing one.

## Dependency install is opt-in

Installing dependencies is the expensive step, and on an untrusted PR it executes that PR's install scripts.
It is therefore **off by default** and enabled per repo:

```yaml
# .github/review.yaml
workspace:
  install: true          # default false
```

With `install: false`, a Tier-2 receipt that needs resolved types is `unobtainable (no install)` — declared, listed in the report's withheld section, never quietly skipped.

**Never enable install for a cross-relation review of a fork.**
`REVIEW_RELATION = cross` on a fork head means the diff is untrusted code, and `npm install` runs it. Even with `install: true` in the config, treat a fork head as `install: false` and say so.

## Declare the capability in the report

`DEPTH_CAPABILITY` renders on the report's run line — the first line of the `**Run**` group — through the renderer's `RUN.depth` slot, never hand-written.
Pass it as `RUN.depth` in the `REPORT_BODY` payload; the renderer appends ` · depth <label>` after the parseable `<mode> · <N> lines in delta` prefix and expands `diff-only` into the label that names what is unavailable.

```markdown
incremental · 84 lines in delta · tier standard · depth tarball (no git history)
```

The renderer rejects `depth: diff-only` paired with `tier: deep`, because a deep review is not obtainable without a checkout — see [`report-rendering.md`](./report-rendering.md#runtier-and-rundepth--the-depth-declaration).

This is the line a maintainer reads to know how much the review's silence is worth.
A report that omits it is asserting full capability by default, which is exactly the failure the phase exists to fix.

## Cleanup

Remove `$WORKDIR` at the end of the run, including on the error paths.

```bash
trap 'rm -rf "$WORKDIR"' EXIT
```

A checkout left behind on a shared runner is both a disk leak and, on a private repo, source code sitting in `/tmp` after the job that was authorized to read it has ended.
