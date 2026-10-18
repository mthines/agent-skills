# Plan: move sessions from Redis to Postgres

## Goal

Drop Redis from the stack by storing login sessions in the main Postgres database.

## Steps

1. Add a `sessions` table (id, user_id, data jsonb, expires_at).
2. Change `src/session/store.ts` to read and write the `sessions` table instead of Redis.
3. Deploy all API pods at once on Thursday 14:00.
4. Right after the deploy, run `redis-cli FLUSHALL` to free the Redis memory.
5. Delete the Redis cluster on Friday.

## Testing

Unit tests for `src/session/store.ts` with a mocked database client.

## Rollback

Revert the deploy.
