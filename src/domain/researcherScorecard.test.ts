import { describe, it, expect } from "vitest";
import { computeResearcherScorecards, type MasterFact, type ResearcherIdentity } from "./researcherScorecard";
import type { RealizedRoiResult } from "./realizedRoi";

const identity = (code: string): ResearcherIdentity => ({
  id: 1,
  code,
  name: `Araştırmacı ${code}`,
  specialtyDomain: "Test",
  avatar: null,
});

const measuredRoi = (overrides: Partial<RealizedRoiResult> = {}): RealizedRoiResult => ({
  realizedRoiPercent: 50,
  realizedUnits: 10,
  realizedRevenue: 300,
  realizedCost: 200,
  realizedNetProfit: 100,
  estimatedAmazonFees: 0,
  lostUnits: 0,
  totalRefunds: 0,
  sampleSize: 3,
  ...overrides,
});

const unmeasuredRoi: RealizedRoiResult = {
  realizedRoiPercent: null,
  realizedUnits: 0,
  realizedRevenue: 0,
  realizedCost: 0,
  realizedNetProfit: 0,
  estimatedAmazonFees: 0,
  lostUnits: 0,
  totalRefunds: 0,
  sampleSize: 0,
  reason: "NO_ORDERS",
};

describe("computeResearcherScorecards — gerçek sipariş verisi olmadığında uydurmaz", () => {
  it("hiç product_masters kaydı yoksa her şey sıfır/null döner, skor null olur", () => {
    const [result] = computeResearcherScorecards([identity("SRC-01")], [], new Map());
    expect(result.discoveryVolume).toBe(0);
    expect(result.approvalRate).toBeNull();
    expect(result.purchaseConversion).toBeNull();
    expect(result.researcherScore).toBeNull();
    expect(result.measuredProductCount).toBe(0);
  });

  it("product_masters kaydı var ama hiçbiri gerçek siparişe dönüşmemişse (bugünkü gerçek durum) approvalRate ölçülür, ROI/skor null kalır", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "B000AAA", decisionAction: "BUY" },
      { researcherCode: "SRC-01", asin: "B000BBB", decisionAction: "REJECT" },
    ];
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, new Map());
    expect(result.discoveryVolume).toBe(2);
    expect(result.approvalRate).toBe(50); // 1/2 REJECT olmayan
    expect(result.purchaseConversion).toBe(0); // hiçbiri sipariş verisinde yok
    expect(result.averageRoi).toBeNull();
    expect(result.researcherScore).toBeNull(); // measuredProductCount 0 olduğu için uydurulmaz
    expect(result.measuredProductCount).toBe(0);
  });

  it("bir ürün gerçek siparişle eşleşince ROI/kâr/skor gerçek veriden hesaplanır", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "B000AAA", decisionAction: "BUY" },
    ];
    const roiMap = new Map<string, RealizedRoiResult>([["B000AAA", measuredRoi()]]);
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, roiMap);
    expect(result.measuredProductCount).toBe(1);
    expect(result.purchaseConversion).toBe(100);
    expect(result.averageRoi).toBe(50);
    expect(result.averageNetProfit).toBe(100);
    expect(result.researcherScore).not.toBeNull();
    expect(result.researcherScore).toBeGreaterThan(0);
  });

  it("örnek boyutu sıfır olan (NO_ORDERS) bir ROI kaydı 'ölçülmüş' sayılmaz", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "B000AAA", decisionAction: "BUY" },
    ];
    const roiMap = new Map<string, RealizedRoiResult>([["B000AAA", unmeasuredRoi]]);
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, roiMap);
    expect(result.measuredProductCount).toBe(0);
    expect(result.purchaseConversion).toBe(0);
    expect(result.researcherScore).toBeNull();
  });

  it("fire (lostUnits) oranı problemRate'e yansır ve skoru düşürür", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "B000AAA", decisionAction: "BUY" },
    ];
    const highFire = measuredRoi({ realizedUnits: 5, lostUnits: 5 }); // %50 fire
    const roiMap = new Map<string, RealizedRoiResult>([["B000AAA", highFire]]);
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, roiMap);
    expect(result.problemRate).toBe(50);
  });

  it("decisionAction büyük/küçük harf ya da boşluk fark etmeksizin ASIN eşleşmesi büyük harfe normalize edilir", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "b000aaa", decisionAction: "BUY" },
    ];
    const roiMap = new Map<string, RealizedRoiResult>([["B000AAA", measuredRoi()]]);
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, roiMap);
    expect(result.measuredProductCount).toBe(1);
  });

  it("activeListingsCount yalnız BUY/REPRICE/REORDER kararlarını sayar", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "A1", decisionAction: "BUY" },
      { researcherCode: "SRC-01", asin: "A2", decisionAction: "REPRICE" },
      { researcherCode: "SRC-01", asin: "A3", decisionAction: "WAIT" },
      { researcherCode: "SRC-01", asin: "A4", decisionAction: "PAUSE" },
    ];
    const [result] = computeResearcherScorecards([identity("SRC-01")], masters, new Map());
    expect(result.activeListingsCount).toBe(2);
  });

  it("başka araştırmacının ürünleri karışmaz (researcherCode ile katı ayrım)", () => {
    const masters: MasterFact[] = [
      { researcherCode: "SRC-01", asin: "A1", decisionAction: "BUY" },
      { researcherCode: "SRC-02", asin: "A2", decisionAction: "BUY" },
    ];
    const [r1, r2] = computeResearcherScorecards(
      [identity("SRC-01"), identity("SRC-02")],
      masters,
      new Map()
    );
    expect(r1.discoveryVolume).toBe(1);
    expect(r2.discoveryVolume).toBe(1);
  });
});
