export const TAX_RATE = 0.25;

export const helpers = {
  subtotal(items) {
    return items.reduce((sum, item) => sum + item.price * item.qty, 0);
  },
};

export function withTax(total) {
  return Math.round(total * (1 + TAX_RATE) * 100) / 100;
}

export function checkout(cart) {
  return { total: helpers.subtotal(cart.items) };
}
