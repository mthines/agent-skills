export const helpers = {
  subtotal(items) {
    return items.reduce((sum, item) => sum + item.price * item.qty, 0);
  },
};

export function checkout(cart) {
  return { total: helpers.subtotal(cart.items) };
}
