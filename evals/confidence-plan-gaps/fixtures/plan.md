# Plan: rate-limit the public search endpoint

## TL;DR

Add a per-API-key token bucket to `GET /search` so one client cannot starve the others.

## Requirements

1. [user-stated] Limit each API key to 10 requests per second on `GET /search`.
2. [user-stated] Over-limit requests get HTTP 429 with a `Retry-After` header.
3. [inferred] Limits are configurable without a deploy.

## Decisions

| Decision | Options | Rationale |
| --- | --- | --- |
| Algorithm | token bucket / fixed window | Token bucket allows short bursts without exceeding the average rate |
| Storage | in-process / Redis | Redis, because search runs on six pods |

## Implementation Order

1. Add the limiter middleware.
2. Wire it into the search route.
3. Load limits from config.

## File Changes

| Action | Path | Purpose |
| --- | --- | --- |
| create | src/middleware/rate-limit.ts | Token-bucket middleware |
| modify | src/routes/search.ts | Mount the middleware |
| modify | src/limits/config.ts | Per-key limit lookup |

## Verification

Run the test suite and hit the endpoint by hand.

## Progress Log

- [2026-10-01T09:00:00Z] Plan drafted.
