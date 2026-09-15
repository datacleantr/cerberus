/**
 * CERBERUS — Gerçekleşen ROI (Realized ROI) Motoru
 *
 * ÖNCEKİ DURUM (teknik borç): `actualRoiPercent` alanı
 * `roiPercent * 0.96` ile üretiliyordu. Yani "gerçekleşen ROI" hiç
 * ölçülmüyordu; tahminden sabit bir katsayıyla türetilen bir kurgu sayıydı.
 * Bu, karar motorunun kendi tahminini kendi notlandırması demekti — geri
 * besleme döngüsünün kopuk olduğu yer burasıydı.
 *
 * ŞİMDİ: Gerçekleşen ROI, o ürüne (ASIN/MSKU) ait **fiilen kapanmış
 * siparişlerden** hesaplanır. Fire (P1–P4) maliyet tarafında kayıp olarak
 * kalır; tedarikçinin karta yaptığı `refundAmount` tahsilatı maliyetten mahsup
 * edilir. Ölçülecek veri yoksa sayı **uydurulmaz**,
 * `null` döner ve arayüz "henüz ölçülmedi" gösterir.
 *
 * Tasarım ilkesi: eksik veriyi tahminle doldurmak, eksik veriyi göstermekten
 * daha tehlikelidir. Yönetici uydurma bir sayıya güvenip karar verebilir.
 */

/** Gerçekleşen ROI hesabına giren tek bir sipariş satırı */
export interface RealizedOrderFacts {
  /** Satın alınan toplam adet */
  quantity: number;
  /** Ürün birim maliyeti ($) */
  unitCost: number;
  /** Ürün satış fiyatı ($) */
  sellingPrice: number;
  /** Sipariş toplam maliyeti ($) — kargo/prep dahil gerçek ödenen */
  totalCost: number;
  /** Amazon'a fiilen sevk edilen adet — gelir yalnızca bundan doğar */
  shippedToAmazon: number;
  /** P1 iptal adedi */
  p1CancelQty: number;
  /** P2 eksik adedi */
  p2MissingQty: number;
  /** P3 defolu adedi */
  p3DefectiveQty: number;
  /** P4 tarihi geçmiş adedi */
  p4ExpiredQty: number;
  /** Tedarikçinin ödeme kartına geri yatırdığı tutar ($) */
  refundAmount: number;
  /** Kargo durumu — 'İPTAL' ise gelir yazılmaz */
  cargoStatus: string;
}

export interface RealizedRoiResult {
  /** Gerçekleşen ROI yüzdesi; ölçülemiyorsa null */
  realizedRoiPercent: number | null;
  /** Fiilen satışa giren (sevk edilmiş) adet */
  realizedUnits: number;
  /** Sevk edilen adetten doğan brüt gelir */
  realizedRevenue: number;
  /** Tedarikçi iadesi düşüldükten sonraki gerçekleşen net maliyet */
  realizedCost: number;
  /** Gelir - maliyet */
  realizedNetProfit: number;
  /** Fire nedeniyle kaybedilen adet (P1+P2+P3+P4) */
  lostUnits: number;
  /** Toplam iade tutarı */
  totalRefunds: number;
  /** Hesabın dayandığı sipariş satırı sayısı — güven göstergesi */
  sampleSize: number;
  /** Ölçülemiyorsa sebebi (arayüzde dürüstçe gösterilir) */
  reason?: "NO_ORDERS" | "NOTHING_SHIPPED" | "ZERO_COST";
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Bir ürünün gerçekleşen ROI'sini kapanmış sipariş satırlarından hesaplar.
 *
 * Gelir tarafı: yalnızca **Amazon'a sevk edilmiş** adetler gelir üretir.
 * Depoda bekleyen ya da yolda olan mal henüz para kazanmamıştır.
 *
 * Maliyet tarafı: sipariş için ödenen gerçek tutarın tamamı sayılır. Fire
 * olan adetlerin maliyeti silinmez — o para harcandı ve geri gelmedi. Bu,
 * ROI'yi bilinçli olarak "acımasız" kılar; fire gerçekten cezalandırılır.
 */
export function computeRealizedRoi(rows: RealizedOrderFacts[]): RealizedRoiResult {
  const empty: RealizedRoiResult = {
    realizedRoiPercent: null,
    realizedUnits: 0,
    realizedRevenue: 0,
    realizedCost: 0,
    realizedNetProfit: 0,
    lostUnits: 0,
    totalRefunds: 0,
    sampleSize: 0,
  };

  if (!rows || rows.length === 0) {
    return { ...empty, reason: "NO_ORDERS" };
  }

  let realizedUnits = 0;
  let realizedRevenue = 0;
  let realizedCost = 0;
  let lostUnits = 0;
  let totalRefunds = 0;

  for (const r of rows) {
    const qty = Math.max(0, Number(r.quantity) || 0);
    const shipped = Math.max(0, Number(r.shippedToAmazon) || 0);
    const price = Math.max(0, Number(r.sellingPrice) || 0);
    const refund = Math.max(0, Number(r.refundAmount) || 0);

    const fire =
      Math.max(0, Number(r.p1CancelQty) || 0) +
      Math.max(0, Number(r.p2MissingQty) || 0) +
      Math.max(0, Number(r.p3DefectiveQty) || 0) +
      Math.max(0, Number(r.p4ExpiredQty) || 0);

    // Harcanan para her hâlükârda maliyettir. totalCost boşsa birim
    // maliyetten türetilir (eski/eksik kayıtlara karşı dayanıklılık).
    const spend =
      Number(r.totalCost) > 0
        ? Number(r.totalCost)
        : (Number(r.unitCost) || 0) * qty;
    realizedCost += Math.max(0, spend);

    lostUnits += Math.min(fire, qty);
    totalRefunds += refund;

    // İptal edilmiş sipariş gelir üretmez.
    if (r.cargoStatus === "İPTAL") continue;

    // Gelir yalnızca sevk edilmiş adetten doğar; sevk adedi sipariş
    // adedini aşamaz (veri girişi hatalarına karşı sınırlanır).
    const billable = Math.min(shipped, qty);
    realizedUnits += billable;
    realizedRevenue += billable * price;
  }

  // Kilitli XLS sözleşmesinde refund, tedarikçinin ödeme kartına yaptığı
  // geri ödemedir; müşteri satış iadesi değildir. Bu nedenle geliri azaltmaz,
  // satın alma maliyetini mahsup eder. Refund maliyeti aşarsa negatif maliyet
  // üretmeyiz (fazla tahsilat ayrıca muhasebe mutabakatı gerektirir).
  realizedCost = Math.max(0, realizedCost - totalRefunds);

  const result: RealizedRoiResult = {
    realizedRoiPercent: null,
    realizedUnits,
    realizedRevenue: round2(realizedRevenue),
    realizedCost: round2(realizedCost),
    realizedNetProfit: round2(realizedRevenue - realizedCost),
    lostUnits,
    totalRefunds: round2(totalRefunds),
    sampleSize: rows.length,
  };

  // Hiç sevkiyat yoksa ROI "sıfır" değildir — henüz *ölçülmemiştir*.
  // Bu ayrım kritik: 0 yanıltıcı bir performans sinyali verirdi.
  if (realizedUnits === 0) {
    return { ...result, reason: "NOTHING_SHIPPED" };
  }

  if (result.realizedCost <= 0) {
    return { ...result, reason: "ZERO_COST" };
  }

  result.realizedRoiPercent = round2(
    (result.realizedNetProfit / result.realizedCost) * 100
  );

  return result;
}

/**
 * Tahmin ile gerçekleşen arasındaki sapma. Karar motorunun kalibrasyonunu
 * ölçer: pozitif sapma tahminin iyimser olduğunu gösterir.
 */
export interface RoiVarianceResult {
  variancePoints: number | null;
  status: "ON_TARGET" | "OPTIMISTIC" | "PESSIMISTIC" | "UNMEASURED";
}

export function computeRoiVariance(
  estimatedRoi: number | null | undefined,
  realizedRoi: number | null | undefined
): RoiVarianceResult {
  if (
    estimatedRoi === null ||
    estimatedRoi === undefined ||
    realizedRoi === null ||
    realizedRoi === undefined ||
    !Number.isFinite(Number(estimatedRoi)) ||
    !Number.isFinite(Number(realizedRoi))
  ) {
    return { variancePoints: null, status: "UNMEASURED" };
  }

  const variancePoints = round2(Number(estimatedRoi) - Number(realizedRoi));

  // ±5 puanlık bant "hedefte" sayılır; ölçüm gürültüsü karar üretmemeli.
  if (Math.abs(variancePoints) <= 5) {
    return { variancePoints, status: "ON_TARGET" };
  }

  return {
    variancePoints,
    status: variancePoints > 0 ? "OPTIMISTIC" : "PESSIMISTIC",
  };
}
