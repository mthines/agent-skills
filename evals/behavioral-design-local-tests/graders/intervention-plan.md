---
type: llm
---

PASS if ALL hold:

1. Before recommending anything, the reply diagnoses why people are not testing locally, and identifies that the fast `pnpm test:changed` path is unknown and the full suite is slow (an ability / awareness barrier), rather than assuming people do not care.
2. The top recommendation makes the fast path the easy default (for example a pre-push hook or default script that runs `test:changed`, with an easy opt-out), rather than mandating the 11-minute suite.
3. Each recommended intervention names the barrier it targets and a metric that would show it worked (for example the share of pushes that ran tests locally, or the CI red rate).

FAIL if the reply leads with mandates, penalties, or shaming; if it recommends forcing the full 11-minute suite before every push with no opt-out; or if interventions carry no metric.
