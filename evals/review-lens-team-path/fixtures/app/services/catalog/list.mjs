export function listProducts(products) {
  return products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
}
