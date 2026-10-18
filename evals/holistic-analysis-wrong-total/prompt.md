---
description: After a failed point fix, holistic-analysis must trace load → pricing → format and put the fix at the load boundary, not in the formatter.
tags: [ablation, holistic-analysis]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

Order totals on the receipt are wrong for orders that have shipping, e.g. order `A-7` shows `29.54` instead of `34.49`.
I already tried fixing it by wrapping the total in `parseFloat` in `src/format.mjs` and it is still wrong.
Step back and figure out what is actually going on before we touch anything else.
Do not edit files; tell me where the fix belongs and why.
