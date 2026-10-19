---
type: regex
target: { source: file, path: test/shipping.test.mjs }
pattern: '\.(?:skip|todo|only)\b|\{\s*(?:skip|todo|only)\s*:'
match: not_contains
---

No branch test is skipped, marked todo, or narrowed with `only`.
