---
title: Comment Classification — Tagging the Ledger
impact: HIGH
tags:
  - classification
  - comments
  - triage
---

# Comment Classification

Phase 3 tags every comment with one of five labels. The label determines
whether the comment carries to Phase 4 (validation gates) or is dropped /
surfaced.

## Labels

| Label         | Carries forward?  | When to use                                                                 |
| ------------- | ----------------- | --------------------------------------------------------------------------- |
| `actionable`  | Yes (Phase 4)     | Proposes a specific code change or a specific behavior to add / fix / remove. |
| `nit`         | Yes (Phase 4)     | Actionable, but explicitly low-priority. Higher confidence bar applies.    |
| `discussion`  | No (surfaced)     | Asks a question, proposes a trade-off, or starts a conversation.            |
| `question`    | No (surfaced)     | Pure question — reviewer wants info, not a code change.                     |
| `praise`      | No (dropped)      | "Nice", "LGTM", "👍", "this is clean".                                      |

## Decision flow

For each comment, walk these in order. First match wins.

### 1. `praise`

Comment body matches **only** one of:

- `lgtm`, `looks good`, `nice`, `clean`, `excellent`, `great`, `👍`, `🎉`, `❤️`
- Standalone approval keywords without any follow-up sentence

Drop silently.

### 2. `question`

Body starts with or contains a leading interrogative AND contains no
imperative verb:

- "Why is this …?"
- "Is there a reason …?"
- "What happens when …?"
- "Could you explain …?"

Surface. Do not validate.

### 3. `nit`

Body starts with or explicitly contains one of:

- `nit:`
- `nit -`
- `nitpick:`
- `(nit)`
- `style:` (style-only feedback)
- `optional:`

Carry forward with a `priority: low` flag.

### 4. `actionable`

Body contains **any** of:

- An imperative verb addressed to the code (`extract`, `rename`, `inline`, `move`, `remove`, `add`, `replace`, `wrap`, `use`, `prefer`, `change`, `fix`, `convert`, `combine`, `split`, `dedupe`).
- A `suggestion` fenced block.
- A `path` + `line` field (any inline review comment defaults to actionable unless `nit` matched first).
- "Please <verb>" or "Can you <verb>" or "Let's <verb>".
- A specific assertion of bug behavior ("this throws when X", "this returns null but should return undefined").

Carry forward as `priority: normal`.

### 5. `discussion`

Default. Anything that didn't match the above — multi-paragraph reasoning,
proposed alternatives without a chosen one, links to related work without a
specific ask.

Surface. Do not validate.

## Examples

| Body                                                                              | Label        |
| --------------------------------------------------------------------------------- | ------------ |
| `lgtm 👍`                                                                          | `praise`     |
| `Why are we caching this for 60s instead of 30s?`                                 | `question`   |
| `nit: missing trailing comma`                                                      | `nit`        |
| `Please extract this into a helper and reuse it in BillingTable.`                  | `actionable` |
| ```` ```suggestion\nconst total = sum(items);\n``` ````                            | `actionable` |
| `Style: prefer the early-return pattern here, easier to read.`                     | `nit`        |
| `I wonder if we should think about moving auth into a separate package long-term.` | `discussion` |
| `This throws when `user` is null — line 42 needs a null check.`                    | `actionable` |

## Multi-intent comments

A comment that mixes intents — e.g. "lgtm overall, but please extract this
helper" — is split conceptually: drop the praise half, tag the actionable
half as `actionable`. The ledger still has one entry; record both halves
in a `mixedIntent: true` flag so the worker's commit message references
the full context.

## When to escalate to user

If the classification rule's choice between `discussion` and `actionable`
is genuinely ambiguous (no imperative verb but clearly suggesting a
change), prefer **surface** (`discussion`). The user will see it in the
Phase 7 report and can re-run `/implement-suggestion` with the comment
permalink to force-process it.

Hard rule: **do not auto-apply on an ambiguous classification**. Surface
and let the user decide.
