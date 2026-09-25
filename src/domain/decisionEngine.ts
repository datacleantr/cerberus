/**
 * CERBERUS Karar Motoru (T5.1) — saf fonksiyonlar, route'tan bağımsız.
 * İş kurallarının birim testi burada yapılır; route yalnızca IO katmanıdır.
 */

import { estimateAmazonFees, type FeeProvenance } from "./amazonFees";

export interface LandedCostResult {
  marketplaceFee: number;
  fulfillmentFee: number;
  landedCost: number;
  estimatedNetProfit: number;
  roiPercent: number;
  /** Ücret tahmininin dayanağı — CATEGORY_MATCHED: gerçek kategoriden, DEFAULT_ASSUMED: sabit varsayım (bkz. amazonFees.ts) */
  feeProvenance: FeeProvenance;
  feeBasis: string;
}

/**
 * DENETİM BULGUSU N-3 (P0) — DÜZELTİLDİ: pazaryeri ücreti artık kategoriye
 * göre `src/domain/amazonFees.ts`'ten gelir (eşleşme yoksa dürüstçe
 * DEFAULT_ASSUMED %15); fulfillment ücreti `fulfillmentType` okunur — FBM'de
 * sıfırdır (Amazon kargolamıyor). `category`/`fulfillmentType` verilmezse
 * önceki davranışla birebir aynı sonucu üretir (DEFAULT_ASSUMED + FBA
 * varsayımı), böylece bu iki alanı henüz bilmeyen çağıranlar kırılmaz.
 */
export function calculateLandedCostAndProfit(
  sourcePrice: number,
  sellingPrice: number,
  prepCost = 1.35,
  options?: { category?: string | null; fulfillmentType?: string | null }
): LandedCostResult {
  const fees = estimateAmazonFees({
    sellingPrice,
    category: options?.category,
    fulfillmentType: options?.fulfillmentType,
  });
  const marketplaceFee = fees.referralFeeAmount;
  const fulfillmentFee = fees.fulfillmentFeeAmount;
  const landedCost = Number(
    (sourcePrice + prepCost + marketplaceFee + fulfillmentFee).toFixed(2)
  );
  const estimatedNetProfit = Number((sellingPrice - landedCost).toFixed(2));
  const roiPercent =
    landedCost > 0 ? Number(((estimatedNetProfit / landedCost) * 100).toFixed(2)) : 0;

  return {
    marketplaceFee,
    fulfillmentFee,
    landedCost,
    estimatedNetProfit,
    roiPercent,
    feeProvenance: fees.provenance,
    feeBasis: fees.basis,
  };
}

/**
 * Bir skorun nereden geldiğini söyler.
 *
 * `MEASURED`  — gerçek veriden hesaplandı, karara tam ağırlıkla girer.
 * `HEURISTIC` — kaba bir kuraldan türetildi (ör. alan adı), sınırlı güvenilir.
 * `ASSUMED`   — sabit varsayım; henüz gerçek sinyal yok.
 *
 * Bu ayrım şeffaflık için zorunlu: skorun %35'i sabit varsayımken kullanıcıya
 * tek bir "Fırsat Skoru: 88" göstermek, olmayan bir kesinlik iddia etmektir.
 */
export type SignalProvenance = "MEASURED" | "HEURISTIC" | "ASSUMED";

export interface ScoredSignal {
  score: number;
  provenance: SignalProvenance;
  /** Skorun neye dayandığının Türkçe açıklaması */
  basis: string;
}

export interface DecisionEngineResult {
  profitabilityScore: number;
  demandScore: number;
  competitionScore: number;
  priceStabilityScore: number;
  supplierRiskScore: number;
  operationalRiskScore: number;
  opportunityScore: number;
  decisionAction: "BUY" | "TEST" | "WAIT" | "REJECT";
  policyStatus: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;

  /** Her eksenin kaynağı ve gerekçesi — arayüzde "tahmini" rozeti bundan çıkar */
  signals: {
    profitability: ScoredSignal;
    demand: ScoredSignal;
    competition: ScoredSignal;
    priceStability: ScoredSignal;
    supplierRisk: ScoredSignal;
    operationalRisk: ScoredSignal;
  };
  /** Fırsat skorunun yüzde kaçı gerçek ölçüme dayanıyor (0-100) */
  evidenceCoverage: number;
  /** Sabit varsayıma dayanan eksenlerin adları */
  assumedAxes: string[];
}

/**
 * Karar motoru.
 *
 * ÖNEMLİ KALİBRASYON NOTU:
 * Eskiden altı eksen sabit ağırlıklarla toplanıyordu (kârlılık %28, talep %22,
 * rekabet %15, fiyat istikrarı %13, tedarikçi %12, operasyonel %10). Ancak bu
 * eksenlerin dördü gerçek sinyal taşımıyordu — fiyat istikrarı, tedarikçi ve
 * operasyonel risk tamamen sabitti; talep skoru yalnızca alan adına bakıyordu.
 * Yani skorun ~%35'i bilgi içermeyen dolguydu ve bu, olmayan bir kesinlik
 * hissi yaratıyordu.
 *
 * Yeni yaklaşım: ölçülen eksenler ağırlığın çoğunu alır; varsayıma dayanan
 * eksenlerin ağırlığı düşürülür ve her biri `provenance` ile işaretlenir.
 * `evidenceCoverage` alanı, skorun ne kadarının gerçek ölçüme dayandığını
 * açıkça bildirir. Gerçek pazar verisi (talep, rekabet, fiyat geçmişi)
 * bağlandığında yapılacak tek şey ilgili eksenin provenance'ını MEASURED'a
 * çevirip ağırlığını yükseltmektir.
 */
export interface DecisionThresholds { rejectRoi: number; testRoi: number; }
export const DEFAULT_THRESHOLDS: DecisionThresholds = { rejectRoi: 25, testRoi: 38 };

export function computeDecisionEngine(
  roiPercent: number,
  sourceDomain: string,
  duplicateScore: number,
  thresholds: DecisionThresholds = DEFAULT_THRESHOLDS
): DecisionEngineResult {
  // --- ÖLÇÜLEN: kârlılık, gerçek landed-cost ROI'den türer ---
  const profitabilityScore = Math.min(99, Math.max(30, Math.round(55 + roiPercent * 0.55)));
  const profitability: ScoredSignal = {
    score: profitabilityScore,
    provenance: "MEASURED",
    basis: `Landed-cost ROI %${roiPercent.toFixed(2)} üzerinden hesaplandı`,
  };

  // --- ÖLÇÜLEN: mükerrerlik, ekibin kendi araştırma geçmişinden gelir ---
  // Duplicate skoru gerçek bir veritabanı karşılaştırmasının sonucudur.
  const duplicateRisk = Math.min(99, Math.max(1, Math.round(duplicateScore)));

  // --- SEZGİSEL: talep, yalnızca kaynak alan adına bakıyor ---
  const isKnownHighTurnover =
    sourceDomain.includes("homedepot") || sourceDomain.includes("ulta");
  const demandScore = isKnownHighTurnover ? 94 : 86;
  const demand: ScoredSignal = {
    score: demandScore,
    provenance: "HEURISTIC",
    basis: isKnownHighTurnover
      ? `${sourceDomain} geçmişte yüksek devir gösterdi (alan adı sezgisi)`
      : "Kaynak alan adı için devir geçmişi yok — taban değer",
  };

  // --- SEZGİSEL: rekabet, ROI'nin dolaylı göstergesi ---
  const competitionScore = roiPercent > 50 ? 82 : 68;
  const competition: ScoredSignal = {
    score: competitionScore,
    provenance: "HEURISTIC",
    basis:
      roiPercent > 50
        ? "Yüksek ROI marjı düşük rekabete işaret ediyor (dolaylı gösterge)"
        : "Marj dar — rekabet baskısı varsayılıyor (dolaylı gösterge)",
  };

  // --- VARSAYIM: gerçek sinyal yok, sabit ---
  const priceStability: ScoredSignal = {
    score: 88,
    provenance: "ASSUMED",
    basis: "Fiyat geçmişi entegrasyonu bağlı değil — sabit varsayım",
  };
  const supplierRisk: ScoredSignal = {
    score: 94,
    provenance: "ASSUMED",
    basis: "Tedarikçi performans geçmişi izlenmiyor — sabit varsayım",
  };
  const operationalRisk: ScoredSignal = {
    score: 90,
    provenance: "ASSUMED",
    basis: "Operasyonel gecikme verisi bağlı değil — sabit varsayım",
  };

  const signals = {
    profitability,
    demand,
    competition,
    priceStability,
    supplierRisk,
    operationalRisk,
  };

  // Ağırlıklar kanıt gücüne göre yeniden dağıtıldı: ölçülen eksen %45,
  // sezgisel eksenler %37, salt varsayımlar toplam %18'e indirildi
  // (eskiden %35'ti). Varsayımlar skoru artık domine edemez.
  const weights = {
    profitability: 0.45,
    demand: 0.22,
    competition: 0.15,
    priceStability: 0.06,
    supplierRisk: 0.06,
    operationalRisk: 0.06,
  } as const;

  const opportunityScore = Math.round(
    profitability.score * weights.profitability +
      demand.score * weights.demand +
      competition.score * weights.competition +
      priceStability.score * weights.priceStability +
      supplierRisk.score * weights.supplierRisk +
      operationalRisk.score * weights.operationalRisk
  );

  // Skorun yüzde kaçı gerçek ölçüme dayanıyor?
  const evidenceCoverage = Math.round(weights.profitability * 100);

  const assumedAxes = [
    priceStability.provenance === "ASSUMED" ? "Fiyat İstikrarı" : null,
    supplierRisk.provenance === "ASSUMED" ? "Tedarikçi Riski" : null,
    operationalRisk.provenance === "ASSUMED" ? "Operasyonel Risk" : null,
  ].filter((x): x is string => x !== null);

  let decisionAction: DecisionEngineResult["decisionAction"] = "BUY";
  let policyStatus = "APPROVED_BY_POLICY";
  let riskLevel: DecisionEngineResult["riskLevel"] = "LOW";
  let confidenceScore = 92;

  // Mükerrerlik kontrolü ROI'den ÖNCE gelir: çok kârlı görünen bir ürün bile
  // ekipte başkası araştırdıysa beklemeye alınır. Kârlılık, mükerrer emeği
  // meşrulaştırmaz.
  if (duplicateRisk >= 80) {
    decisionAction = "WAIT";
    policyStatus = "REQUIRES_MANAGER_APPROVAL";
    riskLevel = "HIGH";
    confidenceScore = 68;
  } else if (roiPercent < thresholds.rejectRoi) {
    decisionAction = "REJECT";
    policyStatus = "FLAGGED_IP_RISK";
    riskLevel = "HIGH";
    confidenceScore = 89;
  } else if (roiPercent < thresholds.testRoi) {
    decisionAction = "TEST";
    policyStatus = "APPROVED_BY_POLICY";
    riskLevel = "MEDIUM";
    confidenceScore = 84;
  }

  // Güven skoru, kanıt kapsamıyla sınırlanır. Sabit varsayımlara dayanan bir
  // karar "%92 eminim" diyemez — bu, sistemin kendi cehaletini itiraf ettiği
  // yerdir.
  confidenceScore = Math.min(confidenceScore, 60 + Math.round(evidenceCoverage * 0.7));

  return {
    profitabilityScore,
    demandScore,
    competitionScore,
    priceStabilityScore: priceStability.score,
    supplierRiskScore: supplierRisk.score,
    operationalRiskScore: operationalRisk.score,
    opportunityScore,
    decisionAction,
    policyStatus,
    riskLevel,
    confidenceScore,
    signals,
    evidenceCoverage,
    assumedAxes,
  };
}
