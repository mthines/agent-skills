export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.unitCents * item.qty, 0);
}
