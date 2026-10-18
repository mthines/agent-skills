---
description: code-quality must turn the nested refund check into guard clauses and collapse the per-status if-chain and switch into one Record<OrderStatus, …> map.
tags: [ablation, code-quality, smoke]
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Edit, Write, Bash]
---

`src/order-status.ts` has grown hard to read and the next person to add a status will get it wrong.
Refactor it for readability and maintainability without changing its behaviour.
Keep the exported function names and signatures.
When you are done, run `node --test` and make sure it passes.
