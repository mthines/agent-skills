---
name: interview
description: >
  Turns an underspecified request into a short spec before planning — reads
  the code first, asks only the questions that change what gets built, in one
  batched round, and writes `brief.md`. Stays silent on a clear request.
  Triggers on "align on scope", "interview me", "clarify the request",
  "/interview".
disable-model-invocation: false
argument-hint: '[<request>] [--non-interactive]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
  tags:
    - requirements
    - scope-alignment
    - clarifying-questions
    - interview
    - pre-planning
    - brief-artifact
---

# Interview

Turns an unclear request into a spec a fresh session can build and verify from: `.agent/{branch}/brief.md`.
It asks the user only what the code cannot answer and what would change the implementation.
Why it is this small: [`references/design.md`](./references/design.md).

## Input

`$ARGUMENTS` is the request.
If empty, use the conversation's active request; if there is none, ask what to scope.

| Flag                | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `--non-interactive` | Never prompt. If a `blocking` unknown remains, list it under `## Open questions` and return `blocked`. For headless callers. |

Inside `aw`, this skill runs on demand from Phase 0; do not also run it standalone. Contract: [`rules/aw-integration.md`](./rules/aw-integration.md).

## Procedure

### 1. Restate and read the code

1. Restate the request in one paragraph plus requirement bullets, each tagged `[user-stated]` or `[inferred]`.
2. Read the affected code (`Grep` / `Glob` / `Read`; an `Explore` agent only for a broad sweep): where it lives, what already exists to reuse, the repo's conventions, and governing docs (`CLAUDE.md`, `.claude/rules/`).
3. Delete every candidate question the code answers.

```text
Good: "src/lib/pr-status-cache.ts already caches per-branch status → reuse it."
Bad:  asking the user "Should we cache the result?"
```

### 2. Classify what is still unknown

List what remains open about intent, **non-goals**, **success criteria**, edge cases visible in the code, and constraints, plus every surviving `[inferred]` bullet.
Record each constraint found in step 1 (a governing-doc rule, compatibility, performance) under `## Constraints`.
Non-goals and success criteria are always resolved: answered by the request, confirmed in the round, or recorded as an assumption.

| Class      | Test                                                                                    | Action                                     |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| `blocking` | A wrong guess changes the approach, or the change is hard to reverse (data, API, migration). | Ask.                                       |
| `advisory` | A sensible default exists and a wrong guess is cheap to fix later.                      | Don't ask. Record the default in `## Assumptions (advisory)`. |
| `spike`    | Only seeing it work settles it (feel, performance, a third-party API's real behavior).  | Don't ask. Record `settle by spike: <what>` in `## Assumptions (advisory)`. |

Zero `blocking` unknowns → ask nothing, write the brief, and set the verdict per step 4.
That silence is the skill working.

### 3. Ask once

1. Put every `blocking` question into one `AskUserQuestion` call (≤ 4 questions, 2–4 options each).
   More than four: ask the four whose wrong guess costs most, list the rest under `## Open questions`, and return `blocked`.
2. Each option is a concrete choice found in the code, with its trade-off; the one you would pick goes first, labelled `(Recommended)`.
3. A second round is allowed only when a first-round answer exposes a new `blocking` unknown.
4. Never a third round: list the remaining `blocking` unknowns under `## Open questions`, return `blocked`, and recommend `/ideate` (options) or a spike (evidence).

```text
Good: one call — { PR states: [open+merged+ci-failing (Recommended), open+merged, all four] },
                 { Poll source: [reuse PrPoller's 90s (Recommended), new interval] }
Bad:  "Which states?" → wait → "What cadence?" → wait → "Should it cache?"
```

### 4. Write the brief

Write [`templates/brief.md`](./templates/brief.md) to `.agent/{branch}/brief.md` (`.agent/interview/brief.md` on `main`), updating it in place on a re-run.
Keep every heading; write `None.` under an empty one.
Never put a plan, a diff, or code in it.
Set exactly one verdict:

| Verdict                  | When                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `ready`                  | No `blocking` unknown left and no unconfirmed assumption.            |
| `ready-with-assumptions` | No `blocking` unknown left; at least one advisory or spike assumption. |
| `blocked`                | A `blocking` unknown is unanswered (user unavailable, `--non-interactive`, or the two-round cap). |

End with one line: the verdict and the brief path.

## Out of scope

- Generating solution options → `/ideate`.
- Red-teaming a plan → `/critical`.
- Scoring readiness → `/confidence`.
- Writing the plan or code → the caller.
