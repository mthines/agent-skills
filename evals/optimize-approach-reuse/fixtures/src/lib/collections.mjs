/**
 * Keep the first item for each key, preserving order. O(n).
 * @template T
 * @param {T[]} items
 * @param {(item: T) => unknown} keyOf
 * @returns {T[]}
 */
export function uniqueBy(items, keyOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
