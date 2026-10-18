import { redis } from "../infra/redis";

const TTL_SECONDS = 60 * 60 * 24 * 14;

export async function getSession(id: string): Promise<Record<string, unknown> | null> {
  const raw = await redis.get(`sess:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function saveSession(id: string, data: Record<string, unknown>): Promise<void> {
  // Sliding expiry: every request refreshes the TTL.
  await redis.set(`sess:${id}`, JSON.stringify(data), "EX", TTL_SECONDS);
}
