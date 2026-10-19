---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '\}\s*else\b'
match: not_contains
---

No `else` remains in `src/shipping.mjs`; both `else` branches followed a `return`.
