---
title: Comment Fetching — gh API Endpoints and Ledger Construction
impact: HIGH
tags:
  - github
  - api
  - comments
  - fetch
---

# Comment Fetching

Phase 2 builds one comment ledger per PR by querying three GitHub endpoints
and merging the results.

## Endpoints

For each PR `<owner>/<repo>#<n>`, fetch in **parallel** (one message, three `Bash` calls):

| Endpoint                                              | Returns                                              |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `gh api repos/<owner>/<repo>/pulls/<n>/reviews`       | Review submissions (with optional body + state)      |
| `gh api repos/<owner>/<repo>/pulls/<n>/comments`      | Line-level review comments (the `pulls/.../comments`) |
| `gh api repos/<owner>/<repo>/issues/<n>/comments`     | General PR conversation comments                     |

All three are needed:

- **Reviews** carry the reviewer's overall summary (e.g. "LGTM but please address X, Y, Z" — often the most actionable single block).
- **Pulls comments** are the inline `path` + `line` comments that suggestion blocks belong to.
- **Issues comments** are the conversation comments that often contain follow-up "and also please…" requests.

Use `--paginate` if any endpoint may exceed 100 results:

```bash
gh api --paginate repos/<owner>/<repo>/pulls/<n>/comments
```

## Resolved-thread filter

GitHub does not expose "resolved" status on `/pulls/<n>/comments` directly.
Use the GraphQL endpoint for resolved status:

```bash
gh api graphql -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            comments(first: 1) { nodes { databaseId } }
          }
        }
      }
    }
  }' -f owner=<owner> -f name=<repo> -F number=<n>
```

Build a `resolvedCommentIds: Set<number>` from the result and drop any
pulls-comment whose `id` is in the set.

## Suggestion blocks

A `pulls/.../comments` body may contain a Markdown fenced block:

````markdown
```suggestion
new code here
```
````

Extract these into a structured field on the ledger entry: `{ proposedReplacement: "<new code>" }`.
GitHub's UI lets the reviewer "Commit suggestion" with one click — the worker should be able to apply it just as mechanically.

## Ledger entry shape

```json
{
  "id": 4567890123,
  "source": "review" | "pulls" | "issues",
  "author": "alice",
  "body": "Please extract this into a helper",
  "path": "src/billing/format.ts",
  "line": 42,
  "side": "RIGHT",
  "originalLine": 40,
  "createdAt": "2026-05-12T10:33:00Z",
  "updatedAt": "2026-05-12T10:33:00Z",
  "proposedReplacement": null,
  "inReplyTo": null,
  "reviewId": 987654,
  "reviewState": "CHANGES_REQUESTED" | "COMMENTED" | "APPROVED" | null,
  "isResolved": false
}
```

Fields `path`, `line`, `side`, `originalLine` are only present when `source == "pulls"`.

## Deduplication

When the same comment appears via multiple endpoints (rare but possible
during review submission), keep the entry whose `source` is `pulls` over
`review` over `issues`. Track by `id`.

## Reply chains

If `inReplyTo != null`, the comment is part of a thread. Process every
comment in the thread; the **deepest** comment is the most recent
clarification. When two thread comments disagree, the deeper one wins.

## Author filter

By default, include comments from all authors **except** the current user
(authenticated via `gh auth status`). The user's own comments are usually
self-notes, not suggestions to themselves.

Surface a count of filtered comments in the Phase 7 report so the user can
spot mis-filtering.

## Author inclusion — humans AND AI reviewers

Process comments from **both** human teammates **and** AI / bot reviewers
(`claude[bot]`, `coderabbitai[bot]`, `sourcery-ai[bot]`, `sweep-ai[bot]`,
human reviewers — all included). The classification + validation gates in
Phases 3–4 decide what is actually actionable; the fetch layer must not
pre-filter by author type or the worker never sees the reviewer's feedback.

Concretely:

| Author kind                                                                                   | Treatment              |
| --------------------------------------------------------------------------------------------- | ---------------------- |
| Human teammate                                                                                | **Include**            |
| AI code-review bot — `claude[bot]`, `coderabbitai[bot]`, `sourcery-ai[bot]`, `sweep-ai[bot]`  | **Include**            |
| The current user (`gh auth status` login)                                                     | **Exclude** by default — self-notes, not feedback. Surface count in Phase 7. |
| Noise bots — `dependabot[bot]`, `renovate[bot]`                                               | **Exclude** unless the body contains a fenced `suggestion` block          |
| CI summary bots — `github-actions[bot]`                                                       | **Exclude** unless the body contains a fenced `suggestion` block          |

The split between "AI reviewer" and "noise bot" is by **login allowlist**,
not by `author.type`. Both groups have `author.type == "Bot"` on GitHub,
but only the AI-reviewer group produces feedback worth gating through
`/critical` + `/confidence`. The allowlist is conservative — if a new AI
reviewer launches, add it explicitly rather than flipping to "all bots".

Surface counts in the Phase 7 report:

```
Comments fetched (n):
  - human teammates:   <n>
  - AI reviewers:      <n>   (claude[bot], coderabbitai[bot], …)
  - self-filtered:     <n>
  - noise-filtered:    <n>   (dependabot, github-actions, …)
  - resolved-filtered: <n>
```

If the user wants to **exclude** AI-reviewer comments for a specific run,
they pass an explicit comment-permalink — `commentFilter` then scopes the
run to one comment regardless of author. The default policy is "include
both" because the skill's purpose is to act on every actionable suggestion
on the PR, whoever wrote it.

## Per-PR ledger output

The Phase 2 output for each PR:

```json
{
  "pr": "dash0/console#1234",
  "branch": "fix/foo",
  "headSha": "8a7c2d…",
  "comments": [ /* ledger entries */ ],
  "resolvedFilteredCount": 4,
  "botFilteredCount": 2,
  "selfFilteredCount": 1
}
```

Pass this whole structure to Phase 3 for classification.
