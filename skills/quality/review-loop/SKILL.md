---
name: review-loop
description: >
  Bounded review-apply-simplify convergence loop for a GitHub PR (draft PRs are
  fine). Runs up to N=3 iterations of pr-reviewer → implement-suggestion →
  polish simplify, with an early exit on a PASS verdict with no blocking
  findings. Use after opening a draft PR to converge the branch to a clean
  state before undrafting. Callers: autonomous-workflow Phase 6/7, create-pr
  (post-draft), and standalone via /review-changes. Invoke with
  /review-loop <PR-URL|#n> [--cap N] [--critical] [--no-feedback].
disable-model-invocation: false
argument-hint: '<PR-URL|#n> [--cap N] [--critical] [--no-feedback]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - review
    - code-quality
    - simplify
    - convergence
    - pr
    - orchestrator
---

# review-loop — Bounded Review-Apply-Simplify Convergence

Drive a PR from its initial draft state to a clean, review-ready state by
iterating `pr-reviewer` → `implement-suggestion` → `polish simplify` until
the PR is clean or the cap is reached.

This skill is an **orchestrator**.
It contains no quality rules of its own.
It sequences three existing pieces, each owning its own domain:

1. `pr-reviewer` — finds issues (read-only; posts one `COMMENT` review).
2. `implement-suggestion` — applies actionable review findings (single-shot, no `--watch`).
3. `Skill("polish", "simplify")` — applies Class M mechanical refactors behind a confidence gate.

## Modes

Parse the **first positional argument** as the PR reference.
Everything else is a flag.

| Flag | Effect |
| --- | --- |
| `--cap N` | Override the default iteration cap of 3. |
| `--critical` | Pass `--critical` to each `pr-reviewer` call (adversarial pre-mortem). |
| `--no-feedback` | Skip the loop; run `pr-reviewer` once and report findings without applying. |

## Procedure

### Step 0: Resolve the PR and preconditions

```bash
# Resolve PR number and repo from the argument
# (mirrors the parsing logic in pr-reviewer Step 0)
if [[ "$ARG" =~ ^https://github\.com/([^/]+/[^/]+)/pull/([0-9]+) ]]; then
  PR_REPO="${BASH_REMATCH[1]}"
  PR_NUMBER="${BASH_REMATCH[2]}"
elif [[ "$ARG" =~ ^#?([0-9]+)$ ]]; then
  PR_REPO=""
  PR_NUMBER="${BASH_REMATCH[1]}"
fi

RESOLVED_REPO=${PR_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
```

If no PR reference is found, abort: `review-loop requires a PR URL or #<n>.`

Set the iteration cap:

```bash
CAP=${cap_flag:-3}
ITERATION=0
```

### Step 1: Loop — review → apply → simplify

Each iteration runs three sub-steps.
The loop exits early when `pr-reviewer` returns a PASS with no blocking findings.

```
while ITERATION < CAP:
    ITERATION += 1

    # Sub-step A: review
    run pr-reviewer(<PR>) [--critical if passed]
    if pr-reviewer verdict == PASS with no blocking findings:
        break   # early exit; branch is clean

    # Sub-step B: apply findings
    Skill("implement-suggestion", "<PR-URL>")
    # Single-shot apply — no --watch; the loop drives re-review itself.

    # Sub-step C: simplify
    Skill("polish", "simplify")
    # Applies Class M mechanical refactors; never runs the reviewer pass.

    push any local changes:
    git push

if ITERATION == CAP and last verdict != PASS:
    report: cap reached, findings still present, surface the remaining blockers
```

**Hard rule: never call `Skill("polish")` or `Skill("polish", "review")` from
this loop.** Call only `Skill("polish", "simplify")`.
Full `polish` runs a reviewer pass internally, which would re-enter `pr-reviewer`
and create a dispatch cycle.
`polish simplify` dispatches no reviewer — this is the anti-circularity guarantee.

### Step 2: Report

After the loop exits (early or at cap), emit a compact summary:

```
review-loop on PR #<n> (<REVIEW_RELATION>)

Iterations: <N> of <CAP>
Stop reason: <PASS-no-blockers | cap-reached>

Per-iteration summary:
  Iteration 1: <verdict>, <N findings>, <M applied by implement-suggestion>, <K simplify recipes>
  Iteration 2: ...

Final pr-reviewer verdict: <PASS | FAIL>
Remaining blockers (if any): <one line each>

Head commit: <sha>
```

Surface remaining blockers prominently if the cap was reached without convergence.
Do not silently drop them.

## Hard rules

- **Never call `Skill("polish")` or `Skill("polish", "review")`.** Only `Skill("polish", "simplify")`.
- **Never write to GitHub directly.** `pr-reviewer` posts the `COMMENT` review; this skill orchestrates only.
- **Never undraft the PR.** This skill converges; the user makes the final undraft decision.
- **One `implement-suggestion` per iteration, no `--watch`.** The loop drives re-review; `--watch` waits for external bots and would conflict.
- **Cap is a hard limit.** If the PR is still failing at the cap, surface the findings and stop. Do not extend the cap silently.

## Relationship to other skills

| Skill | Relationship |
| --- | --- |
| `pr-reviewer` | Sub-step A: the find pass (read-only); this skill drives re-review between iterations. |
| `implement-suggestion` | Sub-step B: the apply pass; invoked single-shot (no `--watch`). |
| `polish simplify` | Sub-step C: the cleanup pass; only the simplify mode, never full `polish`. |
| `polish` | Calls `review-loop` for its review role; review-loop NEVER calls full `polish` back. |
| `create-pr` | Delegates post-draft review to `review-loop` after opening the draft PR. |
| `autonomous-workflow` Phase 6/7 | Invokes `review-loop` in place of the retired `reviewer` agent dispatches. |
| `review-changes` | Routes to `review-loop` as the primary convergence entry point. |
