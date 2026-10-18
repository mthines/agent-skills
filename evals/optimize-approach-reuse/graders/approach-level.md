---
type: llm
---

PASS if the reply recommends replacing the nested-loop dedupe with the existing `uniqueBy` helper, justifies it on codebase fit (the helper already exists and `src/audit.mjs` uses it), and any replacement it proposes keeps today's behaviour by filtering to active sessions before deduplicating (for example `uniqueBy(sessions.filter((s) => s.active), (s) => s.userId)`).
FAIL if the reply only suggests line-level tweaks (variable names, `for…of`, `some()`) without pointing at `uniqueBy`, proposes writing a new helper, or proposes code that deduplicates before filtering (which drops a user whose first session is inactive).
