---
title: Webhook Memory Filter — Signal-Quality Gate for LoreKit Writes
impact: HIGH
tags:
  - webhook
  - memory
  - lorekit
  - signal-quality
  - anti-noise
  - self-improvement
---

# Webhook Memory Filter

A write gate applied by the AW dispatcher (or any automation handler) before
any LoreKit lesson or outcome write that originates from a GitHub webhook
event. Prevents accumulating noise from high-frequency, low-signal events
such as status checks, synchronize pushes, and edited or deleted comments.

This rule is referenced by:

- [`phase-4-testing.md#lessons-write`](./phase-4-testing.md#lessons-write) —
  before a stuck-loop lesson write triggered by a webhook automation.
- [`phase-7-ci-gate.md#lessons-write`](./phase-7-ci-gate.md#lessons-write) —
  before an end-of-run lesson write triggered by a webhook automation.
- [`../../agents/shared/rules/review-outcomes.md`](../../../../agents/shared/rules/review-outcomes.md) —
  before appending an outcome record to the `review-outcomes` bus.

---

## Contents

- [When this rule applies](#when-this-rule-applies)
- [Event-tier table](#event-tier-table)
- [Dispatcher gate (pre-flight)](#dispatcher-gate-pre-flight)
- [Resolved-thread fast path](#resolved-thread-fast-path)
- [Phase 7 quality gate](#phase-7-quality-gate)
- [Phase 4 pre-flight](#phase-4-pre-flight)
- [Per-PR outcome dedup](#per-pr-outcome-dedup)
- [Per-fingerprint cooldown (24 h)](#per-fingerprint-cooldown-24-h)
- [What is NEVER stored](#what-is-never-stored)

---

## When this rule applies

This rule applies when **all** of the following are true:

1. A write to a LoreKit scope is about to occur (`memory.write`).
2. The write was triggered by a GitHub webhook delivery (not by a human
   typing a command or by an autonomous workflow operating on a human-authored
   prompt).
3. The webhook event type is one of the supported event types (see the
   event-tier table below).

When the triggering context is not a webhook (e.g. the user ran
`/autonomous-workflow`, `fix-bug`, etc. manually), this rule does not apply.

---

## Event-tier table

Every incoming GitHub webhook event maps to one of three tiers. The dispatcher
reads `x-github-event` + `payload.action` and sets two boolean flags before
any write is attempted.

| Tier | Events + Actions | `LESSON_WRITE_ENABLED` | `OUTCOME_WRITE_ENABLED` |
|---|---|---|---|
| `WRITE_LESSON` | `pull_request_review_thread` action=`resolved` | `true` | `true` |
| `WRITE_LESSON` | `pull_request` action=`closed` / `merged`, when the PR had agent-authored review activity | `true` | `true` |
| `WRITE_LESSON` | `pull_request_review` action=`submitted` | `true` | `true` |
| `WRITE_OUTCOME_ONLY` | `pull_request_review_comment` action=`created` | `false` | `true` |
| `WRITE_OUTCOME_ONLY` | `issue_comment` action=`created` | `false` | `true` |
| `WRITE_OUTCOME_ONLY` | `check_suite` action=`completed` | `false` | `true` |
| `WRITE_OUTCOME_ONLY` | `status` state=`success` or `failure` | `false` | `true` |
| `NO_WRITE` | `status` state=`pending` or `in_progress` | `false` | `false` |
| `NO_WRITE` | `push` (any) | `false` | `false` |
| `NO_WRITE` | `pull_request` action=`synchronize` / `opened` | `false` | `false` |
| `NO_WRITE` | `create`, `delete` (any) | `false` | `false` |
| `NO_WRITE` | Any event not listed above | `false` | `false` |

`pull_request_review_thread resolved` is the highest-signal event in the
webhook stream — it represents explicit author acknowledgement of a finding.
It is the only event that warrants a `WRITE_LESSON` without first checking
the `review-outcomes` bus (see [Resolved-thread fast path](#resolved-thread-fast-path)).

---

## Dispatcher gate (pre-flight)

Apply before any write, at the point where the webhook automation decides
what to do.

```
event_type = payload.headers["x-github-event"]
action     = payload.body["action"]

tier = lookup(event_tier_table, event_type, action)   # default: NO_WRITE

LESSON_WRITE_ENABLED  = (tier == "WRITE_LESSON")
OUTCOME_WRITE_ENABLED = (tier == "WRITE_LESSON" or tier == "WRITE_OUTCOME_ONLY")

pass both flags forward to Phase 4 lessons-write, Phase 7 lessons-write,
and review-outcomes write steps — the phases do NOT recompute the tier.
```

A `NO_WRITE` tier means **zero LoreKit calls are made** — not even a
`memory.search` dedup check. Skip the write block entirely, log one line, and
return 200 OK to GitHub.

---

## Resolved-thread fast path

`pull_request_review_thread` with `action: resolved` bypasses the normal
outcome-bus accumulation cycle and writes a positive outcome record immediately.

```
fingerprint = category + ":" + claim-gist + ":" + code-pattern
  # Extract from thread.comments[0].body using the fingerprint formula in
  # agents/shared/rules/prior-comment-awareness.md (Section 2.5b).

memory.write {
  scope:        "global",
  key:          "review-outcomes::<fingerprint>",
  value:        "<outcome record in review-outcomes schema>",
  tags:         ["loop::review-outcomes", "source::resolved-thread", "signal::resolved-thread"],
  source_agent: "github-webhook",
  trigger:      "pull_request_review_thread.resolved",
  ttl_days:     30,
}

# Immediately check for promotion eligibility.
if seen_count >= 3:
  surface the promotion suggestion per
  agents/shared/rules/outcome-learning.md#promotion-decisions
```

This fast path does NOT write an `aw-lessons` entry. If the resolved thread
also marks the end of a workflow run, the normal Phase 7 `lessons-write` block
handles any durable lesson.

---

## Phase 7 quality gate

Applied after the dispatcher gate when `LESSON_WRITE_ENABLED == true` and
the Phase 7 `lessons-write` block is about to fire.

**Pre-flight:**

```
if LESSON_WRITE_ENABLED == false:
  log: "Phase 7: lesson write skipped — NO_WRITE event tier"
  exit the lessons-write block
```

**Retrospective quality gate (when `LESSON_WRITE_ENABLED == true`):**

Before calling `memory.write`, apply the **durable-fact litmus**:

| Question | Disqualifies if |
|---|---|
| Would a future run benefit from knowing this? | No |
| Is the lesson falsifiable and actionable (not "it seemed to work")? | No |
| Does the trigger-context match a pattern likely to recur (not a one-off env issue)? | No |

A lesson candidate that fails **all three** questions is dropped:

```
log: "Phase 7: lesson candidate rejected by quality gate
     (ephemeral / unfalsifiable / no-recurrence) — candidate: <one-line>"
```

A candidate that passes **at least one** question proceeds to `memory.write`.

**Hard drop (regardless of litmus):**

Do not write a lesson whose body records only:
- "CI passed cleanly with no friction" (no signal)
- A value that matches the privacy never-store list (credentials, tokens,
  customer names, PII)

---

## Phase 4 pre-flight

Applied before the Phase 4 stuck-loop `lessons-write` block.

```
if LESSON_WRITE_ENABLED == false:
  log: "Phase 4: stuck-loop lesson write skipped — NO_WRITE event tier"
  exit the lessons-write block
```

The stuck-loop lesson is always signal-worthy (a stuck loop is by definition
an unexpected friction event) — the quality gate in Phase 7 does NOT apply
here. The privacy pre-flight still applies.

---

## Per-PR outcome dedup

Applied before any `review-outcomes` bus append (when
`OUTCOME_WRITE_ENABLED == true`).

```
memory.search {
  q:      "<fingerprint or key words>",
  scopes: ["repo::{owner}/{repo}", "global"],
  limit:  10,
}

for each result matching fingerprint + pr:
  if result.verdict == incoming_verdict:
    # Same verdict for same fingerprint on same PR — skip.
    log: "outcome dedup — skipped (identical verdict already recorded for <fingerprint> on <pr>)"
    exit
  else:
    # Verdict changed (e.g. applied → reverted-after-ci) — update in place.
    memory.write { same scope + key, updated value }
    exit

# No matching entry — ADD.
memory.write { scope, key, value, tags, ttl_days: 30 }
```

This prevents the bus accumulating duplicate rows when GitHub fires the same
webhook multiple times (e.g. comment edits, status re-deliveries).

---

## Per-fingerprint cooldown (24 h)

Applied for high-frequency event types (`check_suite`, `pull_request_review_comment`)
**after** the dedup check passes.

Read `last_written` from the existing lesson's `meta:` comment (if any):

```
if existing_entry.meta.last_written is set:
  age = now() - existing_entry.meta.last_written

  if age < 24h:
    log: "cooldown active for <fingerprint> — last written <timestamp>, skipping"
    exit

# No cooldown or cooldown expired — proceed with memory.write.
# Set meta.last_written = now() in the written value.
```

The 24 h window collapses multiple webhook firings for the same pattern
(e.g. a batch review that posts ten comments in one push) into one write
per day. No external state store is required — the `last_written` timestamp
travels inside the LoreKit entry's `value` as a `meta:` comment field.

---

## What is NEVER stored

Regardless of event tier or flag values, the following are **always** dropped
before any `memory.write` call:

- CI intermediate states: `status.state == pending`, `status.state == in_progress`
- Push events with no linked PR
- PR opened/synchronize events (no outcome signal yet)
- End-of-run retrospectives that record only "CI passed cleanly with no friction"
- Any candidate body shorter than 20 characters (rejects "ok", "+1", emojis)
- Any candidate body that is purely a fenced code block with no surrounding prose
- Any candidate matching bot-noise patterns:
  - `/^(Build|Deploy|Test|CI|Checks?) (passed|failed|succeeded|completed)/i`
  - `/^Bumps \[/` (Dependabot)
  - `/^All \d+ checks? (passed|failed)/i`
  - `/^Auto-merge enabled/i`
- Any candidate whose body matches the persistent-memory privacy never-store
  list (credentials, API keys, tokens, PII) — the privacy pre-flight in
  `skills/authoring/persistent-memory/rules/privacy-and-consent.md` applies
  unconditionally; autonomous writes skip the consent preview, never the
  never-store list.
