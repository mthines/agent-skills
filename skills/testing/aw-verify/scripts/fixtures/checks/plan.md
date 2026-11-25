---
tier: Lite
---
## Task
Fall back to %TEMP% when os.tmpname() returns a bare name.
## Guardrails
- Keep unchanged: the macOS and Linux temp path — docs/render.md
## Acceptance Criteria
- [ ] AC-1 — When os.tmpname() returns a bare name and TEMP is set, temp_dir() shall return TEMP.
- [ ] AC-2 — When TEMP is empty and TMP is set, temp_dir() shall return TMP.
- **Before PR**: `pnpm vitest run render-lib`
