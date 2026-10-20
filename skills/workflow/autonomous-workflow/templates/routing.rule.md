# Autonomous Workflow Routing

When the user asks to implement something using phrases that signal independent, isolated work — such as:

- "independently", "autonomously", "implement autonomously", "in isolation", "alone", "on your own"
- "end-to-end", "full implementation", "implement X with tests and PR"
- "work on this in a worktree", "do this in parallel"
- "take care of this", "handle this without me"
- "ship this", "land this", "all the way to a PR", "through CI"

invoke the **`aw` dispatcher skill** with the user's full request:

```
Skill("aw", "<user's full request>")
```

`aw` is the only natural-language destination: never route these phrases straight to `autonomous-workflow` (that skips tier detection and the lessons loop).
`aw` picks the tier — Micro/Lite run single-pass here, Full writes the brief here and dispatches one `aw-executor` from this session (or plays the executor in-context when no tool dispatches a sub-agent) — and prints a paste-ready `/goal` line with the brief.
You may dispatch `aw-executor` directly when a brief already exists at `.agent/{branch}/plan.md`.

Continuation phrases that dispatch the executor when `.agent/{branch}/plan.md` exists:

- "execute", "execute the plan", "continue", "proceed", "ship it", "go"

Do NOT auto-trigger for:

- Simple questions, explanations, or code reviews
- Single-file edits or quick fixes (1–2 files) **during interactive work**. Tasks touching 3 files still auto-trigger; `aw` picks Lite (or Micro for a 1-file mechanical change). An explicit `/aw` on a quick fix opts into Micro.
- Interactive/collaborative coding where the user is actively guiding
- Exploratory research or investigation
- Tasks where the user explicitly says "here" or "in this session"

If unsure whether the task qualifies, prefer triggering — `aw`'s Phase 0 asks clarifying questions before doing any work.

Keep this trigger list and `aw`'s `description:` in step, in the same change; rationale: [`references/routing-rationale.md`](../references/routing-rationale.md).
