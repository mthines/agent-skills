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
| `--no-feedback` | Report-only. Forces `CAP=1` and skips sub-steps B and C, so `pr-reviewer` runs once and its findings are reported without being applied or pushed. |

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

Parse the flags and set the iteration cap:

```bash
# Parse flags out of the argument string.
cap_flag=""
CRITICAL=0
NO_FEEDBACK=0

# --cap N: override the default iteration cap (accepts "--cap 5" or "--cap=5").
if [[ " $ARGUMENTS " =~ [[:space:]]--cap[[:space:]=]+([0-9]+) ]]; then
  cap_flag="${BASH_REMATCH[1]}"
fi

# --critical: pass the adversarial pre-mortem through to each pr-reviewer call.
if [[ " $ARGUMENTS " == *" --critical "* ]]; then
  CRITICAL=1
fi

CAP=${cap_flag:-3}
ITERATION=0

# --no-feedback degrades the loop to a single read-only review pass.
if [[ " $ARGUMENTS " == *" --no-feedback "* ]]; then
  NO_FEEDBACK=1
  CAP=1
fi
```

### Step 1: Loop — review → apply → simplify

Each iteration runs three sub-steps.
The loop exits early when `pr-reviewer` returns a PASS with no blocking findings.

When `NO_FEEDBACK == 1`, only sub-step A runs: sub-steps B and C are skipped, the
push is skipped, and the run reports the findings without applying anything.

```text
while ITERATION < CAP:
    ITERATION += 1

    # Sub-step A: review
    run pr-reviewer(<PR>) [append " --critical" when CRITICAL == 1]
    if pr-reviewer verdict == PASS with no blocking findings:
        break   # early exit; branch is clean

    if NO_FEEDBACK == 1:
        break   # report-only: never apply, never simplify, never push

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

**Hard rule: the only permitted `polish` invocation is `Skill("polish", "simplify")`.**
The `simplify` mode applies Class M mechanical refactors and dispatches no pr-reviewer.
All other `polish` modes trigger an internal agent pass, which would create a dispatch cycle.
This is the anti-circularity guarantee.

### Step 2: Report

After the loop exits (early or at cap), emit a compact summary:

```text
review-loop on PR #<n> (<RESOLVED_REPO>)

Iterations: <N> of <CAP>
Stop reason: <PASS-no-blockers | cap-reached | report-only (--no-feedback)>

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

- **The only permitted `polish` invocation is `Skill("polish", "simplify")`.** Non-simplify modes trigger an internal agent pass and create a dispatch cycle.
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
| `polish` (bare) | **Downstream, not a caller.** `polish`'s Pass A invokes `pr-reviewer` directly and never calls `review-loop`; this loop only invokes `Skill("polish", "simplify")`. |
| `create-pr` | Upstream caller — delegates post-draft review to `review-loop` after opening the draft PR. |
| `autonomous-workflow` Phase 6/7 | Invokes `review-loop` in place of the retired `reviewer` agent dispatches. |
| `review-changes` | Routes to `review-loop` as the primary convergence entry point. |
