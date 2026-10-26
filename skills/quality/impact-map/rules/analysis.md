# Analysis — fetch, candidates, verify, decide

Phases 0–3 of `impact-map`.
The output of this file is a list of at most three decisions, at most one "also live on merge" item, and a settled list, each with evidence.

## Contents

- [Fetch](#fetch)
- [Candidates](#candidates)
- [Verify](#verify)
- [Decide](#decide)
- [Writing What / Risk / Ask](#writing-what--risk--ask)

## Fetch

1. Read the PR metadata in one call:

   ```bash
   gh pr view "$PR" --json number,title,body,author,additions,deletions,changedFiles,files,baseRefName,headRefName,headRefOid
   ```

2. Get the diff:
   - **≤ 300 changed files:** `gh pr diff "$PR" > pr.diff`.
   - **> 300 changed files:** `gh pr diff` fails with `HTTP 406 … too_large`.
     Fetch both refs into a local clone and diff against the merge base:

     ```bash
     git fetch -q origin "pull/${PR_NUMBER}/head" "${BASE_REF}"   # PR_NUMBER from .number; pull/<n>/head also works for fork PRs
     BASE=$(git merge-base "origin/${BASE_REF}" "${HEAD_SHA}")
     git diff "${BASE}" "${HEAD_SHA}" > pr.diff
     ```

     Never `cd` into another worktree or switch its branch to do this.
3. Brace every shell variable that touches a path or a `rev:path` spec (`"${SHA}:path"`, never `$SHA:path`): zsh reads `$X:a…` as a history modifier.
4. Record `HEAD_SHA`, the merge base, and the file count; line links and the footer need all three.
5. **Check for a stack.** When the base branch is another open PR's head, or `gh pr list --base <headRefName>` returns a PR, name the stack in the Why and diff against the PR's own base, never `main`.

## Candidates

Walk every row.
A row with no hit in the diff produces nothing.

| # | Surface | Look for |
| --- | --- | --- |
| 1 | Public entry points | New or changed routes, proxy paths, CLI commands, slash commands, exported APIs — and whether anything gates them on merge |
| 2 | Hot paths | Changed code that existing traffic runs on merge, even as a refactor |
| 3 | Data | Migrations (new tables, altered tables, index rebuilds, backfills), their down migrations, rows that only grow |
| 4 | Secrets and auth | Routes or functions that return secret values, permission checks, who can create or read what |
| 5 | Removals | Deleted files, skills, agents, commands, flags — and every remaining caller of them |
| 6 | Behavior changes for current users | Anything a person or automation mid-flight hits differently after merge |
| 7 | Safety net | Tests or eval suites changed, removed, skipped, or not run; CI checks weakened |
| 8 | Description drift | A claim in the PR body the code does not back, or a change the body does not mention |

For a removal (row 5), search the head commit for live callers:

```bash
git grep -n -E "Skill\(\"?${NAME}|subagent_type=\"?${NAME}|/${NAME}\b|import .*${NAME}" "${HEAD_SHA}"
```

## Verify

Classify every candidate before it reaches the page.

| Class | Test | Goes to |
| --- | --- | --- |
| **Open** | The code shows it, and no test, doc, or description line says it is intended | A decision |
| **Settled** | A test name, a doc, or the description states it is intended | "Already settled", citing that test/doc/line |
| **Wrong** | Reading the code, its callers, or the default branch contradicts it | Dropped |

Checks that turn a candidate into "settled" or "wrong":

- **Read the test names** next to the code (`t.Run("…")`, `it("…")`): a test titled with the behavior settles it.
- **Grep the PR's own docs** (`docs/`, `README`, design notes) for the behavior.
- **Check the default branch's convention** before flagging an oddity: a renamed or disabled file may match what the repo already does.
- **Read the permission code** before writing who can reach a route; name the role the code requires, never "anyone".
- **Do not assert database behavior you cannot see.** Whether a migration file runs in one transaction depends on the runner; state the lock, not a uniqueness gap.
- **Verify the PR's own claims** that the decision rests on (e.g. "commands are byte-identical": compare every fenced block; report the count that differ and how).

```text
✗ Wrong — "A user env with an empty blocklist drops the org blocklist" as a decision
✓ Right — settled: tested in resolve_test.go:191 "an explicitly empty list does not inherit"
```

## Decide

1. Rank the open candidates by **reversibility, then reach**: data loss and anything kept forever first, then what runs for every user on merge, then the rest.
2. Keep at most **three** as decisions.
   Merge candidates that share one Ask.
3. Keep at most **one** non-decision item that runs on merge (typically a hot-path refactor) as the "also live on merge" row.
4. Give each decision **≤ 3 linked lines**, each with one question to answer at that line.
   Build the links with `scripts/line-link.mjs` ([`outputs.md § Line links`](./outputs.md#line-links)).
5. Tag description drift on the decision it belongs to.
6. **In a stack, link a risk that crosses PRs.** When a decision's risk also exists in another PR of the stack, end its Risk with `Same gap in #<n>.`
   Two halves of one contract (a server that sends `done` early, a client that waits on `done`) are the same risk.

## Writing What / Risk / Ask

One sentence each.
Name the thing, not the category.

| Field | Says | Must contain |
| --- | --- | --- |
| **What** | The fact in the diff | A concrete name: a path, table, flag, or function |
| **Risk** | Why a reviewer should care | Who or what is affected, and when |
| **Ask** | The decision | A yes/no or an either/or the reviewer can answer |

```text
✗ Wrong
What: Security considerations around the snapshot endpoint.
Risk: Could be a problem.
Ask: Consider reviewing this.

✓ Right
What: The internal snapshot GET returns plaintext secret values, re-read on every call.
Risk: Snapshots never expire and the request has no user check, so any internal caller can read a thread's current secrets indefinitely.
Ask: Should the route check the thread's user, or stop serving secrets after the thread ends?
```
