---
name: implement-suggestion
description: >
  Implements review-comment suggestions across one or more PRs. Multi-PR mode
  (default when $ARGUMENTS contains PR URLs; empty $ARGUMENTS auto-detects the
  active PR) per PR: resolves a worktree, fetches every actionable comment
  from both human teammates AND AI code-review bots (claude[bot],
  coderabbitai[bot], …), validates each through /critical + /confidence,
  builds a structured suggestion-pack, and dispatches a worker subagent that
  applies each approved change as its own commit, pushes to the existing
  branch, and resolves the addressed review thread — so every handled comment
  ends up resolved and the PR is left clean. Fast-lane for mechanical edits,
  standard-lane via aw-planner for architectural changes. Free-text
  mode applies a single pasted suggestion in the current directory. Triggers
  on "implement suggestion", "apply review comments", "address PR feedback",
  "implement reviewer feedback", "fix PR comments", "/implement-suggestion".
  With --watch, loops the apply on a single PR — waiting for new review-bot
  comments after each push and re-applying until the reviewers go quiet (max 5
  iterations); this is the loop /create-pr dispatches post-push. With
  --resolve-all (used by review-loop), it additionally replies to and resolves
  every non-fix thread it can honestly close — answering questions, recording a
  rationale for declined suggestions — so the PR converges to zero open threads,
  leaving only genuine human-judgment flags (real unfixed blockers) open.
disable-model-invocation: false
argument-hint: '[<pr-url>|#<n>] [--critical] [--watch] [--resolve-all]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(gw *) Read Edit Write Glob Grep Skill
metadata:
  author: mthines
  version: '2.4.0'
  workflow_type: orchestrator
  architecture: parse/resolve/fetch/classify/validate/pack/handoff(fast|standard)/commit-per-comment+resolve-thread/report
  composes:
    - critical
    - confidence
  agents:
    planner: aw-planner
  tags:
    - pr
    - review
    - comments
    - github
    - worktree
    - autonomous
    - validation
    - fast-lane
    - confidence-gated
---

# Implement Suggestion

Take reviewer suggestions on one or more pull requests, validate each through
adversarial review (`/critical`) and a confidence gate (`/confidence`), then
hand off a structured **suggestion-pack** to a worker subagent that applies
the approved changes inside the PR's worktree and pushes them — without
opening a new PR.

This skill is a **thin orchestrator**. The heavy reasoning lives in
`/critical` and `/confidence`. Per-PR worktree isolation comes from `gw`.
Plan authoring for architectural changes is delegated to `aw-planner`.
The mechanical apply / commit / push runs inside a dispatched worker.

> **Source of truth.** This `SKILL.md` is a thin index. Detailed procedures live
> in `rules/*.md`, literal artefacts in `templates/*.md`. Load only what the
> current phase asks for.

## Mode Detection

Parse `$ARGUMENTS` once, in this order. First match wins.

| # | Signal in `$ARGUMENTS`                                                                     | Mode                       |
| - | ------------------------------------------------------------------------------------------ | -------------------------- |
| 1 | One or more `github.com/<owner>/<repo>/pull/<n>` URLs (with or without `#discussion_r…`)   | **multi-pr**               |
| 2 | One bare PR number (`#123`) **and** the current directory is a PR worktree                  | **multi-pr** (n=1)         |
| 3 | Free-text prose, pasted comment body, or non-PR URL                                         | **free-text**              |
| 4 | Empty **and** the current branch has an open PR (auto-detected via `gh pr view`)            | **multi-pr** (active PR)   |
| 5 | Empty **and** no active PR for the current branch                                           | Prompt the user            |

**Active PR auto-detection** (rule #4): when `$ARGUMENTS` is empty, run
`gh pr view --json number,url,state,headRefName,headRefOid,isDraft` (no number =
current branch). If it returns a PR in state `OPEN`, treat as multi-pr with
that single PR. Print one line before continuing:

```
Mode: multi-pr  Active PR: dash0/console#1234 (current branch)
```

If the detection finds a `MERGED` or `CLOSED` PR, refuse to proceed and ask
the user to confirm explicitly.

**`--watch` modifier** (orthogonal to mode): if `$ARGUMENTS` contains `--watch`,
the run loops the single-pass on one PR until the review bots go quiet (max 5
iterations). It requires exactly one PR (multi-pr with n=1, or the active PR).
Refuse `--watch` with more than one PR or in free-text mode. Full procedure in
[`rules/watch-mode.md`](./rules/watch-mode.md) — load it now when `--watch` is set.

**`--resolve-all` modifier** (orthogonal to mode): default is **off** — every
caller keeps today's behaviour (non-fix comments are surfaced with their threads
left open) unless this flag is present. `review-loop` passes it so the loop can
converge a PR to zero open threads. When set, in addition to applying fixes the
worker gives **every** fetched thread an explicit disposition and closes the
ones it can honestly close:

| Disposition | Thread action |
| --- | --- |
| Fix applied (`apply`) | reply `Addressed in <sha>` + resolve (unchanged) |
| `question` | reply with the answer + resolve |
| `discussion`, or an `actionable`/`nit` the gates declined | reply with the rationale (a decline) + resolve |
| `praise` | drop silently (no thread action) |
| Genuine human-judgment flag — a real potential issue the agent will not auto-apply **and** cannot honestly decline (e.g. a `/critical` **Must-fix** surface, or a `surface`-band actionable) | **leave open** + surface, with a reply noting why it is flagged |

The last row is the safety valve: it never force-resolves a live finding, so
this flag cannot green-wash a PR. It composes with `--watch`. Free-text mode
ignores it (no threads to resolve).

Full parsing rules live in [`rules/input-parsing.md`](./rules/input-parsing.md).

State the detected mode and inputs in one line before continuing. Example:

```
Mode: multi-pr  PRs: dash0/console#1234, dash0/console#1278
```

## Architecture

```text
Phase 0:  Input parse            → PR tuples (or free-text string)
Phase 1:  Worktree resolution    → gw checkout <pr> per PR; verify clean state
Phase 2:  Comment fetch          → per-PR ledger (parallel across PRs)
Phase 3:  Classify               → actionable / nit / discussion / praise
Phase 4:  Two-gate validation    → /critical → /confidence per actionable comment
Phase 5:  Build suggestion-pack  → .agent/<branch>/suggestion-pack.md per PR
Phase 6:  Handoff (lane-split)         → worker: commit-per-comment, push, resolve thread
            ├── Fast-lane (simple):     dispatch worker subagent with pack
            └── Standard-lane (complex): aw-planner → plan.md → worker subagent
Phase 7:  Report                 → per-PR table: applied / surfaced / skipped / resolved
```

Per-PR work in Phases 1–6 runs in **parallel across PRs** (one message,
multiple Agent / Bash dispatches). Per-comment work in Phase 4 runs
**sequentially within a PR** so `/critical` and `/confidence` see consistent
state.

## Multi-PR Workflow

### Phase 0 — Input parse

Apply [`rules/input-parsing.md`](./rules/input-parsing.md). Output a
deduplicated list of `{owner, repo, prNumber, commentFilter}` tuples. Validate
each via `gh pr view --json number,state,headRefName,headRefOid,isDraft` and
refuse to proceed for any PR in state `MERGED` or `CLOSED`.

### Phase 1 — Worktree resolution

Apply [`rules/worktree-resolution.md`](./rules/worktree-resolution.md). For
each PR:

1. `gw checkout <pr-url-or-number>` (preferred).
2. Verify `git status --porcelain` is empty and `HEAD == headRefOid`.
3. Record the absolute worktree path.

Hard rule: never auto-stash, never auto-rebase, never operate in the user's
main worktree.

### Phase 2 — Comment fetch

Apply [`rules/comment-fetching.md`](./rules/comment-fetching.md). Per PR,
fetch in parallel:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews
gh api repos/<owner>/<repo>/pulls/<n>/comments
gh api repos/<owner>/<repo>/issues/<n>/comments
```

Build one ledger per PR. Include comments from **both human teammates and
AI code-review bots** (`claude[bot]`, `coderabbitai[bot]`, etc.) — only the
current user's own comments and noise bots (`dependabot`, `github-actions`)
are filtered. Exclude resolved threads. Honor `commentFilter` from Phase 0
if present.

A review body carrying `<!-- PR_REVIEWER_REPORT -->` is handled specially: it is
never self-filtered (the reviewer and this skill often share one GitHub App
identity), and it is **expanded** into one ledger entry per finding — deferred
findings, gate findings, and optimality proposals all live only in that body.
The parse grammar is shared with `pr-reviewer` itself
([`agents/shared/rules/reviewer-report-ingest.md`](../../../agents/shared/rules/reviewer-report-ingest.md));
the expansion contract is in
[`rules/comment-fetching.md § Reviewer-report expansion`](./rules/comment-fetching.md).

### Phase 3 — Classify

<a id="lessons-read"></a>
**Before tagging — read prior lessons.** Load the
`implement-suggestion-lessons` lessons from LoreKit so accumulated
misclassifications and gate mis-calibrations bias this run before they repeat.
Full contract in [`rules/self-improvement-loop.md#read-lessons-phase-3`](./rules/self-improvement-loop.md#read-lessons-phase-3):

```
# Narrow-to-broad; silent no-op if memory.* not connected.
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::implement-suggestion-lessons"], limit: 50 }
memory.list { scope: "global", tags: ["loop::implement-suggestion-lessons"], limit: 50 }
```

Match each lesson's `trigger-context` (reviewer source + topic) against the
ledger. Matches are **advisory inputs** to Phase 3 tagging and the Phase 4 gates
— they never relax the two-gate requirement or a hard rule.

Tag every comment per [`rules/comment-classification.md`](./rules/comment-classification.md):

| Tag           | Treatment (default)                                                        | Treatment under `--resolve-all`                                             |
| ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `actionable`  | Carries to Phase 4 (validation gates).                                     | Same; a declined one is reply-and-resolved in Phase 6 (rationale).          |
| `nit`         | Carries to Phase 4; higher confidence bar applies.                         | Same; a declined one is reply-and-resolved in Phase 6 (rationale).          |
| `discussion`  | Skipped; surfaced in Phase 7 report.                                       | Reply with the agent's take + resolve (Phase 6).                            |
| `question`    | Skipped; surfaced.                                                         | Reply with the answer + resolve (Phase 6).                                  |
| `praise`      | Dropped silently.                                                          | Dropped silently.                                                          |

Under `--resolve-all`, `discussion` / `question` comments are **not** skipped —
they are carried into Phase 5's pack as reply-only entries (no code change) so
the Phase 6 worker can answer and resolve their threads.

### Phase 4 — Two-gate validation

For each `actionable` / `nit` comment, run gates in this order — full
procedure in [`rules/validation-gates.md`](./rules/validation-gates.md):

1. **`Skill("critical", "<mode>")`** — `code` if the comment proposes a
   specific edit (suggestion block, file:line reference), `analysis`
   otherwise. Capture findings (hidden assumptions, blast radius, steelman).
2. **`Skill("confidence", "analysis")`** — score the change in context of the
   comment, surrounding code, and `/critical`'s findings.

Decision matrix:

| `/confidence` score | `nit` comment | `actionable` comment |
| ------------------- | ------------- | -------------------- |
| ≥ 90%               | `apply`       | `apply`              |
| 80%–89%             | `surface`     | `apply`              |
| 70%–79%             | `surface`     | `surface`            |
| < 70%               | `skip`        | `skip`               |

A `/critical` finding tagged **Must-fix** overrides the matrix and
forces `surface`, even at ≥ 90%. This is non-removable — `/critical`'s
Must-fix calls are designed to catch what `/confidence` cannot.
(`/critical` emits Must-fix / Should-fix / Nice-to-have; only Must-fix
overrides — the lower buckets are recorded in the pack.)

### Phase 5 — Build suggestion-pack

Write `.agent/<branch>/suggestion-pack.md` per PR using
[`templates/suggestion-pack.md`](./templates/suggestion-pack.md). The pack is
the contract handed to the worker — it lists every `apply`-tagged change
with file:line, the proposed edit, the comment author and ID, and the
`/critical` + `/confidence` evidence.

The pack is **plan.md-shaped** intentionally: it carries an Acceptance
Criteria section (one criterion per applied change) and a "Mode:
existing-pr" header that signals to consumers "commit and push to the
existing branch; do not open a new PR".

When `--resolve-all` is set, also set `resolve-all: true` in the pack frontmatter
and add the `## Reply-only` section: one entry per `question` / `discussion` /
declined comment with its `disposition` (`answer` / `discussion` / `decline` /
`flag`), thread ID, and the exact reply text the worker will post. The worker's
step-6 pass consumes this section.

### Phase 6 — Handoff (lane-split)

Lane is picked from the pack's complexity signals:

| Lane | Trigger | Plan authored by |
|------|---------|------------------|
| **Fast-lane** | All `apply` changes are single-file mechanical edits AND no `/critical` finding raised Must-fix; AND total file count ≤ 3 | Skill writes the pack directly |
| **Standard-lane** | Any change spans ≥ 2 files; OR `/critical` raised Must-fix on any change; OR ≥ 4 files affected across the PR | Skill dispatches `aw-planner` with the pack as `plan.md` seed |

For each PR, dispatch the worker subagent (one message, parallel across PRs):

```
Agent(
  description: "Apply suggestion-pack to PR #<n>",
  subagent_type: "general-purpose",
  prompt: <the "Worker prompt template" from rules/handoff.md, filled in — the template is inline in that file; no external prompt file exists>
)
```

Full dispatch contract and prompt template:
[`rules/handoff.md#worker-prompt-template`](./rules/handoff.md#worker-prompt-template).

The worker makes **one commit per applied comment** (each message cites that
comment's `@author` + URL), pushes once after all commits, then **resolves
each addressed review thread** — posting a brief `Addressed in <sha>` reply,
then `resolveReviewThread`. This leaves a clean one-to-one trail (commit →
resolved comment) and a PR where every handled comment is resolved; only
`surface` / `skip` comments stay open. `issues` / `review`-summary comments
have no resolvable thread and are reported as such. Full contract in
[`rules/handoff.md#worker-prompt-template`](./rules/handoff.md#worker-prompt-template).

**Under `--resolve-all`**, the worker runs one extra pass after the commit/push
pass: for every reply-only entry (`question` / `discussion`, or an `actionable` /
`nit` the gates declined) it posts a reply — the answer for a question, the
agent's take for a discussion, the decline rationale for a gated-out change —
then `resolveReviewThread`. Reply-only entries have **no commit** and are pushed
nothing. A genuine human-judgment flag is the one exception: the worker posts a
reply noting why it is flagged and **leaves the thread open**. This pass is
resolve-side only, so its failures are non-fatal exactly like the fix-thread
resolves. Full contract in
[`rules/handoff.md#worker-prompt-template`](./rules/handoff.md#worker-prompt-template).

**The main agent does not edit files in Phase 6.** All applies / commits /
pushes / thread resolutions happen inside the worker subagent so the loud loop
(test runs, push retries) stays out of the main context.

### Phase 7 — Report

Emit one summary table:

```markdown
## Implement-Suggestion Results

| PR | Branch | Lane | Applied | Surfaced | Skipped | Commits | Pushed | Resolved |
|----|--------|------|---------|----------|---------|---------|--------|----------|
| dash0/console#1234 | fix/foo | fast | 3 | 1 | 2 | abc1234, def5678, 9a0bcde | ✓ | 3/3 |
| dash0/console#1278 | feat/bar | standard | 0 | 2 | 1 | — | — | 0/0 |
```

`Commits` lists one SHA per applied comment (commit-per-comment). `Resolved`
is `<threads-resolved>/<applied-with-a-thread>` — comments whose fix landed and
whose thread was resolved, over the applied comments that had a resolvable
thread (`issues` / `review`-summary comments have none and are excluded from
the denominator).

Under `--resolve-all`, add an `Answered` column: `<threads-answered-and-resolved>`
— `question` / `discussion` / declined comments closed with a reply (no commit).
`Surfaced` then counts **only** the human-judgment flags left open on purpose; if
`Surfaced` is `0`, the PR has zero open threads and the caller (`review-loop`) can
exit. Report each still-open flag on its own line so it is never silently dropped.

Then per PR list:
- **Applied** — comment ID, author, one-line summary, commit SHA, thread status
  (resolved / no-thread).
- **Surfaced** (needs user) — comment, gate score, `/critical` finding if any.
  Thread left open.
- **Skipped** — comment, reason. Thread left open.

<a id="lessons-write"></a>
**After the report — write lessons.** Run the retrospective and capture any
durable lesson from the run (a Phase 3 misclassification, a Phase 4 gate
mis-score, a Phase 6 lane misfire, an apply that needed a scoped-check fix).
Full contract, tier classification, and the applied-lesson UPDATE rule in
[`rules/self-improvement-loop.md#write-lessons`](./rules/self-improvement-loop.md#write-lessons):

```
# Classify scope (universal → global; project-bound → repo::{owner}/{repo}), dedup, then write.
# Silent no-op if memory.* not connected.
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write { scope: "<global | repo::{owner}/{repo}>", key: "implement-suggestion-lessons::<slug>", value: "<body>", tags: ["loop::implement-suggestion-lessons", "source::<trigger>"], source_agent: "implement-suggestion", trigger: "<end-of-run | watch-reflag | user-override>" }
```

A lesson reaching `seen_count >= 3` is promotion-eligible — surface the
scope-appropriate one-liner (`/create-skill diagnose implement-suggestion` for
`global`; a repo rule via `docs` for `repo::`). Never promote silently.
See [`rules/self-improvement-loop.md#lesson-promotion`](./rules/self-improvement-loop.md#lesson-promotion).

#### Outcome emit

After writing lessons — emit outcome records to `review-outcomes` AND write
comment-relevance memories. These are two separate, parallel writes per processed
comment.

**Write 1 — `review-outcomes` bus** (existing): appends to the `review-outcomes` LoreKit bus
(tag `loop::review-outcomes`) — one fingerprinted outcome record per comment.
This feeds the shared candidate/outcome bus consumed by
[`agents/shared/rules/outcome-learning.md`](../../../agents/shared/rules/outcome-learning.md) at promotion time.

**Write 2 — `reviewer-comment-relevance` memory** (new): writes a relevance signal
to the `reviewer-comment-relevance` LoreKit bucket (tag
`loop::reviewer-comment-relevance`) for each processed comment.
This is the primary write path that makes `reviewer` and `pr-reviewer` continuously
better on this specific repository — each resolved or dismissed comment updates
the per-repo signal so future reviews suppress recurring noise and reinforce
reliably-resolved patterns.
See [`agents/shared/rules/comment-relevance-memory.md § Write`](../../../agents/shared/rules/comment-relevance-memory.md)
for the full record schema and scope-classification rules.

Reuse the per-comment `/critical` + `/confidence` result already in context — do not recompute.
Derive `verdict` / `relevance` from the Phase 4 decision matrix:

| Phase 4 outcome | `verdict` (review-outcomes) | `relevance` (comment-relevance) | `resolution_method` |
| --- | --- | --- | --- |
| Gate cleared, patch landed | `applied` | `relevant` | `fixed` |
| `/critical` Must-fix raised OR `/confidence` below threshold | `rejected-at-validation` | `not-relevant` | `wont-fix` |
| Gate cleared but scoped out / deferred | `deferred` | `weak-not-relevant` | `ignored-at-merge` |
| Patch landed then reverted after CI failure | `reverted-after-ci` | `not-relevant` | `wont-fix` |

For `applied` verdicts, also check the comment thread for explicit "won't fix"
language from the author (`won't fix`, `by design`, `intentional`, `nwf`, `n/a`,
👎 reaction):

```bash
gh api repos/$REPO/pulls/$PR_NUMBER/comments \
  --jq ".[] | select(.in_reply_to_id == $COMMENT_ID) | .body" \
| grep -iE "(won.?t fix|wont fix|by design|intentional|nwf|not going to|n/a)"
```

If a decline phrase is found, override `relevance: not-relevant`, `resolution_method: wont-fix`.

Infer `source` from the comment author login per the heuristic in [`review-outcomes.md`](../../../agents/shared/rules/review-outcomes.md).

```
# Write 1 — review-outcomes bus (unchanged).
# Append-only, non-blocking. Silent no-op if LoreKit not connected.
memory.write { scope: "<global | repo::{owner}/{repo}>", key: "review-outcomes::<fingerprint-slug>", value: "<outcome record>", tags: ["loop::review-outcomes", "source::<verdict>"], source_agent: "implement-suggestion", trigger: "outcome-emit" }

# Write 2 — comment-relevance memory (new).
# Deduplicate first; UPDATE seen_count if exists, ADD otherwise.
# Scope: almost always repo::{owner}/{repo}; global only for universal patterns.
memory.search { q: "<fingerprint slug>", scopes: ["repo::{owner}/{repo}", "global"], limit: 5 }
# The key is EXACTLY `<category>:<claim-gist>` — never a pr#, comment id, SHA, or file:line.
# A coordinate key is unique per occurrence, so seen_count never accumulates and the signal
# is inert. Put coordinates in the record's `examples` field. Self-check: comment-relevance-memory.md § Key format.
memory.write { scope: "repo::{owner}/{repo}", key: "reviewer-comment-relevance::<category>:<claim-gist>", value: "<relevance record>", tags: ["loop::reviewer-comment-relevance", "source::<resolution_method>"], source_agent: "implement-suggestion", trigger: "outcome-emit" }
```

LoreKit owns storage server-side and dedups on write.
The `reviewer-comment-relevance` bucket has a 60-day default TTL, refreshed on each sighting.
The `review-outcomes` bucket has a 30-day volatile TTL.

Both writes are **append-only and non-blocking** — they MUST NOT gate or delay the Phase 7 report.
If LoreKit's `memory.*` tools are not connected, both steps are silent no-ops; the apply flow is unaffected.

## Watch Workflow (`--watch`)

A loop wrapper around the multi-PR single-pass, scoped to one PR. Each iteration:
waits for new review activity, runs Phases 1–7 over comments newer than the last
processed timestamp, advances the baseline, and repeats until the reviewers go
quiet, CI goes red, or the iteration cap (default 5) is hit. `/create-pr` dispatches
this as a background subagent post-push so a new PR auto-converges on its bot feedback.

The wait is the shared
[review-activity poll](../../../agents/shared/rules/review-activity-poll.md) —
co-owned with `review-loop --external-review`, never restated here.

**CI is a stop reason, never a fix.** After each iteration's push the loop reads
check state once; a failing check stops it with `ci red — <check names>` and names
the handoff. It dispatches no `ci-auto-fix` and spends none of the per-PR handoff
budget. Getting a PR both comment-clean *and* green is `review-loop`.

Full loop, the poll call, parameters (`--max-iters`, `--interval`), the CI-state
table, the per-iteration report, and watch-specific hard rules live in
[`rules/watch-mode.md`](./rules/watch-mode.md).

Inside each `--watch` iteration, after the per-iteration Phase 7 report:
run the outcome-emit step (see [above](#outcome-emit)) for every comment processed in that iteration.
This includes both the `review-outcomes` bus write AND the `reviewer-comment-relevance` memory write.
This ensures that `reverted-after-ci` verdicts and relevance signals are captured at the end of the
iteration where CI failure is detected.
Both emits are append-only and non-blocking in each iteration.

## Free-text Workflow

When `$ARGUMENTS` is prose, a pasted comment, or a single comment permalink
without a PR worktree context:

1. Run Phase 4 (two-gate validation) once.
2. Apply in the **current** working directory if the gate clears, otherwise
   surface to the user.
3. Do **not** commit or push — the user is driving manually.

Free-text mode preserves v1 behaviour: a quick "implement this colleague
suggestion I just pasted" path with no PR plumbing.

## Self-Improvement

`/implement-suggestion` gets better across runs through a two-tier lessons loop
(fast episodic tier + gated promotion), identical in shape to
`autonomous-workflow` and `fix-bug`. It **reads** `implement-suggestion-lessons` at Phase 3
and **writes** at Phase 7 (and on a `--watch` re-flag), keyed by reviewer source
+ comment topic. Lessons are **advisory** — they bias classification, gate
calibration, and lane selection, but never relax a gate or a hard rule. A lesson
that recurs (`seen_count >= 3`) is promotion-eligible to a permanent skill guard
via `/create-skill diagnose implement-suggestion`.

The loop owns implement-suggestion's **own** decision phases only; the
standard-lane `aw-planner` dispatch already contributes to `aw-lessons` for the
planning of architectural changes — this loop does not duplicate that.
LoreKit (the `lorekit-memory` skill's `memory.*` tools) is an **optional
companion**: if those tools are not connected the whole loop is a silent no-op.
Full contract:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md).

In addition to writing `implement-suggestion-lessons`, this skill is a **producer of two LoreKit buckets**:

1. **`review-outcomes` shared candidate/outcome bus** (see [`agents/shared/rules/review-outcomes.md`](../../../agents/shared/rules/review-outcomes.md)) — volatile 30-day TTL; consumed by `outcome-learning.md` at promotion time only.
2. **`reviewer-comment-relevance` memory bucket** (see [`agents/shared/rules/comment-relevance-memory.md`](../../../agents/shared/rules/comment-relevance-memory.md)) — durable 60-day TTL; consumed by `reviewer` and `pr-reviewer` at the **start of every review run** (Step 0.7 / Step 1.0) to suppress recurring noise and reinforce reliably-resolved patterns. This is the primary mechanism by which the reviewer pipeline continuously improves on a specific repository.

At Phase 7 (and per-iteration inside `--watch`), one fingerprinted record is written to each bucket
per processed comment.
Both writes are append-only and non-blocking.
The reviewers consume `review-outcomes` only at promotion/consolidation time; they consume `reviewer-comment-relevance` on every review run.

## Hard Rules

- **Never** push with `--force` or `--force-with-lease` without explicit user approval.
- **Never** push with `--no-verify` or bypass hooks.
- **Never** apply a change whose `/critical` review surfaced a Must-fix finding without surfacing first.
- **Never** auto-rebase a PR branch — surface and stop.
- **Never** delete or weaken tests or types to make a suggestion fit.
- **One commit per applied comment.** Each addressed comment is its own commit
  (message citing that comment) so `git log` maps one-to-one to resolved threads.
- **Resolve every addressed thread; leave the rest open.** After a comment's fix
  lands and is pushed, the worker replies with the commit SHA and calls
  `resolveReviewThread`. `surface` / `skip` comments — and any comment whose
  commit did not land — stay open. Never resolve a thread whose fix is not on the remote.
- **`--resolve-all` never green-washes.** The extra reply-and-resolve pass closes
  only threads it can honestly close (fix landed, question answered, discussion
  taken, change explicitly declined with a rationale). A real potential issue the
  agent will not auto-apply **and** cannot honestly decline stays **open** and is
  surfaced — the same invariant as `thread-resolution.md`'s "never resolve a
  persisting/unaddressed finding". Resolving to make a loop terminate is forbidden.
- **Worktree isolation.** Each PR gets its own `gw` worktree.
- **Resolved threads are skipped at fetch time.**
- **Main agent does not apply / commit / push in multi-PR mode.** Workers do.
- **No new PRs.** Push to existing branches only — multi-PR mode never invokes `gh pr create`.

## Prerequisites

| Dependency | Purpose | Required? |
|-----------|---------|-----------|
| `gh` CLI (authenticated) | Fetch comments, resolve PR metadata | **Yes** for multi-PR |
| `gw` CLI | Worktree creation and reuse per PR | Strongly recommended |
| `git` | Commit + push | **Yes** |
| `/critical` skill | Adversarial pre-mortem per comment | **Yes** |
| `/confidence` skill | Gate scoring per comment | **Yes** |
| `aw-planner` agent | Standard-lane plan authoring | Required when standard-lane fires |
| `lorekit-memory` skill (LoreKit `memory.*` tools) | `implement-suggestion-lessons` self-improvement loop (read Phase 3, write Phase 7 / watch re-flag); `reviewer-comment-relevance` per-repo relevance memory (write Phase 7 / watch); `review-outcomes` bus (write Phase 7 / watch) | Optional — all three loops are silent no-ops if not connected |

If `gh` is missing in multi-PR mode, stop and tell the user to install it.

## Rules

| Rule | When it loads |
|------|---------------|
| [`input-parsing`](./rules/input-parsing.md) | Phase 0 |
| [`worktree-resolution`](./rules/worktree-resolution.md) | Phase 1 |
| [`comment-fetching`](./rules/comment-fetching.md) | Phase 2 |
| [`comment-classification`](./rules/comment-classification.md) | Phase 3 |
| [`validation-gates`](./rules/validation-gates.md) | Phase 4 |
| [`handoff`](./rules/handoff.md) | Phase 6 — worker prompt + standard-lane planner dispatch |
| [`watch-mode`](./rules/watch-mode.md) | When `--watch` is set — the post-push feedback loop |
| [`self-improvement-loop`](./rules/self-improvement-loop.md) | Cross-cutting — `implement-suggestion-lessons` fast tier (read Phase 3 / write Phase 7 + watch re-flag) + promotion to `diagnose` |

Templates:

- [`suggestion-pack.md`](./templates/suggestion-pack.md) — the per-PR pack written in Phase 5.

## Relationship to other skills

| Skill | Relationship |
| --- | --- |
| `ci-auto-fix` | **Owns red CI. This skill never fixes it.** The worker's pre-push checks (Phase 6) are local and gate the push; post-push check state is only ever read as a *stop reason* under `--watch`. No `ci-auto-fix` dispatch happens here, and none of its 2-handoff budget is spent. |
| `review-loop` | **The composition point.** "Apply the review comments **and** get CI green" is `review-loop` (or `polish`), which sequences `pr-reviewer` → this skill → `polish simplify` → `ci-auto-fix`. Invoked standalone, this skill leaves red CI to the caller — deliberately. |
| `review-loop --external-review` | Overlaps `--watch`: both wait on an out-of-process reviewer. `--watch` is the thin one (apply + push + stop). `review-loop --external-review` adds `--resolve-all`, `polish simplify`, the CI sub-step, and the description refresh. Both call the shared [review-activity poll](../../../agents/shared/rules/review-activity-poll.md). They never nest — `review-loop`'s hard rule forbids invoking this skill with `--watch`. |
| `pr-reviewer` | Upstream producer of the findings this skill consumes; read-only, never invoked from here. |
| `aw-planner` | Standard-lane plan author (Phase 6) when the pack proposes architectural moves. |

## Key Principles

1. **Analyse once, hand off mechanically.** The skill does every `/critical` + `/confidence` call.
   Workers only apply pre-validated changes.
2. **Two-gate validation is non-skippable.** Every actionable comment goes through both.
   `/critical` runs first so its findings feed `/confidence`.
3. **Lane split mirrors `/fix-bug`.** Fast-lane skips `aw-planner` when changes are mechanical.
   Standard-lane invokes `aw-planner` when the pack proposes architectural moves.
4. **Existing PR is the contract.** This skill never opens a new PR. The worker pushes to the
   existing branch and Phase 7's report links to the existing PR URL.
5. **Parallelize per PR, sequentialize per comment.** PR-level work fans out; per-PR validation
   stays linear so the gates see consistent state.
6. **Learn across runs, but only advisory.** `implement-suggestion-lessons` (read Phase 3, write Phase 7)
   biases classification, gate calibration, and lane selection from prior runs — but a lesson
   never relaxes a gate or a hard rule. Only a recurrence-proven lesson (`seen_count >= 3`) earns
   a confidence-gated, user-approved change to the skill's source.
7. **A review is a report, not a comment.** A `pr-reviewer` body carries findings that exist
   nowhere else — gate findings have no inline anchor, optimality proposals are never posted
   inline, and deferred findings only ever appear in the body. Phase 2 expands it into one entry
   per finding and never self-filters it. Everything expanded still runs the full pipeline: the
   reviewer's own confidence score is evidence for Phase 4, never a way around it.
