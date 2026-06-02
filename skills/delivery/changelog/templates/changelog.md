# Changelog — {{SINCE}} → {{UNTIL}}

_Window: last {{DAYS}} day(s) · {{TOTAL_PRS}} PR(s) · {{TOTAL_TICKETS}} Linear ticket(s)_

## Summary

{{ONE_PARAGRAPH_SUMMARY}}

---

## {{FEATURE_NAME}}

### Shipped

- **{{PR_TITLE}}** — {{ONE_LINE_SUMMARY}} ([#{{PR_NUMBER}}]({{PR_URL}})){{TICKET_REF}}
- **{{PR_TITLE}}** — {{ONE_LINE_SUMMARY}} ([#{{PR_NUMBER}}]({{PR_URL}})){{TICKET_REF}}

### Closed without merge

- **{{PR_TITLE}}** — {{REASON}} ([#{{PR_NUMBER}}]({{PR_URL}}))

### Linear (no PR yet)

- **{{TICKET_TITLE}}** — {{ONE_LINE_SUMMARY}} ([{{TICKET_ID}}]({{TICKET_URL}}))

---

## {{NEXT_FEATURE_NAME}}

### Shipped

- **{{PR_TITLE}}** — {{ONE_LINE_SUMMARY}} ([#{{PR_NUMBER}}]({{PR_URL}})){{TICKET_REF}}

---

## Other

- **{{PR_TITLE}}** — {{ONE_LINE_SUMMARY}} ([#{{PR_NUMBER}}]({{PR_URL}})){{TICKET_REF}}

<!--
Placeholder reference (delete this block in the final output):

  {{SINCE}}                ISO date, start of window (UTC)
  {{UNTIL}}                ISO date, end of window (UTC)
  {{DAYS}}                 Integer day count
  {{TOTAL_PRS}}            Total PR count across all buckets
  {{TOTAL_TICKETS}}        Total Linear ticket count across all buckets
  {{ONE_PARAGRAPH_SUMMARY}} 2–4 sentence high-level summary of the window
  {{FEATURE_NAME}}         Bucket name (e.g. Dashboards, Agent0, OTel)
  {{PR_TITLE}}             PR title, stripped of emoji and trailing punctuation
  {{ONE_LINE_SUMMARY}}     One-sentence imperative summary
  {{PR_NUMBER}}            Numeric PR id
  {{PR_URL}}               PR url
  {{TICKET_REF}}           " · LIN-123" suffix when a PR closes a ticket, else empty
  {{TICKET_TITLE}}         Linear issue title
  {{TICKET_ID}}            Linear identifier (e.g. SUP-456)
  {{TICKET_URL}}           Linear issue url
  {{REASON}}               One-line reason a closed-not-merged PR was abandoned

Section visibility:
  - Omit "Closed without merge" if empty.
  - Omit "Linear (no PR yet)" if every ticket maps to a PR.
  - Omit any feature bucket whose three sub-sections are all empty.

Empty window (zero PRs, zero tickets):
  - Render only the H1 heading line and the Summary section.
  - Set {{ONE_PARAGRAPH_SUMMARY}} to "No activity in this window."
  - Set {{TOTAL_PRS}} and {{TOTAL_TICKETS}} to 0.
  - Omit every feature bucket entirely.
-->
