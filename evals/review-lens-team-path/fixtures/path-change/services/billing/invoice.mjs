export function createInvoice(customerId, lines) {
  const total = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return { id: `inv_${customerId}_${lines.length}`, customerId, lines, totalCents: total, status: "open" };
}

export function payInvoice(invoice) {
  return { ...invoice, status: "paid" };
}

export function refundInvoice(invoice) {
  if (invoice.status !== "paid") throw new Error(`cannot refund an invoice that is ${invoice.status}`);
  return { ...invoice, status: "refunded" };
}
