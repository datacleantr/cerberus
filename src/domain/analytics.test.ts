import { describe, it, expect } from "vitest";
import { computeAnalyticsKpis, buildStoreComparison, buildAlerts, computeProductPnlRanking } from "./analytics";

describe("Analytics — Karar Destek", () => {
  it("boş liste sıfır KPI döner", () => {
    const k = computeAnalyticsKpis([]);
    expect(k.totalOrders).toBe(0);
    expect(k.netProfit).toBe(0);
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
    // Tedarikçi iadesi maliyeti mahsup eder: $50 gelir - ($35 - $5) = $20 brüt;
    // Amazon ücreti (N-3 düzeltmesi): 2 adet * ($25*%15 referral + $4.15 FBA) = $15.80
    expect(k.estimatedAmazonFees).toBe(15.8);
    expect(k.netProfit).toBe(4.2);
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

  it("FBM siparişte fulfillment ücreti alınmaz (yalnız referral)", () => {
    const k = computeAnalyticsKpis([
      { quantity: 2, totalCost: 20, shippedToAmazon: 2, p1CancelQty: 0, p2MissingQty: 0, p3DefectiveQty: 0, p4ExpiredQty: 0, refundAmount: 0, pshBatchNo: null, cargoStatus: "Tam Geldi", sellingPrice: 25, fulfillmentType: "FBM" },
    ]);
    // 2 adet * $25 * %15 referral = $7.50, fulfillment yok
    expect(k.estimatedAmazonFees).toBe(7.5);
  });

  it("computeProductPnlRanking: Amazon ücreti düşülür, en kârlı önce sıralanır", () => {
    const ranked = computeProductPnlRanking([
      { productId: 1, asin: "B01", title: "Ürün A", quantity: 10, shippedToAmazon: 10, totalCost: 100, sellingPrice: 20, refundAmount: 0 },
      { productId: 2, asin: "B02", title: "Ürün B", quantity: 5, shippedToAmazon: 5, totalCost: 200, sellingPrice: 20, refundAmount: 0 },
    ]);
    expect(ranked.length).toBe(2);
    // Ürün A: gelir $200, maliyet $100, ücret $71.50 -> net $28.50 (kârlı)
    // Ürün B: gelir $100, maliyet $200, ücret $35.75 -> net -$135.75 (zararlı)
    expect(ranked[0].productId).toBe(1);
    expect(ranked[0].netProfit).toBe(28.5);
    expect(ranked[1].productId).toBe(2);
    expect(ranked[1].netProfit).toBeLessThan(0);
  });

  it("computeProductPnlRanking: productId olmayan satırlar atlanır", () => {
    const ranked = computeProductPnlRanking([
      { productId: null, asin: "B03", title: "Bağlantısız", quantity: 1, shippedToAmazon: 1, totalCost: 10, sellingPrice: 20, refundAmount: 0 },
    ]);
    expect(ranked.length).toBe(0);
  });

  it("alarm üretir", () => {
    const k = computeAnalyticsKpis([
      { quantity: 10, totalCost: 100, shippedToAmazon: 2, p1CancelQty: 3, p2MissingQty: 2, p3DefectiveQty: 0, p4ExpiredQty: 0, refundAmount: 20, pshBatchNo: null, cargoStatus: "İPTAL", sellingPrice: 20 },
    ]);
    const alerts = buildAlerts(k, [{ asin: "B0X", title: "Test", firstPrice: 20, latestPrice: 18, changePercent: -10, direction: "FALLING", isOpportunity: true }]);
    expect(alerts.some((a) => a.severity === "CRITICAL")).toBe(true);
  });
});
