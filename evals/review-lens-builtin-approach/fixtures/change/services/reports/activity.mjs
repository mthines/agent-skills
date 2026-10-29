import { getUser } from "../../lib/users.mjs";

export async function activityReport(events) {
  const lines = [];
  for (const event of events) {
    const user = await getUser(event.userId);
    lines.push(`${user ? user.name : "unknown"} ${event.action}`);
  }
  return lines;
}
