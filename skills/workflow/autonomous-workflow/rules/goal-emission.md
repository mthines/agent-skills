---
title: 'Goal emission and transcript evidence'
impact: HIGH
tags:
  - goal
  - definition-of-done
  - evidence
---

# Goal emission and transcript evidence

Read when planning ends (every tier) and before the terminal contract of any run that opened a PR.

## Contents

- [Why a printed goal](#why-a-printed-goal)
- [Build the goal line](#build-the-goal-line)
- [Print it](#print-it)
- [Print the evidence](#print-the-evidence)

## Why a printed goal

`/goal <condition>` keeps a session taking turns until a small judge model decides the condition is met.
The judge reads only the transcript: it runs no command and opens no file.
A skill or agent cannot set a goal — `/goal` is a session slash command — so the workflow prints a paste-ready line and the user (or a headless `claude -p "/goal …"`) sets it.

## Build the goal line

A goal has exactly four parts: one end state, how it is proven in the transcript, what must not change, and a turn cap.
Fill one of the two templates on a single line.

| Tier | Template |
| --- | --- |
| Full (has `checks.yaml`) | `/goal run-checks prints "CHECKS <M>/<M> PASS", the Before-PR command prints "exit=0", the branch-reviewer findings are printed as fixed or rejected, and the draft PR URL is printed — or stop after <turn_cap> turns or when a line starting "BLOCKED:" is printed.` |
| Micro / Lite (no `checks.yaml`) | `/goal "<verify command>" exits 0 with "exit=0" printed, the draft PR URL is printed, and the printed git diff --name-only lists only <comma-separated files> — or stop after <turn_cap> turns or when a line starting "BLOCKED:" is printed.` |

- `<M>` is the number of entries in `checks.yaml`.
- `<turn_cap>` is `plan.md`'s `turn_cap:`; without a `plan.md`, the default for the tier in `aw-create-plan` (Micro 5, Lite 12).
- `<verify command>` is the exact before-PR command of the brief.
- A user constraint that forbids the PR replaces "the draft PR URL is printed" with "a line starting `PR: none —` is printed".
- Print `BLOCKED: <reason>` whenever you stop for the user, so the judge ends the loop instead of spinning.
- Never add a second end state, a judgment word ("clean", "good", "robust"), or a condition the transcript cannot show.

```text
✗ /goal make the auth flow robust and well tested
   (no observable end state, no proof, no guardrail, no cap)
✓ /goal run-checks prints "CHECKS 4/4 PASS", the Before-PR command prints "exit=0", the branch-reviewer findings are printed as fixed or rejected, and the draft PR URL is printed — or stop after 30 turns or when a line starting "BLOCKED:" is printed.
```

## Print it

Print the line in a fenced `text` block at the end of planning, followed by one instruction sentence:

| Tier / path | Instruction sentence |
| --- | --- |
| Micro / Lite (single-pass in this session) | `Paste this line to let the session drive itself to done hands-off; the run continues normally if you do not.` |
| Full (worker in this session) | Same as Micro / Lite. |
| Full, `aw-executor` dispatched on request | `A sub-agent cannot hold a goal; to rerun execution headless: cd <worktree> && claude -p "<the /goal line>"` |

On Full, `aw` prints the line right after the brief, before it starts the work.

## Print the evidence

Before the terminal contract of every run that reached Phase 6, print this block verbatim with real values, so a judge reading only the transcript can decide the goal:

```text
AW EVIDENCE
<the run-checks sentinel line, verbatim> | verify: <command> exit=<code>
review: <N> findings — <F> fixed, <R> rejected | not run (<reason>)
PR: <draft PR URL | none — <the user constraint>>
Changed files (git diff --name-only <base>...HEAD):
<one path per line>
```

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
git diff --name-only "$BASE"...HEAD
```

Never paraphrase the sentinel line, and never print `PR:` without a URL you received from GitHub.

When the run wrote `specs.md` or the brief has a `telemetry:` criterion, print one handoff line right after the block, so the same proof can be re-run:

```text
verify run: .agent/<branch>/verify/report.md — browser <green|red|inconclusive|not run (<reason>)>, telemetry <confirms|contradicts|ambiguous|null|not run (<reason>)> · preview: /ui-verify run <pr-url> · local: /aw-verify <pr-url>
```
