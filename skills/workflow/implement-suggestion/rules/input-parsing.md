---
title: Input Parsing — `$ARGUMENTS` to PR Tuples
impact: HIGH
tags:
  - parsing
  - input
  - github
  - pr-url
---

# Input Parsing

Phase 0 turns raw `$ARGUMENTS` into one of two structured outputs:

- **multi-pr** — a deduplicated list of `{owner, repo, prNumber, optionalCommentId}` tuples.
- **free-text** — a single suggestion string carried through unchanged.

## Empty `$ARGUMENTS` — active PR auto-detect

When `$ARGUMENTS` is empty, before falling back to a user prompt, attempt to
resolve the PR for the **current branch**:

```bash
gh pr view --json number,url,state,headRefName,headRefOid,isDraft,baseRepository
```

`gh pr view` with no PR number reads the current branch and resolves the
linked PR. Behaviour:

| `gh pr view` result                            | Action                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Returns a PR in state `OPEN`                    | Treat as multi-pr with one tuple. Print `Mode: multi-pr  Active PR: …`.   |
| Returns a PR in state `MERGED` or `CLOSED`      | Refuse to proceed. Print `Active PR #<n> is <state>. Pass an explicit URL to confirm.` |
| Exits non-zero (no PR found for this branch)    | Fall through to "prompt the user". The branch isn't tracking a PR yet.    |
| Current directory is not a git repo             | Fall through to "prompt the user". Free-text mode has no PR to detect.    |

The auto-detect resolves `owner` and `repo` from `baseRepository.owner.login`
and `baseRepository.name`. It does NOT carry a `commentFilter` — the user
asked for "all comments on this PR" implicitly by omitting any arguments.

Hard rule: auto-detect runs **only** when `$ARGUMENTS` is fully empty. Any
non-empty argument bypasses it — if the user passed a URL or pasted prose,
they meant that.

## Accepted PR URL forms

Match these patterns (case-sensitive on `pull`, host insensitive on case):

| Form                                                                                | Notes                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `https://github.com/<owner>/<repo>/pull/<n>`                                        | Canonical                                          |
| `https://github.com/<owner>/<repo>/pull/<n>/files`                                  | Strip trailing path; same PR                       |
| `https://github.com/<owner>/<repo>/pull/<n>/files#diff-<…>`                         | Strip fragment; same PR                            |
| `https://github.com/<owner>/<repo>/pull/<n>#discussion_r<commentId>`                | Extract `commentId`; same PR                       |
| `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<commentId>`               | Extract `commentId` (issue-comment endpoint)       |
| `https://github.com/<owner>/<repo>/pull/<n>#pullrequestreview-<reviewId>`           | Extract `reviewId`; treat as PR-level              |
| Bare `#<n>` or `<owner>/<repo>#<n>`                                                 | Only valid when paired with a known repo context   |

Reject and surface anything else (PR URL malformed, issue URLs, commit URLs, gist URLs).

## Separator handling

`$ARGUMENTS` may contain multiple URLs separated by:

- Spaces (single or multiple)
- Commas (with optional surrounding whitespace)
- Newlines
- Tabs

Tokenize on `[\s,]+`. Trim each token. Drop empties.

## Free-text detection

If **none** of the tokens match an accepted PR URL form, treat the entire raw
`$ARGUMENTS` as a free-text suggestion. Do not partially fall back — mixing
PR URLs with prose is ambiguous; ask the user to clarify.

Exception: a single comment permalink with no other URL is still **free-text**
if the current working directory is not a worktree for that PR. In that case,
fetch the comment body via `gh api`, treat it as the free-text input, and
proceed without committing.

## Deduplication

Two URLs that resolve to the same `<owner>/<repo>/pull/<n>` are merged. If both
a bare PR URL and a comment-anchored URL are supplied for the same PR, keep
the comment ID as a **filter** on Phase 2's fetch (only validate that comment).

## Output shape

```json
[
  { "owner": "dash0", "repo": "console", "prNumber": 1234, "commentFilter": null },
  { "owner": "dash0", "repo": "console", "prNumber": 1278, "commentFilter": 4567890123 }
]
```

`commentFilter` is `null` to process every actionable comment on the PR, or a
specific comment ID to scope the run.

## Validation

Before returning, for each tuple:

```bash
gh pr view <prNumber> --repo <owner>/<repo> --json number,state,headRefName,headRefOid,isDraft
```

- If `state` is `MERGED` or `CLOSED`, refuse to proceed for that PR and surface.
- If `isDraft` is true, proceed with a one-line warning in the Phase 6 report.

Capture `headRefName` (for worktree resolution) and `headRefOid` (to verify the
worktree is at the right SHA in Phase 1).

## Examples

### Multi-PR

Input:

```
https://github.com/dash0/console/pull/1234, https://github.com/dash0/console/pull/1278
```

Output:

```json
[
  { "owner": "dash0", "repo": "console", "prNumber": 1234, "commentFilter": null },
  { "owner": "dash0", "repo": "console", "prNumber": 1278, "commentFilter": null }
]
```

### Multi-PR scoped to one comment

Input:

```
https://github.com/dash0/console/pull/1234#discussion_r4567890123
```

Output:

```json
[
  { "owner": "dash0", "repo": "console", "prNumber": 1234, "commentFilter": 4567890123 }
]
```

### Free-text

Input:

```
Could you extract the duplicated price-formatting logic into a helper and reuse
it in `BillingTable` and `InvoicePreview`?
```

Output: the string itself, mode `free-text`.
