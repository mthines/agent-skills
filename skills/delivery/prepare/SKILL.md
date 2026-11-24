---
name: prepare
description: >
  Gets a PR, and every PR stacked above it, green without new work: resolves
  merge conflicts, fixes failing CI, and applies unresolved review comments, in
  that order, then confirms CI; --merge squash-merges bottom to top once every
  gate passes. Triggers on "get this PR green", "prepare this PR",
  "make the stack mergeable", "fix and merge", "/prepare".
disable-model-invocation: false
argument-hint: '[<pr-url>|#<n>] [--merge] [--single]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: orchestrator
  tags: [pr, stack, ci, conflicts, review-threads, merge, orchestrator, delivery]
---

# Prepare

Gets one PR, and every open PR stacked above it, to green: no conflicts, passing CI, no unresolved review threads.
It delegates each fix to an existing skill and starts no new work.

## Arguments

Parse `$ARGUMENTS`: the first non-flag token is the PR, everything else is a flag.

| Argument | Default | Effect |
| --- | --- | --- |
| `<pr-url\|#n>` | the current branch's PR (`gh pr view --json url -q .url`) | The bottom PR of the job. |
| `--merge` | off | After the fixes, squash-merge bottom to top behind explicit gates. Read and follow [`rules/merge.md`](./rules/merge.md). |
| `--single` | off | Only this PR; skip the stack walk. |

## Step 0: Resolve scope

1. Set `PRS` to the given PR.
2. Unless `--single`, walk up: for each PR in `PRS`, run `gh pr list --base <its head branch> --state open --json number,url,headRefName`, and append the results.
   When a PR has more than one child, order by depth, then PR number.
3. `PRS` is now ordered bottom to top, which is also merge order.

## Step 1: Check state

For each PR in `PRS`:

```bash
gh pr view <n> --json mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,headRefName,baseRefName
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}' -F o=<owner> -F r=<repo> -F n=<n>
```

A PR needs work when `mergeable` is `CONFLICTING`, any check is failing, or any review thread is unresolved.

A check still running is not green: `gh pr checks <n> --watch` first, then decide.
A PR whose checks all concluded `SKIPPED` (a repo that skips CI on drafts) has not run CI: report it as `CI not run (all checks skipped)`, never as green, and do not merge it.

```text
✗ draft PR, every check SKIPPED, none failing → Already green
✓ #41 CI not run (all checks skipped)
```

If no PR needs work and every PR ran CI, print `Already green` (without `--merge`) and stop.
Under `--merge`, skip Step 2 and go to the merge step.

## Step 2: Fix, bottom to top

Work one PR at a time, bottom first, and finish it before moving up.
`gh pr checkout <n>` before touching any PR other than the one already checked out.
Skip every step that does not apply:

| Order | Condition | Run |
| --- | --- | --- |
| 1 | Merge conflicts | Start the update, then `Skill("resolve-conflicts")` (below) |
| 2 | Failing CI | `Skill("ci-auto-fix", "<pr-url>")` |
| 3 | Unresolved review threads | `Skill("implement-suggestion", "<pr-url> --resolve-all")` |

`resolve-conflicts` only resolves a merge or rebase that is already in progress, and previews against `origin/main` otherwise.
So for row 1, start the update against the PR's own base first, so a stacked PR is compared with its real base:

```bash
git fetch origin <baseRefName>
git rebase origin/<baseRefName>   # stops on conflicts; resolve-conflicts takes it from there
```

Once the rebase finishes, `git push --force-with-lease`.

If a `Skill()` call is refused, apply that skill's contract inline rather than skipping the step.
A push to a lower PR can create conflicts or red CI above it, so after every push re-run Step 1 for the PRs above.
Do not stop after the first PR, even when it was already green.

Rebases use `--force-with-lease`, never `--force`.
If a rebase conflict is not one you can resolve with confidence, stop and ask; do not resolve unfamiliar conflicts to make the stack green.

## Step 3: Confirm

Watch CI on each PR's new head: `gh pr checks <n> --watch`.
A PR that is not passing after the fixes is reported as blocked, with the reason.

## Step 4: Report

One line per PR:

```text
#1 already green · #2 fixed CI · #3 resolved conflicts · #4 CI not run (all checks skipped)
```

Say `Already green` only when every PR in scope is, and never for a PR whose CI did not run.

## Hard rules

- **Never** start new work, refactor, or re-review.
- **Never** weaken a check to get CI green.
- **Never** merge without `--merge`.
- **Never** merge a PR that sits above one that is still open.
