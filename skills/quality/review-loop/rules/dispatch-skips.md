---
title: Dispatch skips — the four ways the loop ends without a reviewer
impact: HIGH
tags:
  - review-loop
  - dispatch
  - degradation
---

# Dispatch skips

Read this file when Step 0 resolves `REVIEWER_ROUTE = none` (rows 1 or 5) or the row-4 install prints `INSTALL: failed`.
Why a skip is the only honest outcome: [`references/design-rationale.md` § Dispatch](../references/design-rationale.md#dispatch).

Four causes leave the loop without a reviewer, and they get **different skip lines** because they have different fixes.
Report the one you can evidence; when you cannot tell the first two apart, report the harness line:

| Cause | How you know | Skip line |
| --- | --- | --- |
| **Nested dispatch** (caller error, fixable today) | You are running as a dispatched sub-agent — the caller's prompt dispatched this loop rather than running it | `skipped (nested dispatch — review-loop must run at the top level; the caller consumed the delegation budget)` |
| **Harness exposes no dispatch tool** (environment) | This is the top-level session and no tool that dispatches a sub-agent is present under any name — `Task`, `Agent`, or another spelling | `skipped (sub-agent dispatch unavailable; pr-reviewer requires it)` |
| **`pr-reviewer` is not an agent type here, and there is no Agent0 workspace** (install) | Step 0 row 5: a dispatch tool exists, its agent types omit `pr-reviewer`, and none of the Agent0 host signals (`/tmp/workspace`, `/tmp/.opencode/skills`, `/tmp/.opencode/agents/general.md`) exists | `skipped (pr-reviewer is not a dispatchable agent type here). Install the agent.` |
| **The Agent0 on-demand install failed** (environment) | Step 0 row 4 ran the install and `/tmp/workspace/agent-skills/env.sh` still does not exist | `skipped (Agent0 install failed: <the setup log's last line>)` |

```markdown
- [TIMESTAMP] review-loop — skipped (nested dispatch — review-loop must run at the top level; the caller consumed the delegation budget). Have the caller run the loop itself.
- [TIMESTAMP] review-loop — skipped (sub-agent dispatch unavailable; pr-reviewer requires it)
- [TIMESTAMP] review-loop — skipped (pr-reviewer is not a dispatchable agent type here). Install the agent.
- [TIMESTAMP] review-loop — skipped (Agent0 install failed: could not download scripts/agent0-setup.sh)
```

Return that skip as the loop's terminal result:

- Do **not** retry the dispatch or the install. One absent-capability return is conclusive.
- Do **not** continue to sub-steps B and C: without a review pass there are no findings to apply, and `polish simplify` alone would misreport an unreviewed PR as converged.
- Do **not** review in this context instead.
- Report it in Step 3 under its own `Stop reason:` token. A skip is never convergence and never `report-only`: say plainly that the loop did not run and the PR was not reviewed.

When the capability check is inconclusive, attempt the dispatch; if it fails for any reason other than an unknown agent type (which continues at Step 0 rows 4–5), emit the matching skip line rather than retrying or working around it.
