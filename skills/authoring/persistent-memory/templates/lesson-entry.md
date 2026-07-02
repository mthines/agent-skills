---
id: <yyyy-mm-dd>-<kebab-case-slug>
created: <ISO-8601 UTC, e.g. 2026-05-15T10:23:00Z>
updated: <ISO-8601 UTC, same as created on ADD>
type: procedural
scope: <lesson-scope-name, e.g. aw-lessons | aw-tester-lessons | fix-bug-lessons | batch-lessons | reviewer-lessons | implement-suggestion-lessons>
phase: <host-skill phase the lesson applies to, e.g. 0–7>
trigger-context: <concrete signal — file glob, task type, tech, e.g. "RN screens (*.tsx nested)">
seen_count: 1
confidence: <high | medium | low>
status: active
expires: <ISO 8601 — default created + 90 days; refreshed on each re-sighting>
source: system
redacted: false
---

# <One-line lesson title — same as the INDEX line>

**What failed:** <concrete observable from the run>
**Why:** <root cause, if known; "unknown" is allowed>
**What to do next time:** <prescriptive, actionable, testable instruction>
**Promotion target:** <skill rule/phase this would harden if promoted, or "none">

## History (added on UPDATE only)

- <ISO date>: <prior wording, one line>
- <ISO date>: <earlier wording, one line>
