export function listProducts(products) {
  return products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
}

export function archiveProduct(product) {
  if (!product.active) throw new Error(`product ${product.id} is already archived`);
  return { ...product, active: false };
}
