<!-- PR_REVIEWER_REPORT -->
{{#PARTIAL_BANNER}}⚠️ **Partial review — tool budget exhausted after {{BUDGET_CALLS}} calls; {{BUDGET_SCANNED}} of {{BUDGET_TOTAL}} files scanned.**

{{/PARTIAL_BANNER}}{{HEADLINE}}
{{RECOMMENDATION_LINE}}
{{UPDATED_LINE}}
{{#FIX_ALL_BUTTON}}
{{FIX_ALL_BUTTON}}
{{/FIX_ALL_BUTTON}}{{#OPTIMALITY_CARDS}}
<details>
<summary>Optimality review ({{OPTIMALITY_COUNT}}) — is this the best approach?</summary>

{{OPTIMALITY_CARDS}}

</details>
{{/OPTIMALITY_CARDS}}{{#ADDITIONAL_FINDINGS}}
<details>
<summary>Additional findings ({{ADDITIONAL_COUNT}}) — cleared review, not inlined</summary>

{{ADDITIONAL_FINDINGS}}

</details>
{{/ADDITIONAL_FINDINGS}}{{#LOW_CONFIDENCE_FINDINGS}}
<details>
<summary>Low-confidence findings ({{LOW_CONFIDENCE_COUNT}}) — advisory, below the confidence bar</summary>

{{LOW_CONFIDENCE_FINDINGS}}

</details>
{{/LOW_CONFIDENCE_FINDINGS}}
<details>
<summary>Review details{{OPEN_THREADS_SUFFIX}}</summary>

<sup>{{FOOTER_LINE}}</sup>

| Gate | Status | Details |
|---|---|---|
| Description vs. code | {{GATE_DESCRIPTION_STATUS}} | {{GATE_DESCRIPTION_DETAILS}} |
| Prior review feedback | {{GATE_PRIOR_STATUS}} | {{GATE_PRIOR_DETAILS}} |
| Documentation | {{GATE_DOCS_STATUS}} | {{GATE_DOCS_DETAILS}} |
| Self-review signals | {{GATE_SELFREVIEW_STATUS}} | {{GATE_SELFREVIEW_DETAILS}} |
| Code review | {{GATE_CODEREVIEW_STATUS}} | {{GATE_CODEREVIEW_DETAILS}} |
{{#OPEN_THREADS}}
**Open review threads ({{OPEN_THREADS_COUNT}})**{{RESOLVED_SINCE}}

{{OPEN_THREADS}}
{{/OPEN_THREADS}}{{#CI_NOTE}}
**CI** — {{CI_NOTE}}
{{/CI_NOTE}}{{#VERIFIED_NOTE}}
**Verified** — {{VERIFIED_NOTE}}
{{/VERIFIED_NOTE}}
**Run mode** — {{RUN_MODE}}

**Memories** — {{MEMORIES_SUMMARY}}
{{#MEMORIES_BULLETS}}
{{MEMORIES_BULLETS}}
{{/MEMORIES_BULLETS}}

{{#TIER_BREAKDOWN}}**Severity** — {{TIER_BREAKDOWN}}

{{/TIER_BREAKDOWN}}**Quality** — {{QUALITY}}
{{#QUALITY_DROPPED}}
- dropped: {{QUALITY_DROPPED}}
{{/QUALITY_DROPPED}}
**Integrations** — {{INTEGRATIONS}}

**Optimality (2.4c)** — {{OPTIMALITY_LOG}}

**Standards (2.4d)** — {{STANDARDS_LOG}}

**Skipped files** — {{SKIPPED_FILES}}

<sup>Reviewed by the [`pr-reviewer`](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) agent — open it to read how these gates and findings are produced.</sup>

</details>
