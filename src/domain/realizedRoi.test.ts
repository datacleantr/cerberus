import { describe, it, expect } from "vitest";
import {
  computeRealizedRoi,
  computeRoiVariance,
  type RealizedOrderFacts,
} from "./realizedRoi";

function row(over: Partial<RealizedOrderFacts> = {}): RealizedOrderFacts {
  return {
    quantity: 10,
    unitCost: 10,
    sellingPrice: 20,
    totalCost: 100,
    shippedToAmazon: 10,
    p1CancelQty: 0,
    p2MissingQty: 0,
    p3DefectiveQty: 0,
    p4ExpiredQty: 0,
    refundAmount: 0,
    cargoStatus: "Tam Geldi",
    ...over,
  };
}

describe("computeRealizedRoi — gerçekleşen ROI siparişlerden hesaplanır", () => {
  it("temel senaryo: 10 adet sevk, $200 gelir, $100 maliyet, Amazon ücreti düşülür", () => {
    // Ücret: 10 adet * (referral %15*$20 + FBA fulfillment $4.15) = 10 * $7.15 = $71.50
    const r = computeRealizedRoi([row()]);
    expect(r.realizedUnits).toBe(10);
    expect(r.realizedRevenue).toBe(200);
    expect(r.realizedCost).toBe(100);
    expect(r.estimatedAmazonFees).toBe(71.5);
    expect(r.realizedNetProfit).toBe(28.5);
    expect(r.realizedRoiPercent).toBe(16.62);
  });

  it("hiç sipariş yoksa ROI null döner — sıfır DEĞİL", () => {
    const r = computeRealizedRoi([]);
    expect(r.realizedRoiPercent).toBeNull();
    expect(r.reason).toBe("NO_ORDERS");
  });

  it("sevkiyat yapılmadıysa ROI ölçülmemiştir, uydurulmaz", () => {
    const r = computeRealizedRoi([row({ shippedToAmazon: 0 })]);
    expect(r.realizedRoiPercent).toBeNull();
    expect(r.reason).toBe("NOTHING_SHIPPED");
    // Para harcandı ama gelir yok — maliyet yine de kaydedilir
    expect(r.realizedCost).toBe(100);
  });

  it("iptal edilen sipariş gelir üretmez ama maliyeti düşülür", () => {
    const r = computeRealizedRoi([row({ cargoStatus: "İPTAL" })]);
    expect(r.realizedUnits).toBe(0);
    expect(r.realizedCost).toBe(100);
    expect(r.reason).toBe("NOTHING_SHIPPED");
  });

  it("tedarikçi iadesi geliri değil net maliyeti azaltır (Amazon ücreti hâlâ ayrıca düşülür)", () => {
    const r = computeRealizedRoi([row({ refundAmount: 50 })]);
    expect(r.realizedRevenue).toBe(200);
    expect(r.realizedCost).toBe(50);
    expect(r.estimatedAmazonFees).toBe(71.5);
    expect(r.realizedNetProfit).toBe(78.5);
    expect(r.realizedRoiPercent).toBe(64.61);
    expect(r.totalRefunds).toBe(50);
  });

  it("fire adetleri sayılır ve maliyet silinmez (fire cezalandırılır)", () => {
    const r = computeRealizedRoi([
      row({ quantity: 10, shippedToAmazon: 6, p2MissingQty: 3, p3DefectiveQty: 1 }),
    ]);
    expect(r.lostUnits).toBe(4);
    expect(r.realizedUnits).toBe(6);
    expect(r.realizedRevenue).toBe(120);
    // Maliyetin tamamı sayılır: harcanan para geri gelmedi
    expect(r.realizedCost).toBe(100);
    // Amazon ücreti yalnız sevk edilmiş (gelir üreten) 6 adet üzerinden alınır
    expect(r.estimatedAmazonFees).toBe(42.9);
    expect(r.realizedRoiPercent).toBe(-16.03);
  });

  it("sevk adedi sipariş adedini aşamaz (veri girişi hatasına dayanıklı)", () => {
    const r = computeRealizedRoi([row({ quantity: 5, shippedToAmazon: 999 })]);
    expect(r.realizedUnits).toBe(5);
  });

  it("totalCost boşsa birim maliyetten türetilir", () => {
    const r = computeRealizedRoi([row({ totalCost: 0, unitCost: 8, quantity: 10 })]);
    expect(r.realizedCost).toBe(80);
  });

  it("birden fazla sipariş satırı toplanır", () => {
    const r = computeRealizedRoi([row(), row({ totalCost: 50, shippedToAmazon: 5 })]);
    expect(r.sampleSize).toBe(2);
    expect(r.realizedUnits).toBe(15);
    expect(r.realizedCost).toBe(150);
    expect(r.realizedRevenue).toBe(300);
  });

  it("negatif ROI mümkündür — zarar gizlenmez", () => {
    const r = computeRealizedRoi([
      row({ sellingPrice: 5, totalCost: 200, shippedToAmazon: 10 }),
    ]);
    expect(r.realizedNetProfit).toBe(-199);
    expect(r.realizedRoiPercent).toBe(-79.92);
  });

  it("negatif/bozuk girdiler sıfıra kırpılır", () => {
    const r = computeRealizedRoi([
      row({ quantity: -5, shippedToAmazon: -3, refundAmount: -10 }),
    ]);
    expect(r.realizedUnits).toBe(0);
    expect(r.totalRefunds).toBe(0);
  });
});

describe("computeRealizedRoi — Amazon ücreti farkındalığı (N-3 uzantısı)", () => {
  it("FBM siparişte fulfillment ücreti alınmaz, yalnız referral düşülür", () => {
    const r = computeRealizedRoi([row({ fulfillmentType: "FBM" })]);
    // 10 adet * $20 * %15 referral = $30, fulfillment yok
    expect(r.estimatedAmazonFees).toBe(30);
  });

  it("bilinen kategori verilirse referral oranı kategoriye göre değişir", () => {
    const r = computeRealizedRoi([row({ category: "Jewelry" })]);
    // 10 adet * ($20*%20 referral + $4.15 FBA fulfillment) = 10 * $8.15 = $81.5
    expect(r.estimatedAmazonFees).toBe(81.5);
  });

  it("iptal edilen sipariş için Amazon ücreti de alınmaz (gelir yok)", () => {
    const r = computeRealizedRoi([row({ cargoStatus: "İPTAL" })]);
    expect(r.estimatedAmazonFees).toBe(0);
  });
});

describe("computeRoiVariance — tahmin kalibrasyonu", () => {
  it("ölçülmemişse UNMEASURED", () => {
    expect(computeRoiVariance(40, null).status).toBe("UNMEASURED");
    expect(computeRoiVariance(null, 40).status).toBe("UNMEASURED");
  });

  it("±5 puan bandı hedefte sayılır", () => {
    expect(computeRoiVariance(40, 38).status).toBe("ON_TARGET");
    expect(computeRoiVariance(40, 43).status).toBe("ON_TARGET");
  });

  it("tahmin gerçekten yüksekse OPTIMISTIC", () => {
    const v = computeRoiVariance(50, 30);
    expect(v.status).toBe("OPTIMISTIC");
    expect(v.variancePoints).toBe(20);
  });

  it("tahmin gerçekten düşükse PESSIMISTIC", () => {
    const v = computeRoiVariance(30, 50);
    expect(v.status).toBe("PESSIMISTIC");
    expect(v.variancePoints).toBe(-20);
  });
});
