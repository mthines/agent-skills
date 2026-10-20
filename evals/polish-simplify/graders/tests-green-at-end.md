---
type: regex
target: trace
pattern: 'pass 10\\n[^"]{0,30}fail 0(?![\s\S]*fail [1-9]\d*\\n)'
---

The trace shows a `node --test` run with all ten tests passing, and no later run with a failure.
