---
title: Project Keying — Stable Surface Identity
impact: MEDIUM
tags:
  - surface
  - project-key
  - git
---

# Project Keying

## Contents

- [Primary: normalised git remote URL](#primary-normalised-git-remote-url)
- [Fallback: absolute git root path](#fallback-absolute-git-root-path)
- [Worktree stability](#worktree-stability)
- [Monorepo subprojects](#monorepo-subprojects)
- [Computing the key (implementation)](#computing-the-key-implementation)

A project key is the filename used for a project's surface file under
`surfaces/`.
It must be stable across `git worktree` checkouts of the same repository and
unique enough to avoid collisions between different projects.

## Primary: normalised git remote URL

```bash
git remote get-url origin
```

Normalise the result to a safe filename:

1. Strip the scheme (`https://`, `git@`, `ssh://`).
2. Replace `:` (in SSH-style `git@host:owner/repo.git`) with `-`.
3. Strip the `.git` suffix if present.
4. Replace `/` with `-`.
5. Lowercase the entire string.

### Examples

| Raw remote URL | Normalised key |
| --- | --- |
| `https://github.com/owner/my-repo.git` | `github.com-owner-my-repo` |
| `git@github.com:owner/my-repo.git` | `github.com-owner-my-repo` |
| `https://gitlab.com/group/subgroup/repo` | `gitlab.com-group-subgroup-repo` |
| `ssh://git@bitbucket.org/team/project.git` | `bitbucket.org-team-project` |

Surface filename: `surfaces/<normalised-key>.md`
Example: `surfaces/github.com-owner-my-repo.md`

## Fallback: absolute git root path

If `git remote get-url origin` fails (no remote configured, local-only repo):

```bash
git rev-parse --show-toplevel
```

Normalise the absolute path:

1. Strip the leading `/`.
2. Replace `/` with `-`.
3. Lowercase.

Example: `/Users/alice/work/my-project` → `users-alice-work-my-project`

Surface filename: `surfaces/users-alice-work-my-project.md`

The absolute-path fallback is less stable (the path changes if the repo moves),
but is correct for local-only projects where it is the only available identity.

## Worktree stability

Both primary and fallback keys are **stable across git worktrees** of the same
repository:
- The remote URL is the same in all worktrees of the same repo.
- The `--show-toplevel` of a worktree returns the worktree's own path, which
  differs from the main checkout. Projects using worktrees heavily should prefer
  the remote URL as the key (which is why the primary method is preferred).

## Monorepo subprojects

For a monorepo where each package has its own test suite, append the
package name to the key:

```
<normalised-remote-key>-<package-name>
```

Example: `github.com-acme-monorepo-packages-api`

The bootstrap step handles this automatically when it detects multiple
packages with independent test commands.
The `--surface <path>` flag is the escape hatch for unusual layouts.

## Computing the key (implementation)

```bash
# Primary
remote=$(git remote get-url origin 2>/dev/null)
if [[ -n "$remote" ]]; then
  key=$(echo "$remote" \
    | sed 's|^[a-z+]*://||; s|^git@||; s|:|/|; s|\.git$||' \
    | tr '/' '-' \
    | tr '[:upper:]' '[:lower:]')
else
  # Fallback
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  key=$(echo "$root" \
    | sed 's|^/||' \
    | tr '/' '-' \
    | tr '[:upper:]' '[:lower:]')
fi
echo "$key"
```
