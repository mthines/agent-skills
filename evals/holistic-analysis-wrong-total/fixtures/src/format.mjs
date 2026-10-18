// "Fix" for wrong totals: force the total back to a number before formatting.
export function formatTotal(total) {
  return parseFloat(total).toFixed(2);
}
