<!-- PR_REVIEWER_REPORT -->
{{#PARTIAL_BANNER}}⚠️ **Partial review — tool budget exhausted after {{BUDGET_CALLS}} calls; {{BUDGET_SCANNED}} of {{BUDGET_TOTAL}} files scanned.**

{{/PARTIAL_BANNER}}{{HEADLINE}}

{{SUMMARY_LINE}}
{{#REASONS_LINE}}
{{REASONS_LINE}}
{{/REASONS_LINE}}{{#ADVISORY_LINE}}
{{ADVISORY_LINE}}
{{/ADVISORY_LINE}}{{#FINDINGS_INDEX}}
{{FINDINGS_INDEX}}
{{/FINDINGS_INDEX}}{{#FIX_ALL_BUTTON}}
{{FIX_ALL_BUTTON}}
{{/FIX_ALL_BUTTON}}{{#OPTIMALITY_CARDS}}
<details>
<summary>Is there a better approach? ({{OPTIMALITY_COUNT}})</summary>

{{OPTIMALITY_CARDS}}

</details>
{{/OPTIMALITY_CARDS}}{{#ADDITIONAL_FINDINGS}}
<details>
<summary>{{ADDITIONAL_COUNT}} more findings — verified, too minor to comment on</summary>

{{ADDITIONAL_FINDINGS}}

</details>
{{/ADDITIONAL_FINDINGS}}{{#LOW_CONFIDENCE_FINDINGS}}
<details>
<summary>Less certain ({{LOW_CONFIDENCE_COUNT}}) — advisory, below the confidence bar</summary>

{{LOW_CONFIDENCE_FINDINGS}}

</details>
{{/LOW_CONFIDENCE_FINDINGS}}
<details>
<summary>Review details{{OPEN_THREADS_SUFFIX}}</summary>

{{#NEEDS_ATTENTION}}**Needs attention**

{{/NEEDS_ATTENTION}}| Gate | Status | Details |
|---|---|---|
| Description vs. code | {{GATE_DESCRIPTION_STATUS}} | {{GATE_DESCRIPTION_DETAILS}} |
| Prior review feedback | {{GATE_PRIOR_STATUS}} | {{GATE_PRIOR_DETAILS}} |
| Documentation | {{GATE_DOCS_STATUS}} | {{GATE_DOCS_DETAILS}} |
| Self-review signals | {{GATE_SELFREVIEW_STATUS}} | {{GATE_SELFREVIEW_DETAILS}} |
| Code review | {{GATE_CODEREVIEW_STATUS}} | {{GATE_CODEREVIEW_DETAILS}} |
{{#OPEN_THREADS}}
**Open review threads ({{OPEN_THREADS_COUNT}})**{{RESOLVED_SINCE}}

{{OPEN_THREADS}}
{{/OPEN_THREADS}}
{{#IMPACT_SECTION}}<details>
<summary>Impact — {{IMPACT_SUMMARY}}</summary>

{{IMPACT_SECTION}}

</details>

{{/IMPACT_SECTION}}{{#WITHHELD}}<details>
<summary>Withheld ({{WITHHELD_COUNT}}) — could not be verified from this runner</summary>

{{WITHHELD}}

</details>

{{/WITHHELD}}**Found**

{{FOUND_LINES}}

**Run**

{{RUN_LINES}}
{{#NOTHING_TO_REPORT}}
<sup>Nothing to report — {{NOTHING_TO_REPORT}}.</sup>
{{/NOTHING_TO_REPORT}}
</details>

{{FOOTER_SUP}}
