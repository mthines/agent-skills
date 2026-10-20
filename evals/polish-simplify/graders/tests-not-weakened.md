---
type: regex
target: { source: file, path: test/shipping.test.mjs }
pattern: '^test\("'
flags: m
match: "count:9"
---

All nine branch tests are still present as top-level `test("…")` calls.
