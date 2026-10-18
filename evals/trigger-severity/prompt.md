---
description: A natural "how severe is this" request must route to the severity skill.
tags: [trigger, severity]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

How severe is this bug, and should it block the release? `src/payments/refund.ts` retries a failed refund call without an idempotency key, so a timeout followed by a retry can refund the customer twice.
