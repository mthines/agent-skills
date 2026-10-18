# create-pr — design rationale

Read on demand. The rules these explain live in [`../SKILL.md`](../SKILL.md); this file changes no behaviour.

## Contents

- [Why Step 6.5 always passes `--no-ci`](#why-step-65-always-passes---no-ci)
- [Why there is no separate external-bot watch](#why-there-is-no-separate-external-bot-watch)
- [Why the CI caps are local, never shared](#why-the-ci-caps-are-local-never-shared)
- [Why the Step 10 slots are mandatory](#why-the-step-10-slots-are-mandatory)
- [Why Step 6.4 records its outcome on the way out](#why-step-64-records-its-outcome-on-the-way-out)

## Why Step 6.5 always passes `--no-ci`

`review-loop` has its own CI sub-step that dispatches `ci-auto-fix`.
Letting it run would make it a second spender of the handoff budget that Steps 7–8 own for this invocation.
`create-pr` does not need it: Steps 7–8 run after Step 6.5, so every commit the loop pushes is covered by the watch that follows.
Suppressing the loop's CI step keeps the budget accountable to one owner — the counters live in this skill's own transcript, never in a state file carried between phases.

## Why there is no separate external-bot watch

A Step 6.7 once backgrounded `/implement-suggestion <pr> --watch` for bot and human comments posted after the loop.
Every job it did is already done or cannot be done:

- `review-loop`'s apply step is `implement-suggestion --resolve-all`, which reads every open thread on the PR — any author, bot or human — on every iteration, so a comment that lands while the loop runs is already applied or answered.
- It pushed to the branch concurrently with the Step 7 CI watch, so the watch could certify a head the background loop had already moved past.
- A background sub-agent needs a harness that keeps running after the turn ends and a dispatch tool at this rung; an Agent0 Automation has neither.

A reviewer who comments after `create-pr` returns is picked up by the next `review-loop` run, or by `/implement-suggestion <pr> --watch` run on purpose.
`--no-feedback`, which disabled that watch, is still accepted and ignored.

## Why the CI caps are local, never shared

Prose asking an agent to *remember* a number across a step transition and a sub-agent fan-out is fragile; prose asking it to *record* one in the transcript is not — hence the printed `ci-watch attempt N/4` and `ci-auto-fix invocation N/2` lines.
There is no shared counter across skills or sub-agents.
Miscounting a local cap costs one extra 9-minute watch or one early escalation; miscounting a shared one produced a false green.
That trade — a correctness risk converted into a latency risk — is why the shared budget was removed; see [`phase-7-ci-gate.md`](../../../workflow/autonomous-workflow/rules/phase-7-ci-gate.md).

## Why the Step 10 slots are mandatory

Step 6.4 has four skip conditions (`--no-ui-verify`, `--no-quality`, a non-UI diff, `ui-verify` not installed) and one failure mode.
When the report had no slot for the spec, every one of them reported as a clean, successful PR, and an absent block was indistinguishable from a diff that needed none.
That is the self-concealing shape of failure modes `F6`/`F7` in [`diagnostic-surface.md`](../../../workflow/autonomous-workflow/rules/diagnostic-surface.md): a degraded path that reports as a legitimate outcome is never fixed, because nobody learns it happened.
The same holds for the `Pre-push review` line: a named skip says the pass exists and why it did not run; an omitted line reads identically to a run that took it.

## Why Step 6.4 records its outcome on the way out

A slot whose value is reconstructed from memory at the end of a long run is the blind spot the slot exists to close.
`ui-verify author` treats the PR-body write as its only deliverable, so its `failed` return means no later reader — the Step 6.5 review-loop's Step 1.6 included — will find a block to run; reporting that as `not authored` claims a decline where there was an error.
Step 6.4 only authors; the run is the review-loop's job at exit.
`create-pr` does not pass `--no-preview-run` because that opt-out is for `autonomous-workflow`, whose Phase 7 rehearses the same specs itself.
