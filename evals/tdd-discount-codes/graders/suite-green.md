---
type: regex
target: trace
pattern: 'pass (?:[4-9]|\d{2,})\b[\s\S]{0,40}fail 0'
---

A final `node --test` summary shows at least four passing tests (the two fixture tests plus new discount tests) and no failures.
