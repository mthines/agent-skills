---
type: llm
---

PASS only if ALL of these hold:

1. The reply names at least three concrete failure modes, and at least two of them are among: every user is logged out at cutover because sessions are not migrated (step 3/4 `FLUSHALL`); rollback is impossible once Redis is flushed or deleted (steps 4–5 versus "Rollback: revert the deploy"); the auth middleware writes the session on every request, so Postgres takes a write per request at peak load; nothing expires rows in the `sessions` table; mocked-DB unit tests cannot catch any of this.
2. Each named failure mode points at where it comes from — a file, a plan step or line, or an explicitly named assumption.
3. The reply proposes at least one concrete alternative approach (for example dual-write or read-through migration, a feature flag, or a staged rollout with Redis kept as fallback) and argues for it.

FAIL if the findings are generic advice that would apply to any migration, if fewer than three concrete failure modes are named, or if no alternative approach is proposed.
