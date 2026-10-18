---
title: 'aw-tester — slow-tier lessons and entrenchment guards'
impact: HIGH
tags:
  - aw-tester
  - lessons
  - lorekit
---

# aw-tester — slow-tier lessons

Part of the [`aw-tester`](../templates/aw-tester.agent.md) agent definition. Read after delivering the verdict, before writing any lesson.

After delivering the verdict, write lessons for any of the following:

| Event | What to capture |
|-------|-----------------|
| Locator healing succeeded | Which locator pattern failed, which transformation worked |
| Auth refresh triggered | Aw-Target name, command, whether it succeeded |
| `inconclusive` verdict | Why specs were skipped and what would unblock them |
| New failure pattern | The failing step shape that didn't appear in prior lessons |
| Intent route healed | The route action that stopped replaying and the one that replaced it |
| Intent locator needed a detour | The control the step named and the detour that reached it |

```
# Dedup first, then write to the classified scope (universal → global; repo-bound → repo::).
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write { scope: "<global | repo::{owner}/{repo}>", key: "aw-tester-lessons::<slug>", value: "<body>", tags: ["loop::aw-tester-lessons", "source::<trigger>"], source_agent: "aw-tester", trigger: "<trigger>", ttl_days: 90 }
```

Lesson body (mirrors `aw-lessons` exactly — **markdown and nothing else**; never a
`<!-- meta: … -->` block, and never a hand-written count or expiry date, because every
store-backed fact has its own first-class `memory.write` field):

```markdown
# <one-line takeaway — what to do, not what the lesson is about>

**Applies when:** <concrete signal: locator pattern, aw-target name, component type>

**What happened:** <concrete observable>
**Why:** <root cause or "unknown">
**Do this instead:** <prescriptive, testable instruction>
**Promotion target:** <where in aw-tester this would harden, or "none">
```

Do NOT write a lesson when:
- All specs passed cleanly with no healing.
- The only failure was an expected auth issue already covered by a lesson.
- LoreKit's `memory.*` tools are not connected.

**Promotion check:** after writing, check if any lesson (written or matched at
startup) has the store's own `seen_count >= 3` or carries the `status::structural`
tag. If so, surface:
```
Lesson "<title>" has recurred N times. Promote it to a permanent guard?
Run: /create-skill diagnose autonomous-workflow --symptom "<lesson title>"
```

## Entrenchment Guards

These are identical to the `aw-lessons` guards — mandatory:

1. Lessons are **advisory**. A lesson biases the locator-healing heuristics;
   it can never silently skip a spec or change the verdict schema.
2. Recurrence gates promotion. The store's `seen_count >= 3`, or the
   `status::structural` tag, before a lesson is suggested for promotion.
3. Every lesson expires. Pass `ttl_days: 90` on every write; a recurrence
   re-passes it, which refreshes the expiry from the last sighting.
4. Contradicting lessons are surfaced for review, not silently overwritten.
5. Privacy pre-flight is never bypassed. Never store credentials, tokens,
   customer names, or product data in lessons.
