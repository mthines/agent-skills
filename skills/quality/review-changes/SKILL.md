---
name: review-changes
description: >
  Review branch changes or a PR for code quality, tests, documentation, and commit
  hygiene. Routes to the `review-loop` skill for a bounded review-apply-simplify
  convergence loop, or to `pr-reviewer` directly for a one-shot read-only review.
  Invoke with /review-changes.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--report] [--critical] [--no-ci] [--external-review] [--interval S]'
license: MIT
metadata:
  author: mthines
  version: '3.0.0'
  workflow_type: command
---

## Routing

Choose the path based on the argument shape:

| Argument shape | Path | Reason |
| --- | --- | --- |
| no arg / `--report` | `Skill("review-loop", "<pr-url> [--critical\|--no-ci\|--external-review\|--interval S]")` on the current branch's open PR, or `pr-reviewer` directly if `--report` (one-shot, no apply) | Own PR convergence loop, or one-shot report. |
| PR URL or `#<n>` | `Skill("review-loop", "<pr-url> [--critical\|--no-ci\|--external-review\|--interval S]")` — runs the bounded review-apply-simplify loop | Converges the PR regardless of who authored it (`pr-reviewer` detects `REVIEW_RELATION` itself). |

`--no-ci`, `--external-review` and `--interval S` are pass-throughs: this skill never
sets them itself, it only forwards what the user passed (see the note below).

```bash
# --report routes straight to pr-reviewer, which --external-review exists to avoid.
# Refuse the pair rather than accepting a flag this path cannot honour, mirroring
# review-loop's refusal of --no-feedback --external-review.
case "$ARGUMENTS" in
  *--report*) case "$ARGUMENTS" in
    *--external-review*)
      echo "--report needs pr-reviewer; drop --external-review or drop --report."
      exit 1 ;;
  esac ;;
esac

# Resolve the current branch's PR whenever no PR was named. Test for the ABSENCE of a
# PR reference, never for an exact flag string: every flag in the table above is
# combinable, so `= "--report"` left `--external-review`, `--critical`, `--no-ci`, and
# `--interval S` with no PR to act on.
case "$ARGUMENTS" in
  *github.com/*/pull/*|*\#[0-9]*) ;;                       # a PR was named; use it
  *) CURRENT_PR=$(gh pr view --json url -q .url 2>/dev/null) ;;
esac
```

**`review-changes` passes no `--no-ci`** — unlike `create-pr` and `autonomous-workflow`
Phase 7, it owns no CI phase of its own, so the loop's CI sub-step is exactly what
keeps a standalone run from converging on a **red** build instead of a
green-threads-red-build one. Forward `--no-ci`, `--external-review`, and `--interval`
through when the user passes them.

It converges on *not red*, not on *green*. `review-loop`'s `ci_is_settled()` treats
`pending` as settled — the loop reads check state, never waits for it — so a run can
converge with checks still in flight. Wait for the checks yourself before merging, or
give CI to a caller that owns a watch (`create-pr` Step 9, `phase-7-ci-gate.md`) and
pass `--no-ci` here.

```
# Default — convergence loop on own or specified PR
Skill("review-loop", "<pr-url-or-number> [--critical|--no-ci|--external-review|--interval S if passed]")

# Report-only (no apply) — one-shot review.
# pr-reviewer is an AGENT — dispatch via the Task tool, NOT Skill():
Task(subagent_type="pr-reviewer", prompt="<pr-url-or-number> [--critical if passed]")
```

## Usage

| Invocation | Effect |
| --- | --- |
| `/review-changes` | Convergence loop on the current branch's open PR — `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify` → CI, up to 5 iterations, converging until every review thread is resolved (fix or reply) **and** CI is not red. |
| `/review-changes --no-ci` | Same, minus the CI sub-step. Pass this when something else already owns CI for the PR. |
| `/review-changes --external-review` | Waits for an out-of-process reviewer (another agent, a review bot) instead of dispatching `pr-reviewer`, then applies + resolves + simplifies as usual. Also the path to use where the `Task` tool is unavailable. |
| `/review-changes --report` | One-shot read-only review via `pr-reviewer` (no apply). |
| `/review-changes --report --external-review` | **Refused.** Print `--report needs pr-reviewer; drop --external-review or drop --report.` and exit — the same refusal `review-loop` gives for `--no-feedback --external-review`, and for the same reason: report-only needs a reviewer to report, and `--external-review` removes the only one either path owns. Never silently ignore `--external-review` here. |
| `/review-changes --critical` | Adds adversarial pre-mortem (`Skill("critical", "code")`) to each `pr-reviewer` call. |
| `/review-changes <PR-URL>` | Convergence loop on the specified PR (self or cross — `pr-reviewer` detects relation automatically). |

## What replaced `--comments`

The old `--comments` flag is gone.
Cross-review with line-level inline comments now lives in the `pr-reviewer` agent and is the default behaviour when a PR is passed.

There is no posting-authorization flag any more. `pr-reviewer` Step 4 posts a single
visible `COMMENT` review to `POST /repos/{owner}/{repo}/pulls/{n}/reviews`
unconditionally, in both relations — the old `--publish` token and the pending-review
workflow it gated are gone. Step 3 still prints the full proposal to the terminal
before Step 4 posts it, so you always see what was sent.
