# Why the dispatcher works the way it does

Read on demand.

## Why `aw` is a skill, not an agent

A skill runs in the caller's context, so the Full-tier work happens in the session the user can set a `/goal` on, and every dispatch starts from the top level.
As an agent, the dispatcher cost a delegation rung, a duplicated tier table policed by an L1 drift guard, and a triplicated tool grant — and it failed the repo's own third-agent test (a third agent must bring a third independent context, not a third role).
The full design note is the workflow's `CLAUDE.md` § "The dispatcher is a skill, not an agent".

## Full tier: short brief, work in session, review after

Current models plan while they work, so a long plan written up front costs time and adds little: in a three-way comparison on one access-scoping ticket, the separate planning agent spent about 45 minutes on a 333-line plan, and the run with no workflow finished 70 minutes sooner while finding more code paths.
A long brief also does harm: current models follow instructions precisely, so a design guess written as a guardrail is executed as a hard limit even where the code proves it wrong — in a blind comparison on an integration ticket, the one defect unique to the workflow run came from a guardrail its own brief invented.
What the workflow adds that a plain run lacks is discipline: every stated requirement holds, negative tests are proven to fail without the guard, the full suite runs, a reusable UI spec exists, and a context that did not write the code reviews it.
So the Full tier keeps a short brief of outcomes and sourced limits sealed into executable checks, the corrections in `rules/corrections.md`, the `run-checks.mjs` gate, and one fresh-eyes review; the design is left to the worker.
The work runs in the caller's session because `/goal` drives only that session and its judge reads only that transcript; a dispatched executor re-reads everything in a new context and cannot be looped.
Review is the one step that needs a different context, so it is the step that is dispatched.

The single-pass Micro/Lite path stays for short tasks, where any handoff is pure overhead — see the workflow's `references/anthropic-architecture-research.md`.

## One local review before the PR

`branch-reviewer` and `pr-reviewer` share one detection core, so once the local loop converges, a posted pass on the same diff mostly re-finds what was just fixed or declined.
The posted pass also costs a human reviewer: the agent posts inline findings, fixes them, and resolves its own threads, which buries the real discussion under a bot talking to itself.
So each tier reviews exactly once, locally, before the PR: Full in its own Step 3 because that pass precedes the walkthrough and verification, Micro and Lite through `create-pr` Step 5.5.
The posted pass stays available behind `--pr-review` for PRs where a visible review record is worth the noise, and the post-CI pass is gone because CI fixes are covered by CI.
On Full, `feature-pr-verifier` checks the opened PR against the brief, which covers most of what the posted pass's description gate did.

## Why a capability test, not a name test

The dispatch tool has been called `Task` and `Agent` in different harnesses and versions.
Reading the absence of `Task` as "no dispatch" sends a fully dispatchable session into the single-context fallback and the no-review path, both of which report as legitimate outcomes, so the mistake is invisible.

## Why `aw` dispatches `feature-pr-verifier`

In the transcripts analysed for the restructure, a dispatched executor never reached the verifier: the old trigger waited for green CI, which the executor's done-condition did not require.
`aw` dispatches it at PR open, from a context that did not write the code.
Each of the verifier's checks runs its own commands against the PR head, so it does not need CI.

## Why a printed `/goal`

`/goal` is a session slash command; neither a skill nor an agent can set it.
Printing a paste-ready line built from the brief lets the user hand any tier's run to the goal loop.
The judge reads only the transcript, which is why every run prints the `AW EVIDENCE` block.

## Why follow-ups are never scope creep

Improvements often become obvious only once the whole feature is visible.
Refusing them because "the task was done" is the failure; the scope-creep guard restrains only unrequested expansion by the agent itself.
