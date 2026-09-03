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
- [Rung 0 — a worktree over the local object store](#rung-0--a-worktree-over-the-local-object-store)
- [What each capability costs you](#what-each-capability-costs-you)
- [Toolchain detection](#toolchain-detection)
- [Dependency install is opt-in](#dependency-install-is-opt-in)
- [Declare the capability in the report](#declare-the-capability-in-the-report)
- [Cleanup](#cleanup)

---

## Run once, before any finder

Phase A runs after the PR is resolved and before Phase B.
It is not re-run per finder, per file, or per re-review pass within one invocation.

Everything downstream — the impact graph, every finder, every verification receipt — reads from `$WORKDIR`.
A finder that reaches for `gh api` to read a file is a bug: the file is on disk.

Two variables come out of this phase, and the second one exists only so cleanup cannot go wrong:

| Variable | Meaning |
| --- | --- |
| `WORKDIR` | the absolute path everything downstream reads from |
| `WORKDIR_CLEANUP` | how this run is allowed to dispose of `WORKDIR`: `none` (it is the user's), `worktree` (`git worktree remove`), or `rm` (`rm -rf`) |

`WORKDIR_CLEANUP` is an enum rather than an owned/not-owned boolean because there are three dispositions and only two of them are "delete it".
A git worktree deleted with `rm -rf` leaves the parent repo broken, so "we created it" does not by itself say how to remove it.

## The capability ladder

Try each rung in order. Stop at the first that succeeds.

```bash
# Rung 0 — a worktree over the LOCAL object store, when the current directory is a clone
# of the PR's repo. No network clone, and full history rather than 50 commits.
# Two implementations; `gw` is preferred, plain git is the fallback. See the section below.
if git remote get-url origin 2>/dev/null \
     | grep -qiE "[:/]${RESOLVED_REPO}(\.git)?/?$" \
   && git fetch origin "pull/$PR_NUMBER/head" 2>/dev/null; then

  if gw --help >/dev/null 2>&1 \
     && WORKDIR="$(gw checkout --no-hooks "$PR_URL")" \
     && [ -z "$(git -C "$WORKDIR" status --porcelain)" ] \
     && [ "$(git -C "$WORKDIR" rev-parse HEAD)" = "$HEAD_SHA" ]; then
    WORKDIR_CLEANUP=none                    # gw owns its lifecycle; never remove it
    DEPTH_CAPABILITY=checkout

  # Fallback — plain `git worktree`, detached at the reviewed SHA. Available wherever
  # rung 0's precondition holds, so a missing `gw` costs the rung nothing.
  # `git worktree add` requires a non-existent path, hence the named parent: the
  # `worktree` disposition rmdir's it, so the temp dir is not orphaned.
  elif WORKTREE_PARENT="$(mktemp -d)" && WORKDIR="$WORKTREE_PARENT/wt" \
       && git worktree add --detach "$WORKDIR" "$HEAD_SHA" 2>/dev/null; then
    WORKDIR_CLEANUP=worktree                # `git worktree remove`, never `rm -rf`
    DEPTH_CAPABILITY=checkout
  fi
fi

if [ -z "$DEPTH_CAPABILITY" ]; then
  WORKDIR="$(mktemp -d)"
  WORKDIR_CLEANUP=rm

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
fi
```

`diff-only` is a **real** state, not an error: a private fork, a revoked token, or a network-restricted runner all land here.
The rule is that the run continues, degraded, and says so.

**Never fabricate the rung.** If the clone failed, the capability is not `checkout` because a later step happened to read one file successfully.

## Rung 0 — a worktree over the local object store

When the run is already inside a clone of the PR's repository, cloning it again over the network to read files that are on the local disk is waste.
A worktree shares the existing object store, so it is both faster than rung 1 and strictly more capable: **full history**, so blame and `log` are available rather than bounded at 50 commits.

The rung is about the **local clone**, not about any particular tool.
[`gw`](https://github.com/mthines/gw-tools) is the ergonomic way to get one and is tried first; plain `git worktree` is the fallback, and it is a fallback in convenience only — the capability is identical.

### The precondition is the local clone, and it is shared

Rung 0 is skipped — not failed — unless both of these hold. Fall through to rung 1.

| Precondition | Check |
| --- | --- |
| the current directory is a clone of the PR's repo | the origin remote resolves to `$RESOLVED_REPO` |
| the PR's head is fetchable into it | `git fetch origin "pull/$PR_NUMBER/head"` exits 0 |

Fetch the **`pull/<n>/head` ref**, not `$HEAD_REF`. A fork PR's head branch does not exist on `origin`, and `git fetch origin <branch>` fails for exactly the PRs where a local clone is most useful — so branch-fetching would silently restrict rung 0 to same-repo PRs.

`gw` being installed is **not** a precondition. It selects the implementation.

### Implementation A — `gw checkout` (preferred)

```bash
gw checkout --no-hooks <PR_URL>         # explicit, and the form to prefer in a script
gw checkout --no-hooks <PR_NUMBER>      # same repo as the current directory
```

Capture the resulting absolute path from the command output; that is `WORKDIR`.
`gw` gives the worktree a stable, discoverable path in the user's workspace and reuses one that already exists, which is why it is first.

That reuse is also its one drawback, and it is what the verification below exists for: unlike a fresh worktree, the directory may already have state in it.

### Implementation B — `git worktree add --detach` (fallback)

```bash
git worktree add --detach "$WORKDIR" "$HEAD_SHA"
```

Available wherever rung 0's precondition holds, so **a missing `gw` costs the rung nothing** — it does not drop the review to a network clone.

Two deliberate choices, both of which make this path simpler than implementation A rather than merely equivalent:

- **`--detach`,** so no branch is checked out. A read-only review needs a tree, not a branch, and `git worktree add <branch>` fails outright when that branch is already checked out in another worktree — which is the common case on the PR a developer is working on.
- **at `$HEAD_SHA`,** not at a ref. That satisfies the one-read-one-head rule *by construction*: there is no window in which the worktree resolves to a commit other than the one this run is reviewing, so the SHA half of the verification below cannot fail.

### Verify before trusting a reused worktree

Implementation A reuses, so both checks are mandatory there.
Implementation B creates a fresh detached worktree at the SHA, so only the cleanliness check is meaningful and it cannot fail in practice.

```bash
git -C "$WORKDIR" status --porcelain     # must be empty
git -C "$WORKDIR" rev-parse HEAD         # must equal $HEAD_SHA
```

- **Dirty tree** → fall through to the next implementation, then to rung 1. Do **not** stash, reset, or clean: those are the user's uncommitted changes, and a review is not worth destroying them. A finding produced from a dirty tree is also wrong twice over — it may describe code that is not in the PR, attributed to the PR's author.
- **`HEAD != HEAD_SHA`** → `git fetch origin "pull/$PR_NUMBER/head" && git merge --ff-only FETCH_HEAD` once, then re-check; still mismatched → fall through. `HEAD_SHA` was bound once at Step 1.1 and is the commit this whole run is about, so reviewing a different tree would silently break the one-read-one-head rule.

Never `git checkout <branch>` in the user's main worktree to reach the PR's head — that mutates their working state without consent. A worktree, or a rung below.

### `--no-hooks` is not optional here

`gw`'s post-create hooks are how a repo makes a fresh worktree *usable* — typically `pnpm install`, sometimes a codegen or env-sync step.
A review reads code; it does not build it.
Passing `--no-hooks` is what keeps this rung honest about two rules this file already owns:

1. **[Dependency install is opt-in](#dependency-install-is-opt-in).** Letting a hook run `pnpm install` would install dependencies as a side effect of *how the workspace was materialized*, so the same repo would get installed dependencies on rung 0 and not on rung 1 — with `install: false` in its config either way.
2. **A fork head is untrusted code.** `npm install` runs scripts from the diff. The fork rule below is unenforceable if an install can arrive through a hook nobody in this pipeline chose to run.

So: `--no-hooks` on every invocation, in every relation, whatever the config says.
When `workspace.install` is `true` **and** the relation is safe, run the install command that [toolchain detection](#toolchain-detection) resolved, explicitly and visibly — one policy, one owner, one place it can be audited.

The plain-git fallback has no hooks to suppress, which is the one respect in which it needs no rule: `git worktree add` runs nothing.

## What each capability costs you

| Capability | Consumer trace | Type check | Covering test | Blame / log | Report line |
| --- | --- | --- | --- | --- | --- |
| `checkout` via rung 0 (worktree, either implementation) | yes | yes, if the toolchain resolves | yes, in self relation | yes, **full history** | `Depth: checkout` |
| `checkout` via rung 1 (clone) | yes | yes, if the toolchain resolves | yes, in self relation | yes, bounded at 50 commits | `Depth: checkout` |
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

Dispose of `$WORKDIR` at the end of the run, including on the error paths, **by the method `WORKDIR_CLEANUP` names** — and by no other.

```bash
cleanup() {
  case "$WORKDIR_CLEANUP" in
    none)     : ;;                                            # the user's worktree; leave it
    worktree) git worktree remove --force "$WORKDIR"          # ours, but git owns the bookkeeping
              rmdir "$WORKTREE_PARENT" ;;                     # …and the temp dir holding it
    rm)       rm -rf "$WORKDIR" ;;                            # a temp clone or tarball
  esac
}
trap cleanup EXIT
```

The `rmdir` is not tidiness: `git worktree add` refuses an existing path, so the fallback creates
`$WORKTREE_PARENT/wt` — and `git worktree remove` deletes only `wt`, leaving the `mktemp -d` parent
behind on every run. One empty directory per review, forever, on a long-lived runner.
`rmdir` rather than `rm -rf` because the parent must be empty by then; if it is not, something put
a file there and silence is the wrong answer.

A checkout left behind on a shared runner is both a disk leak and, on a private repo, source code sitting in `/tmp` after the job that was authorized to read it has ended.
So two of the three cases do delete — the enum exists because *which* delete is not a detail.

This is the one place in the file that destroys data if it is wrong, and there are two distinct ways to get it wrong:

```text
❌ WRONG — `rm -rf "$WORKDIR"` on a `none` (gw) worktree
   Deletes the user's worktree, which they created and may have uncommitted work in.

❌ WRONG — `rm -rf "$WORKDIR"` on a `worktree` (plain-git) worktree
   The directory is ours to remove, but removing it behind git's back leaves a stale entry in the
   parent repo's `.git/worktrees`. The next `git worktree add` at that path fails and `gw` reports
   a corrupt worktree until someone runs `git worktree prune`. The review has then broken the
   repo it was reviewing — while deleting only its own scratch directory.

✅ RIGHT — `none` → leave it; `worktree` → `git worktree remove`; `rm` → `rm -rf`
```

So `rm -rf` is correct **only** for a directory this run filled with a clone or a tarball.
A worktree is removed through git or not at all.

An implementation-A worktree is **never** removed by this agent, not even with `gw remove`, and the reason is that `gw checkout` reuses: its output does not distinguish "created for you just now" from "the one you have had open for a week", so there is no signal on which removal could be made safe. A read-only review that cannot tell the difference does not get to decide the worktree is finished.
