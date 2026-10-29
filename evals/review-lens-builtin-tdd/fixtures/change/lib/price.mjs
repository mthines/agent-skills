export function applyDiscount(total, code) {
  if (code === "SAVE10") return Math.round(total * 0.9 * 100) / 100;
  if (code === "SAVE20") return Math.round(total * 0.8 * 100) / 100;
  return total;
}
