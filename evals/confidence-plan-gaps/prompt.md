---
description: confidence(plan) must cap a plan with no Acceptance Criteria and a dangling File Changes path below 90% and name both gaps.
tags: [ablation, confidence]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Bash]
---

Rate your confidence that `plan.md` is ready to hand to an autonomous agent to execute without me.
Finish your reply with one line in the form `Final: N%`.
