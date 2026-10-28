---
description: branch-reviewer must load a team lens from .agents/review/lenses/ when its applies-to matches, and raise the house rule only that lens states.
tags: [review-lens]
max_turns: 10
timeout_seconds: 1500
allowed_tools: [Agent, Read, Glob, Grep, Bash, Write, Skill]
---

Review this branch against `main` before I open a PR.
Dispatch the `branch-reviewer` agent with `--base main --out .agent/findings.jsonl` and wait for it to finish.
Do not change any code.
Then end your reply with a section `## Findings file` that contains only the contents of `.agent/findings.jsonl`, verbatim, or the single line `(no file)` if it does not exist.
