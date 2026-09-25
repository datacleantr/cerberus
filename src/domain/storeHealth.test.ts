import { describe, it, expect } from "vitest";
import { computeWeeklyStoreHealth, isoWeekKey, type StoreHealthIdentity, type StoreHealthOrderFact } from "./storeHealth";

// Sabit referans an: Çarşamba, 2026-09-23 (haftası isoWeekKey ile türetilir —
// kırılgan olmasın diye referans hafta anahtarı da fonksiyondan üretiliyor).
const NOW = new Date("2026-09-23T12:00:00Z");

function dateInCurrentWeek(offsetDays: number): string {
  // NOW haftası içinde bir gün üretir (Pazartesi'ye göre offset, 0-4 arası güvenli)
  const d = new Date(NOW.getTime());
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + offsetDays);
  return d.toISOString().slice(0, 10);
}

function dateWeeksAgo(weeks: number, dayOffset = 1): string {
  const d = new Date(NOW.getTime() - weeks * 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + dayOffset);
  return d.toISOString().slice(0, 10);
}

function order(over: Partial<StoreHealthOrderFact> = {}): StoreHealthOrderFact {
  return {
    buyerStore: "HRN",
    orderDate: dateInCurrentWeek(1),
    quantity: 10,
    totalCost: 100,
    shippedToAmazon: 10,
    p1CancelQty: 0,
    p2MissingQty: 0,
    p3DefectiveQty: 0,
    p4ExpiredQty: 0,
    refundAmount: 0,
    cargoStatus: "Tam Geldi",
    sellingPrice: 20,
    ...over,
  };
}

const IDENTITIES: StoreHealthIdentity[] = [
  { storeCode: "HRN", storeName: "HRN Amazon", status: "ACTIVE" },
];

describe("isoWeekKey", () => {
  it("aynı ISO haftadaki iki gün için aynı anahtarı üretir", () => {
    expect(isoWeekKey(new Date("2026-09-21T00:00:00Z"))).toBe(isoWeekKey(new Date("2026-09-25T00:00:00Z")));
  });

  it("yıl sınırında doğru ISO hafta numarasını üretir (2025-12-29 -> 2026-W01)", () => {
    // 2025-12-29 Pazartesi, ISO takvimde 2026'nın ilk haftasına düşer.
    expect(isoWeekKey(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("computeWeeklyStoreHealth", () => {
  it("hiç sipariş yoksa mağaza ölçülemedi döner, sayı uydurulmaz", () => {
    const [result] = computeWeeklyStoreHealth(IDENTITIES, [], NOW);
    expect(result.isActiveThisWeek).toBe(false);
    expect(result.healthScore).toBeNull();
    expect(result.grade).toBe("ÖLÇÜLEMEDİ");
    expect(result.weekOverWeek).toBeNull();
    expect(result.silenceAlert?.daysSinceLastOrder).toBeNull();
    expect(result.silenceAlert?.severity).toBe("INFO");
  });

  it("bu hafta sipariş varsa, geçen hafta yoksa: skor hesaplanır ama WoW null olur", () => {
    const orders = [order({ orderDate: dateInCurrentWeek(1) })];
    const [result] = computeWeeklyStoreHealth(IDENTITIES, orders, NOW);
    expect(result.isActiveThisWeek).toBe(true);
    expect(result.healthScore).not.toBeNull();
    expect(result.currentWeek.fulfillmentRate).toBe(100);
    expect(result.currentWeek.problemRate).toBe(0);
    expect(result.weekOverWeek).toBeNull(); // geçen hafta orders=0, sıfır tabandan % üretilmez
    expect(result.silenceAlert).toBeNull();
  });

  it("hem bu hafta hem geçen hafta veri varsa WoW yüzde değişimi doğru hesaplanır", () => {
    const orders = [
      order({ orderDate: dateWeeksAgo(1), quantity: 10, shippedToAmazon: 5, totalCost: 100 }), // geçen hafta: %50 sevk
      order({ orderDate: dateInCurrentWeek(1), quantity: 10, shippedToAmazon: 10, totalCost: 100 }), // bu hafta: %100 sevk
    ];
    const [result] = computeWeeklyStoreHealth(IDENTITIES, orders, NOW);
    expect(result.previousWeek.orders).toBe(1);
    expect(result.currentWeek.fulfillmentRate).toBe(100);
    expect(result.previousWeek.fulfillmentRate).toBe(50);
    expect(result.weekOverWeek).not.toBeNull();
    expect(result.weekOverWeek?.fulfillmentRateDeltaPoints).toBe(50);
    expect(result.weekOverWeek?.ordersDeltaPercent).toBe(0); // 1 -> 1 sipariş
  });

  it("problem oranı yüksekse skor düşer ve doğru eksende görünür", () => {
    const orders = [
      order({ orderDate: dateInCurrentWeek(1), p1CancelQty: 5, quantity: 10, shippedToAmazon: 5 }),
      order({ orderDate: dateInCurrentWeek(2), cargoStatus: "İPTAL" }),
    ];
    const [result] = computeWeeklyStoreHealth(IDENTITIES, orders, NOW);
    expect(result.currentWeek.problemRate).toBe(100); // 2/2 sipariş problemli
    expect(result.healthScore).not.toBeNull();
    expect((result.healthScore as number)).toBeLessThan(60);
    const problemAxis = result.breakdown.find((b) => b.axis.includes("Problem"));
    expect(problemAxis?.score).toBe(0); // 1 - 1.0*2 clamp edilir 0'a
  });

  it("bu hafta sessizse ve geçmişte sipariş varsa, sessizlik gün sayısıyla raporlanır", () => {
    const orders = [order({ orderDate: dateWeeksAgo(4) })]; // 4 hafta önce tek sipariş, bu hafta yok
    const [result] = computeWeeklyStoreHealth(IDENTITIES, orders, NOW);
    expect(result.isActiveThisWeek).toBe(false);
    expect(result.healthScore).toBeNull();
    expect(result.silenceAlert).not.toBeNull();
    expect(result.silenceAlert?.daysSinceLastOrder).toBeGreaterThan(20);
  });

  it("tedarikçi iadesi yüksekse iade ekseni skorunu düşürür", () => {
    const orders = [order({ orderDate: dateInCurrentWeek(1), totalCost: 100, refundAmount: 30 })];
    const [result] = computeWeeklyStoreHealth(IDENTITIES, orders, NOW);
    expect(result.currentWeek.refundRate).toBe(30);
    const cashAxis = result.breakdown.find((b) => b.axis.includes("İade"));
    expect(cashAxis?.score).toBe(0); // 1 - 0.30*5 = -0.5 -> clamp 0
  });

  it("farklı mağazalar birbirine karışmaz", () => {
    const identities: StoreHealthIdentity[] = [
      { storeCode: "HRN", storeName: "HRN", status: "ACTIVE" },
      { storeCode: "SEL", storeName: "SEL", status: "ACTIVE" },
    ];
    const orders = [
      order({ buyerStore: "HRN", orderDate: dateInCurrentWeek(1) }),
    ];
    const results = computeWeeklyStoreHealth(identities, orders, NOW);
    const hrn = results.find((r) => r.storeCode === "HRN")!;
    const sel = results.find((r) => r.storeCode === "SEL")!;
    expect(hrn.isActiveThisWeek).toBe(true);
    expect(sel.isActiveThisWeek).toBe(false);
    expect(sel.healthScore).toBeNull();
  });

  it("N-3 uzantısı: net kâr artık Amazon ücretini düşer (eskiden hiç düşmüyordu)", () => {
    // 10 adet * $20, gelir $200, tedarikçi maliyeti $100, ücret 10*(20*%15+4.15)=$71.50
    const results = computeWeeklyStoreHealth(IDENTITIES, [order()], NOW);
    const hrn = results[0];
    expect(hrn.currentWeek.estimatedAmazonFees).toBe(71.5);
    expect(hrn.currentWeek.netProfit).toBe(28.5);
  });

  it("FBM siparişte Amazon fulfillment ücreti alınmaz", () => {
    const results = computeWeeklyStoreHealth(IDENTITIES, [order({ fulfillmentType: "FBM" })], NOW);
    // yalnız referral: 10 * $20 * %15 = $30
    expect(results[0].currentWeek.estimatedAmazonFees).toBe(30);
  });
});
