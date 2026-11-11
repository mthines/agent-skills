---
title: Notify — route each outcome to where someone acts on it
impact: HIGH
tags: [deployment-verify, notify, slack, linear, escalation]
---

# Notify

The PR comment holds the evidence, but nobody watches a merged PR.
Every terminal outcome, and every ESCALATE, goes where `release.yml` → `notify` routes it.

## Outcomes

| Outcome | Means | Default route |
| --- | --- | --- |
| `PASS` | 100 % passed; flag left on | PR comment only |
| `ROLLED_BACK` | A ROLLBACK verdict, the reversal applied, recovery proven | Slack with mentions, plus a ticket |
| `INCONCLUSIVE` | Not enough traffic or the step was never live; flag returned to the last passed step | Slack, no mentions |
| `ESCALATE` | A human is needed now: the rollback did not take effect, errors persist after it, or the change cannot be rolled back unattended | Slack with mentions, plus the `run` hook |
| `STOPPED` | Nothing was changed: no contract, deploy never detected, a provider failed before the first step | PR comment only |

## Config

```yaml
notify:
  - on: [ROLLED_BACK, ESCALATE]
    slack: { channel: "#deploys", mention: [pr_author, codeowners] }
  - on: [INCONCLUSIVE]
    slack: { channel: "#deploys" }
  - on: [ROLLED_BACK]
    linear: { team: ENG, labels: [rollback] }
  - on: [ESCALATE]
    run: ".agents/aw/scripts/page.sh {pr} {outcome}"
people:                         # GitHub login → Slack user ID, for mentions
  octocat: U0123456789
```

The PR comment is always updated; it needs no entry.
No `notify` block → PR comment only, and the report says `notify: not configured`.

## Deliver

For each entry whose `on` lists the outcome, once per outcome per rollout (`state.notified` records it):

| Target | How |
| --- | --- |
| `slack` | The connected Slack tool whose name ends in `send_message`. Message: outcome, PR title and link, the failing step's verdict line, and the report comment's link. Mentions: `pr_author` and each `codeowners` login of the changed paths, through `people`; an unmapped login is written as plain text, never guessed |
| `linear` | The connected Linear tool that creates issues: title `Rolled back: <PR title>`, body = the report, the `/fix-bug` line, and the PR link |
| `run` | The command with `{pr}`, `{outcome}`, `{report}` (a temp file holding the report) |

A target whose tool is missing or fails → write `notify <target>: failed (<reason>)` into the PR comment and continue with the rest.
Never retry a failed `run` more than once; never drop a failure silently.

```text
✗ Wrong — Slack tool absent, skip it, report PASS of the notification step
✓ Right — PR comment: "notify slack: failed (no Slack tool connected)"
```

## What never goes into a message

- Secrets, tokens, or a `set` command's output.
- Any string in `release.yml` → `posting.forbidden` (an organization's automation trigger words); replace each with `[redacted]` before posting anywhere.
