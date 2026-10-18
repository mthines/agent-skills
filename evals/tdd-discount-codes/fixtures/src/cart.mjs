/** Sum of price × quantity across the cart's line items. */
export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
