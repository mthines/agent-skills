---
title: Question Design — Batched, Prioritized, Bounded
impact: HIGH
tags:
  - questions
  - batching
  - AskUserQuestion
  - interview
---

# Question Design

Phase 3.
How to ask the blocking + high-value unknowns from the readiness gate so the user answers once and the interview converges.
The mechanism is `AskUserQuestion`; the discipline is batching, prioritization, and a hard two-round cap.

## Rules

1. **Batch into one round.** Put every blocking question into a single `AskUserQuestion` call (up to four questions per call). Never send one question, wait, send the next.
2. **Two rounds maximum.** A second round is allowed only when a first-round answer *unlocks* a new blocking unknown that could not have been asked earlier. If you are on round three, the request is too open for an interview — say so and recommend `/ideate`.
3. **Prioritize by blast radius.** Ask the unknowns that most change the implementation first. Drop advisory unknowns from the prompt entirely — they get recorded defaults, not questions.
4. **Make options concrete and grounded.** Each option is a real choice found in research, with its trade-off in the description. Put your recommendation first and mark it `(recommended)`. Offer the option you would take by default so the user can one-tap it.
5. **Never ask what the code answers.** If a question survived to here that Phase 1 could have resolved, resolve it now instead of asking.
6. **Confirm, don't re-open.** Use the round to confirm non-goals and success criteria too — a fast "is X out of scope? yes/no" — not to relitigate the whole request.

## Using AskUserQuestion

- One question object per genuine decision; 2–4 options each; enable `multiSelect` only when the choices are not mutually exclusive.
- `header` is a ≤ 12-char chip (e.g. `Poll source`, `PR states`).
- Lead with the recommended option and append `(recommended)` to its label.
- Options must be mutually exclusive unless `multiSelect` is set; the harness always adds an "Other" escape, so do not add your own.

## Examples

### Good — one batched round

```text
AskUserQuestion([
  { header: "PR states", question: "Which PR states should the badge show?",
    options: [ open+merged+ci-failing (recommended), open+merged only, all four incl. closed ] },
  { header: "Poll source", question: "Where should cadence come from?",
    options: [ reuse PrPoller's 90s (recommended), new configurable interval ] },
])
```

### Bad — drip and ungrounded

```text
Round 1: "Which states?"        → wait
Round 2: "What cadence?"        → wait
Round 3: "Should it cache?"     → PrStatusCache already does; never should have been asked
```

## Common mistakes

- Sending questions serially across turns. **Fix:** one `AskUserQuestion` with up to four questions.
- Asking advisory unknowns. **Fix:** record a default; reserve prompts for blocking ones.
- Abstract options ("configurable", "flexible"). **Fix:** name the concrete choice and its trade-off from research.
- Exceeding two rounds. **Fix:** the request is not interview-shaped; recommend `/ideate` and stop.
