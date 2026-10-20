---
type: regex
pattern: 'confidence[^\n]{0,25}\b\d{1,3}\s?%'
flags: i
match: not_contains
---

The pre-mortem surfaces concerns and does not score the plan; scoring is `confidence`'s job.
