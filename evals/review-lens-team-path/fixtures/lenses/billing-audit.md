---
applies-to: "services/billing/**"
---

# Billing audit — Review Lens

## Trigger

Every change under `services/billing/`. Compliance reconstructs invoice history from the audit log alone.

## Checklist

- [ ] Every new or changed exported function in `services/billing/` that changes an invoice calls `audit.record("billing.<functionName>", { id })` from `lib/audit.mjs` before it returns.
