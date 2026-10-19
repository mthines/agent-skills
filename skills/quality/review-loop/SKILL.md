---
name: review-loop
description: >
  Bounded PR convergence loop: up to 5 iterations of pr-reviewer →
  implement-suggestion --resolve-all → polish simplify until every thread is
  fixed or answered and CI is not red, then a description refresh. Run it at
  the top level of a session with a dispatch tool; flags --ui (parallel
  ui-verify lane), --merge (squash on clean approval), --no-ci, --no-feedback;
  triggers on "/review-loop".
disable-model-invocation: false
argument-hint: '<PR-URL|#n> [--cap N] [--critical] [--no-ci] [--no-feedback] [--no-refresh] [--no-preview-run] [--ui] [--merge]'
license: MIT
metadata:
  author: mthines
  version: '2.1.0'
  workflow_type: command
  tags:
    - review
    - simplify
    - convergence
    - thread-resolution
    - pr
    - orchestrator
    - ci
    - merge
    - ui-verify
---

# review-loop — Bounded Review-Apply-Resolve Convergence

Iterate `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify` on a PR until **every review thread is resolved** and CI is not red, or the cap is reached; then refresh the PR description.
A thread is resolved by a **fix** or an honest **reply**; only genuine human-judgment flags stay open, and the loop never resolves a live finding to terminate.
This skill is an orchestrator with no quality rules of its own.
Why it is shaped this way: [`references/design-rationale.md`](./references/design-rationale.md).

Each iteration runs sub-steps A (`pr-reviewer`), B (`implement-suggestion --resolve-all`), C (`polish simplify`), and D (`ci-auto-fix`); after the loop come Step 1.6 (preview run), Step 2 (description refresh), Step 2.5 (`--merge`), and Step 3 (report).

## Contents

- [Dispatch mechanics](#dispatch-mechanics--read-before-invoking)
- [Modes](#modes)
- [Step 0: Resolve the PR and preconditions](#step-0-resolve-the-pr-and-preconditions)
- [Step 1: Loop](#step-1-loop--review--applyresolve--simplify)
- [Sub-step A — the named dispatch](#sub-step-a--the-named-dispatch)
- [Iteration 1 — apply first](#iteration-1--apply-first-when-the-last-review-still-stands)
- [Sub-step D — CI](#sub-step-d--ci)
- [Step 1.6](#step-16-ui-verify-run-report-only-once-on-exit) · [Step 2](#step-2-refresh-the-pr-description-and-linear-note-on-convergence) · [Step 2.5](#step-25-merge-under---merge) · [Step 3](#step-3-report)
- [Hard rules](#hard-rules)

### Dispatch mechanics — read before invoking

`pr-reviewer` is an **agent**, not a skill: dispatch it with the harness's sub-agent dispatch tool (`Task(subagent_type="pr-reviewer", prompt="<PR-URL> [--critical]")`).
Never call `Skill("pr-reviewer", …)` — it errors with `Unknown skill: pr-reviewer`.
`implement-suggestion` and `polish` are skills: invoke them with `Skill(...)`.
If `Skill("implement-suggestion")` is refused (`disable-model-invocation: true`), apply its contract inline — resolve a worktree at the PR head, apply findings commit-per-comment, push, and reply-to-and-resolve the threads yourself; never skip sub-step B.

#### Dash0 Agent0 sandboxes

**Read linked files from the install, never from the imported folder.**
Agent0 can import a skill as its `SKILL.md` alone, with no `rules/`, `scripts/`, or sibling skills next to it.
So whenever `/tmp/workspace/agent-skills/env.sh` exists, whether it existed at start or the Step 0 row 4 install just wrote it:

1. Source it (`. /tmp/workspace/agent-skills/env.sh`) at the start of every Bash call. It exports `AGENT_SKILLS_ROOT` and `AGENT_SKILLS_COMMIT`.
2. Read every `rules/…` or `scripts/…` file this skill links from `$AGENT_SKILLS_ROOT/skills/review-loop/`, every sibling skill from `$AGENT_SKILLS_ROOT/skills/<name>/`, and every `agents/<path>` link from `$AGENT_SKILLS_ROOT/<path>`. Never read them relative to the folder this `SKILL.md` was loaded from.
3. When `$AGENT_SKILLS_ROOT/skills/review-loop/SKILL.md` differs from the copy you are running, or you cannot compare the two, re-read the installed copy and follow it from Step 0. **The installed copy at `$AGENT_SKILLS_COMMIT` wins**, even when that commit is older than the import, because the rules it links come from that same commit. Once you are following the installed copy, this check is satisfied.

When `/tmp/workspace/agent-skills/env.sh` exists, the loop runs in an Agent0 Automation sandbox, where `pr-reviewer` cannot be dispatched and `Skill()` cannot see a repo-owned skill.
**Read [`rules/agent0-runtime.md`](./rules/agent0-runtime.md) before Step 0.** It keeps every exit condition and substitutes how each sub-step is reached: sub-step A dispatches a `general` sub-agent pointed at the compiled `pr-reviewer` bundle, never a review in this context, and every `Skill("<name>")` becomes a read of the installed `SKILL.md`.
The sandbox is prepared by [`scripts/agent0-setup.sh`](../../../scripts/agent0-setup.sh), pasted as the automation's `sandbox.setupScript`.

An Agent0 session that ran **no** setup script (the generic automation answering a `/review-loop` comment, or an unprepared chat thread) has neither that file nor the bundle, and its dispatch tool offers `explore` and `general`.
Step 0 does **not** skip there: it recognises the host by `/tmp/workspace`, or by `/tmp/.opencode/skills/` or `/tmp/.opencode/agents/general.md` when `/tmp/workspace` does not exist yet, and runs the [on-demand install block](#on-demand-install--step-0-row-4), which lives in this file so a `SKILL.md`-only import still reaches it.

#### The dispatch tool is a capability, not a fixed name

Every capability check in this file asks whether *any* sub-agent dispatch tool is present — `Task`, `Agent`, or another spelling — never whether one specific name is.

```text
# WRONG — a name check; on a harness that spells it `Agent` this skips a reviewable PR
if "Task" not in available_tools: skip
# RIGHT
if no available tool dispatches a sub-agent (Task, Agent, or another spelling): degrade
```

#### Caller contract — run this loop at the top level, never inside a sub-agent

The loop's first sub-step is a delegation, and a dispatched sub-agent usually holds no dispatch tool, so a loop dispatched into a sub-agent can only skip at iteration 0.
A caller that can make only one dispatch runs this procedure itself and spends the budget on `pr-reviewer` / `implement-suggestion`.

```text
# WRONG — the loop arrives with no dispatch tool and can only skip at iteration 0
Task(subagent_type="general", prompt="Run /review-loop <PR-URL>")
# RIGHT — the caller runs the loop itself
Skill("review-loop", "<PR-URL>")        # → the loop dispatches pr-reviewer itself
```

`pr-reviewer` has **no `Skill()` form and no in-context substitute**: never review in the loop's own context.
A `general` sub-agent that reads the `pr-reviewer` definition is a reviewer route (Step 0 rows 2 and 4), because it runs in its own fresh context.

When Step 0 finds no reviewer route, or the row-4 install fails, read [`rules/dispatch-skips.md`](./rules/dispatch-skips.md): it picks the skip line, and the skip is the loop's terminal result — never retried, never followed by sub-steps B and C.

## Modes

Parse the **first positional argument** as the PR reference; everything else is a flag.

| Flag | Effect |
| --- | --- |
| `--cap N` | Override the default iteration cap of 5. |
| `--critical` | Pass `--critical` to each `pr-reviewer` call. |
| `--no-feedback` | Report-only: forces `CAP=1` and skips sub-steps B, C, D, and Step 2, so `pr-reviewer` runs once and its findings are reported unapplied. It never takes the apply-first skip. |
| `--no-refresh` | Skip Step 2 (description refresh and Linear note). |
| `--no-ci` | Skip sub-step D. `create-pr` and `autonomous-workflow` pass it (they own CI). |
| `--no-preview-run` | Skip Step 1.6. `autonomous-workflow` passes it; `create-pr` does not. |
| `--ui` | Run `ui-verify` against the live preview in a parallel lane and resolve its findings inside the loop; replaces Step 1.6. Read [`rules/ui-lane.md`](./rules/ui-lane.md) when `--ui` is set. |
| `--merge` | Squash-merge on a clean convergence, a `PASS` verdict, and green CI (Step 2.5). Read [`rules/merge.md`](./rules/merge.md) when `--merge` is set. |

Step 0 refuses `--ui` + `--no-feedback`, `--ui` + `--no-preview-run`, and `--merge` + `--no-feedback` (messages in the flag block).

## Procedure

### Step 0: Resolve the PR and preconditions

```bash
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

**Precondition — a reviewer route.** Resolve `REVIEWER_ROUTE` from capabilities, never from a tool name. Take the **first** row that matches:

| Row | Condition | `REVIEWER_ROUTE` | Sub-step A dispatches |
| --- | --- | --- | --- |
| 1 | No available tool dispatches a sub-agent | `none` | Nothing — emit the dispatch-unavailable or nested-dispatch skip line and return |
| 2 | `/tmp/workspace/agent-skills/env.sh` exists | `agent0` | A `general` sub-agent reading the `pr-reviewer` bundle — [`rules/agent0-runtime.md`](./rules/agent0-runtime.md), read from the install per [Dash0 Agent0 sandboxes](#dash0-agent0-sandboxes) |
| 3 | The dispatch tool's own list of agent types includes `pr-reviewer` | `named` | `pr-reviewer` |
| 4 | That list omits `pr-reviewer`, and the host is Agent0: `/tmp/workspace` or `/tmp/.opencode/skills` exists, or `/tmp/.opencode/agents/general.md` does | `agent0`, after the [on-demand install](#on-demand-install--step-0-row-4), which creates `/tmp/workspace` when absent | As row 2 |
| 5 | That list omits `pr-reviewer`, and none of row 4's Agent0 signals exists | `none` | Nothing — emit `skipped (pr-reviewer is not a dispatchable agent type here)` and return |

1. **Row 1.** A tool that takes a `subagent_type` (or equivalent agent-name) parameter is a dispatch tool whatever it is called; substitute its name wherever this file writes `Task(...)`. None → the nested-dispatch line when you are a dispatched sub-agent, the harness line otherwise.
2. **Row 2.** A prepared sandbox keeps the bundle route even if its setup also registered `pr-reviewer`. Source `env.sh` and apply the [installed-copy rule](#dash0-agent0-sandboxes) before sub-step A.
3. **Rows 3–5.** Read the agent types the dispatch tool publishes (its description or its `subagent_type` parameter); never test-dispatch to find out. When no list is visible, dispatch `pr-reviewer` once: a rejection naming the agent type (`Unknown agent type`, `not a valid agent type`) continues at rows 4–5, never a row-1 skip.
4. **Row 4.** Run the block below once, in this context. `/tmp/workspace/agent-skills/env.sh` existing afterwards is the only success test; otherwise emit the install-failed skip line and return — never retry, never review in this context instead.

#### On-demand install — Step 0 row 4

This block is owned here, not in a linked file, because a `SKILL.md`-only import
must still reach it. Why each line is there:
[`rules/agent0-runtime.md` § Install on demand](./rules/agent0-runtime.md#install-on-demand-when-the-marker-is-absent).

```bash
# review-loop Step 0 row 4: the marker is absent, the host is Agent0, and the
# dispatch tool's agent types omit pr-reviewer. Run once; never retry.
M=/tmp/workspace/agent-skills/env.sh
B=/tmp/workspace/.agent-skills-install
# Agent0 host: the workspace dir, or the opencode import tree of an unprepared
# sandbox. Neither present means a local machine: never install into /tmp there.
if [ -d /tmp/workspace ] || [ -d /tmp/.opencode/skills ] || [ -f /tmp/.opencode/agents/general.md ]; then A0=1; else A0=0; fi
if [ ! -f "$M" ] && [ "$A0" = 1 ]; then
  mkdir -p /tmp/workspace "$B" && rm -f "$B/AGENTS.md.before"
  # Leave the workspace AGENTS.md exactly as found.
  [ -e /tmp/workspace/AGENTS.md ] && cp -p /tmp/workspace/AGENTS.md "$B/AGENTS.md.before"
  rc=1
  if curl -fsSL --max-time 30 -o "$B/agent0-setup.sh" \
       https://raw.githubusercontent.com/mthines/agent-skills/main/scripts/agent0-setup.sh; then
    WITH_PLAYWRIGHT=0 timeout 300 bash "$B/agent0-setup.sh" > "$B/setup.log" 2>&1
    rc=$?
  else
    echo "could not download scripts/agent0-setup.sh" > "$B/setup.log"
  fi
  if [ -e "$B/AGENTS.md.before" ]; then
    cp -p "$B/AGENTS.md.before" /tmp/workspace/AGENTS.md
  else
    rm -f /tmp/workspace/AGENTS.md
  fi
  # A half-verified install must not leave the marker behind for the next run.
  [ "$rc" = 0 ] || rm -f "$M"
fi
if [ -f "$M" ]; then echo "INSTALL: ok"; else echo "INSTALL: failed — $(tail -n 1 "$B/setup.log" 2>/dev/null)"; fi
```

Read the outcome from the last line:

| Last line | Do |
| --- | --- |
| `INSTALL: ok` | Set `REVIEWER_ROUTE = agent0`, apply the [installed-copy rule](#dash0-agent0-sandboxes), read `/tmp/workspace/agent-skills/CONSTRAINTS.md` (this session loaded no `AGENTS.md` pointing at it), and continue as if the sandbox had been prepared. Report the review source as `installed on demand` |
| `INSTALL: failed — <reason>` | Emit `skipped (Agent0 install failed: <reason>)` and return. Never retry, and never review in this context instead |

Never conclude "no dispatch" from the absence of the name `Task`, and never conclude "no reviewer" from a dispatch tool that lacks the `pr-reviewer` type — rows 2–4 exist for that host.

Parse the flags and set the iteration cap:

```bash
cap_flag=""; CRITICAL=0; NO_FEEDBACK=0; NO_REFRESH=0; NO_CI=0; NO_PREVIEW_RUN=0; MERGE=0; UI=0
# --cap N accepts "--cap 5" or "--cap=5".
if [[ " $ARGUMENTS " =~ [[:space:]]--cap[[:space:]=]+([0-9]+) ]]; then
  cap_flag="${BASH_REMATCH[1]}"
fi
[[ " $ARGUMENTS " == *" --critical "* ]] && CRITICAL=1
[[ " $ARGUMENTS " == *" --no-refresh "* ]] && NO_REFRESH=1
[[ " $ARGUMENTS " == *" --no-ci "* ]] && NO_CI=1
[[ " $ARGUMENTS " == *" --no-preview-run "* ]] && NO_PREVIEW_RUN=1
[[ " $ARGUMENTS " == *" --merge "* ]] && MERGE=1
if [[ " $ARGUMENTS " == *" --ui "* ]]; then
  UI=1
fi

CAP=${cap_flag:-5}
ITERATION=0

# --no-feedback degrades the loop to a single read-only review pass.
if [[ " $ARGUMENTS " == *" --no-feedback "* ]]; then
  NO_FEEDBACK=1
  CAP=1
  NO_REFRESH=1
fi

if [ "$MERGE" -eq 1 ] && [ "$NO_FEEDBACK" -eq 1 ]; then
  echo "--merge needs the apply loop; drop --no-feedback."
  exit 1
fi
if [ "$UI" -eq 1 ] && [ "$NO_FEEDBACK" -eq 1 ]; then
  echo "--ui needs the apply loop; drop --no-feedback."
  exit 1
fi
if [ "$UI" -eq 1 ] && [ "$NO_PREVIEW_RUN" -eq 1 ]; then
  echo "--ui runs the preview verification; drop --no-preview-run."
  exit 1
fi
```

Under `--ui`, run [`rules/ui-lane.md`](./rules/ui-lane.md) Steps U0 and U1 now, before the loop: author the spec when the PR has none, and pick the lane mechanism.

The exit-check helper — the count of **unresolved** review threads:

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

The loop exits when every review thread is resolved **and** CI is settled (green, pending, or absent — never red), when an iteration makes no progress (only human-judgment flags remain), or at the cap.

```text
APPLIED_TOTAL = 0
CI_HANDOFFS   = 0
CI_STATE      = "unread"     # no check state observed yet this run
FINAL_VERDICT = "n/a"       # last pr-reviewer verdict; stays n/a until a review pass runs
APPLY_FIRST   = 0           # 1 when iteration 1 skipped sub-step A
PRIOR_SHA     = ""          # the commit the standing review judged — context.json .priorRun.priorSha
DESCRIPTION_REFRESHED = 0   # Step 2 sets 1 when it changed the PR body; Step 2.5 reads it
STOP_REASON   = "cap-reached"  # correct only when the while condition ends the loop;
                               # every break below overwrites it
while ITERATION < CAP:
    ITERATION += 1

    # --ui: read a finished lane run and launch one on a moved head — never blocks (ui-lane.md § Step U3).
    if UI == 1: ui_lane_tick()

    # Iteration 1 only — see "Iteration 1 — apply first when the last review still stands".
    if ITERATION == 1 and NO_FEEDBACK == 0:
        APPLY_FIRST = (context.json .mode == "zero-delta"
                       AND OPEN >= 1       # unresolved threads
                       AND REPLIED == 0)   # unresolved threads holding more than one comment

    # Sub-step A: review — first in every iteration except an iteration 1 that passed the check.
    if ITERATION == 1 and APPLY_FIRST == 1:
        NEW_FINDINGS = true   # the standing review's threads are the work; true also keeps
                              # iteration 1 off the convergence exit. FINAL_VERDICT stays "n/a".
    else:
        review = <dispatch>(subagent_type="pr-reviewer",
                      prompt="<PR-URL>" + (" --critical" if CRITICAL == 1 else ""))
        # <dispatch> is the dispatch tool Step 0 found. Never Skill("pr-reviewer").
        # REVIEWER_ROUTE == "named": sent as "Sub-step A — the named dispatch" describes.
        # AGENT0 == 1 (rules/agent0-runtime.md): subagent_type="general" with that rule's bundle-pointing prompt — never pr-reviewer, never a review in this context.
        # A refusal or BLOCKED reply is not a review: STOP_REASON = "reviewer-refused"; break.
        NEW_FINDINGS  = (pr-reviewer reported new actionable findings)
        FINAL_VERDICT = review.verdict   # PASS | WARN | FAIL — the --merge approval gate reads this

    if NO_FEEDBACK == 1:
        STOP_REASON = "report-only"
        break   # never apply, resolve, simplify, or push

    # CLEAN CONVERGENCE EXIT — the only exit that means "done".
    if NEW_FINDINGS == false AND unresolved_thread_count() == 0 AND ci_is_settled():
        # --ui: ui_settled() may block for the lane run on this head (ui-lane.md § Step U4);
        # when that run posted threads it sets NEW_FINDINGS = true and returns false.
        if UI == 0 or ui_settled():
            STOP_REASON = "all-threads-resolved"
            break
        if STOP_REASON == "ui-red":
            break   # the lane saw a red it could not post — report it, never converge over it

    unresolved_before = unresolved_thread_count()

    # Sub-step B: apply findings AND resolve non-fix threads (single-shot, never --watch).
    Skill("implement-suggestion", "<PR-URL> --resolve-all")
    APPLIED_TOTAL += (applies + answers this iteration, from its report)

    # Sub-step C: simplify
    Skill("polish", "simplify")

    push any local changes:
    git push

    # Sub-step D: CI at the CURRENT REMOTE HEAD; skipped under --no-ci.
    if NO_CI == 0:
        CI_STATE = read check state (stateless query, no watch)   # green|pending|red|error
        if CI_STATE == "error":
            STOP_REASON = "ci-error"
            break   # tooling failure: report verbatim, escalate, never ci-auto-fix
        if CI_STATE == "red" and CI_HANDOFFS < 2:
            dispatch ci-auto-fix as a subagent; CI_HANDOFFS += 1
            CI_STATE = "unread"   # the handoff pushed; the recorded red is no longer head
        elif CI_STATE == "red":
            STOP_REASON = "ci-red"
            break

    # No-progress guard: a ci-auto-fix handoff counts as progress.
    if this iteration applied 0, answered 0, dispatched no ci-auto-fix,
       and unresolved_thread_count() >= unresolved_before:
        STOP_REASON = "no-progress"
        break

# Post-loop. Gate on STOP_REASON, never on ITERATION == CAP.
if STOP_REASON in ("cap-reached", "no-progress"):
    # Neither exit ended on a review pass: read the state after the last push.
    if CI_STATE == "unread" and NO_CI == 0:
        CI_STATE = read check state
    if unresolved_thread_count() > 0 or CI_STATE == "red":   # CI_STATE stays "unread" under --no-ci
        report: <STOP_REASON>; surface remaining blockers/flags AND any red check
```

Never describe a `no-progress` or `cap-reached` exit as validated by a final review: the last thing that ran was a push.

### Sub-step A — the named dispatch

On `REVIEWER_ROUTE == "named"`, dispatch `pr-reviewer` exactly as the `pr-review` skill's Step 2 does, never as a bare single call; load that skill and follow it rather than restating it.
It adds:

1. **One prepare, shared, and cleaned up here.** Run `prepare-review.mjs` once per iteration and hand the reviewer `--context`; the intent worker reads the same context. On iteration 1 the [apply-first check](#iteration-1--apply-first-when-the-last-review-still-stands) reads it before anything is dispatched. Run `prepare-review.mjs --cleanup` once the iteration's dispatches return, or straight after the check when it skipped the dispatch.
2. **The intent worker, in the same message, when `context.budget.topology` is `hybrid`.** A re-review that routes `standard` or `quick` is `in-context` and sends the reviewer alone.
3. **A dispatch record and stamp** (`review-telemetry.mjs dispatch`, and `dispatched_at` in the intent dir).
4. **`--repo-dir <path>`, when a local clone of the PR's repository exists** and this session's cwd is not one (the session's own checkout when its `origin` is the PR's repo, or a clone the user named).

```text
# RIGHT — one message, both dispatches, as /pr-review Step 2 sends them
prepare-review.mjs --pr <PR-URL> --repo-dir <clone> --out <dir>/context.json → budget.topology == "hybrid"
<dispatch>(subagent_type="pr-reviewer", prompt="<PR-URL> --context <dir>/context.json --intent-from <dir>/intent/intent.json --repo-dir <clone>")
<dispatch>(subagent_type="general-purpose", prompt="<worker preamble> … read <dir>/context.json … act as the intent finder … write <dir>/intent/intent.json")
prepare-review.mjs --cleanup <dir>/context.json

# WRONG — a bare call: intent runs in-context, no load step, no local clone
<dispatch>(subagent_type="pr-reviewer", prompt="<PR-URL>")
```

### Iteration 1 — apply first when the last review still stands

At iteration 1, unless `NO_FEEDBACK == 1`, read [`rules/apply-first.md`](./rules/apply-first.md) and run its one-Bash-call check before sub-step A.
It skips sub-step A only when all five conditions hold — `ITERATION == 1`, `NO_FEEDBACK == 0`, `context.json` `.mode == "zero-delta"`, `OPEN >= 1`, `REPLIED == 0` — and any failed read leaves `APPLY_FIRST=0`.

### Sub-step D — CI

When `NO_CI == 0`, read [`rules/ci.md`](./rules/ci.md) before the first sub-step D: it classifies the stateless `gh pr checks` read into `green | pending | red | error`, delegates a red check to `ci-auto-fix` (cap 2 handoffs), and never fixes CI itself.

```text
ci_is_settled():   # the convergence predicate
    NO_CI == 1                      → true    # caller owns CI
    CI_STATE == "unread"            → read check state now, then re-evaluate
    CI_STATE == "green"             → true
    CI_STATE == "pending", 1st time → re-read at head once, then re-evaluate
    CI_STATE == "pending", re-read  → true    # not red, and this loop never waits for CI
    CI_STATE == red                 → false
    CI_STATE == error               → abort, do not converge
```

### Step 1.6: UI-verify run (report-only, once, on exit)

After the loop exits, read [`rules/preview-run.md`](./rules/preview-run.md) and run it, unless **any** of these holds:

- `NO_PREVIEW_RUN == 1` — record `skipped (--no-preview-run)`.
- `NO_FEEDBACK == 1` — record `skipped (--no-feedback)`.
- `UI == 1` — the [`--ui` lane](./rules/ui-lane.md) already verified the final head; report its line instead.
- the loop returned a dispatch skip (no dispatch tool, nested dispatch, `pr-reviewer` not a dispatchable agent type, Agent0 install failed).

It is report-only: it never gates convergence, never reopens the loop, and never undrafts.

### Step 2: Refresh the PR description and Linear note (on convergence)

Skip when `NO_REFRESH == 1`, `NO_FEEDBACK == 1`, or `APPLIED_TOTAL == 0` (no code changed, so the description cannot have drifted).

1. Regenerate the title and body following the shared [`description-contract.md`](../../delivery/create-pr/rules/description-contract.md) — the contract `create-pr` uses. Diff against the PR base and read the current body first; make a minimal edit, not a rewrite. Carry the `<!-- attach-media:v1 -->` … `<!-- /attach-media:v1 -->` media region and the ui-verify region forward verbatim, markers included — dropping either deletes uploaded screenshots or the spec.
2. Apply it:

   ```bash
   gh pr edit "$PR_NUMBER" --repo "$RESOLVED_REPO" --body "$(cat <<'EOF'
   <refreshed narrative body>
   EOF
   )"
   ```

3. Set `DESCRIPTION_REFRESHED = 1` when the edit succeeded and the new body differs from the one you read in item 1.
   Leave it `0` when this step was skipped, the edit failed, or the body came out unchanged.

Then, best-effort, note the linked Linear ticket (skip with one report line if any part is absent): detect a ticket from the branch name (`.../ABC-123-...`), the PR title/body, or `gh pr view`; if one is found **and** the Linear MCP tools are connected, comment on it linking the PR (e.g. `Review loop converged — PR <url> ready for review.`).
Any failure here is logged and never fails the loop.

### Step 2.5: Merge (under `--merge`)

Only when `MERGE == 1`: read [`rules/merge.md`](./rules/merge.md) and run it — the post-refresh re-review, then the four merge gates, then undraft and squash-merge.

### Step 3: Report

```text
review-loop on PR #<n> (<RESOLVED_REPO>)

Iterations: <N> of <CAP>
Stop reason: <all-threads-resolved | no-progress (flags remain) | cap-reached | ci-red (cap on ci-auto-fix handoffs) | ci-error (check query failed) | reviewer-refused (Agent0) | ui-red (lane findings not posted) | report-only (--no-feedback) | skipped (sub-agent dispatch unavailable) | skipped (nested dispatch — must run at top level) | skipped (pr-reviewer is not a dispatchable agent type here) | skipped (Agent0 install failed: <reason>)>
# The STOP_REASON the loop set — never re-derived from the iteration count.
Review source: <pr-reviewer | pr-reviewer bundle via general sub-agent (Agent0<, installed on demand>)>

Per-iteration summary:
  Iteration 1: <verdict | review skipped (prior review at <PRIOR_SHA> still stands)>, <N findings>, <M applied>, <A answered/resolved>, <K simplify recipes>, <U threads still open>
  Iteration 2: ...

Open threads at exit: <count>
  - <one line per still-open human-judgment flag / unresolved blocker>

CI at exit: <green | pending | red (<failing check names>) | error (<verbatim query failure>) | not run (--no-ci) | none on this repo>
  ci-auto-fix handoffs: <CI_HANDOFFS> of 2

UI verify: <green (<N> specs on <url>) | red (<N> failing on <url>) — review before undrafting | inconclusive (preview not deployed at exit) | inconclusive (no deployment lookup on this access path) | inconclusive (<reason> at exit) | not run (no ui-verify block) | not run (empty ui-verify block) | not run (<reason>) | not run (unrecognised outcome: <verbatim>) | skipped (--no-preview-run) | skipped (--no-feedback) | skipped (ui-verify not available) | replaced by the --ui lane (see UI lane)>
UI lane: <the rules/ui-lane.md § Report line value | not requested (no --ui)>

PR description: <refreshed | unchanged (no code applied) | skipped (--no-refresh)>
Linear note: <posted <ticket> | no ticket linked | Linear MCP unavailable | skipped>

Merge re-review: <PASS | WARN | FAIL | refused | not needed (final verdict PASS) | not needed (description unchanged) | not run (<STOP_REASON>) | not requested (no --merge)>
Merge: <merged (squash) | not merged (verdict <V> — not a clean approval) | not merged (post-refresh re-review refused) | not merged (post-refresh re-review found <N> new findings) | not merged (converged, awaiting CI) | not merged (UI lane red on <sha7>) | not merged (<STOP_REASON>) | merge failed (<verbatim gh error>) | not requested (no --merge)>

Final pr-reviewer verdict: <PASS | WARN | FAIL | n/a (no review this run — prior review at <PRIOR_SHA>)>
# The post-refresh re-review's verdict when it ran, else the loop's last review pass.
Head commit: <sha>
```

Surface remaining open threads and any red check prominently when the cap or the no-progress guard stopped the loop.
Never describe a run that stopped with CI red, or that skipped, as converged; a skip is never reported as report-only.

## Hard rules

- **The only permitted `polish` invocation is `Skill("polish", "simplify")`.** Every other mode runs a reviewer pass and creates a dispatch cycle.
- **Never review in this context.** Sub-step A is always a dispatch: `pr-reviewer`, or under Agent0 a `general` sub-agent reading the bundle. A refusing reply is `reviewer-refused`, never a clean pass.
- **Never write to GitHub directly, except the Step 2 description refresh.** `pr-reviewer` posts reviews and `implement-suggestion` resolves threads.
- **Never undraft the PR — except under `--merge`**, where Step 2.5 undrafts only after every merge gate passed.
- **`--merge` merges only on a clean approval.** `STOP_REASON == "all-threads-resolved"`, zero open threads, a `PASS` verdict, and green CI. The final verdict is the post-refresh re-review's when Step 2 changed the body after a non-`PASS` review. Squash only, never `--admin` or `--force`.
- **One `implement-suggestion` per iteration, no `--watch`.**
- **Iteration 1 skips the review only when the last review still stands.** All five apply-first conditions must hold and any failed read fails the check; `NEW_FINDINGS` is `true` on the skip, so convergence and `--merge` always follow a review pass.
- **The cap is a hard limit.**
- **Never fix CI in this context, and never carry CI watch state.** Sub-step D reads check state statelessly, writes nothing for another phase to inherit, and counts `CI_HANDOFFS` inside this run only.
- **Under `--ui`, the lane is part of convergence and only reports.** It posts threads and never commits; at most `UI_CAP = 3` lane runs, one in flight; an `inconclusive` or `NOT RUN` lane never blocks.
