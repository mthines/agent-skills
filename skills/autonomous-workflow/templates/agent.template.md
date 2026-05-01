<!--
DEPRECATED — kept for backward compatibility only.

The autonomous-workflow now installs two agents (`aw-planner` +
`aw-executor`) connected by `plan.md`. This single-agent template is
no longer linked by `install.sh`.

Existing installs that point at this file still work, but new installs
should use `planner.template.md` + `executor.template.md`.

See:
- `../rules/planner-executor-handoff.md` — handoff contract
- `./planner.template.md`
- `./executor.template.md`
-->

---
name: autonomous-workflow
description: >
  DEPRECATED single-agent template. Use the planner + executor split instead.
  Kept only so existing installs that still reference this file keep working.
tools: Read, Write, Edit, Bash, Glob, Grep, Skill
model: sonnet
---

# Autonomous Workflow Agent (deprecated single-agent template)

This template is preserved for users with existing installs that still link
to it. New installs use the planner + executor split — see
[`planner.template.md`](./planner.template.md) and
[`executor.template.md`](./executor.template.md), with the contract
described in
[`../rules/planner-executor-handoff.md`](../rules/planner-executor-handoff.md).

## First: Load the full skill

```
Skill(skill: "autonomous-workflow")
```

The skill body contains all phases (0–7), companion invocations, and rules.
Follow them. If the skill is unavailable, install it via the project README.
