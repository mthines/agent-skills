---
title: The --ui lane — run ui-verify in parallel and resolve its findings inside the loop
impact: HIGH
tags:
  - review-loop
  - ui-verify
  - parallel
  - convergence
---

# The `--ui` lane

Under `--ui`, `ui-verify` runs against the PR's live preview **in parallel** with the review loop, and its blocking results become review threads the loop resolves like any other finding.
The lane never fixes code itself: it posts threads (`ui-verify run --post-findings`), sub-step B (`implement-suggestion --resolve-all`) fixes and resolves them, and the next lane run on the new head checks that the fix held.
Without `--ui`, this file does not apply and [Step 1.6](../SKILL.md#step-16-ui-verify-run-report-only-once-on-exit) runs its report-only pass at exit instead.

## Contents

- [State](#state)
- [Step U0: Make sure a spec exists](#step-u0-make-sure-a-spec-exists)
- [Step U1: Pick the lane mechanism](#step-u1-pick-the-lane-mechanism)
- [Step U2: Launch a lane run](#step-u2-launch-a-lane-run)
- [Step U3: Tick — once per iteration, never blocking](#step-u3-tick--once-per-iteration-never-blocking)
- [Step U4: Settle — the convergence gate](#step-u4-settle--the-convergence-gate)
- [Reading a lane run's result](#reading-a-lane-runs-result)
- [Report line](#report-line)

## State

```text
UI_MECH      = session | background | inline | off    # Step U1
UI_RUNS      = 0          # lane runs launched this invocation
UI_CAP       = 3          # each run is a full Playwright pass + adversarial + telemetry
UI_RUNNING   = none       # { head, handle, started_at } while a lane run is in flight
UI_LAST      = none       # { head, verdict, adversarial, telemetry, posted, deduped } of the last finished run
UI_WAIT_MIN  = 30         # the most Step U4 waits for one run
```

## Step U0: Make sure a spec exists

Before iteration 1, read the PR body.
When it has no `<!-- ui-verify:v2 -->`, `v1`, or legacy `<!-- preview-spec:v1 -->` block, author one in this context: `Skill("ui-verify", "author <PR-URL>")`.

| `author` outcome | Do |
| --- | --- |
| a block was written | continue to Step U1 |
| `not authored (no UI files in diff)` | `UI_MECH = off`; report `UI lane: off (no UI files in diff)` and run the loop as without `--ui` |
| `failed (…)`, or `ui-verify` not available | `UI_MECH = off`; report `UI lane: off (<reason>)` |

Authoring here, not in the lane, keeps exactly one writer of the PR body while the loop runs.

## Step U1: Pick the lane mechanism

Take the first row whose condition holds. Decide by capability, never by a tool's spelling.

| Mechanism | Condition | What runs the lane |
| --- | --- | --- |
| `session` | a tool ending in `create_session` is available (Claude Code Remote) | a sibling session at its own top level, so its `ui-verify` can dispatch `aw-tester` |
| `background` | the sub-agent dispatch tool accepts a background flag (`run_in_background`) | a background `general-purpose` sub-agent |
| `inline` | neither | this context, synchronously, at Step U4 only — no parallelism |

A `background` lane run that returns `NOT RUN (sub-agent dispatch unavailable)` or `NOT RUN (no Chrome extension and no sub-agent dispatch available)` means a nested sub-agent cannot dispatch `aw-tester` on this host.
Set `UI_MECH = inline` for the rest of the invocation; that run does not count toward `UI_CAP`.

## Step U2: Launch a lane run

Launch only when `UI_RUNNING` is `none` and `UI_RUNS < UI_CAP`. Record `UI_RUNNING = { head: <current remote head SHA>, handle, started_at }` and `UI_RUNS += 1`.
The lane command is the same for every mechanism:

```text
/ui-verify run <PR-URL> --unattended --post-findings --wait-preview 15
```

`--unattended` because nobody answers a question in a lane, `--post-findings` because threads are the hand-off, and `--wait-preview 15` because the preview for a fresh push is usually still building.

| Mechanism | Launch |
| --- | --- |
| `session` | `create_session` with `source_url` = the PR's repository, `source_revision` = the PR head branch, `title` = `ui-verify lane · #<n> · <sha7>`, `prompt` = the lane command; `handle` = the session id |
| `background` | `<dispatch>(subagent_type="general-purpose", run_in_background=true, prompt="Run Skill(\"ui-verify\", \"run <PR-URL> --unattended --post-findings --wait-preview 15\") and return its full report.")`; `handle` = the task id |
| `inline` | nothing now — Step U4 runs it |

```text
❌ WRONG — the lane fixes code: two writers race on one branch
prompt = "Run ui-verify on <PR-URL> and fix whatever fails"

✅ RIGHT — the lane only reports; sub-step B is the one writer
prompt = "/ui-verify run <PR-URL> --unattended --post-findings --wait-preview 15"
```

## Step U3: Tick — once per iteration, never blocking

At the top of every iteration, before sub-step A:

1. When `UI_RUNNING` is set, check whether it finished ([Reading a lane run's result](#reading-a-lane-runs-result)) without waiting. Finished → set `UI_LAST`, clear `UI_RUNNING`.
2. When `UI_RUNNING` is `none`, `UI_MECH` is `session` or `background`, and the remote head differs from `UI_LAST.head` (or no run has started yet), launch per Step U2.

The lane's threads land on the PR whenever it finishes; sub-step B reads them on its next pass, because `implement-suggestion` never self-filters a `<!-- ui-verify:finding` comment.

## Step U4: Settle — the convergence gate

The clean-convergence exit calls `ui_settled()` after its other conditions hold. It may block; nothing else in the loop does.

```text
ui_settled():
    if UI_MECH == "off": return true
    head = current remote head SHA
    if UI_LAST.head == head: return verdict_settles(UI_LAST)
    if UI_RUNNING and UI_RUNNING.head != head:
        wait for the stale run as below; record it in UI_LAST and clear UI_RUNNING   # U2 launches only when none is in flight
        on timeout: clear UI_RUNNING; UI_LAST.note = "stale lane run on <old sha7> abandoned"
    if UI_RUNNING and UI_RUNNING.head == head:
        wait for it: poll every 60 s, at most UI_WAIT_MIN minutes
    elif UI_RUNS < UI_CAP:
        launch per Step U2 (inline: run the lane command here, in this context), then wait as above
    else:
        UI_LAST.note = "not verified on <sha7> (lane cap reached)"; return true
    on timeout: UI_LAST = { head, verdict: "inconclusive (lane timed out)" }; return true
    return verdict_settles(UI_LAST)

verdict_settles(run):
    if run.posted > 0 and not run.handed_off:
        run.handed_off = true
        NEW_FINDINGS = true; return false   # its threads are now sub-step B's work, once
    if run.verdict == "red" and run.post_failed: STOP_REASON = "ui-red"; return false
    return true          # green, inconclusive, NOT RUN, or red whose threads were handed off → settled
```

A run's threads are handed to sub-step B exactly once.
After that, any of them still open blocks the exit through `unresolved_thread_count()`, and one that B declined with a reply is resolved and blocks nothing — so a declined finding on an unchanged head never holds the loop open.

An `inconclusive` or `NOT RUN` lane never blocks convergence: the loop cannot deploy a preview or install a browser, and spinning on one only burns the cap.
A red verdict whose findings were all deduped against still-open threads is settled here because those open threads already block the exit through `unresolved_thread_count()`.
`STOP_REASON = "ui-red"` means the lane saw a failure it could not post; the loop stops and reports it rather than converging over it.

## Reading a lane run's result

Every mechanism ends in the same place: the `ui` region (`<!-- verify:section=ui -->` … `<!-- /verify:section=ui -->`) of the PR's one verify comment, whose first line is `<!-- verify:report -->`.
A run on head `<sha>` is **finished** when that region shows `head \`<sha>\`` and a `finished:` line.

```bash
gh api "repos/$RESOLVED_REPO/issues/$PR_NUMBER/comments" --paginate \
  --jq '[.[] | select(.body | startswith("<!-- verify:report -->"))] | first | .body // ""
         | capture("<!-- verify:section=ui -->(?<r>[\\s\\S]*?)<!-- /verify:section=ui -->").r // empty'
```

On the `mcp` path, read the comments with `mcp__github__issue_read` (`method: "get_comments"`) and take the same region.
No region (none posted yet, or an `aw-verify` aggregate replaced it) means no summary for this head.
Parse `verdict`, `adversarial`, `telemetry`, and the `threads:` line from it: `<N> posted, <D> deduped, <X> declined` sets `posted = N`, and `failed (<reason>)` sets `post_failed = true`.

Also finished, with no summary to read:

| Signal | Record |
| --- | --- |
| `session`: `get_session` shows `status_bucket: failed`, or the session went idle with no summary for its head | `verdict: inconclusive (lane session ended without a summary)` |
| `background`: the task completed and its report has no `posted:` line | the report's verdict line, `post_failed: true` when it reports `posted: failed (…)` |
| `inline`: the skill returned | its report, as above |

## Report line

Replace Step 3's `UI verify:` value with:

```text
UI lane: <session | background | inline | off (<reason>)> · <UI_RUNS> run(s) · last on <sha7>: <verdict> · <adversarial line> · <telemetry line> · threads <posted> posted
```
