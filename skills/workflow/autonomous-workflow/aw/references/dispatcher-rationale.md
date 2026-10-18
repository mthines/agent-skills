# Why the dispatcher works the way it does

Read on demand.

## Why `aw` is a skill, not an agent

A skill runs in the caller's context, so `aw-planner` and `aw-executor` are dispatched from the top-level session and keep whatever nested dispatch the harness grants.
As an agent, the dispatcher cost a delegation rung, a duplicated tier table policed by an L1 drift guard, and a triplicated tool grant — and it failed the repo's own third-agent test (a third agent must bring a third independent context, not a third role).
The full design note is the workflow's `CLAUDE.md` § "The dispatcher is a skill, not an agent".

## Why the split is Full-only

The planner → executor handoff buys context isolation and a durable, resumable `plan.md`.
Both pay for complex, long tasks and are pure overhead (extra tokens, a cold read) for short ones, where single-pass continuity is better and cheaper.
Forcing heavy process onto a light task wastes compute and degrades long-horizon performance — see the workflow's `references/anthropic-architecture-research.md`.

## Why a capability test, not a name test

The Claude Code CLI calls the dispatch tool `Task`; the Claude Agent SDK harness behind Claude Code on the web calls it `Agent`.
Reading the absence of `Task` as "no dispatch" sends a fully dispatchable session into the single-context fallback and the no-review path, both of which report as legitimate outcomes, so the mistake is invisible.

## Why `aw` dispatches `feature-pr-verifier`

In the transcripts analysed for the restructure, a dispatched executor never reached the verifier: the old trigger waited for green CI, which the executor's done-condition did not require, and a dispatched executor holds no dispatch tool anyway.
`aw` sits one rung above and is still running when the executor returns, so it dispatches the verifier at PR open.
Each of the verifier's checks runs its own commands against the PR head, so it does not need CI.

## Why a printed `/goal`

`/goal` is a session slash command; neither a skill nor an agent can set it.
Printing a paste-ready line built from the brief lets the user hand a Micro/Lite run to the goal loop, or rerun Full execution headless with `claude -p "/goal …"`.
The judge reads only the transcript, which is why every run prints the `AW EVIDENCE` block.

## Why follow-ups are never scope creep

Improvements often become obvious only once the whole feature is visible.
Refusing them because "the task was done" is the failure; the scope-creep guard restrains only unrequested expansion by the agent itself.
