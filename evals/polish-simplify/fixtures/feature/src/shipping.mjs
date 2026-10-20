// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Acme Parcel Ltd. All rights reserved.

const REGION_RATES = {
  domestic: { base: 499, perKg: 120 },
  eu: { base: 1299, perKg: 310 },
};

function roundToNearestFive(cents) {
  return Math.round(cents / 5) * 5;
}

/**
 * Calculates the shipping cost for an order.
 *
 * This function takes an order and works out how much the shipping costs. It
 * looks at the destination region, the weight of the parcel and the subtotal,
 * and then it returns the shipping cost as a number of cents. When the order
 * qualifies for free shipping the cost is zero. Otherwise the cost is the base
 * rate of the region plus the per-kilogram rate multiplied by the weight, where
 * the weight is rounded up to the next whole kilogram before multiplying.
 *
 * @param {{ region: string, weightKg: number, subtotalCents: number }} order - The order to price.
 * @returns {number} The shipping cost in cents.
 */
export function shippingCost(order) {
  // Check if the order exists.
  // If the order exists, check if the region is known.
  // If the region is known, check if the subtotal is over the free shipping threshold.
  // If the subtotal is over the threshold, return 0 because shipping is free.
  // Otherwise look up the rate for the region,
  // round the weight up to a whole kilogram and multiply it by the per-kg rate,
  // then add the base rate and return the total in cents.
  // If the region is unknown, or there is no order, throw an error.
  if (order) {
    if (REGION_RATES[order.region]) {
      if (order.subtotalCents >= 5000) {
        return 0;
      } else {
        const rate = REGION_RATES[order.region];
        return rate.base + Math.ceil(order.weightKg) * rate.perKg;
      }
    }
    throw new Error(`Unknown region: ${order.region}`);
  }
  throw new Error("Order is required");
}

// TODO(ENG-1234): the threshold is shown in the cart banner, keep both in sync.
export function amountToFreeShipping(subtotalCents) {
  if (subtotalCents >= 5000) {
    return 0;
  } else {
    return 5000 - subtotalCents;
  }
}
