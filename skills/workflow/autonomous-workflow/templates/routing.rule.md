# Autonomous Workflow Routing

When the user asks to implement something using phrases that signal independent, isolated work — such as:

- "independently", "autonomously", "implement autonomously", "in isolation", "alone", "on your own"
- "end-to-end", "full implementation", "implement X with tests and PR"
- "work on this in a worktree", "do this in parallel"
- "take care of this", "handle this without me"
- "ship this", "land this", "all the way to a PR", "through CI"

> This trigger vocabulary is mirrored in the `aw` skill's `description:`
> frontmatter (`aw/SKILL.md`) — the two are one coherent discovery surface, and
> the duplication is forced: frontmatter cannot link a canonical home the way
> `aw/SKILL.md` links the tier table, and this file is also the live rubric the
> L2 `aw-should-trigger` suite reads. So the lists are kept honest by assertion
> instead: L1 `G2d` requires every phrase quoted in the description to appear
> here. When you add, remove, or reword a trigger phrase, update both in the
> same change.
>
> **`aw` is the only natural-language destination.** The parent
> `autonomous-workflow` skill is the phase machinery, not an entry point — its
> description carries no trigger vocabulary and it is reached by
> `/autonomous-workflow` or by `aw` itself. Never route a phrase above straight
> to it: that skips tier detection and the lessons loop, which is the whole job
> of the dispatcher. `G2d` also asserts the parent's description stays clear of
> these phrases, so the two cannot start competing for the same request again.

Invoke the **`aw` dispatcher skill** with the user's full request:

> `aw` is a **skill**, not an agent — it runs in *this* context. The two agents
> it hands off to keep the `aw-` namespace prefix (`aw-` = "autonomous-workflow"):
> `aw-planner` (phases 0–2) and `aw-executor` (phases 3–7), connected by
> `plan.md`, are the **Full-tier** realization.

```
Skill("aw", "<user's full request>")
```

`aw` decides the rest: Micro/Lite run single-pass here; Full dispatches
`aw-planner` → `aw-executor`. Because the dispatcher is in-context, those two
agents are dispatched from **this** session — one rung higher than they sat
under the retired `aw` agent, so they keep whatever nested dispatch the harness
grants (that is why `aw` is a skill; see
[`CLAUDE.md`](../CLAUDE.md#the-dispatcher-is-a-skill-not-an-agent--design-intent)).

**There is no dispatch-unavailable branch for the dispatcher itself.** A skill
needs no `Task` tool to start, so `aw` runs whether or not sub-agent dispatch
exists. When `Task` is missing, `aw` handles it *internally* by running the
**single-context Full** path (planner role → gated `plan.md` + `checks.yaml` →
executor role through Phases 3–7 in one window), preserving the plan artifact
and the `confidence(plan)` gate. Do not pre-empt that decision here.

You may also dispatch `aw-planner` / `aw-executor` directly when you already know
the task is Full and want to skip tier detection.

Continuation phrases that should dispatch the executor when a plan already exists at `.agent/{branch}/plan.md`:

- "execute", "execute the plan", "continue", "proceed", "ship it", "go"

Do NOT auto-trigger for:

- Simple questions, explanations, or code reviews
- Single-file edits or quick fixes (1–2 files) **during interactive work**. Tasks touching 3 files still auto-trigger; `aw`'s tier detection picks Lite (or Micro for a 1-file mechanical change) for them. A dev who *explicitly* invokes `/aw` on a quick fix opts into the Micro tier — that is fine; this exclusion is only about not hijacking casual edits.
- Interactive/collaborative coding where the user is actively guiding
- Exploratory research or investigation
- Tasks where the user explicitly says "here" or "in this session"

The user has opted into this behavior by installing this rule. If unsure whether the task qualifies, prefer triggering — `aw`'s Phase 0 validation will ask clarifying questions before doing any work, at whatever tier it picks.
