import { describe, expect, it } from "vitest";
import { validateOrderQuantityPatch, type OrderQuantityFacts } from "./orderRules";

const current: OrderQuantityFacts = {
  quantity: 10,
  shippedToAmazon: 4,
  p1CancelQty: 1,
  p2MissingQty: 1,
  p3DefectiveQty: 0,
  p4ExpiredQty: 0,
};

describe("validateOrderQuantityPatch", () => {
  it("geçerli kısmi güncellemeyi kabul eder", () => {
    expect(validateOrderQuantityPatch(current, { shippedToAmazon: 8 })).toEqual([]);
  });

  it("adet düşürülürken mevcut sevkiyatın aşımını yakalar", () => {
    expect(validateOrderQuantityPatch(current, { quantity: 3 })[0].field).toBe("shippedToAmazon");
  });

  it("P1-P4 toplamının miktarı aşmasını yakalar", () => {
    const issues = validateOrderQuantityPatch(current, { p3DefectiveQty: 9 });
    expect(issues.some((issue) => issue.message.includes("fire toplamı"))).toBe(true);
  });
});
