---
type: regex
pattern: '## Findings file[\s\S]*audit\.record'
---

The findings name the missing `audit.record(` call in `refundInvoice`: a house rule stated only by `.agents/review/lenses/billing-audit.md`, which loads because the change is under `services/billing/`.
