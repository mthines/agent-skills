---
description: tdd must produce a failing test run before the first edit to the implementation file, then a green suite.
tags: [ablation, tdd, smoke]
max_turns: 15
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Skill, Edit, Write, Bash]
---

Add discount-code support to the cart in `src/cart.mjs`, test-first.

Add an exported `total(items, code)` function:

- no code (`undefined`) means no discount;
- `SAVE10` takes 10% off the subtotal;
- `SAVE25` takes 25% off the subtotal;
- any other code throws a `RangeError`.

The project runs its tests with `node --test`.
