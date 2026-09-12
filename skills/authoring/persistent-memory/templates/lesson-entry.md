---
id: <yyyy-mm-dd>-<kebab-case-slug>
created: <ISO-8601 UTC, e.g. 2026-05-15T10:23:00Z>
updated: <ISO-8601 UTC, same as created on ADD>
type: procedural
scope: <lesson-scope-name, e.g. aw-lessons | aw-tester-lessons | fix-bug-lessons | batch-lessons | reviewer-lessons | implement-suggestion-lessons | ci-auto-fix-lessons | e2e-pr-stabilizer-lessons | test-auto-fix-lessons>
seen_count: 1
confidence: <high | medium | low>
status: <active | promoted | retired | structural>
expires: <ISO 8601 — default created + 90 days; refreshed on each re-sighting>
source: system
redacted: false
---

# <one-line takeaway — what to do, not what the lesson is about>

**Applies when:** <concrete signal — file glob, task type, tool name, error shape>

**What happened:** <the concrete observable from the run>
**Why:** <root cause, if known; "unknown" is allowed>
**Do this instead:** <prescriptive, actionable, testable instruction>
**Promotion target:** <the host rule/step this would harden if promoted, or "none">

## History (added on UPDATE only)

- <ISO date>: <prior wording, one line>
- <ISO date>: <earlier wording, one line>
