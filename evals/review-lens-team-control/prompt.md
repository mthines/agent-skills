---
description: control — a team lens whose applies-to does not match the change must not load, so its house rule is never raised.
tags: [ablation, review-lens]
max_turns: 10
timeout_seconds: 1500
allowed_tools: [Agent, Read, Glob, Grep, Bash, Write, Skill]
---

Review this branch against `main` before I open a PR.
Dispatch the `branch-reviewer` agent with `--base main --out .agent/findings.jsonl` and wait for it to finish.
Do not change any code.
Then end your reply with a section `## Findings file` that contains only the contents of `.agent/findings.jsonl`, verbatim, or the single line `(no file)` if it does not exist.
