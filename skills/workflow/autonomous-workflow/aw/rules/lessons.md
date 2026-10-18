---
title: 'aw lessons loop — intake read, exit write, promotion'
impact: MEDIUM
tags:
  - aw
  - lessons
  - lorekit
---

# aw lessons loop

Read at intake (every tier) and again after the run, before the terminal contract.
The lesson schema, the universal-vs-project classification, and the entrenchment guards live in the workflow's `rules/self-improvement-loop.md`; read it before classifying a lesson.

## Intake read

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-lessons"], limit: 50 }   # no-op if memory.* not connected
memory.list { scope: "global",               tags: ["loop::aw-lessons"], limit: 50 }
```

1. Union both results; on a contradiction the `repo::` lesson wins.
2. Match each lesson's **Applies when** line against the task.
3. Matches inform the tier decision and the approach; Full passes them to `aw-planner` for `## Lessons applied`.

## Exit write

After the run (PR opened or work handed back), list friction, surprises, near-misses, and companions that should have fired; classify each universal or project-bound; dedup; then write:

```text
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write  { scope: "global" | "repo::{owner}/{repo}", key: "aw-lessons::<slug>",
                value: "<body>", tags: ["loop::aw-lessons", "source::<trigger>"],
                source_agent: "aw", trigger: "<trigger>", ttl_days: 90 }
```

- `<body>` is markdown only: a `#` takeaway title, a visible `**Applies when:**` line, then `**What happened:** / **Why:** / **Do this instead:** / **Promotion target:**`. Never a hidden `<!-- meta: … -->` header, front matter, or JSON — store-backed facts have their own write fields.
- Phrase each capture as an observation ("last run hit X"), never a rule ("always do Y").
- A lesson applied at intake whose failure did not recur gets an UPDATE: the store increments `seen_count` by 1 for you, and re-passing `ttl_days` refreshes the expiry.
- Write nothing only when the review surfaced nothing and no lesson was applied.
- Never write secrets or PII.

## Promotion

At `seen_count >= 3` or a `status::structural` tag, surface the suggestion and do not act:

| Scope | Suggestion |
| --- | --- |
| `global` | `/create-skill diagnose autonomous-workflow --symptom "<title>"` |
| `repo::` | `Skill("docs", "update --add-rule \"<title>\" --source lorekit:repo::{owner}/{repo}/aw-lessons::<slug>")` |
