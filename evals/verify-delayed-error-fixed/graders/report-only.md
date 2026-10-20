---
type: regex
target: { source: file, path: src/audit.mjs }
pattern: 'FLUSH_MS = 8000'
---

The run reported instead of fixing: the code under test is unchanged.
