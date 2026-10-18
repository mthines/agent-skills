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
| Full (has `checks.yaml`) | `/goal run-checks prints "CHECKS <M>/<M> PASS", the draft PR URL is printed, and the printed git diff --name-only lists only files in plan.md's File Changes — or stop after <turn_cap> turns.` |
| Micro / Lite (no `checks.yaml`) | `/goal "<verify command>" exits 0 with "exit=0" printed, the draft PR URL is printed, and the printed git diff --name-only lists only <comma-separated files> — or stop after <turn_cap> turns.` |

- `<M>` is the number of entries in `checks.yaml`.
- `<turn_cap>` is `plan.md`'s `turn_cap:`; without a `plan.md`, the default for the tier in `aw-create-plan` (Micro 5, Lite 12).
- `<verify command>` is the exact before-PR command of the brief.
- Never add a second end state, a judgment word ("clean", "good", "robust"), or a condition the transcript cannot show.

```text
✗ /goal make the auth flow robust and well tested
   (no observable end state, no proof, no guardrail, no cap)
✓ /goal run-checks prints "CHECKS 4/4 PASS", the draft PR URL is printed, and the printed git diff --name-only lists only files in plan.md's File Changes — or stop after 30 turns.
```

## Print it

Print the line in a fenced `text` block at the end of planning, followed by one instruction sentence:

| Tier / path | Instruction sentence |
| --- | --- |
| Micro / Lite (single-pass in this session) | `Paste this line to let the session drive itself to done hands-off; the run continues normally if you do not.` |
| Full, split (planner → executor) | `Sub-agents cannot hold a goal, so the split runs as usual; to rerun execution headless: cd <worktree> && claude -p "<the /goal line>"` |
| Full, single-context | Same as Micro / Lite. |

The Full planner includes the line in its handoff message as `- Goal: <line>`; `aw` re-prints it.

## Print the evidence

Before the terminal contract of every run that reached Phase 6, print this block verbatim with real values, so a judge reading only the transcript can decide the goal:

```text
AW EVIDENCE
<the run-checks sentinel line, verbatim> | verify: <command> exit=<code>
PR: <draft PR URL>
Changed files (git diff --name-only <base>...HEAD):
<one path per line>
```

```bash
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main)
git diff --name-only "$BASE"...HEAD
```

Never paraphrase the sentinel line, and never print `PR:` without a URL you received from GitHub.
