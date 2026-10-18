export function lineTotal(item) {
  return item.price * item.qty;
}

export function orderTotal(order) {
  const subtotal = order.items.reduce((sum, item) => sum + lineTotal(item), 0);
  return subtotal + (order.shipping ?? 0);
}
