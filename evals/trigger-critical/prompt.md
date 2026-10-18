---
description: A natural "challenge this plan" request must route to the critical skill.
tags: [trigger, critical, smoke]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Challenge this plan before I ship it: on Friday we drop the `legacy_orders` table because nothing reads it any more, then deploy the new orders service straight after.
