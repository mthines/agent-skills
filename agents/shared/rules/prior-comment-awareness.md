---
title: Prior-comment awareness — dedup against existing review history + anti-flip-flop
impact: HIGH
tags:
  - pr-reviewer
  - dedup
  - incremental
  - flip-flop
---

# Prior-comment awareness

A PR review rarely starts from a blank slate.
In an incremental review (a second pass after a push), a `--watch` loop (`/implement-suggestion --watch`), or any Self-Review re-run, the agent may produce findings it already produced — or worse, findings that *contradict* ones it produced or the author already resolved.

"Recommend X → later revert X → re-recommend X" is the single most-reported complaint about automated reviewers in the 2026 field studies.
Bugbot reads prior PR comments as context specifically to prevent this flip-flop.
This rule implements that same state-awareness.

---

## Contents

- [When this step runs](#when-this-step-runs)
- [Step: fetch existing PR comment state](#step-fetch-existing-pr-comment-state)
- [Thread state — resolution is read, never inferred](#thread-state--resolution-is-read-never-inferred)
- [Dedup against prior bot comments](#dedup-against-prior-bot-comments)
- [Anti-flip-flop state](#anti-flip-flop-state)
- [What "accepted / resolved" includes](#what-accepted--resolved-includes)
- [Sub-agent re-runs](#sub-agent-re-runs)
- [Hardening incremental and --watch paths](#hardening-incremental-and---watch-paths)
- [Carry-forward of deferred findings](#carry-forward-of-deferred-findings)
- [Carry-forward of anchorless findings](#carry-forward-of-anchorless-findings)
- [Logging](#logging)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## When this step runs

| Agent | When | Scope |
| --- | --- | --- |
| `pr-reviewer` (cross or self, PR exists) | **Default ON** — at the start of Step 1, before any finding is produced | All incremental and first-pass runs on an existing PR |

When a PR does not yet exist (branch-only self review without an open PR), skip this step entirely.

---

## Step: fetch existing PR comment state

Run once at Step 1, after Step 0.5 (authorship check) and before Step 1.1 (diff acquisition):

```bash
# REPO is the `owner/repo` string the REST paths below need.
# The GraphQL query needs the two halves separately — bind both here so this
# block runs standalone, and never pass `owner/repo` as the `repo` argument.
REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"
# Identity ladder. `gh api user` hits `/user`, which is NOT repo-scoped and 401s under a GitHub
# App installation token or a per-call credential proxy (`github-access.md § Identity`), so an
# unguarded call here silently yields "" — and every `select(.user_login == "")` below then
# matches nothing, which reads as "this agent has never commented on this PR". Dedup, the
# anti-flip-flop check and Step 2.9c all no-op on a PR full of this agent's own threads.
BOT_LOGIN="${BOT_LOGIN:-$(gh api user --jq .login 2>/dev/null || echo "")}"
# Fallback: this agent's own login, recorded the last time it reviewed THIS PR. The caller binds
# PRIOR_REPORT_AUTHOR from the PR-state record's `bot_login`, or off the sticky it found on the
# fallback rung (pr-reviewer Step 0.7); either way it costs no extra API call here.
[ -z "$BOT_LOGIN" ] && BOT_LOGIN="${PRIOR_REPORT_AUTHOR:-}"

# All existing review comments on this PR (all authors).
# `html_url` is the permalink to the comment thread — kept so Gate 3 can render each
# unresolved thread as a clickable `[path:line](url)` link the author can jump straight to.
# `user_type` (GitHub's `Bot` / `User` / `Organization`) is kept so Gate 3 can label each open
# thread as a bot's or a human's — the report differentiates the two instead of calling every
# open thread a "bot thread", which once reported a human reviewer's comment as a bot's.
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq '.[] | {id, path, line, body, user_login: .user.login, user_type: .user.type, in_reply_to_id, html_url: .html_url}' \
  > /tmp/prior-comments.json

# Comments authored by this agent (bot login)
if [ -n "$BOT_LOGIN" ]; then
  BOT_COMMENTS=$(jq --arg login "$BOT_LOGIN" '[.[] | select(.user_login == $login)]' /tmp/prior-comments.json)
  BOT_IDENTITY_UNKNOWN=false
else
  # Both rungs failed. That is only reachable when this agent has posted no report on this PR
  # either — i.e. a genuine first pass, where an empty set is the correct answer, not a failure.
  BOT_COMMENTS='[]'
  BOT_IDENTITY_UNKNOWN=true
fi

# Thread state — the authoritative resolved/unresolved signal. See § Thread state below.
# `reviewThreads` caps at 100 and `--paginate` does not work for GraphQL, so walk
# `endCursor` until `hasNextPage` is false and concatenate the pages.
THREADS_QUERY='
  query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{ id isResolved isOutdated comments(first:100){ nodes{ databaseId } } }
        }
      }
    }
  }'

: > /tmp/review-thread-pages.json
CURSOR=""
THREADS_COMPLETE=true
while :; do
  # Capture the page, then append it with an explicit newline: `gh api graphql`
  # emits no trailing newline, so appending its stdout directly would run page 2
  # onto page 1's line.
  if ! PAGE=$(gh api graphql -f query="$THREADS_QUERY" \
       -F owner="$OWNER" -F repo="$REPO_NAME" -F pr="$PR_NUMBER" \
       -F cursor="${CURSOR:-null}"); then
    THREADS_COMPLETE=false
    break
  fi
  printf '%s\n' "$PAGE" >> /tmp/review-thread-pages.json
  HAS_NEXT=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$PAGE")
  CURSOR=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$PAGE")
  [ "$HAS_NEXT" = "true" ] || break
done

# One merged document with every page's nodes, in the shape the checks below read.
# `complete` persists THREADS_COMPLETE into the file. An aborted walk leaves the pages
# file empty, so without this flag the merged result `{nodes: []}` is indistinguishable
# from a PR that genuinely has no threads — and THREADS_COMPLETE is a shell variable that
# does not survive to Step 2.9c, which reads only the file.
jq -s --argjson complete "$THREADS_COMPLETE" \
  '{complete: $complete, nodes: [.[].data.repository.pullRequest.reviewThreads.nodes[]]}' \
  /tmp/review-thread-pages.json > /tmp/review-threads.json
```

`THREADS_COMPLETE=false` means the walk stopped early, and it is persisted as `"complete": false` in `/tmp/review-threads.json`.
Every reader — this rule's checks and `thread-resolution.md` at Step 2.9c alike — must treat a map with `complete: false` as **incomplete** per *Pagination guard* below, never as "no more threads".

Store `BOT_COMMENTS`, `/tmp/prior-comments.json` and `/tmp/review-threads.json` for use in the thread-state, dedup and anti-flip-flop checks below.

---

## Thread state — resolution is read, never inferred

A review thread's `isResolved` flag is the **authoritative** signal that a comment has been dealt with. Read it; never infer resolution from the prose of a reply.

The query above is the same one `thread-resolution.md § Resolve the thread` runs at Step 2.9c and the same one `implement-suggestion` runs at its Phase 2. On a re-review the call moves earlier rather than being added — Step 2.9c reuses `/tmp/review-threads.json` instead of re-querying.

From the result build:

1. `RESOLVED_THREAD_IDS: Set<string>` — every thread `id` with `isResolved == true`.
2. `COMMENT_TO_THREAD: Map<databaseId, {threadId, isResolved, isOutdated}>` — every comment in every thread.

`isOutdated` is true when the diff hunk the thread anchors to no longer exists at the current head.
It is **not** a resolution signal on its own — a hunk also goes outdated when the author edits around
a still-live finding — but paired with "the finding does not re-produce anywhere" it identifies a
finding whose subject was deleted (`thread-resolution.md § \`obsolete\``).

**Pagination guard.** `reviewThreads` caps at `first: 100` and `--paginate` does not work for GraphQL. When `pageInfo.hasNextPage` is true, page with `endCursor` until it is false. If paging cannot complete, treat the map as **incomplete** and say so in the run — an unseen thread must never be silently assumed unresolved, because that turns a resolved conversation into a gate failure.

**Fallback.** If the GraphQL call fails outright (permissions, API error), log
`[thread-state] GraphQL unavailable — falling back to reply-text heuristic` and use the heuristic in `§ Fallback resolution heuristic`. Never fail the run on this, and never treat an API error as "everything is unresolved".

### Why prose matching is not enough

Automated fixers reply and resolve; they do not phrase their replies to match a keyword list, and they are not the PR author:

- `implement-suggestion` posts a free-form decline — `suggestion-pack.md`: **Reply**: `<rationale for not applying>` — and then resolves the thread.
- Its reply is authored by the bot, not the PR author.

A resolution test built on "a reply from the PR author containing a decline phrase" therefore returns *unresolved* for a thread that is demonstrably resolved, on every subsequent pass, forever. Reading `isResolved` removes the whole class.

### Fallback resolution heuristic

Used **only** when thread state is unavailable. A thread counts as resolved when either:

- the PR author replied in the thread, or
- any reply is a decline per [`outcome-learning.md § What counts as an acknowledgement`](./outcome-learning.md) (`WONT_FIX_RE` is the script's counterpart); not restated here, so this degraded path cannot drift from the primary one.

This is the pre-existing heuristic as a degraded path — its decline half now defers to the single list rather than restating four phrases — and it is lossy in exactly the way described above.
Because of that it has a **narrow consumer set**: it feeds the dedup and anti-flip-flop checks only.
It never admits a comment to `OPEN_BOT_COMMENTS[]`, so it can neither pass nor fail Gate 3 — a comment whose real thread state could not be read is reported as unverified instead (`pr-reviewer.md` Step 1.0 and *Gate 3*).
Still say in the run that the fallback is in use, so a reader knows the dedup and anti-flip-flop decisions on this PR rest on a lossy signal rather than on read thread state.

---

## Dedup against prior bot comments

A new proposed finding is a **duplicate** of a prior bot comment when:

| Condition | Action |
| --- | --- |
| Same `(path, line ± 2)` AND same Conventional-Comments prefix | **DROP** the new finding — it was already said |
| Same `(path, line ± 2)` AND different prefix | **Keep** the new finding — a different lens on the same line is additive |
| Same pattern / claim but on a different line (code moved) | **Keep** — the location changed; re-flagging is valid |

The `± 2` tolerance handles minor line-number drift from the author's subsequent commits.

Log dedup drops:

```text
[prior-comment] DROP src/foo.ts:42 — suggestion: already posted in prior review (comment #12345)
```

Count in the Quality Gate summary: `Prior-comment dedup drops: N`.

**`BOT_IDENTITY_UNKNOWN == true` is disclosed, never silent.** Dedup, the anti-flip-flop check and
thread reconciliation all read `BOT_COMMENTS`, so an empty set from an unresolved identity would
present as "nothing was ever posted here" and let the run re-post findings the PR already carries.
When the flag is set, log `[prior-comment] bot identity unresolved — dedup and anti-flip-flop
operate on an empty prior set` and carry it into the run's report.

It has two reachable causes, and only the first is benign:
- **A genuine first pass** — no prior report, no prior pointer, nothing to dedup against. The empty
  set is simply correct.
- **A prior-run read that failed** — `PRIOR_REPORT_AUTHOR` is bound from the PR-state record, or
  from the sticky on the fallback rung (`pr-reviewer` Step 0.7), so a PR with prior runs resolves
  *unless both lookups failed*.
  Then the identity is unknown on a PR that does have prior comments, and dedup silently no-ops:
  findings already on the PR get re-posted. This is why the flag is disclosed rather than logged and
  forgotten — the run must say that its dedup was blind, so a duplicate comment reads as a known
  degradation instead of a reviewer that changed its mind.

---

## Anti-flip-flop state

The flip-flop invariant: **the agent MUST NOT reverse a previously accepted or resolved suggestion.**

A suggestion is **accepted / resolved** when any of the following hold:

1. The commented line was subsequently changed in a commit after the comment was posted (outcome-learning signal c).
2. The PR thread for the comment is marked resolved.
3. The PR author replied "fixed", "done", "addressed", "resolved", or a similar acknowledgement.

Check each new proposed finding against prior accepted / resolved suggestions:

```bash
# Check if the bot previously suggested OPPOSITE of current new finding
# e.g., bot said "use Map here" (resolved) → now bot says "use Record here"
```

This is a semantic check, not a grep.
The agent must evaluate: "Does my new finding contradict a prior finding that was acted on?"

If yes → **DROP** the new finding unconditionally.
Log the drop:

```text
[anti-flip-flop] DROP src/foo.ts:55 — new suggestion contradicts resolved prior comment #12345 (previously suggested `Map`, author applied it; now re-suggesting `Record`)
```

This drop is NOT subject to override or confidence gate.
A contradiction with a resolved suggestion is dropped regardless of confidence score.
The finding may be surfaced in the terminal output for human review, but it is never posted.

---

## What "accepted / resolved" includes

| State | Counts as resolved |
| --- | --- |
| Author pushed a commit touching `(path, line ± 5)` after comment | Yes |
| Thread explicitly marked resolved on GitHub | **Only after verifying against HEAD — see *Resolved is not verified* below. Never sufficient on its own.** |
| Author replied with acknowledgement text | Yes |
| Author replied with disagreement / explanation and no fix | **No** — the author challenged the finding; re-flagging in a later pass is allowed |
| 👎 reaction by the author | **No** — dismissal means the finding was wrong, not accepted; the noise lesson fires, but re-flagging is not prevented (the agent should have dropped it originally, and the outcome-learning loop handles that) |

---

## Resolved is not verified — check HEAD before trusting it

Thread resolution is a UI action any collaborator can take and carries **no guarantee a commit
followed it**. Seven production sightings
(`reviewer-lessons::resolved-bot-thread-is-not-evidence-of-a-fix`) found a real defect suppressed
at dedup because a `cursor[bot]` thread on the same anchor was marked resolved with no accompanying
code change — the defect was still live at HEAD, and it survived only as a prose note in the
terminal report, invisible to a human reading the PR. The inverse also holds and is just as costly:
an **unresolved** thread is not evidence the defect is still live — three prior comments were once
all still `open` on GitHub yet all three had been fixed in the very next commit, GitHub had merely
marked them outdated.

Before suppressing (or re-raising) a finding on the strength of thread state alone, apply these
checks **in order** — cheapest first:

1. **Anchor-file existence.** If the file the thread anchors to no longer exists at HEAD (deleted,
   renamed, moved), the finding is moot. This needs no line-level reasoning and is the cheapest
   possible confirmation that HEAD contradicts the old claim — check it before anything else, for
   **every** covering thread, including a third-party bot's, and before reading that bot's own
   severity label.
2. **Delta-path membership.** A prior comment anchored on a path outside this run's delta cannot
   have been fixed by this run — computed once as a path-set intersection, before opening any file.
3. **Read the code at HEAD.** For everything the first two checks don't settle, open the file (or
   diff the thread's originating commit against HEAD for that path) and confirm the claim no longer
   reproduces. A **compound** claim ("X breaks both the write and the read path") must have **each
   mechanism verified separately** — the first mechanism reading as fixed is not evidence the second
   is, and a partially-fixed thread is the easiest false suppression available.
4. **A written deferral counts, an unwritten one doesn't.** A resolved thread whose remediation is
   an explicit deferral to a follow-up ticket is validly suppressed only when that deferral is
   recorded durably (PR body or a linked issue) — cite the text in the report. A resolved thread
   backed by neither code nor a written deferral is still an empty resolution.

This applies to **both directions** (resolved ≠ fixed, open ≠ unaddressed), to **both** bot and
human threads (the discriminator is thread liveness and anchor identity, never authorship), and to
**this agent's own prior comments**, not only a third party's.

**Three outcomes, not two.** A verified claim resolves to one of:
- **gate-without-posting** — a live, non-outdated thread already carries the same claim at the same
  anchor; the defect is visible to a human, so a second inline comment would be pure duplication.
  Fail the prior-feedback gate on it instead of restating it.
- **post-as-new-code** — nothing visible on the PR carries the still-reproducing claim (the
  covering thread was resolved without a fix, or only partially covers a compound claim); post it
  as a fresh inline finding, explicitly noting the earlier thread was resolved without a code
  change.
- **suppress** — HEAD genuinely contradicts the finding (file deleted, code changed, or a written
  deferral is on record).

Do not collapse this to a binary post-or-suppress — a resolved thread that is only *half* fixed
needs `post-as-new-code` for the surviving half, not `suppress` for the whole claim.

---

## Sub-agent re-runs

When this rule executes inside a sub-agent (e.g., a review dispatched by an orchestrator), the sub-agent does NOT receive the SessionStart memory-load priming that the main session gets.
The sub-agent MUST therefore perform the Step 1.0 memory read itself — never assume the relevance and lesson memories were pre-loaded.
The companion relevance-memory read (see `comment-relevance-memory.md § Read`) is a mandatory real `mcp__lorekit__memory_list` tool call. Never infer disconnection without attempting the call, and never off a single transient throw: retry a thrown error up to 2 more times (3 attempts total) with a short backoff before treating the backend as not connected, exactly as `comment-relevance-memory.md § Read` and `pr-reviewer.md § Step 1.0` prescribe. A hard "tool unavailable" error is terminal only when the tool is absent from the agent's `tools:` grant; when the MCP server simply has not connected yet it is provisional, and the later write sites re-probe rather than inheriting the read-time verdict (`comment-relevance-memory.md § Read`).

---

## Hardening incremental and --watch paths

For incremental review passes (a new diff pushed, a `--watch` iteration):

1. Always re-fetch `/tmp/prior-comments.json` at the start of each iteration.
2. Treat the prior comment state as the ground truth for dedup and anti-flip-flop.
3. Do NOT assume the prior payload artifact (`.agent/pr-review/...payload.json`) is the complete picture — the author may have replied or resolved threads since that artifact was written.

The prior-comment fetch is cheap (one `gh api` call); always re-run it rather than relying on stale state.

---

## Carry-forward of deferred findings

`pr-reviewer` defers findings that clear every quality gate but exceed the inline placement caps (`rubric-composition.md § Placement (Step 2.9b)`).
Deferral only works if the next run can still see them, and in `incremental` / `incremental-quick` mode it cannot re-derive them: those modes scan the **delta** only, so a finding deferred in run 1 on a file untouched since would be lost permanently.
Carry-forward closes that hole.

Run this immediately after the prior-comment fetch, in every mode:

1. Read `CARRIED_FINDINGS` — the `data.carried_findings` array of the PR-state record, already fetched at Step 0.7. It is **structured state, not parsed prose**: each entry arrives as `{path, line, prefix, body, confidence, first_seen_sha}`, so there is no `(confidence 84)` to recover from a rendered bullet and no heading to match. When the record was unusable, this array is empty and the run says so — the fallback rung recovers a delta baseline, never carried findings.
2. Re-admit each entry into the current run's finding stream, tagged `carried-forward`, with its recorded confidence score.
3. Drop a carried entry when **any** holds:
   - Its `(file, line)` no longer exists in the current PR state, or the line's content changed since the review that deferred it (the finding was likely addressed).
   - It duplicates a finding produced fresh in this run (normal dedup, `§ Dedup against prior bot comments`).
   - It duplicates a prior **posted** comment (it was promoted inline in a later run).
4. A carried entry skips re-generation but **not** the gates: it re-enters at 2.6 grounding and flows through receipt, confidence, and shape again, because the code may have moved under it.
5. Placement (2.9b) then treats it like any other cleared finding, and its priority ordering is unchanged — so an unaddressed deferred `issue` outranks a fresh `nitpick` for the inline slots and eventually surfaces inline.

Report the count as `Carried forward: <N>` in the Quality Gate summary.

A finding can therefore be deferred across several incremental runs, but it can never be silently forgotten: it is either posted inline, still listed in the body, or dropped for a logged reason.
Whichever way it goes, the run's own outcome is what gets written back (`pr-reviewer` Step 4c) — a finding posted inline or resolved this run is **not** re-recorded, or it would return next run as a duplicate.

---

## Carry-forward of anchorless findings

`Additional findings` is not the only body-only output of a review pass.
A gate finding has **no inline anchor by design** — a `❌` on *Prior review feedback*, *Documentation*, or *Self-review signals* (or a `⚠️` on the tri-state *Prior review feedback*) exists only as a row in the gate-status table inside the `Review details` accordion.
Optimality proposals (2.4c) are rendered as body cards and never inline.
The `**Standards (2.4d)**` log line records whether that lens ran at all; its individual findings go inline or into `Additional findings`, so they travel with `CARRIED_FINDINGS` and are not re-parsed here.
None of these are re-derivable from the delta, and 2.4c and 2.4d are both **skipped** in `incremental-quick`.
Without this rule a re-review silently drops every one of them, and the PR conversation loses context the author still needs.

Run this at **Step 2.5c**, in every mode, over the `PRIOR_DIAGNOSTICS` read from the PR-state record at `pr-reviewer.md § Step 0.7 → Bind the run-mode inputs` (`data.diagnostics`: `gate_rows`, `optimality_cards`, `standards`, `skipped_files`, `partial`).
It is structured state, so a heading rename in the report template can no longer cost a re-review its carried diagnostics — which is what the old "parse it back out of the rendered accordion" path risked on every template edit.
It runs there — not next to the deferred-finding carry-forward at Step 0.7 — because every disposition below is decided against this run's outcomes from Step 1.8, Step 2.4c, and Step 2.4d, none of which exist yet at Step 0.7.

Each carried entry gets exactly one disposition:

| Condition | Disposition |
| --- | --- |
| The owning step ran this pass and reproduced the entry | **REPLACE** — the fresh entry wins; the carried copy is discarded (it is the same finding, freshly grounded). |
| The owning step ran this pass and did **not** reproduce it | **RESOLVE** — drop it, and log `resolved since <PRIOR_SHA_SHORT>`. This is the only path that removes a finding from the body. |
| The owning step was **skipped** this pass (2.4c / 2.4d under `incremental-quick`, `--no-optimize`, `--no-standards`, or `--skip-gates`) | **CARRY** — re-render the prior entry verbatim in this run's body, suffixed `(carried from <PRIOR_SHA_SHORT>)`. Never let a skipped step read as a clean result. |
| The entry cannot be mapped to an owning step (unparseable or from an older template) | **DROP** with a log line; never re-render an entry you cannot attribute. |

Owning steps: gate rows → Step 1.8; optimality cards → Step 2.4c; standards findings → Step 2.4d; `Skipped files` → Step 1.2 / 2; `PARTIAL_BANNER` → the step that set it.

Hard rules:

1. **A carried gate row never sets a gate's status.** Step 1.8 evaluates every gate against the **current** PR state in every run mode, exactly as it does today. `PRIOR_GATE_STATE` is context for the *Details* text and for the resolve/carry decision — it can neither fail a passing gate nor pass a failing one.
   A gate row reaches `CARRY` only under `--skip-gates`, the one flag that makes Step 1.8 not run; that gate then renders `⏭️` with the carried text in its Details cell, per `pr-reviewer.md § Gate states`. `⏭️` never counts toward `FAILING_GATE_COUNT` and never changes the verdict.
2. **A carried entry never changes the verdict on its own.** Optimality has never blocked the verdict and still does not; standards findings keep their existing non-blocking behaviour.
3. **Carrying is not re-asserting.** A carried entry is re-rendered because its owning step did not run, not because it was re-verified. The `(carried from …)` suffix is mandatory so the author can tell the two apart. It renders `PRIOR_SHA_SHORT`, which the PR-state record supplies in every run mode including `--full` — so the suffix can no longer degrade to `(carried from )`.
4. **A `RESOLVE` requires the owning step to have actually run.** A step that was skipped can never resolve anything — that is the `CARRY` row, and conflating the two is how a still-broken gate silently disappears from the body.

Report the counts as `Anchorless carried: <C> · resolved: <R>` in the Quality Gate summary — the terminal block at `pr-reviewer.md § Step 3`, which renders them as `anchorless carried <AC>, anchorless resolved <AR>`.
They are terminal-only: the posted review body has no slot for them.

---

## Logging

The Quality Gate summary adds four rows:

```text
Prior-comment dedup drops: N  (already said in a prior review pass)
Anti-flip-flop drops:      M  (would contradict a resolved prior suggestion)
Carried forward:           K  (deferred by a prior incremental run, re-admitted)
Anchorless carried:        C  · resolved: R  (gate / optimality / standards findings from the prior body)
```

All four are emitted even when N = 0, M = 0, K = 0, C = 0, and R = 0, so the user can see the step ran.

---

## What this rule does not do

- Re-run outcome measurement — that is `outcome-learning.md`.
- Change how the review is posted — `pr-reviewer` Step 4 rewrites the sticky report unconditionally, posts a visible `COMMENT` review only when the run has new inline findings, and records its run state to the PR-state record (Step 4c). No authorization gate.
- Apply when no PR exists yet (no prior GitHub state to reconcile).
- Drop a finding because an author *challenged* (not accepted) a prior finding — disagreement does not prevent re-flagging; outcomes do.
- Own the prior-run state. This rule *consumes* `CARRIED_FINDINGS`, `PRIOR_DIAGNOSTICS` and `PRIOR_REPORT_AUTHOR`; the record they are read from, and the write that produces them, belong to [`pr-reviewer.md § Step 0.7`](../../pr-reviewer.md) and § Step 4c.
