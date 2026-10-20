---
type: regex
target: { source: file, path: .agent/report-json/plan.md }
pattern: '## Acceptance Criteria[\s\S]*?AC-\d+[^\n]*covers:\s*R\d'
weight: 2
---

The plan has an `## Acceptance Criteria` section whose criteria carry `AC-n` IDs and `(covers: Rn)` traceability back to the requirements.
