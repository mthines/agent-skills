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

The autonomous workflow requires two CLIs. **Stop and ask the user to install
anything missing — do not attempt to proceed without them.**

| Tool | Purpose                                  | Required for |
| ---- | ---------------------------------------- | ------------ |
| `gw` | Git worktree management (gw-tools)       | Phase 2      |
| `gh` | GitHub CLI for PRs and CI checks         | Phase 6, 7   |

---

## Verification

Run these checks before Phase 2. If either fails, stop and follow the
installation steps below.

```bash
which gw && gw --version
which gh && gh --version && gh auth status
```

| Check                 | Pass output                                  | If missing                       |
| --------------------- | -------------------------------------------- | -------------------------------- |
| `which gw`            | path to `gw`                                 | Install via Homebrew or npm      |
| `gw --version`        | version string                               | Re-install                       |
| `which gh`            | path to `gh`                                 | Install via Homebrew or download |
| `gh auth status`      | `Logged in to github.com`                    | Run `gh auth login`              |

---

## Installing `gw`

### Homebrew (macOS, recommended)

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

In each repo that uses the autonomous workflow, run once:

```bash
gw init
```

This creates `.gw/config.json` (commit-safe) and `.gw/.gitignore` (ignores
runtime state while allowing config to be committed).

---

## Installing `gh`

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

---

## Shell Integration for `gw`

`gw cd <branch>` requires shell integration to actually change the parent
shell's working directory (a child process can't `cd` for its parent).

### One-time install

```bash
gw install-shell
```

This appends a small shell function to your `~/.zshrc` or `~/.bashrc` that
wraps `gw cd` and runs the resulting `cd` in the current shell. Restart the
shell or `source` the rc file:

```bash
source ~/.zshrc      # or ~/.bashrc
```

### Verify

```bash
gw add feat/test-prereq
gw cd feat/test-prereq
pwd                   # should be inside the new worktree
gw remove feat/test-prereq
```

If `pwd` does not change, the shell integration didn't load — check that the
rc file is being sourced and that the function is defined (`type gw` should
show a function, not just an executable path).

---

## Troubleshooting

| Symptom                              | Likely cause                       | Fix                                |
| ------------------------------------ | ---------------------------------- | ---------------------------------- |
| `gw: command not found`              | Not on `PATH`                      | Re-install or update `PATH`        |
| `gw cd` does nothing                 | Shell integration not installed    | `gw install-shell` then re-source  |
| `gh: not authenticated`              | Token missing or expired           | `gh auth login`                    |
| `gh pr create` fails on push         | Remote `origin` not set or no perms| `git remote -v`, fix remote        |
| `.gw/config.json` not found          | Repo never initialized             | `gw init`                          |

---

## References

- Phase 2 (where these tools are first used): [phase-2-worktree](./phase-2-worktree.md)
- gw-tools README: <https://github.com/mthines/gw-tools>
- GitHub CLI manual: <https://cli.github.com/manual/>
- Related skill: [`git-worktree-workflows`](../../git-worktree-workflows/)
