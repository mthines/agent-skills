---
name: review-loop
description: >
  Bounded review-apply-resolve convergence loop for a GitHub PR (draft PRs are
  fine). Runs up to N=5 iterations of pr-reviewer → implement-suggestion
  (--resolve-all) → polish simplify, converging until every review thread is
  resolved — through a fix OR a reply (answered question, recorded rationale) —
  so the PR is left with zero open threads (only genuine human-judgment flags
  stay open). On convergence it also refreshes the PR description to match the
  shipped diff and, best-effort, notes the linked Linear ticket. Use after
  opening a draft PR to converge the branch to a clean, review-ready state
  before undrafting. Callers: autonomous-workflow Phase 6/7, create-pr
  (post-draft), and standalone via /review-changes. Invoke with
  /review-loop <PR-URL|#n> [--cap N] [--critical] [--no-feedback] [--no-refresh].
disable-model-invocation: false
argument-hint: '<PR-URL|#n> [--cap N] [--critical] [--no-feedback] [--no-refresh]'
license: MIT
metadata:
  author: mthines
  version: '1.2.0'
  workflow_type: command
  tags:
    - review
    - code-quality
    - simplify
    - convergence
    - thread-resolution
    - pr
    - orchestrator
---

# review-loop — Bounded Review-Apply-Resolve Convergence

Drive a PR from its initial draft state to a clean, review-ready state by
iterating `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify`
until **every review thread is resolved** or the cap is reached, then refresh the
PR description to match the shipped diff.

A thread is resolved when it is **either fixed** (a code change landed) **or
answered** (a reply — the answer to a question, the agent's take on a discussion,
or a rationale for a declined suggestion). The only threads left open at
convergence are genuine **human-judgment flags**: a real potential issue the
agent will neither auto-apply nor honestly decline. That safety valve means the
loop can never green-wash a PR by resolving a live finding — it surfaces it
instead.

This skill is an **orchestrator**.
It contains no quality rules of its own.
It sequences existing pieces, each owning its own domain:

1. `pr-reviewer` — finds issues (read-only; posts one `COMMENT` review; on a re-review resolves its own addressed threads).
2. `implement-suggestion --resolve-all` — applies actionable findings **and** replies-to-and-resolves the non-fix threads it can honestly close (single-shot, no `--watch`).
3. `Skill("polish", "simplify")` — applies Class M mechanical refactors behind a confidence gate.
4. On convergence — refreshes the PR description (via the shared description-contract) and, best-effort, notes the linked Linear ticket.

### Dispatch mechanics — read before invoking

`pr-reviewer` is an **agent**, not a skill. Dispatch it with the **Task tool**
(`Task(subagent_type="pr-reviewer", prompt="<PR-URL> [--critical]")`). **Do not** call
`Skill("pr-reviewer", …)` — there is no skill by that name and it errors with
`Unknown skill: pr-reviewer`.

**When sub-agent dispatch is unavailable.** Some harnesses disable the `Task`
tool, so that dispatch fails outright (`Failed to run agent`). `pr-reviewer` has
**no `Skill()` form and no in-context substitute** — its review independence comes
from running in a fresh, isolated context, so "play the role yourself" would
produce a self-review wearing a reviewer's label, which is worse than no review.

Check for it in [Step 0](#step-0-resolve-the-pr-and-preconditions) and **self-report
a clean skip** rather than letting the caller discover it as a mid-loop tool error:

```markdown
- [TIMESTAMP] review-loop — skipped (sub-agent dispatch unavailable; pr-reviewer requires it)
```

Return that skip as the loop's terminal result. Do **not** retry the dispatch and
do **not** silently continue to sub-steps B and C — without a review pass there are
no findings to apply, and running `polish simplify` alone would misreport an
unreviewed PR as converged.

The check is best-effort, not certain: there is no capability-introspection API, and
a refused dispatch may surface as an uncatchable harness error. Its value is
**placement** — one clean logged deviation at Step 0 instead of a mid-Phase-6 error
the caller has to interpret.

`implement-suggestion` and `polish` **are** skills — invoke them with `Skill(...)`.
If a given install has `implement-suggestion` set `disable-model-invocation: true`
(so `Skill("implement-suggestion")` is refused), fall back to applying its
contract inline: resolve a worktree at the PR head, apply the findings as
commit-per-comment, push, and reply-to-and-resolve the threads yourself (the
same work the skill's worker does) — never skip sub-step B silently.

## Modes

Parse the **first positional argument** as the PR reference.
Everything else is a flag.

| Flag | Effect |
| --- | --- |
| `--cap N` | Override the default iteration cap of 5. |
| `--critical` | Pass `--critical` to each `pr-reviewer` call (adversarial pre-mortem). |
| `--no-feedback` | Report-only. Forces `CAP=1` and skips sub-steps B, C, and the final refresh, so `pr-reviewer` runs once and its findings are reported without being applied, resolved, or pushed. |
| `--no-refresh` | Run the convergence loop as normal but skip the final PR-description refresh and Linear note. |

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
OWNER="${RESOLVED_REPO%/*}"
REPO="${RESOLVED_REPO#*/}"
```

If no PR reference is found, abort: `review-loop requires a PR URL or #<n>.`

**Precondition — sub-agent dispatch.** The loop's first sub-step dispatches the
`pr-reviewer` agent, which has no non-`Task` substitute (see
[Dispatch mechanics](#dispatch-mechanics--read-before-invoking)). Confirm the `Task`
tool is available **before** entering the loop; if it is not, emit the skip line from
that section and return, without running sub-steps B or C on their own.

Parse the flags and set the iteration cap:

```bash
# Parse flags out of the argument string.
cap_flag=""
CRITICAL=0
NO_FEEDBACK=0
NO_REFRESH=0

# --cap N: override the default iteration cap (accepts "--cap 5" or "--cap=5").
if [[ " $ARGUMENTS " =~ [[:space:]]--cap[[:space:]=]+([0-9]+) ]]; then
  cap_flag="${BASH_REMATCH[1]}"
fi

# --critical: pass the adversarial pre-mortem through to each pr-reviewer call.
if [[ " $ARGUMENTS " == *" --critical "* ]]; then
  CRITICAL=1
fi

# --no-refresh: skip the final PR-description refresh + Linear note.
if [[ " $ARGUMENTS " == *" --no-refresh "* ]]; then
  NO_REFRESH=1
fi

CAP=${cap_flag:-5}
ITERATION=0

# --no-feedback degrades the loop to a single read-only review pass.
if [[ " $ARGUMENTS " == *" --no-feedback "* ]]; then
  NO_FEEDBACK=1
  CAP=1
  NO_REFRESH=1
fi
```

A helper for the exit check — the count of **unresolved** review threads:

```bash
unresolved_thread_count() {
  gh api graphql -f query='
    query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100){ nodes{ isResolved } }
        }
      }
    }' -F owner="$OWNER" -F repo="$REPO" -F pr="$PR_NUMBER" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
}
```

### Step 1: Loop — review → apply+resolve → simplify

Each iteration runs three sub-steps.
The loop exits when **every review thread is resolved** (`unresolved_thread_count == 0`),
when an iteration makes **no progress** (the only threads left are ones nothing can
resolve — human-judgment flags), or at the cap.

When `NO_FEEDBACK == 1`, only sub-step A runs: sub-steps B and C are skipped, the
push and the refresh are skipped, and the run reports the findings without applying
anything.

```text
APPLIED_TOTAL = 0
while ITERATION < CAP:
    ITERATION += 1

    # Sub-step A: review — always the first thing each iteration runs, so the
    # loop always ENDS on a review pass that validates the previous iteration's
    # fixes and resolves this agent's now-addressed threads. This is the
    # "last review just resolves comments and makes no changes" convergence pass.
    review = Task(subagent_type="pr-reviewer",
                  prompt="<PR-URL>" + (" --critical" if CRITICAL == 1 else ""))
    # pr-reviewer is an AGENT — dispatch via the Task tool, NOT Skill("pr-reviewer").
    # On a re-review, pr-reviewer resolves its own addressed threads (thread-resolution.md).

    if NO_FEEDBACK == 1:
        break   # report-only: never apply, never resolve, never simplify, never push

    # CLEAN CONVERGENCE EXIT — the only exit that means "done":
    if pr-reviewer found no new actionable findings AND unresolved_thread_count() == 0:
        break   # every thread resolved (fix or reply) and nothing new to fix

    unresolved_before = unresolved_thread_count()

    # Sub-step B: apply findings AND resolve non-fix threads
    Skill("implement-suggestion", "<PR-URL> --resolve-all")
    # If this install has implement-suggestion set disable-model-invocation:true,
    # Skill() is refused — use the inline fallback from "Dispatch mechanics" above
    # (apply commit-per-comment, push, reply-and-resolve yourself). Never skip B.
    # Single-shot apply — no --watch; the loop drives re-review itself.
    # --resolve-all: fixes what it can, and replies-to-and-resolves questions /
    # discussions / declined suggestions; leaves only human-judgment flags open.
    APPLIED_TOTAL += (applies + answers this iteration, from its report)

    # Sub-step C: simplify
    Skill("polish", "simplify")
    # Applies Class M mechanical refactors; never runs the reviewer pass.

    push any local changes:
    git push

    # No-progress guard: nothing was applied or answered AND the open-thread
    # count did not drop → the remaining threads are human-judgment flags the
    # loop cannot resolve. Stop early rather than spinning to the cap. (The clean
    # convergence exit above stays the normal path — it runs one more review pass
    # to validate before declaring done.)
    if this iteration applied 0, answered 0, and unresolved_thread_count() >= unresolved_before:
        break

if ITERATION == CAP and unresolved_thread_count() > 0:
    report: cap reached, threads still open, surface the remaining blockers/flags
```

**Hard rule: the only permitted `polish` invocation is `Skill("polish", "simplify")`.**
The `simplify` mode applies Class M mechanical refactors and dispatches no pr-reviewer.
All other `polish` modes trigger an internal agent pass, which would create a dispatch cycle.
This is the anti-circularity guarantee.

### Step 2: Refresh the PR description and Linear note (on convergence)

Skip this step entirely when `NO_REFRESH == 1`, when `NO_FEEDBACK == 1`, or when
`APPLIED_TOTAL == 0` (the loop changed no code, so the description cannot have drifted).

Otherwise, refresh the PR body so it matches the diff that actually shipped after
the loop's fixes:

1. Regenerate the title and body following the shared
   [`description-contract.md`](../../delivery/create-pr/rules/description-contract.md)
   — the same contract `create-pr` uses, so the refresh keeps identical quality and
   length rules. Diff against the PR base and read the current body first; make it a
   minimal edit, not a rewrite.
2. Apply it:

   ```bash
   gh pr edit "$PR_NUMBER" --repo "$RESOLVED_REPO" --body "$(cat <<'EOF'
   <refreshed narrative body>
   EOF
   )"
   ```

Then, **best-effort**, note the linked Linear ticket (skip silently if any part is absent):

- Detect a ticket from the branch name (`.../ABC-123-...`), the PR title/body, or `gh pr view`.
- If a ticket id is found **and** the Linear MCP tools are connected, post a short comment on the ticket linking the PR and stating that review converged (e.g. `Review loop converged — PR <url> ready for review.`).
- Any failure here (no ticket, no MCP, API error) is logged and never fails the loop.

### Step 3: Report

After the loop exits (converged, no-progress, or at cap), emit a compact summary:

```text
review-loop on PR #<n> (<RESOLVED_REPO>)

Iterations: <N> of <CAP>
Stop reason: <all-threads-resolved | no-progress (flags remain) | cap-reached | report-only (--no-feedback) | skipped (sub-agent dispatch unavailable)>

Per-iteration summary:
  Iteration 1: <verdict>, <N findings>, <M applied>, <A answered/resolved>, <K simplify recipes>, <U threads still open>
  Iteration 2: ...

Open threads at exit: <count>
  - <one line per still-open human-judgment flag / unresolved blocker>

PR description: <refreshed | unchanged (no code applied) | skipped (--no-refresh)>
Linear note: <posted <ticket> | no ticket linked | Linear MCP unavailable | skipped>

Final pr-reviewer verdict: <PASS | FAIL>
Head commit: <sha>
```

Surface remaining open threads prominently if the cap was reached or the
no-progress guard tripped. Do not silently drop them — an open thread at exit is
a human-judgment flag the user must resolve.

## Hard rules

- **The only permitted `polish` invocation is `Skill("polish", "simplify")`.** Non-simplify modes trigger an internal agent pass and create a dispatch cycle.
- **Convergence never green-washes.** The loop resolves a thread only via a fix or an honest reply. A live finding the agent cannot fix or honestly decline stays open and is surfaced — the loop never resolves it to terminate. This is `implement-suggestion --resolve-all`'s safety valve, inherited here.
- **Never write to GitHub directly, except the Step 2 description refresh.** `pr-reviewer` posts the `COMMENT` review and `implement-suggestion` resolves threads; this skill orchestrates. The one direct write it owns is the final `gh pr edit --body` refresh.
- **Never undraft the PR.** This skill converges; the user makes the final undraft decision.
- **One `implement-suggestion` per iteration, no `--watch`.** The loop drives re-review; `--watch` waits for external bots and would conflict.
- **Cap is a hard limit.** If threads are still open at the cap, surface them and stop. Do not extend the cap silently.

## Relationship to other skills

| Skill | Relationship |
| --- | --- |
| `pr-reviewer` | Sub-step A: the find pass (read-only); resolves its own addressed threads on re-review; this skill drives re-review between iterations. |
| `implement-suggestion --resolve-all` | Sub-step B: the apply + resolve pass; invoked single-shot (no `--watch`) with `--resolve-all` so non-fix threads (questions, discussions, declines) are answered and resolved. |
| `polish simplify` | Sub-step C: the cleanup pass; only the simplify mode, never full `polish`. |
| `create-pr` description-contract | Step 2 reuses [`description-contract.md`](../../delivery/create-pr/rules/description-contract.md) for the PR-description refresh — single source of truth with `create-pr`. |
| `polish` (bare) | **Downstream, not a caller.** `polish`'s Pass A invokes `pr-reviewer` directly and never calls `review-loop`; this loop only invokes `Skill("polish", "simplify")`. |
| `create-pr` | Upstream caller — delegates post-draft review to `review-loop` after opening the draft PR. |
| `autonomous-workflow` Phase 6/7 | Invokes `review-loop` in place of the retired `reviewer` agent dispatches. |
| `review-changes` | Routes to `review-loop` as the primary convergence entry point. |
