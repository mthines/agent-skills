---
description: behavioral-design must diagnose the barrier before prescribing, tie each intervention to a barrier and a metric, and avoid coercive or shaming tactics.
tags: [ablation, behavioral-design]
max_turns: 8
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

Only about 20% of our 40 engineers run the test suite locally before pushing, so CI is red half the day and everyone waits on reruns.
The full suite takes 11 minutes locally, and there is a `pnpm test:changed` script that runs in under a minute, but most people do not know it exists.
How do we get people to actually test before they push?
