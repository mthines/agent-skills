---
type: regex
pattern: '## Findings file(?![\s\S]*audit\.record)'
---

The findings never ask for `audit.record(`: the change is under `services/catalog/`, outside the billing lens's `applies-to`, so the lens does not load.
