---
title: Resilience — Rate Limits, Retries, Fallbacks, Timeouts
impact: HIGH
tags:
  - resilience
  - rate-limits
  - retries
  - circuit-breaker
  - fallback
  - timeouts
---

# Resilience

Production AI systems fail in three predictable ways: rate limits,
provider outages, and slow tail latencies.
This rule covers the patterns that keep a service up when the model
provider is degraded.

## Contents

- Rate limits: 429 with `Retry-After`
- Exponential backoff with jitter
- Circuit breakers
- Fallback model chains
- Timeouts: request, stream, tool
- Idempotency keys for tool calls
- Provider outage playbook
- Common mistakes

## Rate limits — honour `Retry-After`

Both Anthropic and OpenAI return:

- `429 Too Many Requests` on rate limit.
- `Retry-After` header with seconds to wait, OR a reset epoch.
- Rate-limit headers on every response (`anthropic-ratelimit-*`,
  `x-ratelimit-*`) showing remaining quota.

Rules:

1. **Always read `Retry-After`** when present — it's the provider's
   ground truth.
2. If absent, fall back to exponential backoff (below).
3. Track `*-remaining-tokens` and `*-remaining-requests` headers; throttle
   client-side **before** you 429.

```text
on 429:
  delay = parseRetryAfter(response) ?? exponentialBackoff(attempt)
  sleep delay
  retry
```

Source: [Anthropic — Rate limits](https://platform.claude.com/docs/en/api/rate-limits),
[OpenAI — Rate limits](https://developers.openai.com/api/docs/guides/rate-limits).

## Exponential backoff with jitter

Pure exponential backoff causes thundering herds — every client retries
at the same moment after an outage.
**Always add jitter.**

Defaults:

```text
attempt:    1     2     3     4     5
base (s):   1     2     4     8    16
jitter:    ±50% (uniform)
cap (s):   60
max attempts: 5 (idempotent) | 1 (non-idempotent)
```

```python
import random

def backoff(attempt: int) -> float:
    base = min(60, 2 ** (attempt - 1))
    return base * (0.5 + random.random())  # 0.5×–1.5× jitter
```

For `non-idempotent` operations (paid actions, side-effectful tool
calls), retry **once at most** unless you have an idempotency key
(see below).

## Circuit breakers

When a provider is genuinely down, retrying every request wastes time
and money.
A circuit breaker trips after N failures, fast-fails subsequent
requests for a cooldown window, then probes for recovery.

States:

| State        | Behaviour                                                        |
| ------------ | ---------------------------------------------------------------- |
| `closed`     | Normal traffic.                                                  |
| `open`       | All requests fail fast; no upstream call.                         |
| `half-open`  | One probe request; success closes, failure re-opens.              |

Defaults:

- Trip after **5 consecutive failures** within 30 s.
- Open for **30 s**, then probe.
- Track per-`(provider, region, model)` — Sonnet may be down while
  Haiku is fine.

Libraries: `pybreaker` (Python), `cockatiel`/`opossum` (JS), or roll
your own with a counter and a clock.

## Fallback model chains

When the primary model is rate-limited or down, fall back to a
secondary — even at lower quality.
Quality with a response beats no response.

```text
primary:   claude-sonnet-4-7
fallback1: claude-haiku-4-5         (same family, cheaper)
fallback2: gpt-5-mini                (different provider — survives Anthropic outage)
fallback3: cached previous response  (degraded mode)
```

Rules:

1. Fall back **only** on infrastructure errors (5xx, 429, timeout) —
   not on validator failures (those mean the prompt is wrong, not the
   model).
2. Tag the response with which model served it.
   This is critical for downstream eval and bug reports.
3. Test the fallback path quarterly with a chaos exercise — fallbacks
   that haven't run in 6 months are usually broken.

A multi-provider fallback (Anthropic → OpenAI) needs prompts that work
on both — abstract the differences into a thin adapter.
See `model-migration.md` for prompt portability.

## Timeouts

Set explicit timeouts at three levels.
The SDK defaults are usually too generous.

| Level                      | Default to set                                                |
| -------------------------- | ------------------------------------------------------------- |
| Request (non-streaming)    | p95 latency × 3 (e.g. 30 s for a Sonnet call).                 |
| Streaming first byte (TTFT) | 5 s. If TTFT exceeds, abort and retry.                         |
| Streaming total            | p99 × 2 (e.g. 90 s).                                           |
| Tool execution             | Per-tool budget; default 10 s for HTTP, 30 s for DB.            |
| Agent loop total           | Cumulative across all iterations; halt on overrun.             |

Always abort the upstream request on timeout — orphaned requests still
bill you for tokens generated.

## Idempotency keys for tool calls

Side-effectful tools (refunds, sends, charges) must be idempotent.
The agent loop **will** retry — by design (parallel tool calls, error
recovery, fallback paths).

Pattern:

1. Server-side: every destructive endpoint accepts an
   `Idempotency-Key` header (UUID).
2. The first request with key X creates the side effect; subsequent
   requests with key X return the cached response.
3. The agent emits the key in the tool call:

```json
{
  "tool_use_id": "toolu_01ABC...",
  "name": "issue_refund",
  "input": {
    "order_id": "ord_123",
    "amount": 50.00,
    "idempotency_key": "ref_2026-05-10_ord_123_50"
  }
}
```

The tool implementation passes `idempotency_key` to the downstream
service.
The agent should generate keys deterministically when possible
(content-addressable), so a retry of the same logical action reuses
the key.

Stripe, Square, and most payment APIs support this natively.
For internal services, add it.

## Provider outage playbook

When a provider has a major outage:

1. **Circuit breaker trips** → all traffic fast-fails after N seconds.
2. **Fallback chain activates** → secondary provider takes over.
3. **Tag responses** with `served_by: <model>` so dashboards distinguish.
4. **Cache pre-warming** of the fallback model's prefix is recommended
   the moment the primary degrades — cold cache on the fallback adds
   30–80% latency on top of the outage stress.
5. **Status-page pings** are unreliable as a real-time signal; trust
   your circuit breaker first, status page second.
6. **Postmortem the cost** — fallbacks usually cost more (different
   pricing, no cache hits); track the spike for the bill.

## Common mistakes

- **Retrying on 429 without honouring `Retry-After`.**
  **Fix:** parse the header; sleep the requested duration.
- **No jitter in backoff.**
  **Fix:** ±50% uniform jitter; thundering herds otherwise.
- **Retrying non-idempotent operations.**
  **Fix:** retry only with an idempotency key; otherwise fail fast.
- **No circuit breaker; every request retries during outages.**
  **Fix:** trip after 5 consecutive failures; probe with one request.
- **Single-provider stack with no fallback.**
  **Fix:** at minimum, fallback within the same family (Sonnet → Haiku);
  ideally cross-provider.
- **No timeout on streaming TTFT.**
  **Fix:** 5 s TTFT cap; abort and retry.
- **Tool calls without idempotency keys.**
  **Fix:** every destructive endpoint accepts and respects an
  `Idempotency-Key`.
- **Fallback path untested for months.**
  **Fix:** quarterly chaos exercise.
