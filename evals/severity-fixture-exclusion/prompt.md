---
description: severity's exclusion gate must keep a destructive shape in a test fixture from being floored or escalated.
tags: [ablation, severity]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

A reviewer flagged this on our PR and I need to decide whether it blocks the merge.

> `tests/fixtures/seed.down.sql:3` runs `DROP TABLE users;`.
> The file is only loaded by the integration-test harness, which creates a throwaway database per test run; nothing in production or in the migration runner references it.

How severe is this finding?
Start your reply with one line `Severity: <critical|high|medium|low>`, then explain.
