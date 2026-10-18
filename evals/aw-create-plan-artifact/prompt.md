---
description: aw-create-plan must write .agent/<branch>/plan.md with ID'd, requirement-traced Acceptance Criteria, plus a checks.yaml derived from them.
tags: [ablation, aw-create-plan]
max_turns: 15
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We agreed on the approach below.
Write the plan artifact for it now so a fresh agent session can pick it up and execute it later without this conversation.
Do not implement anything yet.

Task: add a `--json` flag to the `report` CLI in `src/cli.mjs`.

- With `--json`, print the report as one JSON object on stdout instead of the text table.
- Without the flag, the output is unchanged.
- An unknown flag prints usage to stderr and exits with code 2.
- The formatting logic lives in `src/format.mjs`, which already exports `formatTable(rows)`; add `formatJson(rows)` next to it.
