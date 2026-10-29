import { getUsers } from "../../lib/users.mjs";

export async function teamNames(memberIds) {
  const users = await getUsers(memberIds);
  return users.filter(Boolean).map((u) => u.name);
}
