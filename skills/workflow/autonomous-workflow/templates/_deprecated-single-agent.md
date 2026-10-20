<!--
DEPRECATED — kept for backward compatibility only.

The autonomous-workflow now runs Full tasks as a brief written by the `aw`
skill plus one `aw-executor` agent, connected by `plan.md`. This
single-agent template is no longer linked by `install.sh`.

Existing installs that point at this file still work, but new installs
should use the `aw` skill + `aw-executor.agent.md`.

See:
- `../rules/planner-executor-handoff.md` — handoff contract
- `./aw-executor.agent.md`
-->

---
name: autonomous-workflow
description: >
  DEPRECATED single-agent template. Use the `aw` skill + `aw-executor` instead.
  Kept only so existing installs that still reference this file keep working.
tools: Read, Write, Edit, Bash, Glob, Grep, Skill
model: sonnet
---

# Autonomous Workflow Agent (deprecated single-agent template)

This template is preserved for users with existing installs that still link
to it. New installs use the `aw` skill's brief +
[`aw-executor.agent.md`](./aw-executor.agent.md), with the contract
described in
[`../rules/planner-executor-handoff.md`](../rules/planner-executor-handoff.md).

## First: Load the full skill

```
Skill(skill: "autonomous-workflow")
```

The skill body contains all phases (0–7), companion invocations, and rules.
Follow them. If the skill is unavailable, install it via the project README.
