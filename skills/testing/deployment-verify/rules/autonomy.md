---
title: Autonomy — an earned recommendation beside each hold, learned in LoreKit, decided by a committed rule
impact: HIGH
tags: [deployment-verify, autonomy, promotion, lorekit, signal, risk-class]
---

# Autonomy

At every hold the controller prints a recommendation, `AUTO` or `HUMAN`, and learns from what the human then does.
The recommendation never advances a hold, never flips a flag, and never edits `release.yml`.
**Why:** [`../references/design.md § An earned recommendation`](../references/design.md#a-human-hold-and-an-earned-recommendation).

## The rule is committed

The policy is `release.yml` → `promotion:`, reviewed like code; absent, every recommendation is `HUMAN` and no LoreKit call is made:

| Key | Meaning |
| --- | --- |
| `min_agree_streak` | Counted approvals in a row per level; level `n` needs `n × min_agree_streak`. Required: a positive integer |
| `min_review_seconds` | Rubber-stamp guard: an approval faster than this counts neither way. Default `60` |
| `risk_classes` | Risk classes allowed to be recommended `AUTO`; every other class is `HUMAN` |
| `max_level` | Highest level the signal may reach. Default `1`; `0` disables `AUTO` |

```yaml
# ✓ Right — UI and config changes may earn AUTO after 5 careful approvals in a row
promotion: { min_agree_streak: 5, min_review_seconds: 120, risk_classes: [ui, config], max_level: 1 }
```

## Recommend

[`scripts/promote.mjs`](../scripts/promote.mjs) `recommend(rule, evidence)` is pure; take the first row that matches:

| Condition | Recommendation |
| --- | --- |
| No `promotion:` rule, or `min_agree_streak` not a positive integer | `HUMAN` |
| No evidence | `HUMAN` |
| LoreKit not configured or unreachable (`available: false`) | `HUMAN` |
| Risk class not one of `data`, `api`, `config`, `ui`, `other` | `HUMAN` |
| Risk class not in `risk_classes` | `HUMAN` |
| No signal yet for the risk class | `HUMAN` |
| The contract's `model` differs from the signal's | `HUMAN` |
| `min(level, max_level) < 1` | `HUMAN` |
| `agree_streak < min_agree_streak` (a rule tightened after promotion) | `HUMAN` |
| Otherwise | `AUTO` |

## Risk class

`promote.mjs` `riskClass(files)` reads the PR's changed files (`gh api repos/{owner}/{repo}/pulls/<n>/files`) and reuses `pr-reviewer`'s change-shape detector (`agents/pr-reviewer/scripts/classify-shape.mjs` in this repository); tests and docs are ignored, and the highest class reached wins:

| Class | When |
| --- | --- |
| `data` | `schema-migration` shape (a migration path, or `ALTER`/`CREATE`/`DROP TABLE`) |
| `api` | `api-contract` shape (`.proto`, `.graphql`, OpenAPI, route handlers) |
| `config` | `infra` or `secrets` shape, or a `.github/`, `config/`, `deploy/`, `.ya?ml`, `.toml`, `.env` path |
| `ui` | `.tsx`, `.jsx`, `.vue`, `.svelte`, a stylesheet, or a `components/`, `pages/`, `ui/` path |
| `other` | anything else, and a tests-and-docs-only diff |

The detector missing, or the files unreadable → `unknown` → `HUMAN`.

## The signal

One LoreKit memory per repository × risk class, written by [`scripts/signal.mjs`](../scripts/signal.mjs):

| Field | Value |
| --- | --- |
| scope, key | `repo::<owner>/<name>`, `deployment-verify-autonomy::<risk class>` |
| tags, `kind`, `host` | `deployment-verify-autonomy`, `signal`, `deployment-verify` |
| value (JSON) | `{ v: 1, agree_streak, level, model, last_override_at, updated_at }` |
| TTL | 60 days, refreshed on every write: a repository that stops deploying decays to level 0 |

`nextSignal(prev, event, rule)` is pure; take the first row that matches:

| Event | Effect |
| --- | --- |
| Any event whose `model` differs from the signal's | `agree_streak = 0`, `level − 1` (floor 0), `model` = the new one; the event does not count |
| `approve` with `seconds < min_review_seconds` | Nothing changes |
| `approve` | `agree_streak + 1`; then `level + 1` when `level < max_level` and `agree_streak ≥ min_agree_streak × (level + 1)` |
| `override`, `rollback`, `revert` | `agree_streak = 0`, `level − 1` (floor 0), `last_override_at` = the event time |

Without a `promotion:` rule the controller writes no signal; `signal.mjs --event` run by hand still counts the streak but never raises the level.

## Events and where they come from

| Event | Source |
| --- | --- |
| `approve`, `override` | `tick.mjs --approve` / `--override` at a hold ([`hold.md`](./hold.md)) |
| `rollback` | The tick that ends `ROLLED_BACK`, or `ESCALATE` after a ROLLBACK verdict |
| `revert` | `node ${CLAUDE_SKILL_DIR}/scripts/signal.mjs --event revert --repo <owner/name> --risk-class <class>`, run by whoever opens the revert or hotfix PR (Step 2 of `SKILL.md`) |

The controller writes the event's result into the report as `signal: <class>: <note>`.

## Write with `expected_version`

1. `show --json` the record: found (value and `version`), absent (version `0`), or unavailable.
2. Apply `nextSignal`, then `write --expected-version <version>`.
3. `version_conflict` → re-read and retry once; a second conflict → `Degraded: … expected_version conflicted twice`.
4. A record with no `version` is never written blind: unavailable.

```text
✗ Wrong — read, compute, write without a version: a concurrent tick's override is overwritten by a stale +1
✓ Right — write --expected-version 7; on version_conflict re-read (now 8, streak 0) and apply the approve to that
```

## LoreKit absent

No `LOREKIT_API_KEY` / `LOREKIT_TOKEN`, an unreachable store, or a failed write → one line, and the rollout continues:

```text
Degraded: earned-autonomy signal not read — LoreKit not configured (LOREKIT_API_KEY unset); recommendation stays HUMAN
```

The hold, the decision, and the rollout never depend on LoreKit.
