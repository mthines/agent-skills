---
title: 'Prerequisites'
impact: CRITICAL
tags:
  - setup
  - prerequisites
  - tools
  - gw
  - gh
---

# Prerequisites

The autonomous workflow needs **a GitHub access path** (Phases 6–7) and
**prefers `gw`** for worktree management (Phase 2). Neither specific binary is
hard-required: each has a defined fallback, and the workflow must never block
on a missing tool when a fallback exists.

| Capability | Status | Provided by | Required for |
| ---------- | ------ | ----------- | ------------ |
| GitHub access | **REQUIRED (the capability, not the binary)** | `gh` CLI **or** `mcp__github__*` tools — see [GitHub access path](#github-access-path) | Phase 6, 7 |
| Worktree management | Recommended | `gw`, falling back to native `git worktree` | Phase 2 |

**`gh` is not a hard dependency.** It is one of two ways to reach GitHub, and it
is **absent in Claude Code cloud sessions** (`which gh` returns nothing) while
the `mcp__github__*` tools are present. Treating `gh` as required is what turns
a perfectly workable cloud session into a hard stop — see
[GitHub access path](#github-access-path).

**If `gw` is not installed, the workflow uses native `git worktree` directly
and warns the user about the features they're missing.** See [Fallback to
native `git worktree`](#fallback-to-native-git-worktree) below.

## Contents

- [GitHub access path](#github-access-path)
- [Verification](#verification)
- [Fallback to native `git worktree`](#fallback-to-native-git-worktree)
- [Installing `gw` (recommended)](#installing-gw-recommended)
- [Installing `gh` (one of two GitHub paths)](#installing-gh-one-of-two-github-paths)
- [Troubleshooting](#troubleshooting)
- [References](#references)

---

## GitHub access path

**Owner: [`agents/shared/rules/github-access.md`](../../../../agents/shared/rules/github-access.md).**
Do not restate its mapping here — resolve the path through it.

Before any GitHub step, resolve which path you have — `gh` CLI,
`mcp__github__*` tools, or neither — per that file's
[Step 0](../../../../agents/shared/rules/github-access.md#step-0--resolve-your-path-once-before-any-github-step).
Resolve **once per run**, bind `ACCESS_PATH` (`gh` | `mcp` | `none`), state the
path you took, and use it for the whole run. Discovering the answer at Phase 6
is the bug.

| `ACCESS_PATH` | What Phases 6–7 do |
| ------------- | ------------------ |
| `gh` | Use the commands as written in the phase rules |
| `mcp` | Use the [verb mapping](../../../../agents/shared/rules/github-access.md#verb-mapping); do **not** attempt `gh` — every call fails. Mind the four documented [Gaps](../../../../agents/shared/rules/github-access.md#gaps), notably `gh pr checks --watch`, which has no MCP equivalent and becomes a bounded poll |
| `none` | GitHub steps cannot be performed. Do the `git` work you can (commit, push), name the skipped steps in `Degraded:`, and **never report a step you could not perform as done** |

Both `aw-planner` and `aw-executor` already carry `mcp__github__*` in their
`tools:` frontmatter, so the MCP path is available to them by construction. A
sub-agent inherits **neither** the parent's `gh` binary **nor** its MCP tools —
that is why the grant is explicit there.

---

## Verification

Run these checks at the start of Phase 2. Neither is a hard stop.

```bash
# GitHub access: resolve via github-access.md § Step 0 and bind ACCESS_PATH.
# Do NOT gate on `which gh` — it returns nothing in cloud sessions where the
# MCP path works perfectly, and `gh auth status` lies under a per-call
# credential proxy. The probe is a repo-scoped API call; see that file.
which gw && gw --version || echo "gw not installed — using native git worktree"
```

| Check                 | Pass output                                  | If missing                                       |
| --------------------- | -------------------------------------------- | ------------------------------------------------ |
| `ACCESS_PATH`         | `gh` or `mcp`                                | `none` — Phases 6–7 degrade; report precisely, never improvise |
| `which gw`            | path to `gw`                                 | Continue with native fallback (warn the user once)|

---

## Fallback to native `git worktree`

When `gw` is not installed, **do not block the workflow**. Instead, output the
warning below once at the start of Phase 2, then proceed with the native
equivalent commands:

> ⚠️ `gw` is not installed. The workflow will use native `git worktree`
> commands directly. You're missing:
>
> - **Auto-copy of secrets / env files** (`.env`, `.env.local`, etc.) into new
>   worktrees on creation.
> - **Pre/post-checkout hooks** (e.g. auto-running `npm install`,
>   regenerating types, syncing `.tool-versions`).
> - **`gw cd <branch>` shell integration** (you'll need to `cd` manually).
> - **Smart cleanup** (`gw remove` removes the branch + worktree atomically).
> - **Per-repo config** in `.gw/config.json`.
>
> Install `gw` later if you want these — see <https://github.com/mthines/gw-tools>.

### Command equivalents

| Operation               | With `gw`                    | Native `git worktree`                                       |
| ----------------------- | ---------------------------- | ----------------------------------------------------------- |
| Create worktree         | `gw add feat/foo`            | `git worktree add ../$(basename $(git rev-parse --show-toplevel))-feat-foo -b feat/foo` |
| List worktrees          | `gw list`                    | `git worktree list`                                         |
| Navigate to worktree    | `gw cd feat/foo`             | `cd ../$(basename ...)-feat-foo`  *(manual)*                |
| Sync env / secrets      | `gw sync feat/foo`           | `cp .env ../<worktree>/.env` *(manual; only files you knew to copy)* |
| Remove worktree         | `gw remove feat/foo`         | `git worktree remove ../<path>` then `git branch -d feat/foo` |
| Per-repo config         | `gw init`                    | (no equivalent — `.gw/config.json` is gw-specific)          |

### Path convention for native `git worktree`

When `gw` is unavailable, use the **same sibling-directory layout `gw` uses by
default**, so the worktree placement stays consistent for users who later
install `gw`:

```bash
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BRANCH_SLUG="$(echo "$BRANCH" | tr '/' '-')"   # feat/foo → feat-foo
WORKTREE_PATH="../${REPO_NAME}-${BRANCH_SLUG}"

git worktree add -b "$BRANCH" "$WORKTREE_PATH"
cd "$WORKTREE_PATH"
```

---

## Installing `gw` (recommended)

### Homebrew (macOS)

```bash
brew install mthines/gw-tools/gw
```

### npm (cross-platform)

```bash
npm install -g @gw-tools/gw
```

Supported platforms: macOS (Intel + Apple Silicon), Linux (x64 + ARM64),
Windows (x64).

### Build from source

```bash
git clone https://github.com/mthines/gw-tools.git
cd gw-tools
nx run gw-tool:compile
cp dist/packages/gw-tool/gw /usr/local/bin/gw
```

### Initialize the repo

In each repo where you want `gw`'s features (auto-copy, hooks, sync), run once:

```bash
gw init
```

This creates `.gw/config.json` (commit-safe) and `.gw/.gitignore` (ignores
runtime state while allowing config to be committed). Without `gw init`,
auto-copy and hooks won't fire even if `gw` is installed.

### Shell integration for `gw cd`

`gw cd <branch>` requires shell integration to actually change the parent
shell's working directory (a child process can't `cd` for its parent).

```bash
gw install-shell
source ~/.zshrc      # or ~/.bashrc
```

Verify:

```bash
gw add feat/test-prereq
gw cd feat/test-prereq
pwd                   # should be inside the new worktree
gw remove feat/test-prereq
```

If `pwd` does not change, the shell integration didn't load — check the rc
file is being sourced and `type gw` shows a function, not just an executable
path.

---

## Installing `gh` (one of two GitHub paths)

Install `gh` when you are working **locally** and want the CLI path. In a
Claude Code cloud session there is nothing to install — the `mcp__github__*`
tools are the path there, and `gh` is unavailable by design.

### Homebrew (macOS)

```bash
brew install gh
```

### Other platforms

See <https://cli.github.com/> for Linux package managers, Windows installers,
and direct downloads.

### Authenticate

```bash
gh auth login
```

Choose **GitHub.com**, **HTTPS**, **Login with a web browser** for the simplest
setup.

**Do not verify with `gh auth status`.** It inspects a stored token, so it
exits non-zero under a wrapped `gh` that injects a scoped credential per call
(several CI images, some sandboxes) even though every real API call succeeds —
declaring "no `gh`" on a session where `gh` works. Use the repo-scoped probe in
[`github-access.md` § Step 0](../../../../agents/shared/rules/github-access.md#step-0--resolve-your-path-once-before-any-github-step)
instead.

Without **either** path, Phase 6 (PR creation) and Phase 7 (CI gate) cannot
reach GitHub. That is a reported degradation, not a crash: commit and push
still work, and the run says precisely what it could not do.

---

## Troubleshooting

| Symptom                              | Likely cause                       | Fix                                |
| ------------------------------------ | ---------------------------------- | ---------------------------------- |
| `gw: command not found`              | Not installed (optional)           | Use native `git worktree` fallback, or install gw |
| `gw cd` does nothing                 | Shell integration not installed    | `gw install-shell` then re-source  |
| `gh: command not found`              | Cloud session, or `gh` not installed | **Not a blocker.** Resolve `ACCESS_PATH` per [github-access.md § Step 0](../../../../agents/shared/rules/github-access.md#step-0--resolve-your-path-once-before-any-github-step) and take the `mcp` path |
| `gh auth status` exits non-zero but API calls work | Wrapped `gh` injecting a per-call credential | Ignore `gh auth status` — probe with a repo-scoped `gh api repos/{owner}/{repo}` |
| `gh: not authenticated`              | Token missing or expired           | `gh auth login`, or fall through to the MCP path |
| `gh pr create` fails on push         | Remote `origin` not set or no perms| `git remote -v`, fix remote        |
| `git worktree add` fails             | Branch already exists or path collision | Use a different branch name, or `git worktree list` to inspect |
| `.gw/config.json` not found          | Repo never initialized (gw only)   | `gw init` (only if using gw)       |

---

## References

- Phase 2 (where these tools are first used): [phase-2-worktree](./phase-2-worktree.md)
- gw-tools README: <https://github.com/mthines/gw-tools>
- GitHub CLI manual: <https://cli.github.com/manual/>
- Native git worktree: <https://git-scm.com/docs/git-worktree>
- Without `gw`, the native equivalents are `git worktree add -b <branch> <path>`, `git worktree list`, and `git worktree remove <path>`.
