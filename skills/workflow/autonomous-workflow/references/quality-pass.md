# Why the quality pass is report-only and runs after the build

Autonomous runs ship working code that sometimes picks a weak UX answer or re-implements something the codebase already has.
Agents find the existing code about 99 % of the time but reuse it in only 67–86 % of runs, so the reuse lane forces a written verdict per new item instead of a better search.
LLM judges are near chance at UX taste and favour generated output, so the UX lane grades against a short written house rubric, in a fresh context, never "pick the best UX".

The pass runs after the build and verification, not at plan time: a finished diff and real screenshots give the graders something concrete, and plan-time review of a guessed design is the brief bloat the Full tier removed.
It is report-only because its judgements are advisory: a loop that rebuilt on every `extend` verdict would trade a shipped, verified change for a second build that nothing verifies, and the reviewer is the one who decides whether a reuse is worth the switch.
