---
title: Self-review report — inline terminal output for own PR
impact: MEDIUM
tags:
  - reviewer
  - self-review
  - terminal-output
---

# Self-review report

When `reviewer` runs on the user's own PR (Self-Review sub-mode), it does **not** post comments to GitHub. Posting pending comments to your own freshly-opened PR is enforcement theatre — the orchestrator that called `reviewer` can act on terminal output faster.

This rule covers the terminal-output format. It uses the existing template at `agents/templates/reviewer-inline-report.template.md` plus one addition: every finding emitted into the report is a card from `agents/templates/pr-comment-card.template.md`, so the orchestrator sees the same shape it would get from a cross-review on a colleague's PR.

## When this runs

| Condition | Source |
| --- | --- |
| Mode is **Self-Review** | own PR detected via authorship check |
| `--report` was passed in Self-Review (rare) | uses this same format, just without auto-fix |

The other two modes (Fix Mode on a branch with no PR, Report Mode on a branch with no PR) use a simpler verdict-table output — no Self-Review report.

## Output structure

```
# Self-Review Report: PR #<n> (<repo>)

**Branch**: <head> → <base>
**Reviewed by**: @<me> (self-authored PR)
**Auto-fixed**: <N> issues (see Auto-Fix Summary below)

---

## Critical (block before undrafting)

<comment cards using pr-comment-card.template.md — one card per finding>

## High (should fix before merge)

<comment cards>

## Medium (address in a follow-up)

<comment cards>

## Low / Nitpick

<comment cards>

## Praise

<comment cards>

---

**Verdict**: <Approve | Approve with comments | Request changes> — <score>/10
<One-line rationale.>

---

**Orchestrator**: Review the Critical and High items above. Auto-fixed items are
already applied (see Auto-Fix Summary). Address Critical items before undrafting.
Address High items before merging. Medium and Low items may be deferred to
follow-up PRs.

---

## Auto-Fix Summary

### Fixed
- <file:line> — <one-line description>

### Planned (not applied)
- <file> — <one-line description>

### Verification
- Lint: PASS / FAIL
- Type-check: PASS / FAIL
- Tests (scoped): PASS / FAIL
```

## Severity → bucket mapping

| Source severity | Bucket |
| --- | --- |
| `issue` + blocking finding (broken behaviour / security / data loss / misimplemented intent) | Critical |
| `issue` non-blocking | High |
| `suggestion` | High or Medium (use confidence: ≥ 90 → High, < 90 → Medium) |
| `question` | Medium |
| `nitpick` | Low / Nitpick |
| `praise` | Praise |

A bucket with no findings outputs `None.` (not omitted) so the orchestrator can reliably parse the report.

## Why not post pending comments here

Two reasons:
1. **Visibility duplication.** The user is the PR author. Pending comments are visible only to the user; so is the terminal output. Posting adds nothing.
2. **Orchestrator latency.** Parent agents that read terminal output respond faster than they would after a GitHub API round-trip; pending comments add 1–2 seconds per comment for no signal gain.

The exception is when an orchestrator explicitly invokes `reviewer --emit-pending-comments` for archival purposes. That flag is reserved and not implemented today — if it ships, route through `pr-reviewer` rather than re-implementing posting mechanics here.

## What this rule does not cover

- Posting to GitHub — `reviewer` never posts; `pr-reviewer` owns posting.
- Auto-fix behaviour — covered in `auto-fix-policy.md`.
- The card shape — covered in `agents/templates/pr-comment-card.template.md`.
