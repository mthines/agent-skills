# Autonomous Workflow Agent Routing

When the user asks to implement something using phrases that signal independent, isolated work — such as:

- "independently", "autonomously", "in isolation", "alone", "on your own"
- "end-to-end", "full implementation", "implement X with tests and PR"
- "work on this in a worktree", "do this in parallel"
- "take care of this", "handle this without me"
- "ship this", "land this", "all the way to a PR", "through CI"

Automatically dispatch the autonomous workflow as follows:

1. **If the split-flavor agents are installed** (check for `autonomous-planner.md` + `autonomous-executor.md` in `~/.claude/agents/` or `./.claude/agents/`):
   - Dispatch `autonomous-planner` first with the user's full request as the prompt.
   - When the planner finishes and `plan.md` is gated (`confidence(plan) ≥ 90%`), dispatch `autonomous-executor` with the plan path. If confidence is below 90%, the planner will already have escalated to the user — wait for their decision before dispatching the executor.
2. **Otherwise** (monolithic flavor only): dispatch `autonomous-workflow` with the user's full request as the prompt.

Continuation phrases that should dispatch the executor when a plan already exists at `.agent/{branch}/plan.md`:

- "execute", "execute the plan", "continue", "proceed", "ship it", "go"

Do NOT auto-trigger for:

- Simple questions, explanations, or code reviews
- Single-file edits or quick fixes (< 3 files)
- Interactive/collaborative coding where the user is actively guiding
- Exploratory research or investigation
- Tasks where the user explicitly says "here" or "in this session"

The user has opted into this behavior by installing this rule. If unsure whether the task qualifies, prefer triggering — the planner's Phase 0 validation will ask clarifying questions before doing any work.
