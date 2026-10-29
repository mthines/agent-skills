---
type: regex
pattern: '## Findings file[\s\S]*\[lens:optimize-approach\][\s\S]{0,500}getUsers'
---

A finding tagged `[lens:optimize-approach]` names the batch query `getUsers` as the better shape for the per-event `getUser` loop in `services/reports/activity.mjs`.
