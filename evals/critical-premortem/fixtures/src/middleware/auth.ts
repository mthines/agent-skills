import { getSession, saveSession } from "../session/store";

// Runs on EVERY request (about 4k req/s at peak).
export async function authenticate(req: { cookies: Record<string, string> }) {
  const id = req.cookies["sid"];
  if (!id) return null;
  const session = await getSession(id);
  if (!session) return null;
  await saveSession(id, session); // refresh sliding expiry
  return session;
}
