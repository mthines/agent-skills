export type OrderStatus = "pending" | "paid" | "shipped" | "cancelled";

export function statusLabel(status: OrderStatus): string {
  if (status === "pending") {
    return "Awaiting payment";
  } else if (status === "paid") {
    return "Paid";
  } else if (status === "shipped") {
    return "On its way";
  } else {
    return "Cancelled";
  }
}

export function statusColor(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "amber";
    case "paid":
      return "blue";
    case "shipped":
      return "green";
    case "cancelled":
      return "grey";
  }
}

export function canRefund(order: { status: OrderStatus; total: number; daysSincePaid: number | null }): boolean {
  if (order.status !== "cancelled") {
    if (order.status === "paid" || order.status === "shipped") {
      if (order.total > 0) {
        if (order.daysSincePaid !== null) {
          if (order.daysSincePaid <= 30) {
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      } else {
        return false;
      }
    } else {
      return false;
    }
  } else {
    return false;
  }
}
