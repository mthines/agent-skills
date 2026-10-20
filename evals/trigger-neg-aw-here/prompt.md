---
description: A one-line fix the user asks for "here" must not route to the aw dispatcher.
tags: [trigger, aw, negative]
max_turns: 4
timeout_seconds: 120
allowed_tools: [Read, Glob, Grep, Skill]
---

Quick one, just fix it here in this session: `const recieveTimeoutMs = 30;` has a typo in the name. Give me the corrected line.
