---
description: verify must run the first-token onboarding on the local app and read its logs and data, so it catches the check-then-insert race that mints two first tokens when /welcome loads twice at once — green unit tests, clean logs, and a correct single walk-through all miss it.
tags: [ablation, verify]
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Agent]
---

/mthines-agent-skills:verify run local --no-fix --no-push --no-comment

Verify the first-token onboarding on this branch end to end on the local app: a brand-new user signs in for the first time and opens /welcome.
The acceptance criteria are in `.agent/feat-first-token/plan.md`, and the repo facts are in `.agents/aw/notes.md`.
Report only: do not change the code.
End your reply with a section `## Verdict` that says `WORKS` or `BROKEN`, then each defect you found with its evidence and where in the code it comes from.
