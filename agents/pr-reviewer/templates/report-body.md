<!-- PR_REVIEWER_REPORT -->
{{#PARTIAL_BANNER}}⚠️ **Partial review — tool budget exhausted after {{BUDGET_CALLS}} calls; {{BUDGET_SCANNED}} of {{BUDGET_TOTAL}} files scanned.**

{{/PARTIAL_BANNER}}{{HEADLINE}}

{{SUMMARY_LINE}}
{{#REASONS_LINE}}
{{REASONS_LINE}}
{{/REASONS_LINE}}{{#ADVISORY_LINE}}
{{ADVISORY_LINE}}
{{/ADVISORY_LINE}}{{#IMPACT_IMAGE}}
{{IMPACT_IMAGE}}
{{/IMPACT_IMAGE}}{{#FINDINGS_INDEX}}
{{FINDINGS_INDEX}}
{{/FINDINGS_INDEX}}{{#FIX_ALL_BUTTON}}
{{FIX_ALL_BUTTON}}
{{/FIX_ALL_BUTTON}}{{#ADDITIONAL_FINDINGS}}
<details>
<summary>{{ADDITIONAL_COUNT}} more findings — verified, too minor to comment on</summary>
<br>

{{ADDITIONAL_FINDINGS}}

</details>
{{/ADDITIONAL_FINDINGS}}{{#NOTES}}
<details>
<summary>Notes ({{NOTES_COUNT}}) — posted inline</summary>
<br>

{{NOTES}}

</details>
{{/NOTES}}{{#LOW_CONFIDENCE_FINDINGS}}
<details>
<summary>Less certain ({{LOW_CONFIDENCE_COUNT}}) — advisory, below the confidence bar</summary>
<br>

{{LOW_CONFIDENCE_FINDINGS}}

</details>
{{/LOW_CONFIDENCE_FINDINGS}}{{#OPTIMALITY_CARDS}}
<details>
<summary>Is there a better approach? ({{OPTIMALITY_COUNT}})</summary>

{{OPTIMALITY_CARDS}}

</details>
{{/OPTIMALITY_CARDS}}
<details>
<summary>Review details{{OPEN_THREADS_SUFFIX}}</summary>
<br>

| Gate | | Details |
|---|:-:|---|
| Description vs. code | {{GATE_DESCRIPTION_STATUS}} | {{GATE_DESCRIPTION_DETAILS}} |
| Prior review feedback | {{GATE_PRIOR_STATUS}} | {{GATE_PRIOR_DETAILS}} |
| Documentation | {{GATE_DOCS_STATUS}} | {{GATE_DOCS_DETAILS}} |
| Self-review signals | {{GATE_SELFREVIEW_STATUS}} | {{GATE_SELFREVIEW_DETAILS}} |
| Code review | {{GATE_CODEREVIEW_STATUS}} | {{GATE_CODEREVIEW_DETAILS}} |
{{#OPEN_THREADS}}
**Open review threads ({{OPEN_THREADS_COUNT}})**{{RESOLVED_SINCE}}

{{OPEN_THREADS}}
{{/OPEN_THREADS}}
{{#WITHHELD}}<details>
<summary>Withheld ({{WITHHELD_COUNT}}) — could not be verified from this runner</summary>

{{WITHHELD}}

</details>

{{/WITHHELD}}| Run | Details |
|---|---|
{{RUN_ROWS}}
{{#MEMORIES_LIST}}
**Memories used**

{{MEMORIES_LIST}}
{{/MEMORIES_LIST}}{{#NOTHING_TO_REPORT}}
<sup>Nothing to report — {{NOTHING_TO_REPORT}}.</sup>
{{/NOTHING_TO_REPORT}}
</details>

{{FOOTER_SUP}}
