---
title: Model Migration & Version Pinning
impact: HIGH
tags:
  - migration
  - versioning
  - pinning
  - deprecation
  - rollout
---

# Model Migration & Version Pinning

A new model version is a new model.
Treat the migration like a deployment: pinned, tested against the
golden set, A/B released, with a rollback path.

## Contents

- Pin snapshots, not aliases (when, why)
- Migration checklist
- A/B testing a new model
- Deprecation handling
- Cross-provider migration
- Rollback
- Common mistakes

## Pin snapshots, not aliases

Each provider exposes two kinds of model identifiers:

| Form               | Example                              | Behaviour                              |
| ------------------ | ------------------------------------ | -------------------------------------- |
| **Alias**          | `claude-sonnet-4-7`                  | Always points to the current snapshot. Auto-upgrades. |
| **Pinned snapshot** | `claude-sonnet-4-7@2026-04-15`       | Frozen. Never changes.                  |

**Pin snapshots in production.**
Aliases auto-upgrade silently — your evals were green yesterday on
snapshot A; today's traffic runs snapshot B with no diff in your repo.

When to use aliases:

- Local development.
- Eval scoreboard runs comparing latest-vs-pinned.
- One-off scripts you'll throw away.

When to pin:

- Production.
- CI golden-set runs (deterministic baselines).
- Anything customer-facing.

Sources:
[Anthropic — Models overview](https://platform.claude.com/docs/en/about-claude/models/overview),
[OpenAI — Model versioning](https://developers.openai.com/api/docs/models/versioning).

## Migration checklist

When a provider releases a new model (or you're moving from Sonnet 4.6
→ 4.7):

- [ ] Branch the prompt config; bump `model_version`.
- [ ] Run the **full golden set** (`evals.md`) against the new model.
- [ ] Diff results: pass-rate, latency p50/p95, cost per request.
- [ ] Hand-inspect every regression — is the test stale, or does the
      new model genuinely degrade?
- [ ] If pass rate is within tolerance (default: ≤ 1pp regression),
      proceed.
- [ ] Run a 5% A/B for 24 hours.
- [ ] If A/B metrics hold, ramp to 50% for 48 hours.
- [ ] Ramp to 100%.
- [ ] Keep the old version pinned and routable for 7 days as rollback.
- [ ] Update prompt-versioning records (`observability-and-versioning.md`).

Skip none of these.
Migrations are where prompts that "always worked" suddenly don't.

## A/B testing a new model

The eval-suite-only test is necessary but not sufficient.
Production traffic surfaces failure modes the golden set missed.

A/B harness:

```text
request →
  hash(user_id) % 100
    < ROLLOUT_PCT → new_model
    else          → current_model

emit gen_ai.* span tagged with `served_by: <model_id>`
emit downstream metrics tagged with served_by
```

Compare on:

- **Validator failure rate** (schema, semantic) — must not rise.
- **User thumb-down rate** — must not rise.
- **p95 latency** — must not rise > 20%.
- **Cost per request** — track but don't gate (new models are usually
  more expensive but better).

Do not gate on a single metric.
A new model with better quality and 30% higher cost can still be the
right call; a new model with same quality and higher latency usually
isn't.

## Deprecation handling

When a provider deprecates a model:

1. **Read the deprecation notice fully.**
   Note the EOL date and the migration target.
2. **Migrate immediately**, even if EOL is months away — late
   migrations are rushed migrations.
3. **Watch the API for deprecation warnings** in headers (Anthropic
   returns `anthropic-deprecated-model: true` on calls to deprecated
   models).
4. **Alert on deprecated-model usage** in your observability.
   Treat deprecated-model traffic as a P1 backlog item.

Common pitfall: a fallback chain still references the deprecated model.
Audit fallbacks separately.

## Cross-provider migration

Moving from Anthropic to OpenAI (or vice versa) is more invasive than
a within-provider migration.
Differences to plan for:

| Concern                     | Anthropic                                   | OpenAI                                          |
| --------------------------- | ------------------------------------------- | ----------------------------------------------- |
| Structural delimiter        | XML tags                                    | Markdown headings or XML.                       |
| Tool schema                 | Anthropic tool schema                       | OpenAI function calling / Structured Outputs.   |
| Reasoning surface           | `thinking` blocks                            | Reasoning items (o-series).                      |
| Caching API                 | Explicit `cache_control`                     | Automatic at ≥ 1024 tokens.                       |
| Stop sequences              | `stop_sequences[]`                           | `stop[]` (≤ 4).                                   |
| Streaming format            | SSE with `event: content_block_delta`        | SSE with `data:` lines and `[DONE]`.              |
| Token counting              | `count_tokens` endpoint                      | `tiktoken` library.                               |

Pattern: hide the differences behind a thin adapter layer (one
`call_model(messages, tools) -> response` interface).
Cross-provider migration then becomes "swap the adapter and re-eval".

Don't expose provider specifics into business logic; you'll regret it
on the first migration.

## Rollback

Rollback must be a config flip, not a redeploy.
Pattern:

```yaml
# config.yaml
models:
  triage:
    primary: "claude-sonnet-4-7@2026-04-15"
    rollback: "claude-sonnet-4-6@2025-11-22"
    rollout_pct: 100  # set to 0 to fully revert
```

Keep the rollback version routable for **at least 7 days** post-100%.
Rate of rollback decisions discovered late: ~5% of migrations within
the first week (source: Hamel Husain's evals work and observed pattern
across teams).

When you rollback:

1. Flip `rollout_pct` to 0.
2. Verify in observability that traffic is on the rollback model.
3. File an issue with the regression evidence (golden-set items that
   regressed in production but not pre-flight).
4. Add the failing items to the golden set so the next migration
   catches them.

## Common mistakes

- **Using model aliases in production.**
  **Fix:** pin snapshots; use aliases only in dev.
- **Migrating without re-running the golden set.**
  **Fix:** full golden-set run is non-negotiable pre-rollout.
- **Single metric gates** ("pass rate is fine, ship it").
  **Fix:** validator failure, thumb-down, p95 latency, cost — all four.
- **Late migration on a deprecated model.**
  **Fix:** migrate on announcement, not at EOL.
- **Provider specifics leaked into business logic.**
  **Fix:** thin adapter layer; one model interface.
- **Rollback path requires a redeploy.**
  **Fix:** config-driven; flip a percentage.
- **Forgotten deprecated model in the fallback chain.**
  **Fix:** audit fallbacks separately during migration.
- **No tag on responses showing which model served them.**
  **Fix:** `served_by: <model_id>` on every span (see
  `observability-and-versioning.md`).
