import { describe, it, expect } from "vitest";
import { estimateAmazonFees, estimateReferralFeeRate } from "./amazonFees";

describe("estimateReferralFeeRate", () => {
  it("bilinen kategori eşleşirse CATEGORY_MATCHED döner", () => {
    const r = estimateReferralFeeRate("Electronics Accessories");
    expect(r.provenance).toBe("CATEGORY_MATCHED");
    expect(r.rate).toBe(0.08);
  });

  it("bilinmeyen/boş kategori DEFAULT_ASSUMED %15 döner", () => {
    expect(estimateReferralFeeRate(null)).toEqual({ rate: 0.15, provenance: "DEFAULT_ASSUMED" });
    expect(estimateReferralFeeRate("UNCATEGORIZED")).toEqual({ rate: 0.15, provenance: "DEFAULT_ASSUMED" });
    expect(estimateReferralFeeRate("Bilinmeyen Kategori")).toEqual({ rate: 0.15, provenance: "DEFAULT_ASSUMED" });
  });

  it("kategori normalize edilir (boşluk/tire farkı eşleşmeyi bozmaz)", () => {
    expect(estimateReferralFeeRate("jewelry").rate).toBe(0.2);
    expect(estimateReferralFeeRate("JEWELRY").rate).toBe(0.2);
  });
});

describe("estimateAmazonFees", () => {
  it("FBA + bilinmeyen kategori: referral %15 + fiyat kademesi fulfillment", () => {
    const r = estimateAmazonFees({ sellingPrice: 45, fulfillmentType: "FBA" });
    expect(r.referralFeeAmount).toBe(6.75);
    expect(r.fulfillmentFeeAmount).toBe(4.15);
    expect(r.totalFeeAmount).toBe(10.9);
    expect(r.provenance).toBe("DEFAULT_ASSUMED");
  });

  it("fulfillmentType verilmezse FBA varsayılır (mevcut karar motoru davranışıyla uyumlu)", () => {
    const r = estimateAmazonFees({ sellingPrice: 45 });
    expect(r.fulfillmentFeeAmount).toBe(4.15);
  });

  it("FBM: fulfillment ücreti sıfırdır, yalnız referral alınır", () => {
    const r = estimateAmazonFees({ sellingPrice: 45, fulfillmentType: "FBM" });
    expect(r.fulfillmentFeeAmount).toBe(0);
    expect(r.referralFeeAmount).toBe(6.75);
    expect(r.totalFeeAmount).toBe(6.75);
  });

  it("kategori eşleşirse daha isabetli referral oranı kullanılır", () => {
    const r = estimateAmazonFees({ sellingPrice: 100, category: "Jewelry", fulfillmentType: "FBA" });
    expect(r.referralFeeAmount).toBe(20);
    expect(r.provenance).toBe("CATEGORY_MATCHED");
  });

  it("fulfillment ücreti fiyat kademelerine göre değişir", () => {
    expect(estimateAmazonFees({ sellingPrice: 40, fulfillmentType: "FBA" }).fulfillmentFeeAmount).toBe(4.15);
    expect(estimateAmazonFees({ sellingPrice: 60, fulfillmentType: "FBA" }).fulfillmentFeeAmount).toBe(5.8);
    expect(estimateAmazonFees({ sellingPrice: 150, fulfillmentType: "FBA" }).fulfillmentFeeAmount).toBe(7.45);
  });

  it("RETURN/REMOVAL_ORDER FBM olmadığı için hâlâ FBA fulfillment tahminiyle ele alınır", () => {
    const r = estimateAmazonFees({ sellingPrice: 50, fulfillmentType: "RETURN" });
    expect(r.fulfillmentFeeAmount).toBeGreaterThan(0);
  });

  it("negatif/NaN fiyat sıfıra sabitlenir, negatif ücret üretilmez", () => {
    const r = estimateAmazonFees({ sellingPrice: -10 });
    expect(r.referralFeeAmount).toBe(0);
    expect(r.fulfillmentFeeAmount).toBeGreaterThanOrEqual(0);
  });
});
