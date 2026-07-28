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

## Resolved-thread filter and thread-ID map

GitHub does not expose "resolved" status — or the thread node ID needed to
**resolve** a thread — on `/pulls/<n>/comments` directly. Use the GraphQL
endpoint for both. Fetch the thread `id` (the GraphQL node ID, **not** the
`databaseId`) and every comment's `databaseId` in the thread:

```bash
gh api graphql -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            id
            isResolved
            comments(first: 100) { nodes { databaseId } }
          }
        }
      }
    }
  }' -f owner=<owner> -f name=<repo> -F number=<n>
```

**Truncation guard.** GraphQL connections cap at `first: 100`; `--paginate`
does not work for GraphQL. If `reviewThreads.pageInfo.hasNextPage == true`, the
PR has > 100 review threads and this single page is incomplete — threads beyond
position 100 would arrive with `threadId: null`, be silently skipped at resolve
time, and make the Phase 7 `Resolved` count under-report. Do **not** silently
truncate: either page through with the `endCursor` cursor, or surface a warning
in the Phase 7 report — `PR has > 100 review threads; thread-ID map is
incomplete; some addressed comments may not be auto-resolved` — and continue.
The inner `comments(first: 100)` cap only matters for a single thread with
> 100 replies (rare); the same guard applies if you observe it.

From the result build two structures:

1. `resolvedCommentIds: Set<number>` — every `databaseId` in a thread whose
   `isResolved == true`. Drop any pulls-comment whose `id` is in the set.
2. `commentIdToThreadId: Map<number, string>` — map every comment `databaseId`
   in an **unresolved** thread to that thread's node `id`. This is what the
   worker uses in Phase 6 to call `resolveReviewThread` after committing the
   fix for that comment. Carry it into the pack (per `apply` comment) as
   `threadId`.

Only `source == "pulls"` comments belong to a resolvable review thread.
`issues` comments and top-level `review` summaries have no thread node ID —
their `threadId` is `null` and they are **not** resolvable (see
[handoff.md](./handoff.md) for how the worker handles the `null` case).

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
  "isResolved": false,
  "threadId": "PRRT_kwDO…"
}
```

Fields `path`, `line`, `side`, `originalLine`, `threadId` are only present when
`source == "pulls"`. `threadId` is the GraphQL review-thread node ID (from
`commentIdToThreadId`) the worker resolves after committing the fix; it is
`null` for `issues` / `review` comments, which have no resolvable thread.

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
human reviewers — all included by default). The classification + validation gates in
Phases 3–4 decide what is actually actionable; the fetch layer must not
pre-filter by author type or the worker never sees the reviewer's feedback.

### Step 1 — Load bot policy from `.review.yaml`

Before filtering, load the resolved `bot_policy` from the `.review.yaml` config
(see [`agents/shared/rules/review-config.md#bot-policy`](../../../../agents/shared/rules/review-config.md#bot-policy)).
The resolved policy has two parts:

- `default` (`include` | `exclude`) — fallback treatment for any bot not explicitly listed.
  Default when no `bot_policy` is configured: `include` (standard allowlist below applies).
- `bots` — a map of `login → { action, min_confidence }` entries.

Build a lookup table for fast per-comment resolution:

```python
bot_policy = load_review_yaml_bot_policy()  # returns { default, bots: {...} }

def resolve_bot_action(login: str) -> (action, min_confidence):
    if login in bot_policy.bots:
        return bot_policy.bots[login].action, bot_policy.bots[login].get("min_confidence")
    if login ends with "[bot]":
        # apply default only to bots; human logins never get excluded by bot_policy.default
        return bot_policy.default, None
    return "include", None  # human teammates always included
```

### Step 2 — Apply per-author filter

Evaluate each comment's `author.login` against the resolved policy:

| Author kind | Default treatment | Overridden by `bot_policy.bots`? |
| --- | --- | --- |
| Human teammate | **Include** | No — humans are never controlled by `bot_policy` |
| AI reviewer — `claude[bot]`, `coderabbitai[bot]`, `sourcery-ai[bot]`, `sweep-ai[bot]` | **Include** | Yes — any entry in `bots` wins |
| Noise bots — `dependabot[bot]`, `renovate[bot]` | **Exclude** unless body has a `suggestion` block | Yes — an explicit `include` or `require-apply` entry overrides the noise-bot default |
| CI summary bots — `github-actions[bot]` | **Exclude** unless body has a `suggestion` block | Yes |
| The current user (`gh auth status` login) | **Exclude** — self-notes, not feedback | No — self-exclusion cannot be overridden |
| Any other bot not listed above | Follows `bot_policy.default` (`include` or `exclude`) | Yes |

The split between "AI reviewer" and "noise bot" is by **login allowlist**, not by `author.type`.
Both groups have `author.type == "Bot"` on GitHub, but only the AI-reviewer group produces feedback worth gating through `/critical` + `/confidence`.
The allowlist is conservative — if a new AI reviewer launches, add it explicitly rather than flipping to "all bots" OR list it in `.review.yaml`.

### Step 3 — Mark `require-apply` entries

Comments from a bot whose resolved `action == "require-apply"` are included in the ledger with an extra field:

```json
{ ..., "requireApply": true, "min_confidence": null }
```

`implement-suggestion` Phase 4 reads this field: when `requireApply == true`, the comment **skips `/critical` + `/confidence`** and its verdict is forced to `apply`.
The Phase 7 report counts these separately as `require-apply: N`.

Hard limit on `require-apply`: the skill's global Hard Rules still apply (no `--force` push, no deleting tests, etc.).
`require-apply` bypasses the confidence gate, not safety constraints.

### Step 4 — Apply `min_confidence` override

When a bot entry carries `min_confidence`, store it on every ledger entry from that bot:

```json
{ ..., "min_confidence": 70 }
```

Phase 4 (`validation-gates.md`) reads this field and uses it as the threshold for that comment instead of the profile default.
When `requireApply == true`, `min_confidence` is ignored.

Surface counts in the Phase 7 report:

```
Comments fetched (n):
  - human teammates:      <n>
  - AI reviewers:         <n>   (claude[bot], coderabbitai[bot], …)
  - self-filtered:        <n>
  - noise-filtered:       <n>   (dependabot, github-actions, …)
  - bot-policy-filtered:  <n>   (excluded by .review.yaml bot_policy)
  - resolved-filtered:    <n>
  - require-apply:        <n>   (gate bypassed per bot_policy)
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
