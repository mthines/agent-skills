---
name: implement-suggestion
description: >
  Implements review-comment suggestions across one or more PRs. Multi-PR mode
  (default when $ARGUMENTS contains PR URLs; empty $ARGUMENTS auto-detects the
  active PR) per PR: resolves a worktree, fetches every actionable comment
  from both human teammates AND AI code-review bots (claude[bot],
  coderabbitai[bot], …), validates each through /critical + /confidence,
  builds a structured suggestion-pack, and dispatches a worker subagent to
  apply / commit / push to the existing branch — fast-lane for mechanical
  edits, standard-lane via aw-planner for architectural changes. Free-text
  mode applies a single pasted suggestion in the current directory. Triggers
  on "implement suggestion", "apply review comments", "address PR feedback",
  "implement reviewer feedback", "fix PR comments", "/implement-suggestion".
  With --watch, loops the apply on a single PR — waiting for new review-bot
  comments after each push and re-applying until the reviewers go quiet (max 5
  iterations); this is the loop /create-pr dispatches post-push.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--critical] [--watch]'
license: MIT
allowed-tools: Bash(gh *) Bash(git *) Bash(gw *) Read Edit Write Glob Grep Skill
metadata:
  author: mthines
  version: '2.2.0'
  workflow_type: orchestrator
  architecture: parse/resolve/fetch/classify/validate/pack/handoff(fast|standard)/report
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
Phase 6:  Handoff (lane-split)
            ├── Fast-lane (simple):     dispatch worker subagent with pack
            └── Standard-lane (complex): aw-planner → plan.md → worker subagent
Phase 7:  Report                 → per-PR table: applied / surfaced / skipped
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

### Phase 3 — Classify

<a id="lessons-read"></a>
**Before tagging — read prior lessons.** Load `implement-suggestion-lessons` so accumulated
misclassifications and gate mis-calibrations bias this run before they repeat.
Full contract in [`rules/self-improvement-loop.md#read-lessons-phase-3`](./rules/self-improvement-loop.md#read-lessons-phase-3):

```
Skill("persistent-memory", "read implement-suggestion-lessons --tier home")     # skips silently if not installed
if [ -f memory/implement-suggestion-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read implement-suggestion-lessons --tier project-shared")
fi
```

Match each lesson's `trigger-context` (reviewer source + topic) against the
ledger. Matches are **advisory inputs** to Phase 3 tagging and the Phase 4 gates
— they never relax the two-gate requirement or a hard rule.

Tag every comment per [`rules/comment-classification.md`](./rules/comment-classification.md):

| Tag           | Treatment                                                                  |
| ------------- | -------------------------------------------------------------------------- |
| `actionable`  | Carries to Phase 4 (validation gates).                                     |
| `nit`         | Carries to Phase 4; higher confidence bar applies.                         |
| `discussion`  | Skipped; surfaced in Phase 7 report.                                       |
| `question`    | Skipped; surfaced.                                                         |
| `praise`      | Dropped silently.                                                          |

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

**The main agent does not edit files in Phase 6.** All applies / commits /
pushes happen inside the worker subagent so the loud loop (test runs,
push retries) stays out of the main context.

### Phase 7 — Report

Emit one summary table:

```markdown
## Implement-Suggestion Results

| PR | Branch | Lane | Applied | Surfaced | Skipped | Commit | Pushed |
|----|--------|------|---------|----------|---------|--------|--------|
| dash0/console#1234 | fix/foo | fast | 3 | 1 | 2 | abc1234 | ✓ |
| dash0/console#1278 | feat/bar | standard | 0 | 2 | 1 | — | — |
```

Then per PR list:
- **Applied** — comment ID, author, one-line summary.
- **Surfaced** (needs user) — comment, gate score, `/critical` finding if any.
- **Skipped** — comment, reason.

<a id="lessons-write"></a>
**After the report — write lessons.** Run the retrospective and capture any
durable lesson from the run (a Phase 3 misclassification, a Phase 4 gate
mis-score, a Phase 6 lane misfire, an apply that needed a scoped-check fix).
Full contract, tier classification, and the applied-lesson UPDATE rule in
[`rules/self-improvement-loop.md#write-lessons`](./rules/self-improvement-loop.md#write-lessons):

```
# Universal candidate → home. Project-bound candidate → project-shared only when opted in.
Skill("persistent-memory", "write implement-suggestion-lessons --tier home --auto")     # skips silently if not installed
```

A lesson reaching `seen_count >= 3` is promotion-eligible — surface the
tier-appropriate one-liner (`/create-skill diagnose implement-suggestion` for
`home`; a repo rule via `docs` for `project-shared`). Never promote silently.
See [`rules/self-improvement-loop.md#lesson-promotion`](./rules/self-improvement-loop.md#lesson-promotion).

#### Outcome emit

After writing lessons — emit outcome records to `review-outcomes`. For every comment
processed in this run (any verdict: `applied`, `rejected-at-validation`, `deferred`), append
a fingerprinted outcome record to the `review-outcomes` persistent-memory scope.
This is the outcome-emit step that feeds the shared candidate/outcome bus consumed by
[`agents/shared/rules/outcome-learning.md`](../../../agents/shared/rules/outcome-learning.md) at promotion time.

Reuse the per-comment `/critical` + `/confidence` result already in context — do not recompute.
Derive `verdict` from the Phase 4 decision matrix:

| Phase 4 outcome | `verdict` value |
| --- | --- |
| Gate cleared, patch landed | `applied` |
| `/critical` Must-fix raised OR `/confidence` below threshold | `rejected-at-validation` |
| Gate cleared but scoped out / deferred | `deferred` |
| Patch landed then reverted after CI failure | `reverted-after-ci` (written at the end of the `--watch` loop if CI failure is traced to this patch) |

Infer `source` from the comment author login per the heuristic in [`review-outcomes.md`](../../../agents/shared/rules/review-outcomes.md).

```
# Append-only, non-blocking — one record per processed comment.
# Degrade gracefully if persistent-memory is absent (skips silently).
Skill("persistent-memory", "write review-outcomes --tier home --auto")
# Project-shared, if opted in:
if [ -f memory/review-outcomes/INDEX.md ]; then
  Skill("persistent-memory", "write review-outcomes --tier project-shared --auto")
fi
# Opportunistic consolidation if INDEX exceeds 180 lines:
if [ $(wc -l < ~/.agent-memory/review-outcomes/INDEX.md 2>/dev/null || echo 0) -ge 180 ]; then
  Skill("persistent-memory", "consolidate review-outcomes --tier home --auto")
fi
```

This step is **append-only and non-blocking** — it MUST NOT gate or delay the Phase 7 report.
If `persistent-memory` is absent, the step skips silently; the apply flow is unaffected.

## Watch Workflow (`--watch`)

A loop wrapper around the multi-PR single-pass, scoped to one PR. Each iteration:
waits for new review activity, runs Phases 1–7 over comments newer than the last
processed timestamp, advances the baseline, and repeats until the reviewers go
quiet or the iteration cap (default 5) is hit. `/create-pr` dispatches this as a
background subagent post-push so a new PR auto-converges on its bot feedback.

Full loop, the poll-for-new-activity snippet, parameters (`--max-iters`,
`--interval`), the per-iteration report, and watch-specific hard rules live in
[`rules/watch-mode.md`](./rules/watch-mode.md).

Inside each `--watch` iteration, after the per-iteration Phase 7 report:
run the outcome-emit step (see [above](#outcome-emit)) for every comment processed in that iteration.
This ensures that `reverted-after-ci` verdicts are captured at the end of the iteration where CI failure is detected.
The emit is append-only and non-blocking in each iteration.

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
`persistent-memory` is an **optional companion**: if it is not installed the
whole loop skips silently. Full contract:
[`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md).

In addition to writing `implement-suggestion-lessons`, this skill is now a **producer of the
`review-outcomes` shared candidate/outcome bus** (see [`agents/shared/rules/review-outcomes.md`](../../../agents/shared/rules/review-outcomes.md)).
At Phase 7 (and per-iteration inside `--watch`), it appends a fingerprinted outcome record
for each processed comment.
The reviewers (`reviewer`, `pr-reviewer`) consume this bus only at promotion/consolidation time — never per-review.

## Hard Rules

- **Never** push with `--force` or `--force-with-lease` without explicit user approval.
- **Never** push with `--no-verify` or bypass hooks.
- **Never** apply a change whose `/critical` review surfaced a Must-fix finding without surfacing first.
- **Never** auto-rebase a PR branch — surface and stop.
- **Never** delete or weaken tests or types to make a suggestion fit.
- **One commit per PR.** A run that processes 5 PRs produces at most 5 commits, not 5×N.
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
| `persistent-memory` skill | `implement-suggestion-lessons` self-improvement loop (read Phase 3, write Phase 7 / watch re-flag) | Optional — loop skips silently if absent |

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
