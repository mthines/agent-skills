---
title: Deterministic pipeline — artifact contracts, --dry-run, --isolated
impact: HIGH
tags:
  - pr-reviewer
  - deterministic-pipeline
  - dry-run
  - isolated
---

# Deterministic pipeline

The single home for the pr-reviewer deterministic pipeline's cross-cutting contracts:
what `--dry-run` and `--isolated` mean, the artifact flow between
`prepare-review.mjs` → judgment → `finalize.mjs` → `execute-write-plan.mjs`, and
the write-plan op → MCP tool mapping. This rule owns the CONTRACT; each script's
own header owns its CLI surface, and `agents/pr-reviewer.md` Step 0 / Step 4
own where the flags are read and where the carve-outs apply.

## Contents

- [`--dry-run`](#--dry-run)
- [`--isolated`](#--isolated)
- [`--review-sha`](#--review-sha)
- [Artifact flow](#artifact-flow)
- [Write-plan op → MCP tool map](#write-plan-op--mcp-tool-map)

## `--dry-run`

A full pipeline run that stops **after** `finalize.mjs` writes its rendered
artifacts and **before** `execute-write-plan.mjs` — or the agent's own Step 4
— would issue a single GitHub or LoreKit write. Verified at plan time: no
`--dry-run` / `--preview` / no-write mode existed anywhere in `pr-reviewer.md`
or `branch-reviewer.md` before this pipeline; Step 4c's state write was
documented as **unconditional**, so this is the one explicit carve-out, not a
silent exception discovered later.

**Zero writes means zero, not "zero unless something else needs it":**

| Object | Normal behavior | Under `--dry-run` |
| --- | --- | --- |
| Sticky report comment | `POST`/`PATCH` the comment | Rendered to `$(scratchRoot())/<run-id>/report-body.md`, never posted |
| Review (inline comments) | `POST /pulls/{n}/reviews` | Rendered to `$(scratchRoot())/<run-id>/inline-comments.json`, never posted |
| Thread resolve / reply | `resolve_review_thread` mutation, reply comment | Classified to `$(scratchRoot())/<run-id>/thread-plan.json`, no mutation issued |
| PR-state record | `mcp__lorekit__memory_write` (Step 4c, unconditional otherwise) | Not written |
| Knowledge / hotspot records | `mcp__lorekit__memory_write` (Step 2.7b / memory.md) | Not written |
| `reviewer-comment-relevance` outcome | `mcp__lorekit__memory_write` (Step 2.9c) | Not written |

Every pre-flight assertion still runs (`payload_is_safe` and its successors,
line-validity, the Gate 3 tri-state re-evaluation against the *would-be*
thread resolutions) — a dry-run that skipped its own safety checks would
rehearse a payload that was never actually validated, which defeats the
point of rehearsing at all.

`execute-write-plan.mjs --dry-run` (Phase 4) makes this mechanical: the
write-plan is built exactly as it would be for a real run, and the script
spawns zero `gh` processes and returns zero LoreKit ops to execute —
asserted by its own `--self-test`.

## `--isolated`

Comparable repeat runs — the A/B harness (`scripts/eval/ab-review.mjs`) and
the finalize shadow run both need the SAME PR reviewed N times with no run
depending on what a prior run in the series left behind. `--isolated`:

1. Skips the Step 0.7 LoreKit state-record read entirely. `PRIOR_RUN=none`,
   `IS_RE_REVIEW=false` unconditionally — no fallback to the sticky's footer
   SHA either, because that fallback is itself a form of carried state.
2. Forces `RUN_MODE=full` (the D1/D6 first-run trigger fires on every
   invocation, `route-depth.mjs`'s `firstRun` input is always `true`).
3. **Requires `--pin-head <sha>`.** `prepare-review.mjs` compares the pin
   against the live `headRefOid` and hard-stops with no review on a
   mismatch: `head moved: pinned <a> live <b>`. A pinned run that silently
   reviewed a moved head would poison every metric an A/B or shadow
   comparison computes from it — this is not a narrower review, it is a
   review of a different commit wearing the pinned one's label.

**`--isolated` requires `--dry-run`.**
An isolated run still carries the PR's live sticky report id, so its dry-run
write-plan rehearses the exact write a real run would make.
A/B round 3 found every arm's `write-plan.json` targeting that live comment;
`--dry-run` made it harmless, and without it an isolated run would have
overwritten the real report with a comparability run's output.
Two layers enforce the pairing:

- `finalize.mjs` refuses an `--isolated` context without `--dry-run`, before
  writing anything to its out-dir.
- The write-plan carries `isolated: true`, and `execute-write-plan.mjs`
  refuses any plan with that marker, whatever flags its caller passes.

The A/B harness and the shadow run already pass both flags together.

**What `--isolated` does NOT skip:** Steps 1.0 / 1.2a / 1.2c / 1.2d — the
`codebase-knowledge` and `reviewer-lessons` LoreKit reads — are project
memory, not per-PR run state, and are deliberately outside `--isolated`'s
scope. They persist by design across PRs and across runs of the *same* PR,
which is different from the Step 0.7 state record and its GitHub fallback
rung (both genuinely about "what did the LAST run of THIS PR leave behind").
A knowledge or lesson record surfaced by an earlier review of the same PR
(possibly from a different commit, a different arm, or a different session
entirely) is legitimately read on an `--isolated` run — that is the intended
behavior, not a leak. Consequence for a comparability run (A/B, shadow): two
arms reviewing the same PR are NOT guaranteed a clean, memory-free baseline
just because both pass `--isolated` — if that guarantee matters (e.g.
isolating the reviewer-DEFINITION change under test from prior-run
LEARNING), the caller must arrange it explicitly (a scratch LoreKit scope,
or accepting and noting the shared-memory caveat in the comparison), and
every dispatch prompt in a multi-arm run must state the SAME LoreKit-read
instruction — a difference in what each arm's prompt tells it to read is a
confound `--isolated` cannot detect or prevent.

## `--review-sha`

Read-only review of a **specific past commit** on a PR, not the live head — the historical mode
the A/B harness needs to score arms against a fixed point in a PR's life without waiting for a
fresh PR (D8/D9, plan `feat/pr-reviewer-shrink-fanout-ab`). `prepare-review.mjs --review-sha <sha>`
resolves `<sha>` against the PR's own commit list (`verifyReviewSha` — exact match, or a UNIQUE
prefix; a prefix matching zero or more-than-one commit is refused, never guessed) and reviews that
commit instead of `headRefOid`.

**Two preconditions, both refused BEFORE any `gh` process spawns** (never a partial run that
discovers the conflict mid-fetch):

1. **Requires `--isolated`.** A historical review must not read live PR state that postdates the
   commit it is reviewing — Step 0.7's state-record read and its sticky-footer fallback are both
   about "what did a prior run leave behind," which is meaningless (and actively misleading) for a
   review of a commit from before that state existed.
2. **Refuses `--pin-head`.** `--review-sha` already pins the review to a specific (historical)
   commit; `--pin-head` is a different contract — it compares against the LIVE head, which
   `--review-sha` runs do not care about at all. `--isolated` runs WITHOUT `--review-sha` still
   REQUIRE `--pin-head` (item 3 above); that requirement does not apply once `--review-sha` is set.

**What changes downstream of a verified `--review-sha`:**

| Object | Live-head behavior | Under `--review-sha` |
| --- | --- | --- |
| Diff / files | `gh pr diff` / `pulls/{n}/files` (always the current head) | Compare-based: `repos/{repo}/compare/{base}...{review_sha}` |
| Workspace checkout | Materialized at `headRefOid` | Materialized at the verified `review_sha` (same ladder, same script — only the target SHA differs) |
| Impact graph | Diffs the checked-out workspace against `--base-ref` | Identical — it diffs whatever the workspace is checked out to, so pointing the checkout at `review_sha` is the entire fix; `build-impact-graph.mjs` needs no `--review-sha` awareness of its own |
| CI | `gh pr checks` (the CURRENT check run) | **Not read at all** — `context.historical.ci = "not-read"`. Today's CI result has no relationship to a commit reviewed days or weeks ago; reporting it would misattribute one to the other |
| Thread state / PR description | Read live, as of now | The thread SET is filtered to the reviewed commit's committer date — a thread whose root comment, or a reply, postdates it is dropped (`historicalThreads()`, `historical.threads_created_as_of`; a missing commit date drops every thread, fail closed). Resolution/outdated flags and the description are still read as of now (`thread_state_as_of` / `description_as_of` = `"now"`) — GitHub has no API to reconstruct either as of an arbitrary past commit, so a historical run is an honest MIXED-time view (past code, present metadata), never a simulated past PR page |

`context.json` carries a `historical: {review_sha, thread_state_as_of, description_as_of, ci, threads_created_as_of}`
block (`prepare-review.mjs`'s `historicalBlock()`) whenever `--review-sha` was set, `null`
otherwise. **Every downstream stage refuses a write once this block is present, unless `--dry-run`
is also passed — and the refusal is redundant by design, checked independently at each stage
rather than trusted from the stage before it:**

- `finalize.mjs` refuses (non-zero exit, no `write-plan.json` written) when `context.historical` is
  set and `--dry-run` was not passed — checked before any rendering happens.
- A `--dry-run` run's `write-plan.json` self-identifies (`dry_run: true`, `historical: {review_sha}`,
  `lorekit_write: []`) — never silently indistinguishable from an ordinary plan.
- `execute-write-plan.mjs` refuses (`refusalReason()`, exit 5, zero `gh` calls) to EXECUTE a plan
  carrying either marker — from the PLAN FILE's own fields, never cleared by a caller-supplied CLI
  flag, so a plan that reached this script some other way (hand-assembled, replayed, a future
  caller) is still refused on what it says about itself. `execute-write-plan.mjs --dry-run` on the
  same plan is a preview, not an execution: it lists the planned steps (zero `gh` calls, as always)
  and carries the reason a live run would refuse it as `wouldRefuse`.

A historical run is therefore, by construction, **never** anything other than
`--isolated --dry-run --review-sha <sha>` together — there is no supported way to make one post.

## Artifact flow

```
review-context.json  (prepare-review.mjs)
  + review-packet.md  (review-packet.mjs — description + widened hunks, head line numbers)
  + standards.json    (discover-standards.mjs — normative lines with doc:line; TRIVIAL_SKIP in context)
        │
        ▼
judgments.json        (the model — single-context agent OR /pr-review --fanout)
        │
        ▼  validate-judgments.mjs (schema SSOT)
        │
        ▼
finalize-result.json + report-body.md + pointer-body.md + inline/*.md + write-plan.json
        │  (finalize.mjs)
        ▼
write-result.json     (execute-write-plan.mjs, or the agent executing ops over MCP)
```

Each artifact's shape, and the op → MCP tool mapping below, are filled in as
each phase lands (Phase 2 onward); this section is the index they attach to.

**`/pr-review --fanout`** (default OFF; see
[`skills/quality/pr-review/SKILL.md`](../../../skills/quality/pr-review/SKILL.md#--fanout--opt-in-parallel-orchestration)
for the full orchestration) fills in the SAME `judgments.json → finalize.mjs` steps above from
parallel sub-agent dispatches instead of one single-context pass, with two artifacts this flow
gains only under `--fanout`:

```
<scratchRoot()>/<run-id>/{candidates,lenses,verdicts}/…   (one file per finder/lens/verifier dispatch)
        │  finalize.mjs --dedupe-candidates  (cross-finder merge, BEFORE verification)
        ▼
deduped.json → (verified, per candidate) → judgments.json   (same as the diagram above, from here on)
```

`finalize.mjs --dedupe-candidates <file> [--out <file>]` and
`finalize.mjs --context … --judgments … --out-dir … --writer github|findings-bus [--bus-path <file>] [--dry-run] [--no-dispatch]`
are both documented in `finalize.mjs`'s own `usage()` string; the latter is also
`branch-reviewer`'s entire output path (D16) — `--writer findings-bus` writes
`findings.jsonl` **instead of** `write-plan.json`, never both.

## Write-plan op → MCP tool map

`execute-write-plan.mjs` is the `gh` path. When `probeGhAccess` (`gh api
repos/{repo} --jq .full_name`) fails, the script exits 3 — `"no gh access
path — execute over MCP per rules/pipeline.md"` — and the agent itself
executes the write-plan's ops over the `mcp__github__*` / `mcp__lorekit__*`
tools granted to `aw-executor` / `pr-reviewer`, per this table:

| `write-plan.json` op | `gh` path | `mcp__*` tool |
| --- | --- | --- |
| `sticky.upsert` (create — `comment_id: null`) | `gh api repos/{repo}/issues/{pr}/comments -f body=@<body_path>` | `mcp__github__add_issue_comment` |
| `sticky.upsert` (update — `comment_id` set) | `gh api repos/{repo}/issues/comments/{id} -X PATCH -f body=@<body_path>` | **No update-comment tool is granted.** Falls back to the documented degraded path: `mcp__github__add_issue_comment` posting `pointer_body_path` as a new comment, never a second copy of the full report (matches the `gh`-path degraded case above — an access path that cannot patch the sticky posts the pointer, it never fabricates a PATCH). |
| `review.create` | `gh api repos/{repo}/pulls/{pr}/reviews -X POST -f commit_id=<sha> -f event=COMMENT -f comments=<json>` | `mcp__github__add_comment_to_pending_review` once per inline comment, then `mcp__github__pull_request_review_write` to submit with `event: COMMENT` — the MCP pending-review flow is two calls where `gh api` is one. |
| `thread.reply` | `gh api graphql -f query=mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}` | **No reply-to-thread tool is granted.** There is no MCP primitive that threads a reply under an existing review comment; the closest available action is a new top-level comment via `mcp__github__add_issue_comment`, which is NOT a true threaded reply and must be reported as such, never silently substituted. |
| `thread.resolve` | `gh api graphql -f query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}` | `mcp__github__resolve_review_thread` |
| `lorekit.write` | *(never `gh` — GitHub has no LoreKit surface)* | `mcp__lorekit__memory_write`, one call per queued op; `execute-write-plan.mjs` never executes these itself (D9) — they are always returned for the caller to run. |

The three writes (threads, sticky, review) fail independently on both paths —
one failing does not block the others, per D9. The two starred gaps
(`sticky.upsert` update, `thread.reply`) are real MCP-grant limitations, not
oversights: an MCP-only session (no `gh`) can create a sticky and resolve
threads, but cannot update an existing sticky in place or post a true
threaded reply — it must degrade to the pointer comment and a top-level
comment respectively, and both degradations must be named in the run's
report, never presented as the real op.
