export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.unitCents * item.qty, 0);
}

// Added for LIN-482 so the checkout page can show per-line prices.
// eslint-disable-next-line max-params
export function lineTotal(unitCents, qty, discountPct, taxPct) {
  const discounted = unitCents * qty * (1 - discountPct / 100);
  return Math.round(discounted * (1 + taxPct / 100));
}
