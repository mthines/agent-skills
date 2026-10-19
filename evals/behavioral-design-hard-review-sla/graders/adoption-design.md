---
type: llm
---

PASS only if ALL four hold:

1. Before prescribing, it diagnoses why PRs wait, naming at least two concrete barriers (for example no clear owner for each review, notification noise / missed requests, large PRs, protected focus time, reviews not counted as real work).
2. Its top-ranked intervention removes friction or sets a default rather than mandating harder: e.g. automatic reviewer assignment (round-robin / CODEOWNERS / a daily review rotation), a fixed daily review slot, a smaller-PR norm, or routing review requests to where people already look.
3. It does not rely on publicly ranking or shaming individuals; any visibility it proposes is team-level (or private to the individual), and the review load is spread fairly.
4. It names a metric computed from GitHub data (e.g. median / p90 time to first review, share of PRs reviewed within 4 business hours), a baseline measured before the change, and a re-check after several weeks or a pilot / staggered comparison.

FAIL if any of the four is missing, or if the plan leads with announcing the SLA as a rule plus reminders / nagging.
