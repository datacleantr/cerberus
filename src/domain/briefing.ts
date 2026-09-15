/**
 * CERBERUS Yönetici Sabah Brifingi (T8.2) — saf hesap fonksiyonları.
 *
 * Önceki sürümde brifing metinleri route içinde SABİT KODLANMIŞTI
 * ("Dyson V15 ... DURDURULDU", "DeWalt ... onayla") — yani yönetici, gerçek
 * verisiyle ilgisi olmayan bir demo cümlesi okuyordu (F-23 / ürün dürüstlüğü).
 * Bu modül brifingi YALNIZCA gerçek satır verisinden üretir ve her maddeye
 * kaynak metriğini iliştirir. Veri yoksa madde üretilmez — uydurma yapılmaz.
 */

export interface BriefingOrderFacts {
  totalOrders: number;
  totalUnits: number;
  totalSpend: number;
  totalShippedToAmazon: number;
  totalRefunds: number;
  problemOrdersCount: number;
  p1CancelTotal: number;
  p2MissingTotal: number;
  p3DefectiveTotal: number;
  p4ExpiredTotal: number;
  estimatedRevenue: number;
  /** Batch'e atanmamış (PSH kuyruğunda bekleyen) sipariş sayısı */
  unbatchedOrders: number;
  /** Kargo durumu 'Yolda' olan sipariş sayısı */
  inTransitOrders: number;
}

export interface BriefingMasterFacts {
  totalMasters: number;
  avgRoiPercent: number;
  /** Karar aksiyonuna göre ürün adedi: BUY/TEST/WAIT/REJECT... */
  decisionCounts: Record<string, number>;
  /** Tazelik durumuna göre adet: FRESH/AGING/STALE/EXPIRED */
  freshnessCounts: Record<string, number>;
  /** Mükerrer alarmı açık ürün adedi (duplicateScore >= 80) */
  duplicateAlerts: number;
  /** Yönetici onayı bekleyen politika kaydı adedi */
  pendingPolicyApprovals: number;
}

export interface BriefingItem {
  /** Yöneticiye gösterilen cümle */
  text: string;
  /** Cümlenin dayandığı metrik anahtarı — "bu sayı nereden geliyor?" sorusunun cevabı */
  metric: string;
  severity: "INFO" | "WARN" | "CRITICAL";
}

export interface HealthBreakdownItem {
  axis: string;
  weight: number;
  score: number;
  detail: string;
}

export interface BusinessHealth {
  score: number;
  grade: "KRİTİK" | "ZAYIF" | "İZLEMEDE" | "İYİ" | "GÜÇLÜ" | "ÖLÇÜLEMEDİ";
  breakdown: HealthBreakdownItem[];
  /** Hiç veri yoksa false — arayüz skor yerine "veri bekleniyor" gösterir */
  measurable: boolean;
}

export interface MorningBriefing {
  businessHealthScore: number;
  /** Skor gerçekten ölçülebildi mi? Boş sistemde false. */
  healthMeasurable: boolean;
  healthGrade: BusinessHealth["grade"];
  healthBreakdown: HealthBreakdownItem[];
  whatChanged: BriefingItem[];
  whatMatters: BriefingItem[];
  whatShouldIDo: BriefingItem[];
  /** Hesabın dayandığı kayıt sayısı — 0 ise UI "veri yok" durumu gösterir */
  sampleSize: number;
  generatedAt: string;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `%${n.toFixed(1)}`;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * İş Sağlığı Skoru (0–100) — 5 eksenli, ağırlıklı ve AÇIKLANABİLİR.
 * Her eksen kendi ham metriğinden 0-100'e normalize edilir; kırılım döner ki
 * yönetici "89 nereden çıktı?" diye sorabilsin.
 */
export function computeBusinessHealth(
  orders: BriefingOrderFacts,
  masters: BriefingMasterFacts
): BusinessHealth {
  // 1) Kârlılık: ortalama ROI, %40 hedefe göre normalize
  const roiScore = clamp(Math.round((masters.avgRoiPercent / 40) * 100), 0, 100);

  // 2) Sevk performansı: Amazon'a gönderilen / satın alınan adet
  const fulfillmentRate =
    orders.totalUnits > 0 ? orders.totalShippedToAmazon / orders.totalUnits : 0;
  const fulfillmentScore = clamp(Math.round(fulfillmentRate * 100), 0, 100);

  // 3) Fire/problem: problemli sipariş oranı ne kadar düşükse o kadar iyi
  const problemRate =
    orders.totalOrders > 0 ? orders.problemOrdersCount / orders.totalOrders : 0;
  const problemScore = clamp(Math.round((1 - problemRate * 2) * 100), 0, 100);

  // 4) Veri tazeliği: FRESH oranı (karar kalitesinin ön koşulu)
  const freshCount = masters.freshnessCounts.FRESH || 0;
  const freshnessScore =
    masters.totalMasters > 0
      ? clamp(Math.round((freshCount / masters.totalMasters) * 100), 0, 100)
      : 0;

  // 5) Tedarikçi iade bağımlılığı: refund finansal olarak maliyeti geri kazandırır,
  // fakat yüksek oran iptal/fire ve tedarikçi kalitesi sorununun sinyalidir.
  const refundRate = orders.totalSpend > 0 ? orders.totalRefunds / orders.totalSpend : 0;
  const cashScore = clamp(Math.round((1 - refundRate * 5) * 100), 0, 100);

  const breakdown: HealthBreakdownItem[] = [
    {
      axis: "Kârlılık (Landed-Cost ROI)",
      weight: 0.3,
      score: roiScore,
      detail: `Ortalama ROI ${pct(masters.avgRoiPercent)} / hedef %40.0`,
    },
    {
      axis: "FBA Sevk Performansı",
      weight: 0.22,
      score: fulfillmentScore,
      detail: `${orders.totalShippedToAmazon} / ${orders.totalUnits} adet sevk edildi`,
    },
    {
      axis: "Fire & Problem Oranı",
      weight: 0.2,
      score: problemScore,
      detail: `${orders.problemOrdersCount} / ${orders.totalOrders} sipariş problemli`,
    },
    {
      axis: "Veri Tazeliği",
      weight: 0.15,
      score: freshnessScore,
      detail: `${freshCount} / ${masters.totalMasters} ürün FRESH`,
    },
    {
      axis: "Tedarikçi İade Bağımlılığı",
      weight: 0.13,
      score: cashScore,
      detail: `${money(orders.totalRefunds)} iade / ${money(orders.totalSpend)} harcama`,
    },
  ];

  const score = Math.round(
    breakdown.reduce((sum, item) => sum + item.score * item.weight, 0)
  );

  // Hiç sipariş ve hiç ürün yoksa iş sağlığı KÖTÜ değildir — ÖLÇÜLEMEZ.
  // Yeni kurulan ya da sıfırlanmış bir sistemde "33 KRİTİK" göstermek
  // yanıltıcıdır: yönetici olmayan bir problemi kovalamaya başlar.
  const measurable = orders.totalOrders > 0 || masters.totalMasters > 0;

  if (!measurable) {
    return {
      score: 0,
      grade: "ÖLÇÜLEMEDİ",
      breakdown: breakdown.map((b) => ({
        ...b,
        score: 0,
        detail: "Henüz veri yok",
      })),
      measurable: false,
    };
  }

  const grade: BusinessHealth["grade"] =
    score >= 85 ? "GÜÇLÜ" : score >= 70 ? "İYİ" : score >= 55 ? "İZLEMEDE" : score >= 40 ? "ZAYIF" : "KRİTİK";

  return { score, grade, breakdown, measurable: true };
}

/** WHAT CHANGED? — dönemin ölçülebilir hareketleri */
export function buildWhatChanged(
  orders: BriefingOrderFacts,
  masters: BriefingMasterFacts
): BriefingItem[] {
  const items: BriefingItem[] = [];
  if (orders.totalOrders === 0) return items;

  items.push({
    text: `${orders.totalOrders} sipariş / ${orders.totalUnits} adet için toplam ${money(orders.totalSpend)} tedarik harcaması kayıtlı.`,
    metric: "orders.totalSpend",
    severity: "INFO",
  });

  const fulfillmentRate =
    orders.totalUnits > 0 ? (orders.totalShippedToAmazon / orders.totalUnits) * 100 : 0;
  items.push({
    text: `FBA sevk oranı ${pct(fulfillmentRate)} (${orders.totalShippedToAmazon}/${orders.totalUnits} adet).`,
    metric: "orders.shippedToAmazon",
    severity: fulfillmentRate < 80 ? "WARN" : "INFO",
  });

  if (masters.totalMasters > 0) {
    items.push({
      text: `Karar kasasında ${masters.totalMasters} ürün var; ortalama tahmini ROI ${pct(masters.avgRoiPercent)}.`,
      metric: "productMasters.roiPercent",
      severity: masters.avgRoiPercent < 30 ? "WARN" : "INFO",
    });
  }

  const grossMargin =
    orders.estimatedRevenue - Math.max(0, orders.totalSpend - orders.totalRefunds);
  if (orders.estimatedRevenue > 0) {
    items.push({
      text: `Tahmini ciro ${money(orders.estimatedRevenue)}, tahmini brüt marj ${money(grossMargin)}.`,
      metric: "orders.estimatedRevenue",
      severity: grossMargin <= 0 ? "CRITICAL" : "INFO",
    });
  }

  return items;
}

/** WHAT MATTERS? — dikkat isteyen riskler (yalnız gerçekten varsa üretilir) */
export function buildWhatMatters(
  orders: BriefingOrderFacts,
  masters: BriefingMasterFacts
): BriefingItem[] {
  const items: BriefingItem[] = [];

  if (orders.problemOrdersCount > 0) {
    items.push({
      text: `${orders.problemOrdersCount} siparişte P1–P4 fire/iptal kaydı var (P1:${orders.p1CancelTotal} • P2:${orders.p2MissingTotal} • P3:${orders.p3DefectiveTotal} • P4:${orders.p4ExpiredTotal}).`,
      metric: "orders.problemOrdersCount",
      severity: orders.problemOrdersCount > orders.totalOrders * 0.15 ? "CRITICAL" : "WARN",
    });
  }

  if (orders.totalRefunds > 0) {
    items.push({
      text: `Toplam ${money(orders.totalRefunds)} tedarikçi iadesi kaydı var; ilişkili iptal/fire dosyalarının kök nedeni takip edilmeli.`,
      metric: "orders.totalRefunds",
      severity: "WARN",
    });
  }

  if (masters.duplicateAlerts > 0) {
    items.push({
      text: `${masters.duplicateAlerts} üründe mükerrer kayıt alarmı (duplicate score ≥ 80) — birleştirme kararı bekliyor.`,
      metric: "productMasters.duplicateScore",
      severity: "WARN",
    });
  }

  const stale = (masters.freshnessCounts.STALE || 0) + (masters.freshnessCounts.EXPIRED || 0);
  if (stale > 0) {
    items.push({
      text: `${stale} ürünün verisi STALE/EXPIRED — bu kayıtlarla verilen karar güvenilir değil.`,
      metric: "productMasters.dataFreshnessStatus",
      severity: "WARN",
    });
  }

  if (masters.pendingPolicyApprovals > 0) {
    items.push({
      text: `${masters.pendingPolicyApprovals} ürün yönetici onayı bekliyor (REQUIRES_MANAGER_APPROVAL).`,
      metric: "productMasters.policyStatus",
      severity: "WARN",
    });
  }

  if (items.length === 0 && orders.totalOrders > 0) {
    items.push({
      text: "Açık risk kaydı yok: fire, tedarikçi iadesi, mükerrer ve onay kuyrukları temiz.",
      metric: "—",
      severity: "INFO",
    });
  }

  return items;
}

/** WHAT SHOULD I DO? — önceliklendirilmiş, uygulanabilir aksiyonlar */
export function buildWhatShouldIDo(
  orders: BriefingOrderFacts,
  masters: BriefingMasterFacts
): BriefingItem[] {
  const items: BriefingItem[] = [];

  const buyCount = masters.decisionCounts.BUY || 0;
  if (buyCount > 0) {
    items.push({
      text: `${buyCount} ürün BUY kararında — satın alma emirlerini onaya taşıyın.`,
      metric: "productMasters.decisionAction=BUY",
      severity: "INFO",
    });
  }

  if (masters.pendingPolicyApprovals > 0) {
    items.push({
      text: `${masters.pendingPolicyApprovals} politika onayını sonuçlandırın; onaysız kayıt satın almaya geçemez.`,
      metric: "productMasters.policyStatus",
      severity: "WARN",
    });
  }

  if (orders.unbatchedOrders > 0) {
    items.push({
      text: `${orders.unbatchedOrders} sipariş hiçbir PSH batch'ine atanmamış — sevkiyat partisi açın.`,
      metric: "orders.pshBatchNo IS NULL",
      severity: "WARN",
    });
  }

  if (orders.p2MissingTotal > 0) {
    items.push({
      text: `${orders.p2MissingTotal} adet P2 (eksik) kaydı için depo sayım eşleştirmesini kapatın.`,
      metric: "orders.p2MissingQty",
      severity: "CRITICAL",
    });
  }

  const rejectCount = masters.decisionCounts.REJECT || 0;
  if (rejectCount > 0) {
    items.push({
      text: `${rejectCount} ürün REJECT kararında — kaynak listelerinden düşürün ki ekip tekrar araştırmasın.`,
      metric: "productMasters.decisionAction=REJECT",
      severity: "INFO",
    });
  }

  const priority = { CRITICAL: 0, WARN: 1, INFO: 2 } as const;
  return items.sort((a, b) => priority[a.severity] - priority[b.severity]).slice(0, 5);
}

export function buildMorningBriefing(
  orders: BriefingOrderFacts,
  masters: BriefingMasterFacts,
  now: Date = new Date()
): MorningBriefing {
  const health = computeBusinessHealth(orders, masters);
  return {
    businessHealthScore: health.score,
    healthMeasurable: health.measurable,
    healthGrade: health.grade,
    healthBreakdown: health.breakdown,
    whatChanged: buildWhatChanged(orders, masters),
    whatMatters: buildWhatMatters(orders, masters),
    whatShouldIDo: buildWhatShouldIDo(orders, masters),
    sampleSize: orders.totalOrders + masters.totalMasters,
    generatedAt: now.toISOString(),
  };
}
