---
title: Memory Taxonomy — Types, Lifecycles, Retention
impact: MEDIUM
tags:
  - taxonomy
  - episodic
  - semantic
  - procedural
  - preference
---

# Memory Taxonomy

Four types, grounded in the CoALA framework (Princeton, 2023) and the
Mem0 / Letta literature. Each has a different lifecycle and different
retention rules.

| Type         | What it is                                            | Example                                              | Lifecycle                                       |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| `semantic`   | Durable facts about entities                          | "Anna's favourite teacher is Mr. Chen"              | Long-lived; only consolidate, rarely archive    |
| `episodic`   | Time-bound events and decisions                       | "We switched to weekly piano lessons on 2026-04-30" | Auto-archive after 180 days unless referenced   |
| `procedural` | Workflows, routines, "how to do X"                    | "When Anna is overwhelmed, give her quiet time"    | Long-lived; UPDATE when the routine changes     |
| `preference` | User-stated likes, dislikes, values, opinions         | "I prefer Montessori over traditional schooling"   | Long-lived; UPDATE when contradicted            |

The type is mandatory in entry frontmatter. The extraction step in the
write pipeline must assign exactly one type per candidate.

## Picking the right type

When in doubt, use this decision flow:

1. Does the statement reference a specific moment in time (`on
   2026-04-30`, `last Tuesday`, `during the move`)? → **`episodic`**.
2. Does the statement describe a recurring process or rule ("when X,
   do Y")? → **`procedural`**.
3. Does the statement describe what the user (or a tracked subject)
   likes, dislikes, values, or believes? → **`preference`**.
4. Otherwise, it is a fact about an entity → **`semantic`**.

If a statement could fit two types, pick the one with the longer
lifecycle. (e.g. "Anna started piano on 2026-04-30 and loves it" →
prefer `preference` ("Anna loves piano") + a separate `episodic`
entry ("Anna started piano on 2026-04-30") rather than one mixed
entry.

## Confidence levels

| Confidence | Meaning                                            | Default action                  |
| ---------- | -------------------------------------------------- | ------------------------------- |
| `high`     | Explicitly stated by the user                      | Store                           |
| `medium`   | Strongly implied (multiple consistent references)  | Store                           |
| `low`      | Model inference, single weak reference             | Reject unless `--allow-low`     |

Confidence is captured in frontmatter, not in the body. This lets a
future reader filter by confidence without reading every entry.

## Source attribution

Required field. One of:

- `user-stated` — the user said it directly.
- `inferred` — the model inferred it from conversation context.
- `external` — pulled from a fetched URL, file, or external system.
- `system` — emitted by a tool (e.g. test output, build log).

`user-stated` is the only source that should default to `high`
confidence. Everything else starts at `medium` or lower.

## Retention defaults by type

| Type         | Auto-archive after            | Notes                                       |
| ------------ | ----------------------------- | ------------------------------------------- |
| `semantic`   | Never (manual only)           | Durable facts                               |
| `episodic`   | 180 days, if not referenced   | Adjustable in scope-level config (future)   |
| `procedural` | Never (manual only)           | Routines change; UPDATE, do not archive     |
| `preference` | Never (manual only)           | Beliefs change; UPDATE, do not archive      |

A reference (an `UPDATE` operation, an INDEX cross-reference, or an
explicit `read` of the entry) resets the 180-day clock for episodic
entries.

## Tagging

Tags are free-form kebab-case strings in the entry frontmatter. Use
them aggressively — they are the primary recall surface for `read`.

Conventions:

- Lead with the entity tag (`anna`, `john`, `project-acme`).
- Add a category tag (`school`, `hobbies`, `regulation`, `decision`).
- Add a sub-topic tag when useful (`piano`, `bedtime`, `pickup-time`).

Two or three tags per entry is typical; more than five is noise.
