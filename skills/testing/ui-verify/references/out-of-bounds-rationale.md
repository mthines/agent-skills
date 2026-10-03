# Out-of-bounds brainstorm — why it is shaped this way

The rule is [`../rules/out-of-bounds.md`](../rules/out-of-bounds.md).
This file records why each part exists, so a later edit can tell a load-bearing choice from an incidental one.

## Why it runs in `author`, at the top level

Sub-agent dispatch nests to different depths on different hosts.

| Host | Can a dispatched sub-agent dispatch another? |
| --- | --- |
| OpenCode, and Dash0 Agent0 (which runs OpenCode) | No, by default. The Task tool counts the calling session's ancestors and refuses at `subagent_depth` (default 1), and a child session is given `task: deny` unless its own agent config grants `task`. Agent0's configuration sets neither and ignores a repository's project config, so a skill cannot change it. |
| Claude Code | Yes — up to three layers below the main conversation by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`). |

A brainstorm built from independent generators needs one dispatch level of its own, so it has to run where that level is still free.
`author` runs in the caller's top-level session in every normal entry point; `run`'s adversarial pass is already a dispatched sub-agent and has none left.
So generation lives in `author`, and its output reaches `run` the only way anything does: as specs in the committed PR block.
When `author` itself runs inside a dispatched agent, the in-context mode keeps the step working instead of skipping it.

## Why the framing names the pending state, and why there are baseline moves

A brainstorm framed only as "leave the intended path" drifts toward client-side robustness — forms, storage, network faults, tabs — and does not reliably reach interruptions of a state the server is holding open while it waits for the user.
Those interruptions — ignoring a prompt and doing something else, dismissing it, reloading while it is open — are exactly where post-release regressions in waiting UI come from.
Naming the changed component's pending state in the framing points the generators at it, and the baseline moves give every pending state a coverage floor that does not depend on any generator thinking of the obvious.

## Why `ignore`, `dismiss`, and `reload` are a floor, and severity caps the rest

A fixed count cuts real dead ends: ranked by likelihood plus damage, it can cut `dismiss` even when a dismissed prompt is the changed component's known dead end.

So the three interruptions a waiting prompt meets first are taken unconditionally, and everything else is kept or cut by how bad it would be if it broke, not by its place in a list.
How many dead ends a change can create depends on the change, and a count cannot know that; a severity tier can.
The tier comes from the `severity` skill, the same `critical` / `high` / `medium` / `low` vocabulary the adversarial pass and the reviewers use, so a reader of the PR block and a reader of a review see one scale.
The gate is `high`: on severity's rubric that is broken core behavior on a common path, which is what a user stuck after a dismiss or a reload is; a `medium` dead end has a workaround the user can find.
Severity's Step 2 path floor is skipped because every candidate shares the diff's paths, so a floor would raise all of them together and rank none.

The cost of no count is run time: every selected spec runs against the preview.
One spec per move bounds the baseline moves at six; only new moves the generators add can push past that, and each of those has cleared both the checkability bar and the severity gate.

`refused-next` names the page's main control as well as the pending item, because a prompt the server refuses while a card waits can leave the card and the server disagreeing about whether it is still open.

## Why every spec ends with a keep-going step

An interruption rarely breaks the screen it happens on.
The failure shows on the next action: the new message is refused, the reloaded page shows a card that can no longer be answered, the dismissed prompt leaves the thread unable to continue.
A spec that stops at the interruption passes on exactly the builds it exists to catch.

## Why `**Expected:**` holds only recovery outcomes

What the UI should show after a user dismisses or ignores a prompt is a product decision the author usually cannot know.
A spec that guesses it ("a toast says *Question dismissed*") fails correct builds that chose differently.
Recovery outcomes — the user can continue, the item has one clear state, nothing is lost silently, one action has one effect, views agree — hold for every correct design, so a failure is a real dead end.

## Why five generators and one judge, and deep mode only on request

Independent contexts generate more distinct ideas than one context asked for the same number, which is why the generators are separate sub-agents dispatched together.
Five personas in one message keep that independence at the cost of one dispatch round; one judge applies a fixed rubric.
The full `ideate` deep pipeline adds evolution rounds, a panel, and a pre-mortem — many more dispatches and far more wall time — which does not fit a step that runs on every UI pull request, nor an Agent0 Automation's default 10-minute timeout.
It stays available behind `--brainstorm deep`.

## Why the pending state must be reached deterministically

The intent-spec grading table treats a missing seed named under `**Preconditions:**` as unreachable, so the spec is `skipped`.
A non-deterministic step that simply did not happen — the model did not ask its question this time — leaves the expected items unobserved, so the spec fails.
Seeding the state turns an environment gap into an honest skip instead of a false red.

## Why generators get no tools

Dispatched sub-agents share the session's sandbox; on Dash0 Agent0 that is one small machine.
Five generators each cloning, installing, or building would contend for it, and none of that improves an idea list.
Everything a generator needs fits in the prompt: the framing, the pending states, the baseline moves, and a short diff excerpt.
