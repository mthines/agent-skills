# /pr-review — why it is shaped this way

The operational authority is [`../SKILL.md`](../SKILL.md); the `remember` rule is [`../rules/remember.md`](../rules/remember.md).
This file records why each choice exists, so a later edit can tell a load-bearing line from an incidental one.

## Why it is read-only

Read-only is the whole distinction from `review-loop`, `/implement-suggestion`, and `/polish`: you get a review, and your working tree is exactly where you left it.

## Why the pass-through flags are never validated

The agent owns its flag grammar.
A skill that rejects an unrecognised flag has to be edited every time the agent gains one, and the failure is silent: the user's flag is dropped and the review runs without it.

## Why `pr-reviewer` needs a PR

It reads threads, gates, and its own prior state from the PR object, so there is nothing to degrade to on a branch with no PR.
A missing `gh` is a resolution problem only — the agent itself is MCP-capable.

## Why the caller dispatches the intent worker

The dispatched agent holds no dispatch tool of its own, so the one sub-agent its budget isolates — the intent finder — is dispatched by the caller, in the same message, so the two run concurrently and the wall time is the reviewer's own.
An isolated intent finder catches high-severity defects that the same finder misses when run in the reviewer's context (measurements: [`dispatch-topology.md`](../../../../agents/pr-reviewer/rules/dispatch-topology.md)).
One shared `prepare-review.mjs` run serves both: a worker that runs its own prepare repeats the GitHub reads and leaves a worktree behind.
The preamble's explicit read-list and forbidden-file rule stop the worker from re-reading the full agent document; the dispatch prompt is the one part of a worker's context this skill controls.

## Why `date +%s`, not `%s%3N`

BSD `date` on macOS has no `%N`, so `%s%3N` prints a literal `3N`.
The stamp and the `dispatch` record put the agent's definition read and the worker's own span in the trace ([`run-telemetry.md`](../../../../agents/pr-reviewer/rules/run-telemetry.md)).

## Why absent dispatch is a skip, not an inline review

Review independence comes from a fresh, isolated context.
An inline review is a self-review wearing a reviewer's label, which is worse than no review because it is reported as one.
Absence is a property of the dispatch topology, settled before any code is read, so a retry costs a round trip and returns the same answer.
The test is by capability, because a test for the name `Task` skips the review on every harness that spells the tool `Agent`.

## Why one dispatch, and why the verdict is reported as returned

A second pass over an unchanged head re-reads the same code and re-posts the same report; iterating against fixes is `review-loop`'s job.
The gates and the verifier made the verdict with evidence; re-adjudicating it here would produce two disagreeing verdicts for one run.
The agent rewrites its sticky report in place so a PR does not accumulate copies, so this skill writes nothing to GitHub.

## Which review command

| Command | Reviews | Applies findings | Pushes | Loops |
| --- | --- | --- | --- | --- |
| **`/pr-review <PR>`** | yes | **no** | no | no — one dispatch |
| [`/implement-suggestion <PR>`](../../../workflow/implement-suggestion/SKILL.md) | no — applies existing comments | yes | yes | no (`--watch` repeats) |
| [`review-loop`](../../review-loop/SKILL.md) | yes | yes | yes | yes, cap 5, converges on threads + CI |
| [`/polish`](../../polish/SKILL.md) | yes | mechanical only | no | no — one pass each |
