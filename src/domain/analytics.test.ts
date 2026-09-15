import { describe, it, expect } from "vitest";
import { computeAnalyticsKpis, buildStoreComparison, buildAlerts } from "./analytics";

describe("Analytics — Karar Destek", () => {
  it("boş liste sıfır KPI döner", () => {
    const k = computeAnalyticsKpis([]);
    expect(k.totalOrders).toBe(0);
    expect(k.grossProfit).toBe(0);
  });

  it("basit KPI hesap", () => {
    const k = computeAnalyticsKpis([
      { quantity: 2, totalCost: 20, shippedToAmazon: 2, p1CancelQty: 0, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, refundAmount: 0, pshBatchNo: null, cargoStatus: "Tam Geldi", sellingPrice: 25 },
      { quantity: 1, totalCost: 15, shippedToAmazon: 0, p1CancelQty: 1, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, refundAmount: 5, pshBatchNo: "BATCH-1", cargoStatus: "İPTAL", sellingPrice: 30 },
    ]);
    expect(k.totalOrders).toBe(2);
    expect(k.totalUnits).toBe(3);
    expect(k.totalSpend).toBe(35);
    expect(k.totalShipped).toBe(2);
    expect(k.p1).toBe(1);
    expect(k.totalRefunds).toBe(5);
    // Tedarikçi iadesi maliyeti mahsup eder: $50 gelir - ($35 - $5) = $20.
    expect(k.grossProfit).toBe(20);
    expect(k.problemRate).toBe(50);
  });

  it("mağaza kıyas gruplar", () => {
    const c = buildStoreComparison([
      { buyerStore: "HRN", quantity: 2, totalCost: 20, shippedToAmazon: 2, refundAmount: 0, p1CancelQty: 0, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, cargoStatus: "Tam Geldi" },
      { buyerStore: "SEL", quantity: 1, totalCost: 10, shippedToAmazon: 0, refundAmount: 0, p1CancelQty: 0, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, cargoStatus: "Yolda" },
      { buyerStore: "HRN", quantity: 1, totalCost: 15, shippedToAmazon: 1, refundAmount: 0, p1CancelQty: 0, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, cargoStatus: "Tam Geldi" },
    ]);
    expect(c.length).toBe(2);
    expect(c.find((x) => x.storeCode === "HRN")?.orders).toBe(2);
  });

  it("alarm üretir", () => {
    const k = computeAnalyticsKpis([
      { quantity: 10, totalCost: 100, shippedToAmazon: 2, p1CancelQty: 3, p2MissingQty: 2, p3DefectiveQty: 0, p4ExpiredQty: 0, refundAmount: 20, pshBatchNo: null, cargoStatus: "İPTAL", sellingPrice: 20 },
    ]);
    const alerts = buildAlerts(k, [{ asin: "B0X", title: "Test", firstPrice: 20, latestPrice: 18, changePercent: -10, direction: "FALLING", isOpportunity: true }]);
    expect(alerts.some((a) => a.severity === "CRITICAL")).toBe(true);
  });
});
