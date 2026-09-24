/**
 * CERBERUS — Haftalık Mağaza/Hesap Sağlığı Motoru
 *
 * ÖNCEKİ DURUM (denetim bulgusu): `stores.account_health_score` sütunu
 * DB'de duruyordu (varsayılan 98), API'den ham haliyle dışarı veriliyordu
 * (`admin/stores` route'u `...store` ile spread ediyordu) ama HİÇBİR YERDE
 * hesaplanmıyordu — ne bir route ne bir domain fonksiyonu bu alanı
 * güncelliyordu. Arayüzde de hiç render edilmiyordu (grep: sıfır kullanım).
 * Yani her mağaza sonsuza kadar "98" göstermeye programlıydı; bu, tam
 * olarak `researcherScorecard.ts`'nin düzelttiği sorunun ikizi.
 *
 * ŞİMDİ: Hesap sağlığı, o mağazanın GERÇEK sipariş satırlarından, haftalık
 * pencerede (ISO 8601 hafta, sistem saatine göre "bu hafta" / "geçen hafta")
 * hesaplanır. Üç ölçülebilir eksen kullanılır: FBA sevk performansı, fire/
 * problem oranı, tedarikçi iade bağımlılığı — `computeBusinessHealth` ile
 * aynı normalize mantığı, böylece "Sabah Brifingi"ndeki global skorla
 * kafası karışmaz.
 *
 * DÜRÜSTLÜK İLKESİ (computeRealizedRoi / computeResearcherScorecards ile
 * aynı): bu hafta o mağazada HİÇ sipariş yoksa bir sayı uydurulmaz —
 * `healthScore: null` döner. Ama sessizlik de bilgidir: son sipariş
 * tarihinden bu yana geçen gün sayısı `computeFreshness` ile ölçülüp bir
 * "sessizlik" uyarısına dönüştürülür (skor değil, gözlem).
 *
 * Haftalık kıyas (WoW) da yalnız geçen hafta gerçekten sipariş varsa
 * hesaplanır — sıfır tabanlı yüzde değişim (bölme/0 → sonsuzluk) asla
 * üretilmez.
 */

import { computeFreshness } from "./dataFreshness";

export interface StoreHealthOrderFact {
  buyerStore: string;
  orderDate: string; // YYYY-MM-DD
  quantity: number;
  totalCost: number;
  shippedToAmazon: number;
  p1CancelQty: number;
  p2MissingQty: number;
  p3DefectiveQty: number;
  p4ExpiredQty: number;
  refundAmount: number;
  cargoStatus: string;
  sellingPrice: number;
}

export interface StoreHealthIdentity {
  storeCode: string;
  storeName: string;
  status: string; // 'ACTIVE' | 'PASSIVE'
}

export interface WeekMetrics {
  weekKey: string; // ISO 8601, örn. "2026-W38"
  orders: number;
  units: number;
  spend: number;
  shippedUnits: number;
  refundAmount: number;
  netProfit: number;
  /** null: bu pencerede adet yok, sevk oranı ölçülemez */
  fulfillmentRate: number | null;
  /** null: bu pencerede sipariş yok, problem oranı ölçülemez */
  problemRate: number | null;
  /** null: bu pencerede harcama yok, iade oranı ölçülemez */
  refundRate: number | null;
}

export interface WeekOverWeekDelta {
  ordersDeltaPercent: number;
  spendDeltaPercent: number;
  /** puan (yüzde puanı) farkı, örn. +5 = 5 puan iyileşti */
  fulfillmentRateDeltaPoints: number | null;
  problemRateDeltaPoints: number | null;
}

export interface HealthBreakdownItem {
  axis: string;
  weight: number;
  score: number;
  detail: string;
}

export type HealthGrade = "KRİTİK" | "ZAYIF" | "İZLEMEDE" | "İYİ" | "GÜÇLÜ" | "ÖLÇÜLEMEDİ";

export interface SilenceAlert {
  severity: "INFO" | "WARN" | "CRITICAL";
  text: string;
  daysSinceLastOrder: number | null;
}

export interface StoreWeeklyHealth {
  storeCode: string;
  storeName: string;
  status: string;
  currentWeek: WeekMetrics;
  previousWeek: WeekMetrics;
  /** geçen hafta sipariş yoksa null — yüzde değişim sıfır tabandan hesaplanmaz */
  weekOverWeek: WeekOverWeekDelta | null;
  isActiveThisWeek: boolean;
  healthScore: number | null;
  grade: HealthGrade;
  breakdown: HealthBreakdownItem[];
  /** Bu hafta sessizse ve/veya hiç sipariş geçmişi yoksa dolu, aksi halde null */
  silenceAlert: SilenceAlert | null;
}

const round2 = (n: number) => Number(n.toFixed(2));
const round1 = (n: number) => Number(n.toFixed(1));
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** ISO 8601 hafta anahtarı (Pazartesi başlangıçlı, Perşembe kuralı) — yıl sınırlarında da doğru. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (d.getUTCDay() + 6) % 7; // Pazartesi=0 ... Pazar=6
  d.setUTCDate(d.getUTCDate() - dayNr + 3); // o haftanın Perşembe günü
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function emptyWeekMetrics(weekKey: string): WeekMetrics {
  return {
    weekKey,
    orders: 0,
    units: 0,
    spend: 0,
    shippedUnits: 0,
    refundAmount: 0,
    netProfit: 0,
    fulfillmentRate: null,
    problemRate: null,
    refundRate: null,
  };
}

function aggregateWeek(weekKey: string, rows: StoreHealthOrderFact[]): WeekMetrics {
  if (rows.length === 0) return emptyWeekMetrics(weekKey);

  let units = 0;
  let spend = 0;
  let shipped = 0;
  let refund = 0;
  let revenue = 0;
  let problemOrders = 0;
  for (const o of rows) {
    units += Number(o.quantity) || 0;
    spend += Number(o.totalCost) || 0;
    shipped += Number(o.shippedToAmazon) || 0;
    refund += Number(o.refundAmount) || 0;
    revenue += (Number(o.shippedToAmazon) || 0) * (Number(o.sellingPrice) || 0);
    const isProblem =
      o.cargoStatus === "İPTAL" ||
      o.p1CancelQty > 0 ||
      o.p2MissingQty > 0 ||
      o.p3DefectiveQty > 0 ||
      o.p4ExpiredQty > 0 ||
      Number(o.refundAmount) > 0;
    if (isProblem) problemOrders++;
  }
  const effectiveCost = Math.max(0, spend - refund);

  return {
    weekKey,
    orders: rows.length,
    units,
    spend: round2(spend),
    shippedUnits: shipped,
    refundAmount: round2(refund),
    netProfit: round2(revenue - effectiveCost),
    fulfillmentRate: units > 0 ? round1((shipped / units) * 100) : null,
    problemRate: rows.length > 0 ? round1((problemOrders / rows.length) * 100) : null,
    refundRate: spend > 0 ? round1((refund / spend) * 100) : null,
  };
}

function computeDelta(current: WeekMetrics, previous: WeekMetrics): WeekOverWeekDelta | null {
  if (previous.orders === 0) return null; // sıfır tabandan yüzde değişim uydurulmaz
  return {
    ordersDeltaPercent: round1(((current.orders - previous.orders) / previous.orders) * 100),
    spendDeltaPercent:
      previous.spend > 0 ? round1(((current.spend - previous.spend) / previous.spend) * 100) : 0,
    fulfillmentRateDeltaPoints:
      current.fulfillmentRate === null || previous.fulfillmentRate === null
        ? null
        : round1(current.fulfillmentRate - previous.fulfillmentRate),
    problemRateDeltaPoints:
      current.problemRate === null || previous.problemRate === null
        ? null
        : round1(current.problemRate - previous.problemRate),
  };
}

function computeHealthScore(current: WeekMetrics): { score: number; breakdown: HealthBreakdownItem[] } {
  // computeBusinessHealth (briefing.ts) ile aynı normalize mantığı — iki
  // skor arayüzde birlikte görülebileceği için ölçekler tutarlı olmalı.
  const fulfillmentScore = clamp(Math.round(current.fulfillmentRate ?? 0), 0, 100);
  const problemRatio = (current.problemRate ?? 0) / 100;
  const problemScore = clamp(Math.round((1 - problemRatio * 2) * 100), 0, 100);
  const refundRatio = (current.refundRate ?? 0) / 100;
  const cashScore = clamp(Math.round((1 - refundRatio * 5) * 100), 0, 100);

  const breakdown: HealthBreakdownItem[] = [
    {
      axis: "FBA Sevk Performansı",
      weight: 0.4,
      score: fulfillmentScore,
      detail: `${current.shippedUnits} / ${current.units} adet bu hafta sevk edildi`,
    },
    {
      axis: "Fire & Problem Oranı",
      weight: 0.35,
      score: problemScore,
      detail: `${current.orders} siparişin %${current.problemRate ?? 0} kadarı problemli`,
    },
    {
      axis: "Tedarikçi İade Bağımlılığı",
      weight: 0.25,
      score: cashScore,
      detail: `$${current.refundAmount} iade / $${current.spend} harcama`,
    },
  ];

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.score * b.weight, 0));
  return { score, breakdown };
}

function gradeFor(score: number): HealthGrade {
  return score >= 85 ? "GÜÇLÜ" : score >= 70 ? "İYİ" : score >= 55 ? "İZLEMEDE" : score >= 40 ? "ZAYIF" : "KRİTİK";
}

function buildSilenceAlert(
  isActiveThisWeek: boolean,
  lastOrderDate: string | null,
  now: Date
): SilenceAlert | null {
  if (isActiveThisWeek) return null;

  if (!lastOrderDate) {
    return {
      severity: "INFO",
      text: "Bu mağazada hiç sipariş kaydı yok — henüz ölçülemez.",
      daysSinceLastOrder: null,
    };
  }

  const freshness = computeFreshness(lastOrderDate, now);
  const severity: SilenceAlert["severity"] =
    freshness.status === "STALE" || freshness.status === "EXPIRED"
      ? "CRITICAL"
      : freshness.status === "AGING"
        ? "WARN"
        : "INFO";

  return {
    severity,
    text: `Bu hafta sipariş yok — son sipariş ${freshness.ageInDays} gün önce (${lastOrderDate}).`,
    daysSinceLastOrder: freshness.ageInDays,
  };
}

/**
 * Tüm mağazalar için haftalık sağlık kartı hesaplar.
 *
 * @param identities `stores` tablosundan mağaza kimlikleri — sipariş
 *   geçmişi olmayan mağazalar da listede "ölçülemedi" olarak görünsün diye.
 * @param allOrders TÜM mağazaların TÜM siparişleri (route seviyesinde
 *   filtrelenmemiş — hafta pencereleri ve "son sipariş" burada hesaplanır).
 * @param now Referans an (test edilebilirlik için enjekte edilir).
 */
export function computeWeeklyStoreHealth(
  identities: StoreHealthIdentity[],
  allOrders: StoreHealthOrderFact[],
  now: Date = new Date()
): StoreWeeklyHealth[] {
  const currentWeekKey = isoWeekKey(now);
  const previousWeekRef = new Date(now.getTime() - 7 * 86_400_000);
  const previousWeekKey = isoWeekKey(previousWeekRef);

  const byStore = new Map<string, StoreHealthOrderFact[]>();
  const lastOrderDateByStore = new Map<string, string>();
  for (const o of allOrders) {
    const code = o.buyerStore || "HRN";
    const bucket = byStore.get(code);
    if (bucket) bucket.push(o);
    else byStore.set(code, [o]);

    const prevMax = lastOrderDateByStore.get(code);
    if (!prevMax || o.orderDate > prevMax) lastOrderDateByStore.set(code, o.orderDate);
  }

  return identities.map((identity) => {
    const own = byStore.get(identity.storeCode) || [];
    const currentRows = own.filter((o) => isoWeekKey(new Date(o.orderDate + "T00:00:00Z")) === currentWeekKey);
    const previousRows = own.filter((o) => isoWeekKey(new Date(o.orderDate + "T00:00:00Z")) === previousWeekKey);

    const currentWeek = aggregateWeek(currentWeekKey, currentRows);
    const previousWeek = aggregateWeek(previousWeekKey, previousRows);
    const isActiveThisWeek = currentWeek.orders > 0;

    let healthScore: number | null = null;
    let breakdown: HealthBreakdownItem[] = [];
    let grade: HealthGrade = "ÖLÇÜLEMEDİ";
    if (isActiveThisWeek) {
      const computed = computeHealthScore(currentWeek);
      healthScore = computed.score;
      breakdown = computed.breakdown;
      grade = gradeFor(computed.score);
    }

    return {
      storeCode: identity.storeCode,
      storeName: identity.storeName,
      status: identity.status,
      currentWeek,
      previousWeek,
      weekOverWeek: computeDelta(currentWeek, previousWeek),
      isActiveThisWeek,
      healthScore,
      grade,
      breakdown,
      silenceAlert: buildSilenceAlert(isActiveThisWeek, lastOrderDateByStore.get(identity.storeCode) || null, now),
    };
  });
}
