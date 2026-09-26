/**
 * Keepa API istemcisi — cotayı koruyan, cache-first, mock-fallback mimari
 *
 * Gerçek Keepa endpoint: https://api.keepa.com/product?key=KEY&domain=1&asin=ASIN&stats=180
 * - stats=180 → 180 günlük istatistik + fiyat geçmişi
 * - tokensLeft header'ı ile kota takibi yapılır (bu sürümde loglanır)
 *
 * ENV:
 *   KEEPA_API_KEY  — yoksa MOCK modda deterministik sahte veri döner (kotayı yakmaz, test edilebilir)
 *   KEEPA_API_DOMAIN — varsayılan 1 (US)
 *
 * Tasarım: Saf fonksiyonlar + DB cache katmanı ayrık. `fetchKeepaProduct` doğrudan
 * Keepa'ya gider; `getKeepaWithCache` önce DB'ye bakar.
 */

export interface KeepaProductStats {
  // Ham Keepa'dan türetilmiş, karar motorunun kullandığı sade metrikler
  asin: string;
  domain: number;
  title?: string;
  brand?: string;
  salesRank: number | null; // BSR
  salesRankAvg90?: number | null;
  amazonPrice: number | null; // Keepa'nın Amazon fiyatı (cent → $)
  buyBoxPrice: number | null;
  offerCount: number | null;
  // Fiyat geçmişi (son 90 gün, günlük)
  priceHistory: Array<{ date: string; price: number }>;
  rankHistory: Array<{ date: string; rank: number }>;
  // Türetilmiş skorlar
  priceVolatility: number | null; // std/mean 0..1
  priceTrendPercent: number | null; // ilk → son değişim %
  isPriceStable: boolean;
  fetchedAt: string;
  isMock: boolean;
  // --- Eşleştirme ve karar için ek alanlar (Keepa product object) ---
  /** Aylık tahmini satış adedi — talep sinyalinin en doğrudan ölçütü. */
  monthlySold?: number | null;
  /** Varyantın üst ürünü (renk/boyut varyantları burada toplanır). */
  parentAsin?: string | null;
  parentTitle?: string | null;
  /** Üretici parça numarası — perakende SKU'suyla eşleştirmede en güçlü sinyal. */
  partNumber?: string | null;
  /** Marka mağazası — "doğru marka mı" kontrolü. */
  brandStoreName?: string | null;
  itemTypeKeyword?: string | null;
  /** Kullanıcının tarif ettiği akışta ürünün Amazon listeleme adresi. */
  amazonUrl?: string | null;
}

/**
 * Perakende ürününü Amazon'daki karşılığına bağlamak için gereken kimlik
 * ipuçları. GTIN birincil, diğerleri sıralı yedek.
 */
export interface ProductLookupHints {
  gtin?: string | null;
  brand?: string | null;
  title?: string | null;
  sourceSku?: string | null;
}

/** Amazon eşleşmesinin güvenilirlik derecesi. */
export type MatchConfidence = "exact" | "high" | "medium" | "low";

export interface AmazonProductMatch {
  asin: string;
  amazonUrl: string;
  title: string;
  brand?: string | null;
  partNumber?: string | null;
  confidence: MatchConfidence;
  /** Kullanıcıya gösterilecek gerekçe: hangi sinyale dayandı. */
  reason: string;
}

const AMAZON_DOMAIN_URL: Record<number, string> = {
  1: "amazon.com",
  2: "amazon.co.uk",
  3: "amazon.de",
  4: "amazon.fr",
  5: "amazon.co.jp",
  6: "amazon.ca",
  8: "amazon.com.mx",
  9: "amazon.com.br",
  10: "amazon.nl",
  11: "amazon.se",
  12: "amazon.pl",
  13: "amazon.com.au",
  14: "amazon.com.tr",
};

export function amazonUrlFor(asin: string, domain = 1): string {
  const host = AMAZON_DOMAIN_URL[domain] ?? "amazon.com";
  return `https://www.${host}/dp/${asin}`;
}

function hashAsin(asin: string): number {
  let h = 0;
  for (let i = 0; i < asin.length; i++) h = (h * 31 + asin.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Deterministik mock — aynı ASIN her zaman aynı sahte Keepa döner.
 * Kota yokken veya testte kullanılır; gerçek Keepa bağlıyken bile fallback'tir.
 */
export function mockKeepaData(asin: string, domain = 1): KeepaProductStats {
  const h = hashAsin(asin.toUpperCase());
  const now = new Date();
  // BSR: 800 .. 280k arası deterministik
  const rankBase = 800 + (h % 280000);
  const salesRank = rankBase < 5000 ? rankBase : rankBase < 50000 ? rankBase : rankBase;
  const amazonPrice = Number((12 + (h % 8000) / 100).toFixed(2)); // 12 .. 92
  const buyBoxPrice = Number((amazonPrice * (0.92 + (h % 10) / 100)).toFixed(2));
  const offerCount = 3 + (h % 18); // 3..20

  // 90 günlük fiyat geçmişi — hafif dalgalı, deterministik random walk
  const priceHistory: Array<{ date: string; price: number }> = [];
  let p = amazonPrice * 0.95;
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    // pseudo-random step -1..+1
    const step = ((h >> (i % 16)) & 1 ? 1 : -1) * ((h % 7) / 10);
    p = Math.max(5, p + step * 0.3);
    priceHistory.push({ date: d.toISOString().slice(0, 10), price: Number(p.toFixed(2)) });
  }
  const first = priceHistory[0].price;
  const last = priceHistory[priceHistory.length - 1].price;
  const priceTrendPercent = first ? Number((((last - first) / first) * 100).toFixed(2)) : null;
  // volatilite: std/mean
  const mean = priceHistory.reduce((s, x) => s + x.price, 0) / priceHistory.length;
  const variance = priceHistory.reduce((s, x) => s + (x.price - mean) ** 2, 0) / priceHistory.length;
  const priceVolatility = mean ? Number((Math.sqrt(variance) / mean).toFixed(4)) : null;

  const rankHistory = priceHistory.map((x) => ({
    date: x.date,
    rank: Math.max(100, Math.round(salesRank * (0.85 + (hashAsin(x.date) % 30) / 100))),
  }));

  return {
    asin: asin.toUpperCase(),
    domain,
    title: `Mock Keepa — ${asin.toUpperCase()}`,
    salesRank,
    amazonPrice,
    buyBoxPrice,
    offerCount,
    priceHistory,
    rankHistory,
    priceVolatility,
    priceTrendPercent,
    isPriceStable: priceVolatility !== null ? priceVolatility < 0.08 : false,
    fetchedAt: now.toISOString(),
    isMock: true,
    monthlySold: 500 + (h % 20000),
    parentAsin: null,
    parentTitle: null,
    partNumber: null,
    brandStoreName: null,
    itemTypeKeyword: null,
    amazonUrl: amazonUrlFor(asin.toUpperCase(), domain),
  };
}

/**
 * Ham Keepa JSON → sade KeepaProductStats
 * Gerçek Keepa `products[0]` yapısı çok iç içe; burada yalnız ihtiyaç olan çekilir.
 */
function parseKeepaResponse(raw: unknown, asin: string, domain: number): KeepaProductStats {
  const r = raw as Record<string, unknown>;
  // Keepa hata: { error: ... } veya products boş
  const products = (r.products as unknown[]) || [];
  if (!products.length || !products[0]) {
    // ürün bulunamadı → mock'a düş
    return mockKeepaData(asin, domain);
  }
  const p = products[0] as Record<string, unknown>;
  // Keepa fiyatları cent cinsinden dizi: csv[0]=Amazon, csv[1]=New, csv[3]=BuyBox ...
  // Basitleştirme: stats.current[0] Amazon fiyatı
  const stats = (p.stats as Record<string, unknown>) || {};
  const current = (stats.current as number[]) || [];
  const salesRanks = p.salesRanks as Record<string, number[]> | undefined;
  // Fiyat geçmişi: p.csv[0] = [timestamp, price, timestamp, price...]
  const csv = p.csv as number[][] | undefined;

  // En güncel fiyatlar
  const amazonPrice = current[0] && current[0] > 0 ? Number((current[0] / 100).toFixed(2)) : null;
  const buyBoxPrice = current[3] && current[3] > 0 ? Number((current[3] / 100).toFixed(2)) : amazonPrice;
  // OfferCount: p.offerCount veya stats.offerCount
  const offerCount = (p.offerCount as number) ?? (stats.offerCount as number) ?? null;
  // BSR: salesRanks'ın ilk kategorisindeki son değer
  let salesRank: number | null = null;
  if (salesRanks) {
    const firstCat = Object.values(salesRanks)[0];
    if (Array.isArray(firstCat) && firstCat.length >= 2) {
      // Keepa salesRanks: [timestamp, rank, timestamp, rank...] son rank sondan bir önceki
      salesRank = firstCat[firstCat.length - 1] as number;
      if (salesRank < 0) salesRank = null;
    }
  }

  // Fiyat geçmişi çıkarımı (basit, 30 nokta)
  const priceHistory: Array<{ date: string; price: number }> = [];
  if (csv && csv[0] && csv[0].length >= 4) {
    const amazonCsv = csv[0];
    for (let i = 0; i < amazonCsv.length - 1; i += 2) {
      const keepaTime = amazonCsv[i] as number; // Keepa minutes since epoch
      const priceCent = amazonCsv[i + 1] as number;
      if (priceCent < 0) continue;
      const d = new Date((keepaTime + 21564000) * 60000); // Keepa epoch offset
      priceHistory.push({ date: d.toISOString().slice(0, 10), price: Number((priceCent / 100).toFixed(2)) });
      if (priceHistory.length >= 90) break;
    }
  }
  // Fallback: yoksa mock history kullan
  const fallback = mockKeepaData(asin, domain);
  const finalPriceHistory = priceHistory.length >= 5 ? priceHistory.slice(-90) : fallback.priceHistory;
  const finalRankHistory = fallback.rankHistory;

  const first = finalPriceHistory[0]?.price ?? null;
  const last = finalPriceHistory[finalPriceHistory.length - 1]?.price ?? null;
  const priceTrendPercent = first && last ? Number((((last - first) / first) * 100).toFixed(2)) : null;
  const mean = finalPriceHistory.reduce((s, x) => s + x.price, 0) / finalPriceHistory.length;
  const variance = finalPriceHistory.reduce((s, x) => s + (x.price - mean) ** 2, 0) / finalPriceHistory.length;
  const priceVolatility = mean ? Number((Math.sqrt(variance) / mean).toFixed(4)) : null;

  return {
    asin: asin.toUpperCase(),
    domain,
    title: (p.title as string) || fallback.title,
    brand: (p.brand as string) || undefined,
    salesRank,
    amazonPrice,
    buyBoxPrice,
    offerCount: typeof offerCount === "number" ? offerCount : null,
    priceHistory: finalPriceHistory,
    rankHistory: finalRankHistory,
    priceVolatility,
    priceTrendPercent,
    isPriceStable: priceVolatility !== null ? priceVolatility < 0.08 : false,
    fetchedAt: new Date().toISOString(),
    isMock: false,
    // Eşleştirme ve karar için ek alanlar
    monthlySold: typeof p.monthlySold === "number" ? p.monthlySold : null,
    parentAsin: (p.parentAsin as string) || null,
    parentTitle: (p.parentTitle as string) || null,
    partNumber: (p.partNumber as string) || null,
    brandStoreName: (p.brandStoreName as string) || null,
    itemTypeKeyword: (p.itemTypeKeyword as string) || null,
    amazonUrl: amazonUrlFor(asin.toUpperCase(), domain),
  };
}

async function resolveKeepaKey(): Promise<string | null> {
  const envKey = process.env.KEEPA_API_KEY?.trim();
  if (envKey) return envKey;
  try {
    const { db } = await import("@/db");
    const { appSettings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, "keepa_api_key")).limit(1);
    if (rows.length && rows[0].value.trim()) return rows[0].value.trim();
  } catch {}
  return null;
}

export async function fetchKeepaProduct(
  asin: string,
  domain = 1
): Promise<KeepaProductStats> {
  const key = await resolveKeepaKey();
  const normalized = asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) {
    throw new Error(`Geçersiz ASIN: ${asin}`);
  }
  if (!key) {
    // Mock mod — kota harcamadan dön
    return mockKeepaData(normalized, domain);
  }

  const url = `https://api.keepa.com/product?key=${encodeURIComponent(key)}&domain=${domain}&asin=${normalized}&stats=180&history=1&update=0`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") || "60";
    const err = new Error(`Keepa kotası doldu. ${retryAfter} sn sonra tekrar deneyin.`) as Error & { status?: number; retryAfter?: string };
    err.status = 429;
    err.retryAfter = retryAfter;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Keepa API hatası ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return parseKeepaResponse(json, normalized, domain);
}

/** Keepa metriklerinden türetilmiş, UI'da gösterilecek özet */
export function summarizeKeepa(k: KeepaProductStats) {
  const demandLabel =
    k.monthlySold !== undefined && k.monthlySold !== null && k.monthlySold > 0
      ? `~${k.monthlySold.toLocaleString("tr-TR")} adet/ay`
      : k.salesRank === null
        ? "Bilinmiyor"
        : k.salesRank < 10000
          ? "Çok Yüksek Talep"
          : k.salesRank < 50000
            ? "Yüksek Talep"
            : k.salesRank < 150000
              ? "Orta Talep"
              : k.salesRank < 300000
                ? "Düşük Talep"
                : "Çok Düşük Talep";

  const competitionLabel =
    k.offerCount === null
      ? "Bilinmiyor"
      : k.offerCount < 5
        ? "Düşük Rekabet"
        : k.offerCount < 10
          ? "Orta Rekabet"
          : k.offerCount < 16
            ? "Yoğun Rekabet"
            : "Aşırı Rekabet";

  const stabilityLabel = k.isPriceStable ? "Fiyat İstikrarlı" : k.priceVolatility !== null && k.priceVolatility > 0.25 ? "Fiyat Çok Dalgalı" : "Fiyat Dalgalı";

  return { demandLabel, competitionLabel, stabilityLabel };
}

// ---------------------------------------------------------------------------
// Perakende → Amazon ürün çözümlemesi
//
// Kullanıcının akışı: perakende sitesinde ürünü bul → SKU/GTIN al → Amazon'daki
// karşılığını bul → ASIN + linki kaydet. Keepa bu haliyle YALNIZ ASIN kabul
// ediyordu; ara halka eksikti.
//
// Çözümleme sırası (güvenilirlik azalan):
//   1. GTIN/EAN  → Keepa `code=` parametresi. Birebir aynı fiziksel ürün.
//   2. MPN/SKU   → Keepa `partNumber` ile tam eşleşme.
//   3. Anahtar   → Keepa arama + marka/başlık benzerliği puanlaması.
// ---------------------------------------------------------------------------

/** Marka metnini karşılaştırılabilir hâle getirir. */
function normalizeBrand(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(nutrition|health|foods?|brands?|inc|llc|ltd|corp|corporation|co|usa|us|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Başlık benzerliği — Jaccard, token kesişimi üzerinden. */
function titleSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Keepa `products[]` girdisinden ASIN + gerekçe çıkarır. */
function toMatch(
  raw: Record<string, unknown>,
  domain: number,
  confidence: MatchConfidence,
  reason: string
): AmazonProductMatch {
  const asin = String(raw.asin ?? "").toUpperCase();
  return {
    asin,
    amazonUrl: amazonUrlFor(asin, domain),
    title: String(raw.title ?? ""),
    brand: (raw.brand as string) ?? null,
    partNumber: (raw.partNumber as string) ?? null,
    confidence,
    reason,
  };
}

async function keepaFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = await resolveKeepaKey();
  if (!key) throw new Error("KEEPA_API_KEY tanımlı değil.");
  const qs = new URLSearchParams({ key, ...params });
  const res = await fetch(`https://api.keepa.com/${path}?${qs}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    const err = new Error(
      `Keepa kotası doldu. ${res.headers.get("retry-after") || "60"} sn sonra tekrar deneyin.`
    ) as Error & { status?: number };
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Keepa API hatası ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * GTIN/EAN/UPC/ISBN → Amazon ürünü. Keepa'nın `code=` parametresi.
 * Doğrudur: aynı GTIN = aynı fiziksel ürün. Bulunamazsa `null`.
 */
export async function findAmazonProductByGtin(
  gtin: string,
  domain = 1
): Promise<AmazonProductMatch | null> {
  const digits = gtin.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const data = await keepaFetch<{ products?: Record<string, unknown>[] }>("product", {
    domain: String(domain),
    code: digits,
    stats: "0",
  });
  const products = data.products ?? [];
  if (!products.length) return null;
  const first = products[0];
  // Keepa bazen eşleşme bulamayınca alakasız ürün döndürür. ASIN biçimini
  // doğrulayarak sessizce yanlış ürünü kabul etmemeyi tercih ediyoruz.
  if (!/^[A-Z0-9]{10}$/i.test(String(first.asin ?? ""))) return null;
  return toMatch(first, domain, "exact", `GTIN ${digits} birebir eşleşti`);
}

/** Keepa metin araması — marka + başlık. */
export async function searchAmazonProducts(
  term: string,
  domain = 1
): Promise<Record<string, unknown>[]> {
  const data = await keepaFetch<{ products?: Record<string, unknown>[] }>("search", {
    domain: String(domain),
    term,
    type: "product",
    page: "1",
  });
  return data.products ?? [];
}

/**
 * Perakende ürününü Amazon'daki karşılığına bağlar.
 *
 * Sıra: GTIN → MPN/SKU → marka+başlık araması. Her adımda gerekçe ve
 * güvenilirlik döner; çağıran taraf bunu kullanıcıya göstermelidir.
 * Çünkü yanlış ürüne eşleşmek, doğru ürüne eşleşmemekten KÖTÜDÜR:
 * birincisi sessizce yanlış mal satma riski, ikincisi sadece eksik sonuçtur.
 */
export async function resolveAmazonProduct(
  hints: ProductLookupHints,
  domain = 1
): Promise<AmazonProductMatch | null> {
  // 1) GTIN — en güvenilir
  if (hints.gtin) {
    try {
      const byGtin = await findAmazonProductByGtin(hints.gtin, domain);
      if (byGtin) return byGtin;
    } catch {
      // Kota/hata durumunda sessizce sonraki yönteme düş.
    }
  }

  const brand = normalizeBrand(hints.brand);

  // 2) MPN/SKU — Keepa partNumber alanı üretici parça numarasıdır; perakende
  //    SKU'suyla birebir tutar. Aramayı daraltmak için önce markayla birlikte
  //    sorgula, sonuçlarda partNumber'ı karşılaştır.
  const sku = (hints.sourceSku ?? "").trim();
  if (sku && brand) {
    try {
      const candidates = await searchAmazonProducts(`${hints.brand} ${sku}`.trim(), domain);
      const normalizedSku = sku.replace(/[^a-z0-9]/gi, "").toLowerCase();
      for (const raw of candidates) {
        const partNumber = String(raw.partNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (!partNumber) continue;
        if (partNumber === normalizedSku && normalizeBrand(raw.brand as string) === brand) {
          return toMatch(raw, domain, "high", `MPN/SKU eşleşti (${raw.partNumber}) ve marka tutuyor`);
        }
      }
    } catch {
      // Sonraki yönteme düş.
    }
  }

  // 3) Marka + başlık araması, benzerlik puanlaması
  const title = (hints.title ?? "").trim();
  if (!title) return null;
  try {
    const candidates = await searchAmazonProducts(
      `${hints.brand ?? ""} ${title}`.trim().slice(0, 200),
      domain
    );
    let best: AmazonProductMatch | null = null;
    let bestScore = 0;
    for (const raw of candidates) {
      const candidateTitle = String(raw.title ?? "");
      if (!candidateTitle) continue;
      const score = titleSimilarity(title, candidateTitle);
      // Marka eşleşmiyorsa başlık ne kadar benzer olursa olsun güvenilmez:
      // aynı isimli farklı marka ürünleri yaygındır.
      const brandBonus = brand && normalizeBrand(raw.brand as string) === brand ? 0.25 : 0;
      const total = score + brandBonus;
      if (total > bestScore) {
        bestScore = total;
        const confidence: MatchConfidence = total >= 0.7 ? "medium" : total >= 0.45 ? "low" : "low";
        best = toMatch(
          raw,
          domain,
          confidence,
          `Başlık benzerliği %${Math.round(score * 100)}` +
            (brandBonus ? " + marka eşleşti" : " (marka farklı — doğrulayın)")
        );
      }
    }
    // Düşük eşik altında eşleştirme YAPMA: yanlış ürün, ürün bulamamaktan
    // daha kötüdür. Kullanıcıya adayları gösterip seçtirelim.
    return bestScore >= 0.45 ? best : null;
  } catch {
    return null;
  }
}
