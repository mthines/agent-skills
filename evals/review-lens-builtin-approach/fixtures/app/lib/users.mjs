const rows = new Map([[1, { id: 1, name: "Ada" }], [2, { id: 2, name: "Linus" }], [3, { id: 3, name: "Grace" }]]);
export const queries = { count: 0 };

/** One round trip per call. */
export async function getUser(id) {
  queries.count++;
  return rows.get(id) ?? null;
}

/** One round trip for any number of ids. */
export async function getUsers(ids) {
  queries.count++;
  return ids.map((id) => rows.get(id) ?? null);
}
