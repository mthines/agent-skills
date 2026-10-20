# Why create-skill runs the job before writing the skill

Rationale for [`rules/run-first.md`](../rules/run-first.md).

## The skill is the gap, not the process

Anthropic's skill-authoring guidance says to complete the task without a skill first, note where the agent goes wrong, and write the skill to close only those gaps.
Current models do most multi-step jobs correctly unaided, so a skill that documents the whole process is mostly restating behaviour the model already has.
Those lines cost tokens on every load and dilute the few lines that change the outcome.
Strong skills usually start as a handful of lines and one gotcha, and grow only when a later run shows a new failure.

## Why designing the skill up front fails

Planning the process from memory and then asking for a skill produces a description of what the author imagines will go wrong.
Running the job exposes what actually goes wrong: an ambiguous input choice, a domain rule the model cannot infer, an output convention the user cares about.
The corrections ledger is the evidence that each `SKILL.md` line earns its place.

## Why the brief is task, guardrails, and definition of done

The brief tells the agent what to do and what done looks like, then lets it plan while it works instead of approving a plan first.
The definition of done is the only part a reviewer needs to check afterwards, and it becomes the skill's check script when it is mechanical.
A check the agent can run, and re-run until it passes, is what lets a user read the evidence instead of re-doing the verification.

## Why corrections are routed, not all written into the skill

- A rule that must never be broken is a hook, because a deterministic hook runs every time, while capitalised MUST/NEVER prose is followed only most of the time.
- A fact true for the whole workspace belongs in `CLAUDE.md`, which is loaded for every task, not in a skill loaded for one job.
- A research or MCP-heavy step goes to a sub-agent so the main context stays clean for the work the skill is about.

## Why there is a no-skill exit

Published skill libraries regularly score no better than a same-length dummy file when run with and without the skill on the same tasks.
A skill whose run needed zero corrections is that case: it adds cost and adds nothing.
Stopping is a correct outcome of `scaffold`, not a failure.

## Why the run uses the target model

Different models need different amounts of guidance.
Corrections gathered on a stronger model under-specify for a weaker one, and the reverse wastes tokens, so the ledger records the model and Phase 8 re-checks on each target model.
