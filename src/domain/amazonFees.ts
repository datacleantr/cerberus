/**
 * CERBERUS — Amazon Ücret Tahmin Motoru
 *
 * DENETİM BULGUSU N-3 (P0): `decisionEngine.ts` → `calculateLandedCostAndProfit()`
 * pazaryeri (referral) ücretini TÜM kategoriler için sabit %15 alıyordu;
 * fulfillment ücretini yalnız satış fiyatına göre 3 sabit kademeye
 * ($4.15/$5.80/$7.45) oturtuyordu ve `fulfillmentType` (FBA/FBM) alanını HİÇ
 * okumuyordu. Gerçekte Amazon referral ücreti kategoriye göre %8-%45 arasında
 * değişir; FBA fulfillment ücreti ebat-kademesi + ağırlığa göre hesaplanır.
 *
 * Araştırma sırasında AYNI KUSURUN bağımsız olarak `realizedRoi.ts`,
 * `storeHealth.ts` ve `analytics.ts`'nin "net kâr" hesaplarında da (hiçbir
 * Amazon ücreti düşülmeden) tekrarlandığı bulundu — yani sistem genelinde
 * gösterilen her "Net Kâr" rakamı, Amazon'un kestiği payı hiç saymadan
 * şişirilmiş çıkıyordu (tipik olarak gerçek net kârın üstünde %15-25+).
 *
 * ŞİMDİ: tek, paylaşılan, test edilmiş bir ücret tahmin fonksiyonu — hem
 * satın alma öncesi karar motorunda (decisionEngine.ts) hem gerçekleşen
 * ROI/analitik/mağaza sağlığı hesaplarında kullanılır.
 *
 * DÜRÜSTLÜK İLKESİ: kategori eşleşirse `CATEGORY_MATCHED` (daha isabetli);
 * eşleşmezse sabit %15 varsayılan kullanılır ama `DEFAULT_ASSUMED` olarak
 * işaretlenir — hiçbir zaman "kesin" gibi sunulmaz.
 *
 * BİLİNEN SINIR (kasıtlı olarak kapatılmadı — bkz. denetim raporu N-3):
 * FBA fulfillment ücreti gerçekte ebat-kademesi + ağırlığa göre hesaplanır;
 * CERBERUS şu an ürün ağırlığı/ebatını hiç tutmuyor, bu yüzden fulfillment
 * ücreti hâlâ yalnız satış fiyatına dayanan bir kademe tahminidir (ASSUMED).
 * Depolama ücreti, uzun-vadeli depolama cezası, iade işleme ücreti ve
 * düşük-envanter ek ücretleri bu modelde YOK — bunlar için envanter yaşı/
 * hacim verisi gerekir; uydurmak yerine açık bırakıldı.
 */

export type FeeProvenance = "CATEGORY_MATCHED" | "DEFAULT_ASSUMED";

export interface AmazonFeeEstimate {
  /** 0-1 arası referral ücret oranı */
  referralFeeRate: number;
  referralFeeAmount: number;
  /** Yalnız FBA'da > 0 — FBM'de Amazon fulfillment ücreti almaz (satıcı kendi kargolar) */
  fulfillmentFeeAmount: number;
  totalFeeAmount: number;
  provenance: FeeProvenance;
  /** Türkçe, kullanıcıya gösterilebilir gerekçe */
  basis: string;
}

const round2 = (n: number) => Number(n.toFixed(2));

/**
 * Amazon US referral ücret tablosu — kamuya açık Amazon fee schedule'ına
 * dayanan yaklaşık oranlar. Kategori adları `products.category` /
 * `product_masters.category` serbest metin olduğu için normalize edilip
 * (büyük harf, boşluk/tire → alt çizgi) eşleştirilir.
 */
const CATEGORY_REFERRAL_RATES: Record<string, number> = {
  ELECTRONICS: 0.08,
  ELECTRONICS_ACCESSORIES: 0.08,
  CAMERA: 0.08,
  CAMERA_PHOTO: 0.08,
  COMPUTERS: 0.08,
  VIDEO_GAME_CONSOLES: 0.08,
  JEWELRY: 0.2,
  WATCHES: 0.16,
  BEAUTY: 0.15,
  LUXURY_BEAUTY: 0.15,
  HEALTH_PERSONAL_CARE: 0.15,
  GROCERY: 0.08,
  GOURMET_FOOD: 0.15,
  CLOTHING: 0.17,
  APPAREL: 0.17,
  SHOES: 0.15,
  HANDBAGS: 0.15,
  TOYS: 0.15,
  TOYS_GAMES: 0.15,
  SPORTING_GOODS: 0.15,
  SPORTS_OUTDOORS: 0.15,
  HOME: 0.15,
  HOME_KITCHEN: 0.15,
  KITCHEN: 0.15,
  PET_SUPPLIES: 0.15,
  OFFICE_PRODUCTS: 0.15,
  TOOLS_HOME_IMPROVEMENT: 0.15,
  AUTOMOTIVE: 0.12,
  BOOKS: 0.15,
  MEDIA: 0.15,
  MUSIC: 0.15,
  FURNITURE: 0.15,
  MUSICAL_INSTRUMENTS: 0.15,
  BABY_PRODUCTS: 0.15,
  INDUSTRIAL_SCIENTIFIC: 0.12,
  LAWN_GARDEN: 0.15,
  PATIO: 0.15,
};

const DEFAULT_REFERRAL_RATE = 0.15;

function normalizeCategoryKey(category?: string | null): string {
  return (category || "")
    .trim()
    .toUpperCase()
    .replace(/[\s/&-]+/g, "_");
}

/** Kategoriye göre referral ücret oranını çözer — eşleşme yoksa dürüstçe DEFAULT_ASSUMED döner. */
export function estimateReferralFeeRate(category?: string | null): {
  rate: number;
  provenance: FeeProvenance;
} {
  const key = normalizeCategoryKey(category);
  if (key && key !== "UNCATEGORIZED" && CATEGORY_REFERRAL_RATES[key] !== undefined) {
    return { rate: CATEGORY_REFERRAL_RATES[key], provenance: "CATEGORY_MATCHED" };
  }
  return { rate: DEFAULT_REFERRAL_RATE, provenance: "DEFAULT_ASSUMED" };
}

/**
 * FBA fulfillment ücreti — ebat/ağırlık verisi olmadığı için satış fiyatına
 * dayanan kaba bir kademe tahmini (bkz. dosya başı BİLİNEN SINIR notu).
 */
function estimateFbaFulfillmentFee(sellingPrice: number): number {
  return sellingPrice > 100 ? 7.45 : sellingPrice > 45 ? 5.8 : 4.15;
}

export interface AmazonFeeInput {
  sellingPrice: number;
  category?: string | null;
  /** 'FBA' | 'FBM' | 'RETURN' | 'REMOVAL_ORDER' | diğer — bilinmiyorsa FBA varsayılır */
  fulfillmentType?: string | null;
}

/**
 * Bir satış birimi için tahmini Amazon ücretini (referral + fulfillment)
 * hesaplar. FBM'de fulfillment ücreti sıfırdır (Amazon kargolamıyor) —
 * ama satıcının kendi kargo maliyeti bu modelde henüz TUTULMUYOR (ayrı bir
 * açık bulgu, bkz. dosya başı yorum).
 */
export function estimateAmazonFees(input: AmazonFeeInput): AmazonFeeEstimate {
  const sellingPrice = Math.max(0, Number(input.sellingPrice) || 0);
  const { rate, provenance } = estimateReferralFeeRate(input.category);
  const referralFeeAmount = round2(sellingPrice * rate);

  const type = (input.fulfillmentType || "FBA").toUpperCase();
  const isFba = type !== "FBM";
  const fulfillmentFeeAmount = isFba ? round2(estimateFbaFulfillmentFee(sellingPrice)) : 0;

  const basis = [
    provenance === "CATEGORY_MATCHED"
      ? `Kategori eşleşti (${input.category}): %${(rate * 100).toFixed(0)} referral`
      : `Kategori bilinmiyor/eşleşmedi: varsayılan %${(rate * 100).toFixed(0)} referral (ASSUMED)`,
    isFba
      ? "FBA: fulfillment ücreti fiyat kademesinden tahmin edildi (ASSUMED — ağırlık/ebat verisi yok)"
      : "FBM: Amazon fulfillment ücreti alınmaz (satıcının kendi kargo maliyeti bu modelde yok)",
  ].join(" · ");

  return {
    referralFeeRate: rate,
    referralFeeAmount,
    fulfillmentFeeAmount,
    totalFeeAmount: round2(referralFeeAmount + fulfillmentFeeAmount),
    provenance,
    basis,
  };
}
