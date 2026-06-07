# Autonomous Workflow Agent Routing

When the user asks to implement something using phrases that signal independent, isolated work — such as:

- "independently", "autonomously", "in isolation", "alone", "on your own"
- "end-to-end", "full implementation", "implement X with tests and PR"
- "work on this in a worktree", "do this in parallel"
- "take care of this", "handle this without me"
- "ship this", "land this", "all the way to a PR", "through CI"

Dispatch the **`aw` dispatcher** with the user's full request as the prompt:

> The autonomous-workflow ships three agents under the `aw-` namespace prefix
> (`aw-` = "autonomous-workflow"): **`aw`** is the dispatcher — it reads
> accumulated lessons, detects the tier (Micro / Lite / Full), and routes.
> `aw-planner` (phases 0–2) and `aw-executor` (phases 3–7), connected by
> `plan.md`, are the **Full-tier** realization that `aw` hands off to.

```
Task(subagent_type="aw", prompt=<user's full request>)
```

`aw` decides the rest: Micro/Lite run single-pass in its own context; Full hands
off to `aw-planner` → `aw-executor`. This replaces the old "dispatch the planner
first" rule — routing through `aw` fixes the case where a Lite task (which has
no `plan.md`) was sent to the planner anyway.

You may also dispatch `aw-planner` / `aw-executor` directly when you already know
the task is Full and want to skip tier detection.

Continuation phrases that should dispatch the executor when a plan already exists at `.agent/{branch}/plan.md`:

- "execute", "execute the plan", "continue", "proceed", "ship it", "go"

Do NOT auto-trigger for:

- Simple questions, explanations, or code reviews
- Single-file edits or quick fixes (1–2 files) **during interactive work**. Tasks touching 3 files still auto-trigger; `aw`'s tier detection picks Lite (or Micro for a 1-file mechanical change) for them. A dev who *explicitly* invokes `@aw` on a quick fix opts into the Micro tier — that is fine; this exclusion is only about not hijacking casual edits.
- Interactive/collaborative coding where the user is actively guiding
- Exploratory research or investigation
- Tasks where the user explicitly says "here" or "in this session"

The user has opted into this behavior by installing this rule. If unsure whether the task qualifies, prefer triggering — `aw`'s Phase 0 validation will ask clarifying questions before doing any work, at whatever tier it picks.
