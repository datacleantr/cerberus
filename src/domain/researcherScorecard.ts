/**
 * CERBERUS — Araştırmacı (Sourcing Uzmanı) Skor Kartı
 *
 * ÖNCEKİ DURUM (teknik borç): `researchers` tablosundaki discoveryVolume,
 * approvalRate, averageRoi, averageNetProfit, problemRate, researcherScore
 * ve activeListingsCount alanları elle girilmiş/seed edilmiş sabit
 * sayılardı — hiçbiri gerçek `product_masters` ve `orders` verisinden
 * hesaplanmıyordu. Ekip, hiç ölçülmeyen bir "kalite skoru"na bakıyordu.
 *
 * ŞİMDİ: Her araştırmacının bulduğu ürünler (`product_masters.researcher_code`,
 * ASIN üzerinden doğal anahtar) gerçek siparişlerle (`realizedRoiByAsin`,
 * `computeRealizedRoi` çıktısı) eşleştirilerek skor kartı canlı hesaplanır.
 *
 * DÜRÜSTLÜK İLKESİ (computeRealizedRoi ile aynı): ölçülecek gerçek sipariş
 * verisi yoksa sayı uydurulmaz — `null` döner, arayüz "Ölçülmedi" gösterir.
 * `discoveryVolume` ve `approvalRate` istisnadır: bunlar `product_masters`
 * kaydının kendisinden (sipariş gerekmeden) hesaplanabilir.
 *
 * BİLİNEN SINIR: `product_masters` şu an gerçek 194 satırlık tarihsel
 * importla örtüşmeyen demo/seed verisidir (o import doğrudan `orders`'a
 * yapıldı, keşif/karar akışından geçmedi). Bu yüzden gerçek siparişe
 * dayanan alanlar (purchaseConversion, averageRoi, averageNetProfit,
 * problemRate, researcherScore) bugün çoğu araştırmacı için "Ölçülmedi"
 * görünecektir — bu bir hesaplama hatası değil, veri bağlantısının henüz
 * kurulmamış olmasının doğru yansımasıdır. Araştırmacılar gerçek ürünleri
 * uygulama üzerinden (Karar Kasası) kaydettikçe skorlar canlanacaktır.
 */

import type { RealizedRoiResult } from "./realizedRoi";

/** `product_masters`'ta "hâlâ aktif" sayılan kararlar — kalıcı liste, PAUSE/LIQUIDATE/REJECT/WAIT/TEST hariç. */
const ACTIVE_DECISION_ACTIONS = new Set(["BUY", "REPRICE", "REORDER"]);

export interface ResearcherIdentity {
  id: number;
  code: string;
  name: string;
  specialtyDomain: string;
  avatar?: string | null;
}

/** `product_masters`'tan skor kartı için gereken minimum alan seti */
export interface MasterFact {
  researcherCode: string;
  asin: string;
  decisionAction: string;
}

export interface ResearcherScorecard {
  id: number;
  code: string;
  name: string;
  specialtyDomain: string;
  avatar?: string | null;
  /** product_masters'tan bu araştırmacıya atfedilen toplam kayıt sayısı */
  discoveryVolume: number;
  /** decisionAction REJECT olmayanların oranı (0-100) — kayıt varsa her zaman ölçülür */
  approvalRate: number | null;
  /** En az bir gerçek siparişe dönüşen ASIN oranı (0-100) — sipariş verisi gerektirir */
  purchaseConversion: number | null;
  /** Gerçekleşen ROI'si ölçülebilen ürünlerin ortalaması (0-100 aralığında değildir, ham yüzde) */
  averageRoi: number | null;
  /** Gerçekleşen net kâr toplamı ($) — ölçülebilen ürünlerden */
  averageNetProfit: number | null;
  /** Fire oranı (0-100) — sevk edilmiş+kayıp adet tabanından */
  problemRate: number | null;
  /** decisionAction'ı hâlâ aktif sayılan (BUY/REPRICE/REORDER) kayıt sayısı */
  activeListingsCount: number;
  /** Kalite-ayarlı bileşik skor (0-100); hiç gerçek sipariş ölçümü yoksa null */
  researcherScore: number | null;
  /** Skorun kaç ölçülmüş üründen türediği — arayüzde güven göstergesi */
  measuredProductCount: number;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Bir araştırmacının bulduğu ürünleri gerçek sipariş verisiyle birleştirip
 * skor kartını hesaplar. `realizedRoiByAsin`, her ASIN için
 * `computeRealizedRoi` çıktısını taşır (route seviyesinde bir kere
 * hesaplanır, burada yeniden kullanılır — çift hesap yok).
 */
export function computeResearcherScorecards(
  identities: ResearcherIdentity[],
  masters: MasterFact[],
  realizedRoiByAsin: Map<string, RealizedRoiResult>
): ResearcherScorecard[] {
  const mastersByResearcher = new Map<string, MasterFact[]>();
  for (const m of masters) {
    const code = (m.researcherCode || "").trim();
    if (!code) continue;
    const bucket = mastersByResearcher.get(code);
    if (bucket) bucket.push(m);
    else mastersByResearcher.set(code, [m]);
  }

  return identities.map((identity) => {
    const own = mastersByResearcher.get(identity.code) || [];
    const discoveryVolume = own.length;

    const approvalRate =
      discoveryVolume === 0
        ? null
        : round2(
            (own.filter((m) => m.decisionAction !== "REJECT").length / discoveryVolume) * 100
          );

    const activeListingsCount = own.filter((m) =>
      ACTIVE_DECISION_ACTIONS.has(m.decisionAction)
    ).length;

    // Sipariş verisiyle eşleşen (yani en az bir gerçek satırı olan) ASIN'ler.
    const measured = own
      .map((m) => realizedRoiByAsin.get((m.asin || "").toUpperCase()))
      .filter((r): r is RealizedRoiResult => Boolean(r) && r!.sampleSize > 0);

    const purchaseConversion =
      discoveryVolume === 0 ? null : round2((measured.length / discoveryVolume) * 100);

    const withRoi = measured.filter((r) => r.realizedRoiPercent !== null);
    const averageRoi =
      withRoi.length === 0
        ? null
        : round2(
            withRoi.reduce((sum, r) => sum + (r.realizedRoiPercent as number), 0) / withRoi.length
          );

    const averageNetProfit =
      measured.length === 0
        ? null
        : round2(measured.reduce((sum, r) => sum + r.realizedNetProfit, 0));

    const totalUnitsAcrossMeasured = measured.reduce(
      (sum, r) => sum + r.realizedUnits + r.lostUnits,
      0
    );
    const totalLost = measured.reduce((sum, r) => sum + r.lostUnits, 0);
    const problemRate =
      totalUnitsAcrossMeasured === 0 ? null : round2((totalLost / totalUnitsAcrossMeasured) * 100);

    // Kalite-ayarlı bileşik skor: yalnız gerçekten ölçülen bileşenler
    // ağırlıklandırılır. Hiçbiri ölçülemiyorsa (measured.length === 0)
    // skor uydurulmaz — null döner.
    let researcherScore: number | null = null;
    if (measured.length > 0) {
      const roiComponent = averageRoi === null ? null : Math.max(0, Math.min(100, averageRoi));
      const problemComponent = problemRate === null ? null : 100 - problemRate;
      const weighted: Array<[number, number]> = [
        [approvalRate ?? 0, 0.2],
        [purchaseConversion ?? 0, 0.25],
        ...(roiComponent !== null ? ([[roiComponent, 0.35]] as Array<[number, number]>) : []),
        ...(problemComponent !== null ? ([[problemComponent, 0.2]] as Array<[number, number]>) : []),
      ];
      const totalWeight = weighted.reduce((s, [, w]) => s + w, 0);
      researcherScore =
        totalWeight === 0
          ? null
          : round2(weighted.reduce((s, [v, w]) => s + v * w, 0) / totalWeight);
    }

    return {
      id: identity.id,
      code: identity.code,
      name: identity.name,
      specialtyDomain: identity.specialtyDomain,
      avatar: identity.avatar,
      discoveryVolume,
      approvalRate,
      purchaseConversion,
      averageRoi,
      averageNetProfit,
      problemRate,
      activeListingsCount,
      researcherScore,
      measuredProductCount: measured.length,
    };
  });
}
