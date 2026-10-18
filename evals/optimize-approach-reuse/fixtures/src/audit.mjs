import { uniqueBy } from "./lib/collections.mjs";

/** One audit row per actor, first occurrence wins. */
export function actors(events) {
  return uniqueBy(events, (e) => e.actorId).map((e) => e.actorId);
}
