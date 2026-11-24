# Intent — notification settings (no PR yet, no ticket)

Intent source: /aw brief

## Acceptance criteria
- ✅ AC-1 [ui:/settings/notifications] When a channel is toggled off, the toggle shows off after reload.   (spec: specs.md Spec 1)
- ⏭️ AC-2 [api:PUT /api/notification-settings] An empty channel list returns 400.

## Guardrails
- G-1 [guardrail] Keep unchanged: the public settings API shape
