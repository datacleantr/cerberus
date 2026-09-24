/**
 * CERBERUS — Araç/Varlık Takibi (Abonelik/Alan Adı/Site)
 *
 * Kaynak: kullanıcının "Amazon Mağaza Ekibi Rutin" belgesine eklediği not —
 * gerçek takip edilen kalemler belgedeki 5 rol şablonu değil: ASINZEN/Keepa
 * üyelik takibi, GoDaddy alan adı/hosting süresi, Shopify site yönetimi.
 *
 * DÜRÜSTLÜK İLKESİ (computeWeeklyStoreHealth/computeRealizedRoi ile aynı):
 * "durum" alanı veritabanında SAKLANMAZ (bkz. src/db/schema.ts →
 * storeAssets yorumu) — süresi geçmiş bir aboneliği "aktif" diye saklamak
 * sessizce yanlış bilgi üretir. Durum her okumada `expiresAt`'tan canlı
 * hesaplanır. Süre bilgisi hiç girilmemişse "aktif" DEĞİL, "TAKİP
 * EDİLMİYOR" sayılır.
 */

export type AssetType = "SUBSCRIPTION" | "DOMAIN" | "HOSTING" | "SHOPIFY_SITE" | "OTHER";
export type AssetStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NOT_TRACKED";

/** Bu gün sayısının altına düşen süre "yakında dolacak" sayılır */
export const ASSET_EXPIRING_SOON_DAYS = 14;

export interface AssetFact {
  id: number;
  storeCode: string | null;
  assetType: AssetType;
  name: string;
  provider: string | null;
  url: string | null;
  expiresAt: string | null; // ISO
  renewalCost: number | null;
  notes: string | null;
  lastCheckedAt: string | null;
  lastCheckedBy: string | null;
}

export interface AssetComputed extends AssetFact {
  status: AssetStatus;
  daysUntilExpiry: number | null;
}

export function computeAssetStatus(asset: AssetFact, now: Date = new Date()): AssetComputed {
  if (!asset.expiresAt) {
    return { ...asset, status: "NOT_TRACKED", daysUntilExpiry: null };
  }

  const expires = new Date(asset.expiresAt);
  if (Number.isNaN(expires.getTime())) {
    return { ...asset, status: "NOT_TRACKED", daysUntilExpiry: null };
  }

  const daysUntilExpiry = Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);

  if (daysUntilExpiry < 0) {
    return { ...asset, status: "EXPIRED", daysUntilExpiry };
  }
  if (daysUntilExpiry <= ASSET_EXPIRING_SOON_DAYS) {
    return { ...asset, status: "EXPIRING_SOON", daysUntilExpiry };
  }
  return { ...asset, status: "ACTIVE", daysUntilExpiry };
}

/** En kritik (süresi geçmiş) varlık en üstte olacak şekilde sıralı liste */
export function computeAssetBoard(assets: AssetFact[], now: Date = new Date()): AssetComputed[] {
  const rank = (s: AssetStatus) => (s === "EXPIRED" ? 0 : s === "EXPIRING_SOON" ? 1 : s === "ACTIVE" ? 2 : 3);

  return assets
    .map((a) => computeAssetStatus(a, now))
    .sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return (a.daysUntilExpiry ?? Infinity) - (b.daysUntilExpiry ?? Infinity);
    });
}
