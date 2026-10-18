import { readFileSync } from "node:fs";

/** Read orders exported by the shop backend (one JSON object per line). */
export function loadOrders(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
