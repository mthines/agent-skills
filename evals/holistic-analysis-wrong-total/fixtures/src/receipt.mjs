import { loadOrders } from "./load.mjs";
import { orderTotal } from "./pricing.mjs";
import { formatTotal } from "./format.mjs";

for (const order of loadOrders("data/orders.jsonl")) {
  console.log(`${order.id}  ${formatTotal(orderTotal(order))}`);
}
