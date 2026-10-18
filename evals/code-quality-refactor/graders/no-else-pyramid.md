---
type: regex
target: { source: file, path: src/order-status.ts }
pattern: '\}\s*else\s*\{'
match: not_contains
---

Guard clauses replace the `} else {` pyramid in `canRefund`.
