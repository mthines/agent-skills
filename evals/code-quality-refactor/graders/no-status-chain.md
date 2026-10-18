---
type: regex
target: { source: file, path: src/order-status.ts }
pattern: 'case\s+"pending"|===\s*"pending"'
match: not_contains
---

Per-status labels and colours come from the map, not from a re-enumerated if-chain or switch.
