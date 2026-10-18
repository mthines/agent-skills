---
type: regex
pattern: '^[\s#*>]*Severity\**\s*:\s*\**\s*low\b'
flags: im
---

The tier is `low`: the path matches the exclusion gate (`*/fixtures/*`, `*.down.sql`), so neither the data-loss escalator nor any floor applies, and the defect has no production impact.
