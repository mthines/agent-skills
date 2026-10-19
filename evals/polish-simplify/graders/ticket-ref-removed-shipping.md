---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: 'ENG-1234'
match: not_contains
---

The internal ticket reference is gone from `src/shipping.mjs`.
