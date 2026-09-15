export interface OrderQuantityFacts {
  quantity: number;
  shippedToAmazon: number;
  p1CancelQty: number;
  p2MissingQty: number;
  p3DefectiveQty: number;
  p4ExpiredQty: number;
}

export interface OrderQuantityIssue {
  field: keyof OrderQuantityFacts;
  message: string;
}

/**
 * Validates the final state after a partial PATCH is applied.
 * DB CHECK constraints remain the last line of defence, but API callers get a
 * useful 422 instead of an opaque constraint-error 500.
 */
export function validateOrderQuantityPatch(
  current: OrderQuantityFacts,
  patch: Partial<OrderQuantityFacts>
): OrderQuantityIssue[] {
  const value: OrderQuantityFacts = {
    quantity: Number(patch.quantity ?? current.quantity),
    shippedToAmazon: Number(patch.shippedToAmazon ?? current.shippedToAmazon),
    p1CancelQty: Number(patch.p1CancelQty ?? current.p1CancelQty),
    p2MissingQty: Number(patch.p2MissingQty ?? current.p2MissingQty),
    p3DefectiveQty: Number(patch.p3DefectiveQty ?? current.p3DefectiveQty),
    p4ExpiredQty: Number(patch.p4ExpiredQty ?? current.p4ExpiredQty),
  };

  const issues: OrderQuantityIssue[] = [];
  if (value.quantity < 1 || !Number.isInteger(value.quantity)) {
    issues.push({ field: "quantity", message: "Sipariş adedi pozitif bir tam sayı olmalıdır." });
    return issues;
  }
  if (value.shippedToAmazon > value.quantity) {
    issues.push({
      field: "shippedToAmazon",
      message: `Sevk edilen adet (${value.shippedToAmazon}) sipariş adedini (${value.quantity}) aşamaz.`,
    });
  }
  const fire = value.p1CancelQty + value.p2MissingQty + value.p3DefectiveQty + value.p4ExpiredQty;
  if (fire > value.quantity) {
    issues.push({
      field: "p1CancelQty",
      message: `P1–P4 fire toplamı (${fire}) sipariş adedini (${value.quantity}) aşamaz.`,
    });
  }
  return issues;
}
