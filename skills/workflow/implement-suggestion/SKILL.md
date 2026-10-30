---
name: implement-suggestion
description: >
  Applies human and AI-bot review comments on one or more PRs — each gated by /critical + /confidence,
  committed separately, pushed, and its thread resolved — or one pasted suggestion in place. --watch
  repeats on one PR until reviewers go quiet; --resolve-all also closes every non-fix thread it honestly
  can; triggers on "implement suggestion", "apply review comments", "/implement-suggestion".
disable-model-invocation: false
argument-hint: '[<pr-url>|#<n>] [--critical] [--watch] [--resolve-all]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(gw *) Read Edit Write Glob Grep Skill
metadata:
  author: mthines
  version: '3.1.0'
  workflow_type: orchestrator
  architecture: parse/resolve/fetch/classify/validate/pack/apply(here for 1 PR, worker per PR for ≥ 2)/commit-per-comment+resolve-thread/report
  composes:
    - critical
    - confidence
  tags:
    - pr
    - review
    - comments
    - github
    - worktree
    - autonomous
    - validation
    - confidence-gated
---

# Implement Suggestion

Validate reviewer suggestions on one or more PRs through `/critical` and `/confidence`, then apply each PR's **suggestion-pack**: commit, push to the existing branch, and resolve threads.
One PR is applied in this context; two or more get one worker sub-agent per PR, in parallel.
Never open a new PR.
Detailed procedure lives in `rules/*.md`; load each file at the phase that names it.

**Contents:** [Mode Detection](#mode-detection) · [Architecture](#architecture) · [Multi-PR Workflow](#multi-pr-workflow) · [Results](#implement-suggestion-results) · [Free-text Workflow](#free-text-workflow) · [Self-Improvement](#self-improvement) · [Hard Rules](#hard-rules) · [Prerequisites](#prerequisites) · [Rules](#rules)

## Mode Detection

Parse `$ARGUMENTS` once, in this order. First match wins.

| # | Signal in `$ARGUMENTS` | Mode |
| - | --- | --- |
| 1 | One or more `github.com/<owner>/<repo>/pull/<n>` URLs (with or without `#discussion_r…`) | **multi-pr** |
| 2 | One bare PR number (`#123`) **and** the current directory is a PR worktree | **multi-pr** (n=1) |
| 3 | Free-text prose, pasted comment body, or non-PR URL | **free-text** |
| 4 | Empty **and** the current branch has an open PR (auto-detected via `gh pr view`) | **multi-pr** (active PR) |
| 5 | Empty **and** no active PR for the current branch | Prompt the user |

Rule #4 runs `gh pr view --json number,url,state,headRefName,headRefOid,isDraft` with no number; an `OPEN` PR becomes the single PR, a `MERGED` or `CLOSED` one needs explicit user confirmation.
Full parsing rules: [`rules/input-parsing.md`](./rules/input-parsing.md).

Modifiers (orthogonal to mode):

- `--watch` — loop the single pass on exactly one PR until the reviewers go quiet (max 5 iterations); refuse it with more than one PR or in free-text mode. `rules/watch-mode.md` — read when `--watch` is set.
- `--resolve-all` — default off; also reply to and resolve every non-fix thread that can honestly be closed. `rules/resolve-all.md` — read when `--resolve-all` is set; it changes Phases 3, 5, 6, and 7.

State the detected mode and inputs in one line before continuing:

```text
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
Phase 6:  Apply                  → 1 PR: here; ≥ 2 PRs: one worker per PR — commit-per-comment, full check, push, resolve thread
Phase 7:  Report                 → per-PR table: applied / surfaced / skipped / resolved
```

Phases 1–6 run in parallel across PRs (one message, multiple dispatches); Phase 4 runs sequentially within a PR so the gates see consistent state.

## Multi-PR Workflow

### Phase 0 — Input parse

Apply [`rules/input-parsing.md`](./rules/input-parsing.md): a deduplicated list of `{owner, repo, prNumber, commentFilter}` tuples, each validated via `gh pr view --json number,state,headRefName,headRefOid,isDraft`; refuse any PR in state `MERGED` or `CLOSED`.

### Phase 1 — Worktree resolution

Apply [`rules/worktree-resolution.md`](./rules/worktree-resolution.md). Per PR: `gw checkout <pr-url-or-number>`, verify `git status --porcelain` is empty and `HEAD == headRefOid`, record the absolute worktree path.
Never auto-stash, never auto-rebase, never operate in the user's main worktree.

### Phase 2 — Comment fetch

Apply [`rules/comment-fetching.md`](./rules/comment-fetching.md). Per PR, in parallel:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews
gh api repos/<owner>/<repo>/pulls/<n>/comments
gh api repos/<owner>/<repo>/issues/<n>/comments
```

Include comments from human teammates **and** AI review bots (`claude[bot]`, `coderabbitai[bot]`, …); filter only the current user's own comments and noise bots (`dependabot`, `github-actions`).
Exclude resolved threads. Honor `commentFilter`.

A review body carrying `<!-- PR_REVIEWER_REPORT -->` is never self-filtered (the same carve-out covers a `pr-reviewer` inline finding, recognised by its attribution footer, and a `review-loop --ui` lane finding by its `<!-- ui-verify:finding` marker), and is **expanded** into one ledger entry per finding — deferred findings, gate findings, and optimality proposals exist only in that body.
Every expanded finding still runs the full pipeline; the reviewer's own score is evidence for Phase 4, never a way around it.
Grammar: [`agents/shared/rules/reviewer-report-ingest.md`](../../../agents/shared/rules/reviewer-report-ingest.md); expansion contract: [`rules/comment-fetching.md § Reviewer-report expansion`](./rules/comment-fetching.md).

### Phase 3 — Classify

<a id="lessons-read"></a>
First read `implement-suggestion-lessons` from LoreKit per [`rules/self-improvement-loop.md#read-lessons-phase-3`](./rules/self-improvement-loop.md#read-lessons-phase-3) (silent no-op if `memory.*` is not connected).
Matching lessons are advisory inputs to tagging and the Phase 4 gates; they never relax the two-gate requirement or a hard rule.

Tag every comment per [`rules/comment-classification.md`](./rules/comment-classification.md):

| Tag | Treatment (default) |
| --- | --- |
| `actionable` | Carries to Phase 4. |
| `nit` | Carries to Phase 4; higher confidence bar applies. |
| `discussion` | Skipped; surfaced in the Phase 7 report. |
| `question` | Skipped; surfaced. |
| `praise` | Dropped silently. |

### Phase 4 — Two-gate validation

For each `actionable` / `nit` comment, in this order ([`rules/validation-gates.md`](./rules/validation-gates.md)):

1. **`Skill("critical", "<mode>")`** — `code` if the comment proposes a specific edit (suggestion block, file:line reference), `analysis` otherwise.
2. **`Skill("confidence", "analysis")`** — score the change given the comment, the surrounding code, and `/critical`'s findings.

| `/confidence` score | `nit` comment | `actionable` comment |
| ------------------- | ------------- | -------------------- |
| ≥ 90%               | `apply`       | `apply`              |
| 80%–89%             | `surface`     | `apply`              |
| 70%–79%             | `surface`     | `surface`            |
| < 70%               | `skip`        | `skip`               |

A `/critical` finding tagged **Must-fix** overrides the matrix and forces `surface`, even at ≥ 90%; this override is non-removable.
Should-fix / Nice-to-have do not override; record them in the pack.

### Phase 5 — Build suggestion-pack

Write `.agent/<branch>/suggestion-pack.md` per PR from [`templates/suggestion-pack.md`](./templates/suggestion-pack.md): every `apply` change with file:line, the proposed edit, comment author and ID, and the `/critical` + `/confidence` evidence.
The pack is plan.md-shaped — one Acceptance Criterion per applied change, and a `Mode: existing-pr` header meaning "commit and push to the existing branch; do not open a new PR".

Once the pack names its files, read the `codebase-knowledge` signal for exactly those paths and fold matches into the pack as apply-time constraints, per [`rules/self-improvement-loop.md § Cross-bucket read — codebase-knowledge`](./rules/self-improvement-loop.md#cross-bucket-read--codebase-knowledge-phase-5-apply-seam).
The worker reads no other memory.

### Phase 6 — Apply (here for one PR, one worker per PR for two or more)

Order the pack first (B builds on A ⇒ A first; two contradicting `apply` comments both move to `surface`), then pick the applier by PR count:

| PRs in this run | Applier |
| --- | --- |
| 1 (always under `--watch` and inside `review-loop`) | **This context.** Run the worker prompt template's *What to do* steps and *Hard rules* yourself, against the pack. |
| ≥ 2 | **One worker sub-agent per PR, all in one message**, each with the filled template. |

**Why:** this context already read every comment and ran both gates on it; a single worker re-reads all of that from the pack and buys no parallelism ([`rules/handoff.md § Who applies`](./rules/handoff.md#who-applies)).

```text
# correct — one PR: apply here, from the pack
Phase 5 writes the pack → Phase 6 runs steps 1–6 of the template in this context → Phase 7 reports

# incorrect — one PR: a worker that re-reads what this context already holds
Agent(subagent_type="general-purpose", prompt=<template for PR #123>)
```

With two or more PRs, dispatch:

```text
Agent(
  description: "Apply suggestion-pack to PR #<n>",
  subagent_type: "general-purpose",   # "general" on OpenCode / Agent0 — rules/handoff.md#generic-sub-agent-type
  prompt: <the "Worker prompt template" from rules/handoff.md, filled in — the template is inline in that file; no external prompt file exists>
)
```

Contract and prompt: [`rules/handoff.md#worker-prompt-template`](./rules/handoff.md#worker-prompt-template).
Whoever applies makes one commit per applied comment (message cites `@author` + URL), pushes once after all commits, then replies `Addressed in <sha>` and calls `resolveReviewThread` on each addressed thread.
`surface` / `skip` comments stay open; `issues` / `review`-summary comments have no resolvable thread and are reported as such.
With two or more PRs, the main agent does not edit, commit, push, or resolve in Phase 6.
Applying in this context changes nothing in the pack: edit only the files an `apply` entry lists, and never re-judge an entry the gates already passed.

### Phase 7 — Report

```markdown
## Implement-Suggestion Results

| PR | Branch | Applied | Surfaced | Skipped | Commits | Pushed | Resolved |
|----|--------|---------|----------|---------|---------|--------|----------|
| dash0/console#1234 | fix/foo | 3 | 1 | 2 | abc1234, def5678, 9a0bcde | ✓ | 3/3 |
| dash0/console#1278 | feat/bar | 0 | 2 | 1 | — | — | 0/0 |
```

`Commits` lists one SHA per applied comment.
`Resolved` is `<threads-resolved>/<applied-with-a-thread>` (`issues` / `review`-summary comments are excluded from the denominator).
Then per PR list **Applied** (comment ID, author, one-line summary, commit SHA, thread status), **Surfaced** (comment, gate score, `/critical` finding; thread left open), and **Skipped** (comment, reason; thread left open).

<a id="lessons-write"></a>
After the report, write durable lessons (a Phase 3 misclassification, a Phase 4 mis-score, an apply that rippled past its own files) per [`rules/self-improvement-loop.md#write-lessons`](./rules/self-improvement-loop.md#write-lessons); a lesson reaching `seen_count >= 3` is surfaced for promotion, never promoted silently.

Then run the outcome-emit step: one `review-outcomes` record (consumed by `outcome-learning.md`) and one `reviewer-comment-relevance` record per processed comment, both append-only and non-blocking.
`rules/outcome-emit.md` — read when LoreKit `memory.*` tools are connected (both writes are silent no-ops otherwise).

## Free-text Workflow

When `$ARGUMENTS` is prose, a pasted comment, or a single comment permalink without a PR worktree context:

1. Run Phase 4 once.
2. Apply in the **current** working directory if the gate clears; otherwise surface to the user.
3. Do **not** commit or push.

## Self-Improvement

Reads `implement-suggestion-lessons` at Phase 3; writes at Phase 7 and on a `--watch` re-flag ([`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md)).
Also produces two LoreKit buckets ([`rules/outcome-emit.md`](./rules/outcome-emit.md)): the `review-outcomes` bus (volatile 30-day TTL) and `reviewer-comment-relevance` (durable 60-day TTL, read by `pr-reviewer` on every run).
LoreKit is optional; without `memory.*` tools every loop is a silent no-op.

## Hard Rules

- **Never** push with `--force` or `--force-with-lease` without explicit user approval.
- **Never** push with `--no-verify` or bypass hooks.
- **Never** apply a change whose `/critical` review surfaced a Must-fix finding without surfacing first.
- **Never** auto-rebase a PR branch — surface and stop.
- **Never** delete or weaken tests or types to make a suggestion fit.
- **One commit per applied comment.** Each message cites its comment, so `git log` maps one-to-one to resolved threads.
- **Resolve every addressed thread; leave the rest open.** Never resolve a thread whose fix is not on the remote.
- **Worktree isolation.** Each PR gets its own `gw` worktree.
- **One PR is applied here; two or more PRs are applied by workers.** With ≥ 2 PRs the main agent does not apply, commit, or push.
- **No new PRs.** Push to existing branches only — never invoke `gh pr create`.
- **Never fix CI.** Red CI belongs to `ci-auto-fix`; "apply the comments and get CI green" is `review-loop`. Under `--watch`, check state is only a stop reason.

## Prerequisites

| Dependency | Required? |
|-----------|-----------|
| `gh` CLI (authenticated) | **Yes** for multi-PR — stop and ask the user to install it if missing |
| `gw` CLI | Strongly recommended |
| `git`, `/critical`, `/confidence` | **Yes** |
| `lorekit-memory` skill (LoreKit `memory.*` tools) | Optional |

## Rules

| Rule | When it loads |
|------|---------------|
| [`input-parsing`](./rules/input-parsing.md) | Phase 0 |
| [`worktree-resolution`](./rules/worktree-resolution.md) | Phase 1 |
| [`comment-fetching`](./rules/comment-fetching.md) | Phase 2 |
| [`comment-classification`](./rules/comment-classification.md) | Phase 3 |
| [`validation-gates`](./rules/validation-gates.md) | Phase 4 |
| [`handoff`](./rules/handoff.md) | Phase 6 — who applies, worker dispatch + prompt; rationale: [`apply-context`](./references/apply-context.md) |
| [`outcome-emit`](./rules/outcome-emit.md) | Phase 7, and per `--watch` iteration, when LoreKit is connected |
| [`watch-mode`](./rules/watch-mode.md) | When `--watch` is set |
| [`resolve-all`](./rules/resolve-all.md) | When `--resolve-all` is set |
| [`self-improvement-loop`](./rules/self-improvement-loop.md) | Phase 3 read, Phase 7 / watch re-flag write, promotion |
