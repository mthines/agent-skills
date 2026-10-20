---
type: regex
pattern: '(?:plan\.md|store\.ts|auth\.ts)(?::\d+|[^\n]{0,20}(?:line|L|step)\s*\d+)'
flags: i
---

At least one finding is pinned to a file plus a line or plan step (for example `plan.md:14`, `auth.ts line 9`, or `plan.md step 4`).
