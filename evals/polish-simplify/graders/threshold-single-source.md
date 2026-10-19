---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '\b5_?000\b'
match: "count:1"
---

The free-shipping threshold literal appears exactly once in `src/shipping.mjs` (a named constant), not repeated at each use.
