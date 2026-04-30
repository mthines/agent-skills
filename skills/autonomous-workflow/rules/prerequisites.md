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

The autonomous workflow has **one required tool** and **one recommended tool**.
Stop and ask the user to install anything missing — except `gw`, where the
workflow falls back to native `git worktree` if it's absent.

| Tool | Status      | Purpose                                     | Required for |
| ---- | ----------- | ------------------------------------------- | ------------ |
| `gh` | **REQUIRED**| GitHub CLI for PRs and CI checks            | Phase 6, 7   |
| `gw` | Recommended | Worktree management with hooks + auto-sync  | Phase 2 (falls back to `git worktree`) |

**If `gw` is not installed, the workflow uses native `git worktree` directly
and warns the user about the features they're missing.** See [Fallback to
native `git worktree`](#fallback-to-native-git-worktree) below.

---

## Verification

Run these checks at the start of Phase 2. Only `gh` is hard-required.

```bash
which gh && gh --version && gh auth status     # REQUIRED — stop if missing
which gw && gw --version || echo "gw not installed — using native git worktree"
```

| Check                 | Pass output                                  | If missing                                       |
| --------------------- | -------------------------------------------- | ------------------------------------------------ |
| `which gh`            | path to `gh`                                 | **STOP** — install via Homebrew or download      |
| `gh auth status`      | `Logged in to github.com`                    | Run `gh auth login`                              |
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

## Installing `gh` (REQUIRED)

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
setup. Verify with:

```bash
gh auth status
```

Without `gh`, Phase 6 (PR creation) and Phase 7 (CI gate) cannot proceed —
**this is hard-required**, no native fallback.

---

## Troubleshooting

| Symptom                              | Likely cause                       | Fix                                |
| ------------------------------------ | ---------------------------------- | ---------------------------------- |
| `gw: command not found`              | Not installed (optional)           | Use native `git worktree` fallback, or install gw |
| `gw cd` does nothing                 | Shell integration not installed    | `gw install-shell` then re-source  |
| `gh: not authenticated`              | Token missing or expired           | `gh auth login`                    |
| `gh pr create` fails on push         | Remote `origin` not set or no perms| `git remote -v`, fix remote        |
| `git worktree add` fails             | Branch already exists or path collision | Use a different branch name, or `git worktree list` to inspect |
| `.gw/config.json` not found          | Repo never initialized (gw only)   | `gw init` (only if using gw)       |

---

## References

- Phase 2 (where these tools are first used): [phase-2-worktree](./phase-2-worktree.md)
- gw-tools README: <https://github.com/mthines/gw-tools>
- GitHub CLI manual: <https://cli.github.com/manual/>
- Native git worktree: <https://git-scm.com/docs/git-worktree>
- Related skill: [`git-worktree-workflows`](../../git-worktree-workflows/)
