# GitHub access — resolve the path, then use it

**This file is the owner of the procedure.** Consumed by every agent and skill that touches GitHub: `pr-reviewer`, `aw` / `aw-planner` / `aw-executor`, `create-pr`, `review-loop`, `implement-suggestion`, `ci-auto-fix`, `e2e-pr-stabilizer`.

Do not restate the mapping in a caller. Change it here.

---

## Why this exists

There are two ways to reach GitHub and neither is universally present:

| Path | Where it exists | Where it does not |
| ---- | --------------- | ----------------- |
| `gh` CLI | Developer laptops, most CI runners | **Claude Code on the web / cloud sessions — `which gh` returns nothing** |
| `mcp__github__*` tools | Sessions with the GitHub MCP server connected | Any agent whose `tools:` frontmatter does not list them |

The skills were written assuming the first. When it is absent, the documented remedy — *"STOP, install via Homebrew"* — is un-actionable, so the agent improvises across ~169 call sites, and each failing call becomes a fresh retry-or-improvise decision. That is the dominant source of a run that "spins without visible progress".

**The failure mode this rule primarily prevents** is subtler and was observed in the field: a sub-agent dispatched to do GitHub work, in a session where the *parent* had working MCP tools, reported the task **blocked** — because the sub-agent's own toolset had neither `gh` nor `mcp__github__*`. The parent then did the work itself in seconds. The block was real for the sub-agent and invisible to the parent.

---

## Step 0 — resolve your path, once, before any GitHub step

Probe with a **repo-scoped API call against the repository you are about to work on** — never with `gh auth status`:

```bash
command -v gh >/dev/null 2>&1 && gh api "repos/$RESOLVED_REPO" --jq .full_name >/dev/null 2>&1 && echo GH_OK
```

| Result | Your path | What to do |
| ------ | --------- | ---------- |
| `GH_OK` | **`gh` CLI** | Use the commands as written throughout the skills |
| No output, **and** `mcp__github__*` appears in your available tools | **GitHub MCP** | Use the mapping below. Do not attempt `gh` — every call will fail |
| No output, **and** no `mcp__github__*` in your tools | **No GitHub access** | See [No path](#no-path) — this is a hard stop for GitHub steps, not a reason to improvise |

`gh` present but genuinely **unauthenticated** counts as no `gh`: you cannot fix it (`gh auth login` is interactive), so fall through to MCP.

### Why not `gh auth status`, and why not `gh api user`

Both lie in environments that are ordinary, not exotic — a hosted agent runner, or CI using a GitHub App:

- **`gh auth status`** inspects a stored token. A wrapped `gh` that injects a scoped credential *per call* (Dash0's sandbox, several CI images) holds only a placeholder, so `gh auth status` exits non-zero while every real API call succeeds. Probing with it declares "no `gh`" on a session where `gh` works perfectly, and the agent then takes a path with fewer capabilities — or reports no access at all.
- **`gh api user`** hits `/user`, which is **not repo-scoped** and 401s under a GitHub App installation token and under per-call credential injection. It is a bad liveness probe for the same reason it is a bad identity source (see below).

A repo-scoped `GET /repos/{owner}/{repo}` is the narrowest call that proves what you actually need: this credential can reach this repository.

### Identity (`ME` / the bot login)

`gh api user --jq .login` (MCP: `get_me`) is the documented way to learn who you are posting as, and it is **allowed to fail** — see the two cases above. When it does:

1. Treat the identity as **unknown**, never as the empty string. `ME=""` silently turns every `select(.user.login == env.ME)` filter into "matches nothing", which reads downstream as "no prior comment / no prior report exists" and produces duplicate posts.
2. **Never key idempotency off the login.** Find your own prior artifacts by the marker you wrote into them (`<!-- PR_REVIEWER_REPORT -->`, and see [`reviewer-report-ingest.md`](./reviewer-report-ingest.md)), which works regardless of identity resolution.
3. Degrade the things that genuinely need identity (self-vs-cross relation framing, "is this comment mine") to their safe default and say so once, in the run's announcement.

Resolve this **once per run** and state which path you took. Re-probing per call is noise; discovering the answer at Phase 6 is the bug.

---

## Verb mapping

The verbs actually used across this repo, in frequency order. Anything not listed has no equivalent — see [Gaps](#gaps).

| `gh` command | MCP equivalent |
| ------------ | -------------- |
| `gh pr view <n>` | `pull_request_read` method `get` |
| `gh pr view <n> --json files` | `pull_request_read` method `get_files` |
| `gh pr diff <n>` | `pull_request_read` method `get_diff` |
| `gh pr view <n> --json commits` | `pull_request_read` method `get_commits` |
| `gh pr checks <n>` | `pull_request_read` method `get_check_runs` |
| `gh pr status` / combined status | `pull_request_read` method `get_status` |
| `gh pr list` | `list_pull_requests` |
| `gh search prs` | `search_pull_requests` |
| `gh pr create --draft` | `create_pull_request` with `draft: true` |
| `gh pr edit <n> --body` | `update_pull_request` |
| `gh pr ready <n>` | `update_pull_request` with `draft: false` |
| `gh pr merge <n>` | `merge_pull_request` |
| `gh pr comment <n>` | `add_issue_comment` |
| `gh api .../issues/<n>/comments` (read) | `issue_read` method `get_comments` (older servers: `get_issue_comments`) |
| `gh api .../issues/comments/<id> --method PATCH` (edit a comment) | **none — see [Gaps](#gaps)** |
| `gh api .../pulls/<n>/reviews` (read) | `pull_request_read` method `get_reviews` |
| `gh api .../pulls/<n>/comments` (read) | `pull_request_read` method `get_review_comments` |
| posting a review | `pull_request_review_write` (create pending → `add_comment_to_pending_review` → submit), or a single `COMMENT` review |
| resolving a thread | `resolve_review_thread` (needs the thread's GraphQL node id, which `get_review_comments` returns) |
| `gh run view <id> --log-failed` | `get_job_logs` with `failed_only: true` |
| `gh run list` | `actions_list` |
| `gh run rerun <id>` | `actions_run_trigger` |
| `gh repo view --json nameWithOwner` | you already know `owner` / `repo`; pass them directly |
| `gh api user --jq .login` | `get_me` |

**Two habits that avoid most friction:** MCP tools take `owner` and `repo` as separate parameters — parse them from the PR URL once and reuse — and they return JSON objects, so the `--jq` filters in the skills become ordinary field access.

---

## Gaps

Four things have **no** MCP equivalent. Do not fake them.

| `gh` capability | Why it has no equivalent | Do this instead |
| --------------- | ------------------------ | --------------- |
| `gh pr checks --watch` | Streams until checks settle; MCP calls are request/response | Poll `pull_request_read` method `get_check_runs` on the bounded schedule in [`registration-poll.md`](../../../skills/delivery/create-pr/rules/registration-poll.md) and the caller's watch cap. Never busy-loop |
| `gh run download` | No artifact-download tool | Report that artifacts are unavailable on this path; do not substitute log scraping and call it the same thing |
| `gh api graphql` (arbitrary queries) | Only specific operations are exposed | If the query has no listed equivalent, treat it as a gap and report it |
| Editing an existing issue comment (`PATCH /issues/comments/<id>`) | The server exposes `add_issue_comment` (create) but no comment-update tool | **Never emulate it by posting another comment.** An updated-in-place surface (a sticky status comment) that cannot be updated must either stay stale or be replaced by a compact pointer — the caller decides, and states which. Two full copies is the outcome the sticky exists to prevent. Before assuming the gap, check your own tool list: if an update tool *is* present in this session, use it |

MCP access is also **repo-scoped** to the session's allow-list. A mapping that works in one repository can fail in another with an authorization error — that is a `tooling-failure`, not "no data".

---

## No path

When neither `gh` nor `mcp__github__*` is available, GitHub steps **cannot** be performed. The rules, in order of how often they are broken:

1. **Say so precisely.** *"I have no GitHub access path (no `gh`, no `mcp__github__*` tools), so I could not open the PR."* Not *"the PR is blocked"* — a caller who has the tools will read that as an external obstacle and wait, when it could have done the step itself in one call.
2. **Do the work you can.** Commit and push (that is `git`, not GitHub API). Prepare the PR title and body and put them in your report so the caller can open it without redoing the work.
3. **Never report success for a step you could not perform**, and never claim a review was posted, a thread resolved, or CI observed when the call did not happen.

### If you are dispatching a sub-agent

**A sub-agent inherits neither your `gh` binary nor your MCP tools.** Its access is exactly what its own `tools:` frontmatter grants.

Before dispatching an agent to do GitHub work, confirm its definition lists `mcp__github__*`. If it does not, either do the GitHub step yourself after it returns, or say in the prompt that GitHub steps are out of scope for it — so it reports its actual result instead of reporting the task blocked.
