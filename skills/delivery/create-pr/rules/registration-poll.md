# CI check-registration poll

**This file is the owner of the procedure.** Two callers consume it: [`create-pr` Step 7a](../SKILL.md#step-7a-wait-for-checks-to-register) and [`phase-7-ci-gate.md` Step 1](../../../workflow/autonomous-workflow/rules/phase-7-ci-gate.md#step-1-identify-the-pr--initial-watch).

Neither caller may edit the procedure or restate it. Change it here, then re-read both callers' outcome mappings. Ownership stated in prose is what prevents drift — the directory only implies it.

> **Why a shared file and not a shared counter.** What failed in the reverted #107 was shared **mutable state** — a budget written by several contexts. Immutable prose with a single owner is the opposite: it is the fix for two files drifting apart, not an instance of the problem. Do not copy this procedure into a caller.

## What this answers

Exactly one question: **do CI checks exist yet for this PR?**

Never a CI verdict. Deciding pending-vs-failing is `--watch`'s job.

## Why it is needed

`gh pr checks --watch` does **not** wait for checks that do not exist yet — with none registered it returns immediately. Registration takes seconds after a push, so a caller that treats "no checks reported" as "this repo has no CI" reports success for a PR whose CI was never observed.

## The poll

```bash
# Issue this Bash call with the tool parameter timeout: 600000.
# The tool's DEFAULT is 120000, which would kill the call at 2 minutes and
# leave the loop's own 90 s bound unreachable.
timeout 90 bash -c '
  while :; do
    err=$(gh pr checks <pr-number> 2>&1 >/dev/null); rc=$?
    # Registered, unambiguously: 0 = all terminal and passing, 8 = pending.
    [ "$rc" -eq 0 ] || [ "$rc" -eq 8 ] && break
    # Non-zero with EMPTY stderr = a check reported failure (it printed to
    # stdout, which we discarded). That is also "registered".
    #
    # Keying on "did gh write a message" rather than on which number it
    # returned is deliberate: gh does not document a stable exit code for
    # "no checks reported", so any classifier resting on that constant is
    # unsound by construction. Presence of stderr is observable and stable.
    [ -z "$err" ] && break
    lc=$(printf %s "$err" | tr "[:upper:]" "[:lower:]")
    case "$lc" in
      *"no checks reported"*|*"no commit found"*|*"no pull requests found"*) sleep 5 ;;
      *) echo "$err" >&2; exit 3 ;;   # DEFAULT IS FAILURE: an unrecognised gh error is never benign
    esac
  done
  exit 0'                             # never leak the last command status
```

## Outcomes (caller-neutral)

Map these to your own next step; this table deliberately names no caller's step numbers.

| Poll exit | Outcome | Meaning |
| --------- | ------- | ------- |
| 0 | `registered` | Checks exist — terminal or pending. **What to do next is the caller's decision**, not this file's: `create-pr` watches them, Phase 7 re-reads its own Step 1 table and may skip the watch entirely |
| 3 | `tooling-failure` | `gh` itself failed (auth, network, rate limit, not logged in). Report and escalate. Conclude **nothing** about CI |
| 124 | *(internal — not an outcome)* | 90 s elapsed with nothing but "no checks reported". **This never surfaces to a caller**: retry the poll here, up to 3 polls total, then resolve to one of the outcomes above or below |
| — | `no-ci` | Three polls elapsed **and** the approval check below found nothing. This repo does not run CI on PRs |

**Callers render exactly three outcomes** — `registered`, `tooling-failure`, `no-ci`. Exit 124 is this file's business, not theirs.

After the third unsuccessful poll, before concluding the repo has no CI:

```bash
gh run list --branch <branch> --limit 5
```

If it shows runs **awaiting maintainer approval** (outside-contributor PRs hold runs indefinitely), the outcome is `tooling-failure`-like: report and escalate, do **not** report success. Only with no runs at all is the outcome `no-ci`.

## Counting

Print `registration poll N/3` as you make each attempt and carry those lines into your report. Externalising the count is the point — a number written down at the moment it changes survives a step transition; one held in the agent's head does not.
