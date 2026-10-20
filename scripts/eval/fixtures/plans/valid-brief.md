# Plan: add rate limit header

## Task
Return `X-RateLimit-Remaining` on every API response.

## Requirements
- R1 [user-stated]: header present on 2xx and 429 responses.

### Out of Scope
- Changing the limiter algorithm.

## Guardrails
- Do not modify `src/limits/algorithm.ts`.

## Acceptance Criteria (Definition of Done)
- AC-1 (covers: R1): `curl -sI localhost:3000/api` shows the header.

## Turn Cap
12

## File Changes
| File | Action |
| --- | --- |
| `src/middleware/rate-limit.ts` | modify |
