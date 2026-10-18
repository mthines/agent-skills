---
description: A natural "make this readable" request must route to the code-quality skill.
tags: [trigger, code-quality]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

Clean this up and make it more readable, just show me the new version:

```ts
function fee(u: { plan: string; country: string; seats: number }) {
  if (u.plan === "pro") { if (u.country === "DK") { if (u.seats > 10) { return 8; } else { return 10; } } else { return 12; } }
  else { if (u.plan === "team") { return u.seats > 10 ? 15 : 18; } else { return 0; } }
}
```
