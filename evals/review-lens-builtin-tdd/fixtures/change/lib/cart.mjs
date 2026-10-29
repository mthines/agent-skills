export const helpers = {
  subtotal(items) {
    return items.reduce((sum, item) => sum + item.price * item.qty, 0);
  },
  discount(total, code) {
    return code === "SAVE10" ? Math.round(total * 0.9 * 100) / 100 : total;
  },
};

export function checkout(cart) {
  const subtotal = helpers.subtotal(cart.items);
  return { total: helpers.discount(subtotal, cart.code) };
}
