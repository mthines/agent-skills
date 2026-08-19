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
  before undrafting. Also converges CI: after each iteration's push it reads the
  check state and delegates a red mechanical failure to ci-auto-fix, so
  convergence means zero open threads AND CI not red (--no-ci opts out; create-pr
  and autonomous-workflow pass it because they own their own CI phase). With
  --external-review the reviewer is out-of-process: sub-step A waits on the
  shared review-activity poll for another agent's review instead of dispatching
  pr-reviewer, which also makes the loop usable where the Task tool is disabled.
  Caller contract: this is an orchestrator whose first sub-step is a delegation,
  so it must run at the TOP LEVEL of a session that still holds the Task tool —
  never dispatch it into a sub-agent, which cannot delegate further and can only
  skip at iteration 0.
  Callers: autonomous-workflow Phase 6/7, create-pr (post-draft), and standalone
  via /review-changes. Invoke with /review-loop <PR-URL|#n> [--cap N]
  [--critical] [--external-review] [--interval S] [--no-ci] [--no-feedback]
  [--no-refresh].
disable-model-invocation: false
argument-hint: '<PR-URL|#n> [--cap N] [--critical] [--external-review] [--interval S] [--no-ci] [--no-feedback] [--no-refresh]'
license: MIT
metadata:
  author: mthines
  version: '1.4.0'
  workflow_type: command
  tags:
    - review
    - code-quality
    - simplify
    - convergence
    - thread-resolution
    - pr
    - orchestrator
    - ci
    - external-review
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
4. `ci-auto-fix` — diagnoses and fixes a red check after the iteration's push (skipped under `--no-ci`).
5. On convergence — refreshes the PR description (via the shared description-contract) and, best-effort, notes the linked Linear ticket.

Under `--external-review`, step 1 is replaced by a **wait**: the reviewer is
another process (a review bot, a CI-triggered agent, a teammate), and the loop
polls for its output instead of producing its own. Steps 2–5 are unchanged —
they consume threads from GitHub and do not care who wrote them.

### Dispatch mechanics — read before invoking

`pr-reviewer` is an **agent**, not a skill. Dispatch it with the **Task tool**
(`Task(subagent_type="pr-reviewer", prompt="<PR-URL> [--critical]")`). **Do not** call
`Skill("pr-reviewer", …)` — there is no skill by that name and it errors with
`Unknown skill: pr-reviewer`.

#### Caller contract — run this loop at the top level, never inside a sub-agent

This skill is an orchestrator whose **first sub-step is itself a delegation**. It
must therefore be invoked from a context that still holds the `Task` tool. Most
harnesses give a dispatched sub-agent no `Task` tool at all (Dash0 Agent0
sub-agents cannot delegate further, by platform design), so a caller that
dispatches this loop into a sub-agent spends the run's delegation budget one level
too high and leaves the loop with nothing to dispatch `pr-reviewer` with. The loop
then has exactly one honest outcome: a skip at iteration 0, with the PR unreviewed.

```text
# WRONG — the loop arrives without Task and can only skip at iteration 0
Task(subagent_type="general", prompt="Run /review-loop <PR-URL>")

# RIGHT — the caller runs the loop itself and spends Task on the agents it needs
Skill("review-loop", "<PR-URL>")        # → the loop dispatches pr-reviewer via Task
```

A caller that can make **only one** dispatch has two supported shapes, in
preference order:

| Shape | What the caller does | Consequence |
| --- | --- | --- |
| **Own the loop** (preferred) | Run this procedure at the top level and spend the delegation budget on `pr-reviewer` / `implement-suggestion` | The only shape in which the loop can converge a PR |
| **Delegate with `--external-review`** | Dispatch the loop *with `--external-review` passed deliberately by the caller*, never invented by the callee | No `pr-reviewer` pass happens: a fix-and-polish loop over someone else's review |

**One skip is conclusive — never retry the dispatch.** A missing `Task` tool is a
property of the dispatch topology, decided before any code is read; a second
attempt re-derives a platform fact at the cost of a full round trip and cannot
change the outcome.

**When sub-agent dispatch is unavailable.** Some harnesses disable the `Task`
tool, so that dispatch fails outright (`Failed to run agent`). `pr-reviewer` has
**no `Skill()` form and no in-context substitute** — its review independence comes
from running in a fresh, isolated context, so "play the role yourself" would
produce a self-review wearing a reviewer's label, which is worse than no review.

Check for it in [Step 0](#step-0-resolve-the-pr-and-preconditions) and **self-report
a clean skip** rather than letting the caller discover it as a mid-loop tool error:

Two causes produce the same missing tool, and they get **different skip lines**
because they have different fixes. Report the one you can evidence; when you cannot
tell them apart, report the harness line:

| Cause | How you know | Skip line |
| --- | --- | --- |
| **Nested dispatch** (caller error, fixable today) | You are running as a dispatched sub-agent — the caller's prompt dispatched this loop rather than running it | `skipped (nested dispatch — review-loop must run at the top level; the caller consumed the delegation budget)` |
| **Harness disables `Task`** (environment) | This is the top-level session and `Task` is still absent from the tool set | `skipped (sub-agent dispatch unavailable; pr-reviewer requires it)` |

```markdown
- [TIMESTAMP] review-loop — skipped (nested dispatch — review-loop must run at the top level; the caller consumed the delegation budget). Have the caller run the loop itself, or dispatch it with --external-review.
- [TIMESTAMP] review-loop — skipped (sub-agent dispatch unavailable; pr-reviewer requires it)
```

Return that skip as the loop's terminal result. Do **not** retry the dispatch and
do **not** silently continue to sub-steps B and C — without a review pass there are
no findings to apply, and running `polish simplify` alone would misreport an
unreviewed PR as converged.

**`--external-review` is the exception, and the graceful-degradation path.** In
that mode the loop never dispatches `pr-reviewer`, so this precondition does not
apply and **must not** fire: the review comes from another process that has
already written to GitHub. A harness with `Task` disabled can therefore still run
the loop — suggest `--external-review` in the skip line rather than presenting the
skip as the only outcome:

```markdown
- [TIMESTAMP] review-loop — skipped (sub-agent dispatch unavailable; pr-reviewer requires it). Re-run with --external-review if another agent reviews this PR.
```

One caveat to state plainly: sub-step B (`implement-suggestion`) dispatches a
**worker** subagent of its own, which also wants `Task`. Its documented inline
fallback (apply commit-per-comment, push, reply-and-resolve yourself) covers that
case — see the paragraph below. `--external-review` removes the `pr-reviewer`
dependency, not every sub-agent dependency.

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
| `--external-review` | Replace sub-step A: wait for an **out-of-process** reviewer instead of dispatching `pr-reviewer`. See [Sub-step A — external-review mode](#sub-step-a--external-review-mode). |
| `--interval S` | Poll interval in seconds for `--external-review`, default `300`, **clamped to `540`**. Ignored without `--external-review`. |
| `--no-ci` | Skip sub-step D (the CI pass). Callers that own their own CI phase pass this — `create-pr` (Steps 7–9) and `autonomous-workflow` (Phase 7) both do. |

**Incompatible combinations**, refused or downgraded at Step 0:

| Combination | Behaviour |
| --- | --- |
| `--external-review` + `--no-feedback` | **Refuse.** `--no-feedback` means "run `pr-reviewer` once and report"; with no `pr-reviewer` there is nothing to report. Print `--no-feedback needs pr-reviewer; drop --external-review or drop --no-feedback.` and exit. |
| `--external-review` + `--critical` | **Warn and ignore.** `--critical` only ever fed `pr-reviewer`. Print one line noting it was ignored, then continue — callers pass it by habit and it must not abort the run. |

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

**Precondition — sub-agent dispatch (best-effort).** The loop's first sub-step dispatches
the `pr-reviewer` agent, which has no non-`Task` substitute (see
[Dispatch mechanics](#dispatch-mechanics--read-before-invoking)). Before entering the
loop, check whether `Task` appears in your available tools; if it plainly does not,
emit the skip line from that section and return, without running sub-steps B or C.
Pick the skip line by cause — **nested dispatch** when you are running as a
dispatched sub-agent, the harness line otherwise — and do **not** retry the
dispatch: one missing-`Task` return is conclusive.

**Skip this precondition entirely when `--external-review` is set** — that mode
dispatches no `pr-reviewer`, so a missing `Task` tool is not disqualifying.

**This check cannot be made certain**, and the contract does not pretend otherwise:
there is no capability-introspection API, and on some harnesses a refused dispatch
surfaces as an uncatchable error rather than a return value. When the check is
inconclusive, attempt the dispatch — and if it fails, emit the same skip line rather
than retrying or working around it. The value is **placement**: one clean logged
deviation instead of a mid-Phase-6 error the caller must interpret.

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

# --external-review: sub-step A waits for an out-of-process reviewer.
EXTERNAL_REVIEW=0
if [[ " $ARGUMENTS " == *" --external-review "* ]]; then
  EXTERNAL_REVIEW=1
fi

# --interval S: poll interval for --external-review. Clamp to 540 (below the
# 600 s Bash tool cap) exactly as watch-mode does; values above are clamped
# silently.
INTERVAL=300
if [[ " $ARGUMENTS " =~ [[:space:]]--interval[[:space:]=]+([0-9]+) ]]; then
  INTERVAL="${BASH_REMATCH[1]}"
fi
[ "$INTERVAL" -gt 540 ] && INTERVAL=540

# --no-ci: skip sub-step D. Callers owning their own CI phase pass this.
NO_CI=0
if [[ " $ARGUMENTS " == *" --no-ci "* ]]; then
  NO_CI=1
fi

CAP=${cap_flag:-5}
ITERATION=0

# --no-feedback degrades the loop to a single read-only review pass.
if [[ " $ARGUMENTS " == *" --no-feedback "* ]]; then
  NO_FEEDBACK=1
  CAP=1
  NO_REFRESH=1
fi

# Refuse the one combination that cannot mean anything: report-only needs a
# reviewer to report, and --external-review removes the only one this loop owns.
if [ "$EXTERNAL_REVIEW" -eq 1 ] && [ "$NO_FEEDBACK" -eq 1 ]; then
  echo "--no-feedback needs pr-reviewer; drop --external-review or drop --no-feedback."
  exit 1
fi

# --critical only ever fed pr-reviewer. Warn, do not abort — callers pass it by habit.
if [ "$EXTERNAL_REVIEW" -eq 1 ] && [ "$CRITICAL" -eq 1 ]; then
  echo "note: --critical ignored under --external-review (it only configures pr-reviewer)."
  CRITICAL=0
fi
```

> **Naming.** `NO_FEEDBACK` here is the **report-only mode flag** (`--no-feedback`).
> The shared review-activity poll emits an outcome string also spelled
> `NO_FEEDBACK`, meaning "no new review activity this interval". They are
> unrelated. Sub-step A below reads the poll's result into `POLL_RESULT`
> (`new` / `quiet` / `error`) and never into this variable.

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

Each iteration runs up to four sub-steps.
The loop exits when **every review thread is resolved** (`unresolved_thread_count == 0`)
**and CI is settled** (green, pending, or absent — never red), when an iteration makes
**no progress** (the only threads left are ones nothing can resolve — human-judgment
flags), or at the cap.

When `NO_FEEDBACK == 1`, only sub-step A runs: sub-steps B and C are skipped, the
push and the refresh are skipped, and the run reports the findings without applying
anything.

```text
APPLIED_TOTAL = 0
CI_HANDOFFS   = 0
CI_STATE      = "unread"     # no check state observed yet this run
while ITERATION < CAP:
    ITERATION += 1

    # Sub-step A: review — always the first thing each iteration runs, so the
    # loop always ENDS on a review pass that validates the previous iteration's
    # fixes and resolves this agent's now-addressed threads. This is the
    # "last review just resolves comments and makes no changes" convergence pass.
    if EXTERNAL_REVIEW == 0:
        review = Task(subagent_type="pr-reviewer",
                      prompt="<PR-URL>" + (" --critical" if CRITICAL == 1 else ""))
        # pr-reviewer is an AGENT — dispatch via Task, NOT Skill("pr-reviewer").
        # On a re-review it resolves its own addressed threads (thread-resolution.md).
        NEW_FINDINGS = (pr-reviewer reported new actionable findings)
    else:
        POLL_RESULT = shared review-activity poll, bounded by INTERVAL   # new | quiet | error
        if POLL_RESULT == "error":
            abort → stop reason "poll error"      # a broken probe is NEVER "quiet"
        if POLL_RESULT == "quiet" and ITERATION > 1:
            NEW_FINDINGS = false                  # reviewer silent → fall to the exit below
        else:
            NEW_FINDINGS = true                   # iter 1 always runs a pass

    if NO_FEEDBACK == 1:
        break   # report-only: never apply, never resolve, never simplify, never push

    # CLEAN CONVERGENCE EXIT — the only exit that means "done":
    # ci_is_settled() reads check state on demand when CI_STATE is still "unread"
    # (iteration 1 can reach this exit before sub-step D has ever run), so the
    # loop can never converge on a build it has not looked at.
    if NEW_FINDINGS == false AND unresolved_thread_count() == 0 AND ci_is_settled():
        break   # every thread resolved (fix or reply), nothing new to fix, CI not red

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

    # Sub-step D: CI. Read check state at the CURRENT REMOTE HEAD, then delegate
    # a red mechanical failure to ci-auto-fix. Skipped under --no-ci.
    if NO_CI == 0:
        CI_STATE = read check state (stateless query, no watch)   # green|pending|red|error
        if CI_STATE == "error":
            # Tooling failure, not "no CI" and not a red build. Same verdict as
            # ci_is_settled()'s error arm: never route to ci-auto-fix, never converge.
            break   # stop reason "ci-error"; report the query failure and escalate
        if CI_STATE == "red" and CI_HANDOFFS < 2:
            dispatch ci-auto-fix as a subagent; CI_HANDOFFS += 1
            CI_STATE = "unread"   # the handoff pushed a fix, so the recorded red
                                  # describes a commit that is no longer head.
                                  # ci_is_settled()'s unread arm re-reads it.

    # No-progress guard: nothing was applied or answered AND the open-thread
    # count did not drop → the remaining threads are human-judgment flags the
    # loop cannot resolve. Stop early rather than spinning to the cap. (The clean
    # convergence exit above stays the normal path — it runs one more review pass
    # to validate before declaring done.)
    # CI is deliberately part of "progress": a red-CI iteration that fixed nothing
    # else still made progress if ci-auto-fix pushed, so the loop gets to re-review.
    if this iteration applied 0, answered 0, dispatched no ci-auto-fix,
       and unresolved_thread_count() >= unresolved_before:
        break

if ITERATION == CAP:
    # NO_FEEDBACK == 1 forces CAP=1, so this branch is always taken on a
    # report-only run — which broke out at the top having pushed nothing. There is
    # no head of this loop's making to read CI at, so gate on it as well as NO_CI.
    if CI_STATE == "unread" and NO_CI == 0 and NO_FEEDBACK == 0:
        CI_STATE = read check state   # never report a state you have not read at head
    if unresolved_thread_count() > 0 or CI_STATE == "red":   # CI_STATE stays "unread" under --no-ci
        report: cap reached; surface remaining blockers/flags AND any red check
```

### Sub-step A — external-review mode

Under `--external-review` the loop produces no review of its own. It waits for one.

Run the shared [review-activity poll](../../../agents/shared/rules/review-activity-poll.md#the-poll)
with `SINCE` = the current baseline and `INTERVAL` as parsed at Step 0. That file
owns the procedure — call it, never restate it. Issue its Bash call with the tool
parameter `timeout: 600000`; the `--interval` clamp to 540 at Step 0 is what keeps
the loop's own bound reachable underneath it.

Map its [caller-neutral outcomes](../../../agents/shared/rules/review-activity-poll.md#outcomes-caller-neutral)
into `POLL_RESULT`:

| Poll outcome | `POLL_RESULT` | This loop does |
| --- | --- | --- |
| `NEW_FEEDBACK` | `new` | Run the iteration (sub-steps B, C, D) |
| `NO_FEEDBACK` | `quiet` | **Iteration 1:** run a pass anyway — the external reviewer may have reviewed before the loop started, and exiting here would converge a PR having done nothing. **Later iterations:** the reviewer is quiet; fall through to the convergence exit |
| `POLL_ERROR` | `error` | **Abort** with stop reason `poll error`. Report the stderr. A broken probe is never "the reviewer had nothing to say" — treating it as quiet would report a never-reviewed PR as converged |

**Advance the baseline after every pass**, exactly as the shared rule requires: set
`SINCE` to "now" once sub-steps B–D complete, so the next wait sees only what the
reviewer posted in response to the latest push. Leaving `SINCE` at its original
value re-reports the same review forever and the loop never reaches `quiet`.

What this mode does **not** change: sub-steps B, C, and D are byte-identical. They
read threads from GitHub and neither know nor care which process authored them.
`unresolved_thread_count()` is the same query, and the no-green-wash safety valve
is untouched — a live finding the agent cannot fix or honestly decline still stays
open, whoever raised it.

There is **no verdict** in this mode. `pr-reviewer`'s `PASS`/`FAIL` has no source
here, so the report prints `n/a (external review)` rather than inventing one.

### Sub-step D — CI

Skipped entirely when `--no-ci` is set.

After the iteration's push, read the check state **once** — stateless, at the
current remote head, no watch:

```bash
gh pr checks "$PR_NUMBER" --repo "$RESOLVED_REPO"
```

This is a **query, not a watch**: it adds no `gh … --watch` site and spends nothing
from the watch budgets that
[`create-pr` Step 9](../../delivery/create-pr/SKILL.md) and
[`phase-7-ci-gate.md`](../../workflow/autonomous-workflow/rules/phase-7-ci-gate.md)
each count inside their own invocation. `ci-auto-fix` likewise keeps its own local
counter, so delegating to it stays inside the existing contract — no budget is
shared, and none is carried across contexts.

Classify with the same three-way rule as `phase-7-ci-gate.md` Step 1 — **"no checks
reported" is three different states**, and a bare `gh pr checks` **exits non-zero
while merely pending**, printing to stdout, so non-zero with empty stderr means
"registered and running", not an error:

| Check state | `CI_STATE` | This loop does |
| --- | --- | --- |
| All terminal and passing | `green` | Nothing. Convergence may proceed |
| Any still pending | `pending` | Nothing this iteration — do **not** wait. A *continuing* loop re-reads it next iteration; a loop that exits here does not, so `pending` can be the state it converges on |
| Any check failing | `red` | Dispatch `ci-auto-fix` as a subagent (its output is loud and belongs out of this context), unless `CI_HANDOFFS` is already 2 |
| Query errored (exit 127, or stderr naming auth / network / rate limit / not-logged-in) | `error` | **Tooling failure, not "no CI".** Report and escalate. Never route to `ci-auto-fix` |
| Nothing reported, query succeeded, and this iteration just pushed | — | Not registered yet. Run the shared [registration poll](../../delivery/create-pr/rules/registration-poll.md#the-poll) and re-classify from its outcome; `no-ci` means this repo genuinely has no CI, and counts as `green` for convergence |

```text
ci_is_settled():   # the convergence predicate
    NO_CI == 1                      → true    # caller owns CI; not this loop's call
    CI_STATE == "unread"            → read check state now, then re-evaluate
    CI_STATE == "green"             → true
    CI_STATE == "pending", 1st time → re-read at head once, then re-evaluate
    CI_STATE == "pending", re-read  → true    # not red, and this loop never waits for CI
    CI_STATE == red                 → false
    CI_STATE == error               → abort, do not converge
```

The `"pending"` re-read is the same rule
[`watch-mode.md`](../../workflow/implement-suggestion/rules/watch-mode.md#ci-state-is-a-stop-reason-not-a-fix)
applies before its own stop, and it exists for the same reason: sub-step D reads seconds
after its own push, so `pending` is its usual answer, and converging on the first one means
converging on a build no check has finished. Exactly **one** re-read, and only at this
predicate — re-reading until a check is terminal would turn a loop that must never wait for
CI into a busy-wait on it.

The `"unread"` arm matters: iteration 1 can reach the convergence exit before
sub-step D has run even once (a PR that arrives already reviewed and thread-clean).
Without that arm the loop would report convergence having never looked at CI —
the precise failure this sub-step exists to prevent.

It is also the arm that keeps a `red` from going stale. A `ci-auto-fix` handoff
pushes a fix, so the `red` sub-step D just recorded describes a commit that is no
longer head; the handoff therefore resets `CI_STATE` to `"unread"`, and the next
`ci_is_settled()` re-reads instead of blocking convergence on a build that is
already fixed. The cap check does the same read for the same reason — the loop
never reports a CI state it has not read at the current head.

**Cap: 2 `ci-auto-fix` handoffs per `review-loop` run** (`CI_HANDOFFS`), matching the
per-PR cap the other two orchestrators use. Each handoff already burns a full internal
retry budget; do not wrap it in another loop. At the cap with CI still red, stop and
surface the failing checks — never extend it, and never converge a red PR silently.

**This loop never fixes CI itself.** It classifies and delegates. Every refusal in
[`ci-auto-fix`'s anti-patterns](../../delivery/ci-auto-fix/rules/anti-patterns.md)
holds transitively: no `--no-verify`, no `continue-on-error`, no skipped suites, no
weakened assertions to reach green.

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
Stop reason: <all-threads-resolved | no-progress (flags remain) | cap-reached | ci-red (cap on ci-auto-fix handoffs) | ci-error (check query failed) | poll error | report-only (--no-feedback) | skipped (sub-agent dispatch unavailable) | skipped (nested dispatch — must run at top level)>
# The two skipped tokens are distinct on purpose. A nested dispatch is a caller
# bug with a same-day fix; a disabled Task tool is the environment. Never report a
# skip as "report-only" because it is the nearest token — report-only means a
# review pass ran and its findings were not applied, which is the opposite of a
# PR that was never reviewed.
Review source: <pr-reviewer | external>
# No count on the external arm: the shared poll is a liveness probe and returns only
# NEW_FEEDBACK / NO_FEEDBACK / POLL_ERROR. It exposes no event count, and widening a
# shared contract with two callers for a report cosmetic is not worth it.

Per-iteration summary:
  Iteration 1: <verdict>, <N findings>, <M applied>, <A answered/resolved>, <K simplify recipes>, <U threads still open>
  Iteration 2: ...

Open threads at exit: <count>
  - <one line per still-open human-judgment flag / unresolved blocker>

CI at exit: <green | pending | red (<failing check names>) | error (<verbatim query failure>) | not run (--no-ci) | none on this repo>
  ci-auto-fix handoffs: <CI_HANDOFFS> of 2

PR description: <refreshed | unchanged (no code applied) | skipped (--no-refresh)>
Linear note: <posted <ticket> | no ticket linked | Linear MCP unavailable | skipped>

Final pr-reviewer verdict: <PASS | FAIL | n/a (external review)>
Head commit: <sha>
```

Surface remaining open threads prominently if the cap was reached or the
no-progress guard tripped. Do not silently drop them — an open thread at exit is
a human-judgment flag the user must resolve.

**A red check at exit gets the same treatment.** Name the failing checks and say
the loop stopped with CI red. Never describe such a run as converged — zero open
threads over a red build is not a review-ready PR.

## Hard rules

- **The only permitted `polish` invocation is `Skill("polish", "simplify")`.** Non-simplify modes trigger an internal agent pass and create a dispatch cycle.
- **This loop runs at the top level, never inside a sub-agent.** Its first sub-step is a delegation, so a caller that dispatches the loop instead of running it spends the delegation budget one level too high and the loop can only skip at iteration 0 ([Caller contract](#caller-contract--run-this-loop-at-the-top-level-never-inside-a-sub-agent)). A caller limited to one dispatch passes `--external-review` **deliberately** — the loop never adds that flag to itself.
- **One missing-`Task` skip is terminal.** Never retry the dispatch and never work around it: the tool's absence is fixed by the dispatch topology before any code is read, so a retry costs a round trip and returns the same answer.
- **A skip is never reported as convergence, and never as report-only.** Zero open threads plus green CI is not convergence when no review pass produced a verdict; say plainly that the loop did not run and the PR was not reviewed.
- **Convergence never green-washes.** The loop resolves a thread only via a fix or an honest reply. A live finding the agent cannot fix or honestly decline stays open and is surfaced — the loop never resolves it to terminate. This is `implement-suggestion --resolve-all`'s safety valve, inherited here.
- **Never write to GitHub directly, except the Step 2 description refresh.** `pr-reviewer` posts the `COMMENT` review and `implement-suggestion` resolves threads; this skill orchestrates. The one direct write it owns is the final `gh pr edit --body` refresh.
- **Never undraft the PR.** This skill converges; the user makes the final undraft decision.
- **One `implement-suggestion` per iteration, no `--watch`.** The loop drives re-review; `--watch` waits for external bots and would conflict.
- **Cap is a hard limit.** If threads are still open at the cap, surface them and stop. Do not extend the cap silently.
- **Convergence requires CI settled, not just threads resolved.** Unless `--no-ci` is set, a red check blocks the clean-convergence exit. Reporting zero open threads over a red build is the CI-shaped version of green-washing.
- **Never fix CI in this context.** Sub-step D classifies and delegates to `ci-auto-fix`; it applies no fix itself, and every `ci-auto-fix` refusal (no `--no-verify`, no `continue-on-error`, no skipped suites, no weakened assertions) holds transitively.
- **Never carry CI watch state — query it.** Sub-step D reads check state statelessly at the current remote head and writes nothing; it never records a verdict or a spent budget for another phase to inherit, and it never reintroduces a cross-phase watch-state file ([`diagnostic-surface.md`](../../workflow/autonomous-workflow/rules/diagnostic-surface.md) — *watch state is queried, never carried*). `CI_HANDOFFS` is counted inside this run only.
- **A failed poll is never a quiet reviewer.** Under `--external-review`, `POLL_ERROR` aborts with `poll error`. Converting a broken probe into "the reviewer had nothing to say" reports a never-reviewed PR as converged.
- **Never restate the shared poll.** `--external-review` calls [`review-activity-poll.md`](../../../agents/shared/rules/review-activity-poll.md); copying the block forks four correctness properties that are individually easy to drop.

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
| `ci-auto-fix` | Sub-step D: dispatched as a subagent on a red check, capped at 2 handoffs per run. Owns the fix; this loop only classifies and delegates. Skipped under `--no-ci`. |
| `review-activity-poll` | Shared rule owning the `--external-review` wait — [`agents/shared/rules/review-activity-poll.md`](../../../agents/shared/rules/review-activity-poll.md), co-owned with `implement-suggestion --watch`. |
| `implement-suggestion --watch` | **Sibling, never nested.** Both wait on an out-of-process reviewer via the shared poll; `--watch` is the thin one (apply + push + stop, and it reads CI only as a stop reason). This loop adds `--resolve-all`, simplify, CI delegation, and the description refresh. The hard rule *one `implement-suggestion` per iteration, no `--watch`* keeps them from stacking. |
