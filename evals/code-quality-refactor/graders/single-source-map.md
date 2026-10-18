---
type: regex
target: { source: file, path: src/order-status.ts }
pattern: 'Record<\s*OrderStatus\s*,|satisfies\s+Record<'
---

One `Record<OrderStatus, …>` table is the single source of truth for per-status metadata, so a new status fails to compile until every field is filled.
