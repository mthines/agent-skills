# Taxonomy — `plan` mode

Read this in every `critical plan` run, including `deep plan`, where every lens walks it.

Walk every row.
For each, either produce a specific challenge or write `— ok` and a one-line reason.
Vague "looks fine" is not allowed.

| # | Concern | Probe |
| - | --- | --- |
| 1 | Hidden assumptions about data, scale, or users | What is the plan assuming about input shape, volume, concurrency, or user behaviour? |
| 2 | Top three production failure modes | Name three specific ways this breaks in production — what fails, in what flow. |
| 3 | Blast radius | What else is affected? Shared state, callers, downstream services, RBAC, billing, audit logs. |
| 4 | Rollback / reversibility | If this fails 30 minutes post-deploy, can it be reverted cleanly? Any one-way migrations? |
| 5 | Hidden coupling | Which implicit dependencies (env, ordering, schemas, feature flags) does this rely on? |
| 6 | Maintainability | Will a new engineer understand it in 6 months? Naming, layering, indirection. |
| 7 | Scope creep / incidental change | Is anything being changed that isn't strictly required to satisfy the requirement? |
| 8 | Test design (assertion strength, not coverage) | Do the planned tests assert behaviour, or just shape? What would a passing test miss? |

Row 9 is the [Steelman alternative](../SKILL.md#mandatory-steelman-alternative) — mandatory, written in the SKILL.md structure.
