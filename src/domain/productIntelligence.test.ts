import { describe, it, expect } from "vitest";
import {
  assessProductHealth,
  computeProductPnl,
  isValidTransition,
  STAGE_META,
  LIFECYCLE_STAGES,
  type ProductHealthInput,
} from "./productIntelligence";

function pnlInput(over: Partial<ProductHealthInput> = {}): ProductHealthInput {
  return {
    orderCount: 1,
    unitsPurchased: 10,
    unitsShipped: 10,
    unitsLost: 0,
    totalCost: 100,
    grossRevenue: 200,
    totalRefunds: 0,
    lifecycleStage: "SELLING",
    ...over,
  };
}

describe("computeProductPnl", () => {
  it("temel hesap: $200 gelir - $100 maliyet = %100 ROI", () => {
    const p = computeProductPnl(pnlInput());
    expect(p.netProfit).toBe(100);
    expect(p.roiPercent).toBe(100);
  });

  it("tedarikçi iadeleri net maliyetten mahsup edilir", () => {
    const p = computeProductPnl(pnlInput({ totalRefunds: 50 }));
    expect(p.netRevenue).toBe(200);
    expect(p.netCost).toBe(50);
    expect(p.netProfit).toBe(150);
    expect(p.roiPercent).toBe(300);
  });

  it("sipariş yoksa ROI null — sıfır değil", () => {
    const p = computeProductPnl(pnlInput({ orderCount: 0 }));
    expect(p.roiPercent).toBeNull();
    expect(p.reason).toBe("NO_ORDERS");
  });

  it("sevkiyat yoksa ölçülemez", () => {
    const p = computeProductPnl(pnlInput({ unitsShipped: 0 }));
    expect(p.reason).toBe("NOTHING_SHIPPED");
    expect(p.roiPercent).toBeNull();
  });

  it("fire ve sevk oranları yüzde olarak hesaplanır", () => {
    const p = computeProductPnl(
      pnlInput({ unitsPurchased: 20, unitsShipped: 12, unitsLost: 8 })
    );
    expect(p.lossRatePercent).toBe(40);
    expect(p.fulfillmentRatePercent).toBe(60);
  });

  it("zarar negatif olarak raporlanır, gizlenmez", () => {
    const p = computeProductPnl(pnlInput({ grossRevenue: 40, totalCost: 100 }));
    expect(p.netProfit).toBe(-60);
    expect(p.roiPercent).toBe(-60);
  });
});

describe("assessProductHealth — para kaybı her şeyin önünde gelir", () => {
  it("ağır fire tedarikçi iadesiyle karşılandıysa finansal zarar değil operasyon alarmı üretir", () => {
    // $1027.91 ödeme - $890.85 tedarikçi iadesi = $137.06 net maliyet;
    // $240 sevk geliri kârlı olsa da 30 adetten 26 fire operasyonel olarak kritiktir.
    const h = assessProductHealth(
      pnlInput({
        orderCount: 5,
        unitsPurchased: 30,
        unitsShipped: 4,
        unitsLost: 26,
        totalCost: 1027.91,
        grossRevenue: 240,
        totalRefunds: 890.85,
      })
    );
    expect(h.verdict).toBe("FIX_OPERATIONS");
    expect(h.severity).toBe("WARN");
    expect(h.reasons.some((r) => r.toLocaleLowerCase("tr").includes("fire"))).toBe(true);
    expect(h.recommendedAction).toContain("denetleyin");
  });

  it("zarar varken maliyet düşse bile SCALE_UP önerilmez", () => {
    const h = assessProductHealth(
      pnlInput({ grossRevenue: 50, totalCost: 100, priceTrendPercent: -20 })
    );
    expect(h.verdict).toBe("STOP_LOSS");
  });

  it("kârlı ama fire yüksekse FIX_OPERATIONS", () => {
    const h = assessProductHealth(
      pnlInput({
        unitsPurchased: 20,
        unitsShipped: 14,
        unitsLost: 6,
        totalCost: 100,
        grossRevenue: 200,
      })
    );
    expect(h.verdict).toBe("FIX_OPERATIONS");
    expect(h.severity).toBe("WARN");
  });

  it("marj darsa WATCH", () => {
    const h = assessProductHealth(pnlInput({ grossRevenue: 110, totalCost: 100 }));
    expect(h.verdict).toBe("WATCH");
  });

  it("gerçek vaka B0D47RZVR3: kârlı + maliyet düştü -> SCALE_UP", () => {
    // Canlı veriden: $355.07 maliyet, $480 gelir, tedarikçi fiyatı -%10
    const h = assessProductHealth(
      pnlInput({
        orderCount: 3,
        unitsPurchased: 16,
        unitsShipped: 12,
        unitsLost: 4,
        totalCost: 355.07,
        grossRevenue: 480,
        priceTrendPercent: -10,
      })
    );
    expect(h.verdict).toBe("SCALE_UP");
    expect(h.recommendedAction).toContain("artırmayı");
  });

  it("sağlıklı ürün, trend yoksa HEALTHY", () => {
    const h = assessProductHealth(pnlInput());
    expect(h.verdict).toBe("HEALTHY");
    expect(h.severity).toBe("INFO");
  });

  it("ölçülemeyen ürün için yargı üretilmez", () => {
    const h = assessProductHealth(pnlInput({ unitsShipped: 0 }));
    expect(h.verdict).toBe("UNMEASURED");
    expect(h.recommendedAction).toContain("Sevkiyatı");
  });
});

describe("Yaşam döngüsü geçiş kuralları", () => {
  it("ileri geçişler geçerlidir", () => {
    expect(isValidTransition("DISCOVERED", "ANALYZING")).toBe(true);
    expect(isValidTransition("APPROVED", "PURCHASING")).toBe(true);
    expect(isValidTransition("SELLING", "MONITORING")).toBe(true);
  });

  it("durak atlamak geçersizdir", () => {
    expect(isValidTransition("DISCOVERED", "SELLING")).toBe(false);
    expect(isValidTransition("SCORED", "IN_WAREHOUSE")).toBe(false);
  });

  it("her durakta durdurma mümkündür (PAUSED)", () => {
    for (const s of ["APPROVED", "PURCHASING", "IN_WAREHOUSE", "LISTED", "SELLING"] as const) {
      expect(isValidTransition(s, "PAUSED")).toBe(true);
    }
  });

  it("sonlandırılmış üründen çıkış yoktur", () => {
    expect(STAGE_META.DISCONTINUED.isTerminal).toBe(true);
    expect(STAGE_META.DISCONTINUED.next).toHaveLength(0);
  });

  it("reddedilen ürün yeniden analize alınabilir", () => {
    expect(isValidTransition("REJECTED", "ANALYZING")).toBe(true);
  });

  it("tüm duraklar Türkçe etikete sahiptir", () => {
    for (const s of LIFECYCLE_STAGES) {
      expect(STAGE_META[s].label.length).toBeGreaterThan(2);
    }
  });
});
