---
description: A natural "rate your confidence" request must route to the confidence skill.
tags: [trigger, confidence]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Rate your confidence in this plan before I let an agent run it: add a Redis-backed token bucket in front of `GET /search`, 10 requests per second per API key, return 429 with `Retry-After` when over the limit, and read the limits from the existing config service.
