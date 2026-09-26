/**
 * Cerberus Crawler — Scrapling-ilhamlı dayanıklı JS scraper + opsiyonel Python servisi
 *
 * Scrapling (https://github.com/D4Vinci/Scrapling) referansı:
 *   - Adaptif parser (JSON-LD önce, sonra HTML fallback — yapısal değişikliklere dayanıklı)
 *   - StealthyFetcher (header rotasyonu, anti-bot bypass)
 *   - Spider (proxy/retry/pause-resume) — bu JS katmanında retry + backoff + host throttling olarak yansıtılır
 *
 * Mimari karar (Vercel Node 20):
 *   - Vercel Node doğrudan Scrapling çalıştıramaz (Python). Bu dosya JS tasarımıdır.
 *   - Opsiyonel Python mikro-servisi: SCRAPLING_SERVICE_URL set ise → fetch-tabanlı fallback.
 *   - Fallback yoksa stealth JS fetch tek başına çalışır (geliştirilmiş).
 */

import {
  assertSafeOutboundUrl,
  readResponseTextWithLimit,
  validateOutboundUrlSyntax,
} from "@/lib/httpSafety";

export interface ScrapedItem {
  sourceUrl: string;
  sourceDomain: string;
  title: string;
  brand: string;
  price: number | null;
  /**
   * Liste sayfasında ürünün aralandığı **gerçek fiyat**. JSON-LD `offers.price`
   * çoğu zaman varyantlar arasında EN DÜŞÜK fiyatı verir; bu alan o fiyatı
   * "tarihsel indirim" diye yanlış raporlamamak için ayrı tutulur.
   */
  listPrice: number | null;
  currency: string;
  imageUrl: string | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  /**
   * Gerçek Amazon ASIN. Perakende sitesinden **asla** slug'dan tahmin edilmez —
   * yalnız Amazon kaynaklı URL/token'ından kabul edilir. aksi halde
   * "OMEGA3FIS" gibi sahte ASIN'ler ürün kataloğuna yazılıyordu.
   */
  asinCandidate: string | null;
  /** Perakendecinin kendi ürün kodu (VitaminShoppe VS-xxxx vb.). */
  sourceSku: string | null;
  /**
   * GTIN-8/12/13/14 (UPC/EAN). SKU metnine göre **çok** daha güvenilir bir
   * eşleştirme anahtarıdır: Amazon katalogunda `gtin` alanı birebir tutar.
   * Satışınızı yaparken kullandığınız ürünü doğru Amazon ürününe bağlamanın
   * birincil yolu budur.
   */
  gtin: string | null;
  mpn: string | null;
  /** `true` ise fiyat liste fiyatının altında — indirim sinyalidir. */
  isDiscounted: boolean;
  /** İndirim yüzdesi (liste fiyatı biliniyorsa), aksi halde null. */
  discountPct: number | null;
}

export interface ScrapeResult {
  sourceUrl: string;
  sourceDomain: string;
  products: ScrapedItem[];
  warnings: string[];
  fetchedAt: string;
  isListingPage: boolean;
  /** Hangi motorla çekildi — debug/audit için */
  engine: "js-stealth" | "scrapling-service";
  /** Hangi koruma engelledi/yönlendirdi — kullanıcıya dürüst mesaj için */
  blockedBy: BotProtection | null;
}

function throwOutboundPolicyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const forbidden = /özel|ayrılmış|güvenlik politikası|izin listesi|kullanıcı bilgisi/i.test(
    message
  );
  throw Object.assign(new Error(message), { status: forbidden ? 403 : 422 });
}

// ---------------------------------------------------------------------------
// URL normalizasyonu
// ---------------------------------------------------------------------------
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid", "igshid"].forEach((k) => u.searchParams.delete(k));
  return u.toString();
}

// ---------------------------------------------------------------------------
// Stealth katmanı
//
// DİKKAT: Bu katman yalnız "kolay" bot filtrelerini (kaba UA/eşleşmesiz header
// kontrolü) geçmeye yarar. DataDome/Akamai gibi JS + TLS parmak izi tabanlı
// sistemler Node'un `fetch`'i ile ASLA geçilemez — onlar için gerçek Chromium
// gerekir, yani `SCRAPLING_SERVICE_URL` (services/scrapling) tek yoldur.
//
// Bu katmanın yaptığı düzeltmeler:
//   1. `Sec-Ch-Ua-Platform` artık User-Agent'tan TÜRETİLİR. Önceden sabit
//      `"Windows"` idi; macOS UA seçildiğinde parmak izi kendi kendini
//      ele veriyordu.
//   2. `Referer` + `Sec-Fetch-Site` çelişkisi giderildi. Gerçek tarayıcı
//      `Referer`'li bir istekte `Sec-Fetch-Site: "none"` GÖNDERMEZ.
//   3. Retry artık GERÇEKTEN farklı profil kullanır (attempt ile indeks kayar).
//      Önceden `pickUA(url)` URL'den seed alıyordu, yani her deneme birebir
//      aynı UA'yı gönderiyordu; retry hiçbir işe yaramıyor, sadece DataDome'a
//      aynı isteği ikinci kez yolluyordu.
//   4. `Accept-Encoding` elle yazılmıyor. undici kendi kodlamasını kendisi
//      yönetir; elle `br` vaat etmek parmak izinde çelişki yaratıyordu.
//   5. Cookie jar eklendi. `datadome` çerezi alınıp sonraki isteklere taşınıyor.
// ---------------------------------------------------------------------------

interface StealthProfile {
  userAgent: string;
  /** Chromium tabanlı mı? Firefox client-hint header'ı göndermez. */
  chromium: boolean;
  /** `Sec-Ch-Ua-Platform` — User-Agent ile Aynı olmak ZORUNDA. */
  platform: string;
  acceptLanguage: string;
  /** Chrome sürümü client hint'lerine de yansımalı. */
  brandVersion: string;
}

const CHROME_VERSION = "141";

const STEALTH_PROFILES: readonly StealthProfile[] = [
  {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
    chromium: true,
    platform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
    brandVersion: CHROME_VERSION,
  },
  {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
    chromium: true,
    platform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.9",
    brandVersion: CHROME_VERSION,
  },
  {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
    chromium: true,
    platform: '"macOS"',
    acceptLanguage: "en-US,en;q=0.8",
    brandVersion: CHROME_VERSION,
  },
  {
    // Chromium tabanlı olmayan profil: client-hint header'ı GÖNDERİLMEZ.
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    chromium: false,
    platform: '"Windows"',
    acceptLanguage: "en-US,en;q=0.9",
    brandVersion: CHROME_VERSION,
  },
];

/**
 * Deterministik profil seçimi + gerçek attempt rotasyonu.
 * Aynı URL ilk denemede aynı profili alır (tekrarlanabilirlik), ama her retry
 * bir sonraki profille gider — böylece "farklı UA ile retry" iddiası gerçekten
 * yerine gelir.
 */
function pickProfile(url: string, attempt = 0): StealthProfile {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
  return STEALTH_PROFILES[(h + attempt) % STEALTH_PROFILES.length];
}

/**
 * `fromSite` true ise istek, tarayıcıda site içinden yapılan bir navigasyon
 * gibi görünür: `Referer` gönderilir VE `Sec-Fetch-Site: "same-origin"`
 * gönderilir. `false` ise adres çubuğu navigasyonu: `Referer` yok,
 * `Sec-Fetch-Site: "none"`. İkisini karıştırmak bot sinyalidir.
 */
function stealthHeaders(
  targetUrl: string,
  profile: StealthProfile,
  fromSite: boolean,
  cookie?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": profile.userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": profile.acceptLanguage,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": fromSite ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  if (profile.chromium) {
    headers["Sec-Ch-Ua"] = `"Chromium";v="${profile.brandVersion}", "Google Chrome";v="${profile.brandVersion}", "Not=A?Brand";v="24"`;
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    // KULLANILMAMALIDIR: UA ile uyuşmayan platform hint'i en kolay bot sinyalidir.
    headers["Sec-Ch-Ua-Platform"] = profile.platform;
  }
  if (fromSite) {
    headers["Referer"] = new URL(targetUrl).origin + "/";
  }
  if (cookie) {
    headers["Cookie"] = cookie;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Cookie jar — DataDome `datadome` çerezini ısıtma turundan sonraki isteğe taşır
// ---------------------------------------------------------------------------
class CookieJar {
  private readonly byHost = new Map<string, Map<string, string>>();

  absorb(response: Response, url: string): void {
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (!setCookie.length) return;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    let bucket = this.byHost.get(host);
    if (!bucket) {
      bucket = new Map();
      this.byHost.set(host, bucket);
    }
    for (const raw of setCookie) {
      const pair = raw.split(";")[0]?.trim();
      if (!pair || !pair.includes("=")) continue;
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      // Boş değerli çerez silme bildirimi (Max-Age=0) olarak ele alınır.
      if (/;\s*max-age=0\s*$/i.test(raw)) bucket.delete(name);
      else bucket.set(name, value);
    }
  }

  headerFor(url: string): string | undefined {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return undefined;
    }
    const bucket = this.byHost.get(host);
    if (!bucket || !bucket.size) return undefined;
    return Array.from(bucket, ([name, value]) => `${name}=${value}`).join("; ");
  }
}

// ---------------------------------------------------------------------------
// Bot koruması tespiti
//
// ÖNEMLİ: DataDome engel sayfası 200 DEĞİL, 403'tür ve Cloudflare imzaları
// taşımaz. Önceki tespit yalnız Cloudflare kalıplarına bakıyordu; bu yüzden
// DataDome'lu sitelerde fallback'e hiç ulaşılamıyor, kod daha önce ölüyordu.
// ---------------------------------------------------------------------------
export type BotProtection = "cloudflare" | "datadome" | "akamai" | "perimeterx" | "imperva" | "generic";

interface BotChallenge {
  protection: BotProtection;
  detail: string;
}

const BOT_CHALLENGE_SIGNATURES: ReadonlyArray<{
  protection: BotProtection;
  pattern: RegExp;
  detail: string;
}> = [
  { protection: "datadome", pattern: /captcha-delivery\.com|x-datadome|\bvar dd\s*=|geo\.captcha-delivery/i, detail: "DataDome" },
  { protection: "cloudflare", pattern: /cf-chl-|cf_chl_|__cf_chl|turnstile|checking if the site connection is secure|ddos protection by cloudflare|attention required/i, detail: "Cloudflare" },
  { protection: "cloudflare", pattern: /cdn-cgi\/challenge|cf-mitigated|cf-error-details/i, detail: "Cloudflare" },
  { protection: "perimeterx", pattern: /px-captcha|_pxhd|perimeterx/i, detail: "PerimeterX" },
  { protection: "imperva", pattern: /incapsula|_incap_|imperva/i, detail: "Imperva" },
  { protection: "akamai", pattern: /akamaighosts|ak_bmsc|reference #\d+\.\d+\.\d+/i, detail: "Akamai Bot Manager" },
];

function detectBotChallenge(html: string): BotChallenge | null {
  const head = html.slice(0, 8000);
  for (const sig of BOT_CHALLENGE_SIGNATURES) {
    if (sig.pattern.test(head)) return { protection: sig.protection, detail: sig.detail };
  }
  // DataDome gövdesi JS çalıştırılana kadar neredeyse boştur; gerçek sayfa
  // 500 byte'ın altındaysa "engel sayfası" olma olasılığı yüksektir.
  if (head.length < 1200 && /please enable js|ad blocker|enable javascript/i.test(head)) {
    return { protection: "generic", detail: "bilinmeyen bot koruması" };
  }
  return null;
}

const BOT_PROTECTION_HINT: Record<BotProtection, string> = {
  datadome: "DataDome (JavaScript + TLS parmak izi)",
  cloudflare: "Cloudflare bot yönetimi",
  akamai: "Akamai Bot Manager",
  perimeterx: "PerimeterX / HUMAN",
  imperva: "Imperva",
  generic: "bot koruması",
};

// ---------------------------------------------------------------------------
// HTML yardımcıları (regex tabanlı, hızlı — cheerio bağımlılığı yok)
// ---------------------------------------------------------------------------
function extractMetaContent(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return decodeHtml(m[1]);
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["']${property}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? decodeHtml(m2[1]) : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractJsonLdProducts(html: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of arr) {
        const o = obj as Record<string, unknown>;
        if (o["@type"] === "Product" || o["@type"] === "ItemList" || Array.isArray(o["@graph"])) results.push(o);
        if (Array.isArray(o["@graph"])) {
          for (const g of o["@graph"] as unknown[]) {
            const gg = g as Record<string, unknown>;
            if (gg["@type"] === "Product") results.push(gg);
          }
        }
      }
    } catch {}
  }
  return results;
}

// ---------------------------------------------------------------------------
// GTIN / SKU / MPN — SKU→ASIN eşleştirmenin taşıyıcı sütunları
// ---------------------------------------------------------------------------

/** GTIN kontrol hanesi. UPC/EAN yanlış yazılırsa sessizce eşleşmez; önce burada elenir. */
export function isValidGtin(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  // GTIN-8 ve GTIN-12/13/14 farklı ağırlık şeması kullanır; sağdan sola
  // başlayıp 3'erli kademelerde ağırlık değiştirerek tek formülle çözüyoruz.
  const weighted = body
    .split("")
    .reverse()
    .map((d, i) => Number(d) * (i % 2 === 0 ? 3 : 1))
    .reduce((a, b) => a + b, 0);
  sum = weighted;
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1));
}

/** GTIN-13/12/8/14 → Amazon `gtin` alanında aranacak normalize formlar. */
function gtinCandidates(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const out: string[] = [];
  if (digits.length === 14 && digits.startsWith("0")) out.push(digits.slice(1, 14));
  if (digits.length === 13 && digits.startsWith("0")) out.push(digits.slice(1, 13));
  if (digits.length === 12) out.push(`0${digits}`);
  out.push(digits);
  return Array.from(new Set(out));
}

function pickGtin(p: Record<string, unknown>, html: string): string | null {
  const keys = ["gtin13", "gtin12", "gtin14", "gtin", "gtin8", "upc", "ean", "isbn"];
  for (const key of keys) {
    const value = p[key];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === "string" || typeof raw === "number") {
      const str = String(raw);
      if (isValidGtin(str)) return str.replace(/\D/g, "");
    }
  }
  // JSON-LD yoksa microdata/meta etiketlerine düş.
  for (const key of keys) {
    const m = html.match(
      new RegExp(`<[^>]+itemprop=["']${key}["'][^>]*content=["']([^"']+)["']`, "i")
    ) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*itemprop=["']${key}["']`, "i"));
    if (m && isValidGtin(m[1])) return m[1].replace(/\D/g, "");
  }
  const m2 = html.match(/<meta[^>]+itemprop=["']upc["'][^>]*>(\d{8,14})</i);
  if (m2 && isValidGtin(m2[1])) return m2[1];
  return null;
}

function pickStringField(p: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = p[key];
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === "string" || typeof raw === "number") {
      const trimmed = String(raw).trim();
      if (trimmed) return trimmed.slice(0, 64);
    }
    if (raw && typeof raw === "object") {
      const nested = (raw as Record<string, unknown>).name;
      if (typeof nested === "string" && nested.trim()) return nested.trim().slice(0, 64);
    }
  }
  return null;
}

function toPrice(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** JSON-LD `offers` tek nesne olabilir, dizi olabilir, AggregateOffer olabilir. */
function offerList(offers: unknown): Array<Record<string, unknown>> {
  if (!offers) return [];
  if (Array.isArray(offers)) return offers as Array<Record<string, unknown>>;
  const o = offers as Record<string, unknown>;
  if (Array.isArray(o.offers)) return o.offers as Array<Record<string, unknown>>;
  if (o.aggregateOffer) return [o.aggregateOffer as Record<string, unknown>];
  return [o];
}

/**
 * Gerçek indirim sinyali. Viteks'in ürün sayfalarında JSON-LD `lowPrice`
 * alanı "en ucuz varyant"ı verir; bunu liste fiyatı sanmak, her ürünü
 * %50 indirimli gösterirdi. Bu yüzden oran sadece gerçek bir
 * `highPrice`/`priceSpecification` karşılaştırmasından gelirse dolar.
 */
function computeDiscount(
  price: number | null,
  listPrice: number | null
): { isDiscounted: boolean; discountPct: number | null } {
  if (price === null || listPrice === null) return { isDiscounted: false, discountPct: null };
  if (listPrice <= price) return { isDiscounted: false, discountPct: null };
  const pct = ((listPrice - price) / listPrice) * 100;
  // %1'in altındaki fark genelde vergi/yuvarlama gürültüsüdür, indirim değil.
  if (pct < 1) return { isDiscounted: false, discountPct: null };
  return { isDiscounted: true, discountPct: Math.round(pct) };
}

/**
 * Sitenin gerçekten ürün verdiğine dair güvenilirlik kontrolü.
 *
 * NEDEN GEREKLİ: JS ağırlıklı (SPA) mağazalarda sayfa, ürün verisi
 * yüklenmeden önce bir "splash screen" iskeleti döndürür. Parser bu iskeletten
 * rastgele sayıları ve uygulama metinlerini ürün sanıyordu. Gerçek gözlem:
 * GNC'den "MENA Splash Screen Used by Yotta" adlı ürün ve $1299 fiyatı
 * çıkmıştı — sessizce yanlış veri, ürün BULAMAMAKTAN daha kötüdür.
 *
 * Reddedilenler:
 *   - uygulama kabuğu / yükleme ekranı / hata sayfası metinleri
 *   - alan adının kendisini ürün adı olarak gösteren sayfalar
 *   - ürün bağlamı olmayan, fiyatı olmayan ham iskeletler
 */
const NON_PRODUCT_PATTERNS: RegExp[] = [
  /splash\s*screen/i,
  /loading\.?\.?\.?|yükleniyor/i,
  /enable\s+javascript/i,
  /\b(page not found|404|not found|access denied)\b/i,
  /\b(cookie|consent|privacy) (policy|settings|notice)\b/i,
  /\bsign in|log ?in|register\b.*\baccount\b/i,
  /^[\s\-_=.|]+$/,
];

const GENERIC_TITLE_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\/?$/i;

function isPlausibleProduct(item: ScrapedItem): boolean {
  const title = item.title.trim();
  if (title.length < 4) return false;
  // Alan adı ürün adı olamaz.
  if (GENERIC_TITLE_PATTERN.test(title)) return false;
  for (const pattern of NON_PRODUCT_PATTERNS) {
    if (pattern.test(title)) return false;
  }
  // Fiyat yoksa ve ne GTIN ne marka varsa bu bir ürün değil, iskelettir.
  // Yalnız fiyat olan ama başlığı iskelet gibi olan kayıt da elenir.
  const hasIdentity = Boolean(item.gtin || (item.brand && item.brand.length > 1) || item.sourceSku);
  if (item.price === null && !hasIdentity) return false;
  // Besin takviyesi bağlamında beklemediğimiz absürt fiyatlar genelde
  // yanlış alandan okunmuş sayılardır (stok adedi, ürün no gibi).
  // Fiyat sınırı İKİNCİL savunmadır; asıl koruma başlık denetimidir. Burada
  // yalnız kesin çöp değerler elenir: sent'e yazılmış fiyat (129900), stok
  // adedi veya ürün numarası. 2000 üstü bir takviye fiyatı değildir.
  if (item.price !== null && (item.price < 0.5 || item.price > 2000)) return false;
  return true;
}

function availabilityFrom(raw: unknown): ScrapedItem["availability"] {
  const av = String(raw || "").toLowerCase();
  if (av.includes("instock") || av.includes("in_stock") || av.includes("limitedavailability")) return "IN_STOCK";
  if (av.includes("outofstock") || av.includes("out_of_stock") || av.includes("soldout") || av.includes("backorder")) return "OUT_OF_STOCK";
  return "UNKNOWN";
}

function imageFrom(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const url = (entry as Record<string, unknown>).url;
        if (typeof url === "string") return url;
      }
    }
  }
  if (raw && typeof raw === "object") {
    const url = (raw as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return null;
}

/** Ortak JSON-LD → ScrapedItem dönüşümü. VitaminShoppe ve generic aynı mantığı kullanır. */
function productFromJsonLd(
  p: Record<string, unknown>,
  baseUrl: string,
  domain: string,
  defaultBrand: string
): ScrapedItem | null {
  const name = String(p.name || p.title || "").trim();
  if (!name) return null;

  const brandRaw = p.brand;
  const brand =
    (typeof brandRaw === "string" ? brandRaw
      : ((brandRaw as Record<string, unknown>)?.name as string) || "")
      .trim() || defaultBrand;

  const offers = offerList(p.offers);
  let price: number | null = null;
  let listPrice: number | null = null;
  let currency = "USD";
  let availability: ScrapedItem["availability"] = "UNKNOWN";

  for (const offer of offers) {
    const candidate = toPrice(offer.price ?? offer.lowPrice);
    // Birden fazla varyant varsa en düşük fiyat = gerçekten alınabilecek fiyat.
    if (candidate !== null && (price === null || candidate < price)) price = candidate;
    const high = toPrice(offer.highPrice);
    if (high !== null && (listPrice === null || high > listPrice)) listPrice = high;
    const spec = offer.priceSpecification as Record<string, unknown> | undefined;
    if (spec) {
      const specPrice = toPrice(spec.price);
      if (specPrice !== null && listPrice === null) listPrice = specPrice;
    }
    if (!currency || currency === "USD") currency = (offer.priceCurrency as string) || currency;
    const av = availabilityFrom(offer.availability);
    if (av !== "UNKNOWN") availability = av;
  }

  let productUrl = (p.url as string) || baseUrl;
  try {
    productUrl = new URL(productUrl, baseUrl).toString();
  } catch {
    productUrl = baseUrl;
  }

  const { isDiscounted, discountPct } = computeDiscount(price, listPrice);

  return {
    sourceUrl: productUrl,
    sourceDomain: domain,
    title: decodeHtml(name).slice(0, 300),
    brand: decodeHtml(brand).slice(0, 80),
    price,
    listPrice,
    currency,
    imageUrl: imageFrom(p.image),
    availability,
    asinCandidate: extractAsinCandidate(productUrl),
    sourceSku: pickStringField(p, ["sku", "productID", "retailer_item_id", "mpn"]),
    gtin: pickGtin(p, productUrl),
    mpn: pickStringField(p, ["mpn"]),
    isDiscounted,
    discountPct,
  };
}

function parseVitaminShoppe(html: string, baseUrl: string, domain: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  for (const p of extractJsonLdProducts(html)) {
    if (p["@type"] !== "Product") continue;
    const item = productFromJsonLd(p, baseUrl, domain, "THE VITAMINSHOPPE");
    if (item) items.push(item);
  }
  if (items.length) return items;

  const ogTitle = extractMetaContent(html, "og:title");
  const ogImage = extractMetaContent(html, "og:image");
  const priceText =
    html.match(/["']price["']\s*:\s*["']?\$?([\d.,]+)["']?/i)?.[1] ||
    html.match(/class="[^"]*price[^"]*"[^>]*>\s*\$([\d.,]+)/i)?.[1];
  if (ogTitle && priceText) {
    const price = Number(priceText.replace(/,/g, ""));
    items.push({
      sourceUrl: normalizeUrl(baseUrl),
      sourceDomain: domain,
      title: ogTitle.slice(0, 300),
      brand: (extractMetaContent(html, "og:brand") || html.match(/"brand"\s*:\s*"([^"]+)"/i)?.[1] || "THE VITAMINSHOPPE").slice(0, 80),
      price: Number.isFinite(price) ? price : null,
      listPrice: null,
      currency: "USD",
      imageUrl: ogImage,
      availability: /out of stock/i.test(html) ? "OUT_OF_STOCK" : /in stock/i.test(html) ? "IN_STOCK" : "UNKNOWN",
      asinCandidate: extractAsinCandidate(baseUrl),
      sourceSku: html.match(/"sku"\s*:\s*"([^"]+)"/i)?.[1]?.slice(0, 64) || null,
      gtin: pickGtin({}, html),
      mpn: null,
      isDiscounted: false,
      discountPct: null,
    });
    if (items.length) return items;
  }

  // Son çare: sayfadaki ürün kartı linkleri. Fiyat/GTIN taşınmaz ama
  // keşif için başlık kazanır.
  const tileRe = /<a[^>]+href=["']([^"']*\/p\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tileRe.exec(html)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    let full: string;
    try {
      full = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (items.length >= 30) break;
    const titleMatch = m[0].match(/title=["']([^"']+)["']/i) || m[0].match(/alt=["']([^"']+)["']/i);
    const title = titleMatch ? decodeHtml(titleMatch[1]) : `VitaminShoppe Ürünü ${items.length + 1}`;
    items.push({
      sourceUrl: full,
      sourceDomain: domain,
      title: title.slice(0, 300),
      brand: "THE VITAMINSHOPPE",
      price: null,
      listPrice: null,
      currency: "USD",
      imageUrl: null,
      availability: "UNKNOWN",
      // Perakende slug'ı ASIN DEĞİLDİR — bilerek null.
      asinCandidate: extractAsinCandidate(full),
      sourceSku: null,
      gtin: null,
      mpn: null,
      isDiscounted: false,
      discountPct: null,
    });
  }
  return items;
}

/**
 * Gerçek Amazon ASIN tespiti.
 *
 * ESKİ DAVRANIŞ: `/p/<slug>`'ı büyük harfe çevirip `asinCandidate` sayıyordu.
 * "omega-3-fish-oil" → "OMEGA3FIS" gibi 10 karakterlik slug'lar `/^[A-Z0-9]{10}$/`
 * kontrolünden geçip ürün kataloğunda ASIN olarak yazılıyordu.
 *
 * YENİ: Bir perakende sitesinin URL'si ASIN üretmez. Yalnız Amazon kaynaklı
 * URL'deki `/dp/` veya `/gp/product/` yolu kabul edilir.
 */
function extractAsinCandidate(url: string): string | null {
  const amazon = url.match(/amazon\.[a-z.]{2,12}\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  if (amazon) return amazon[1].toUpperCase();
  const asin = url.match(/(?:^|[/=])(B0[A-Z0-9]{8})(?=$|[/?#&])/);
  if (asin) return asin[1].toUpperCase();
  return null;
}

function parseGeneric(html: string, baseUrl: string, domain: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  for (const p of extractJsonLdProducts(html)) {
    if (p["@type"] === "Product") {
      const item = productFromJsonLd(p, baseUrl, domain, domain.split(".")[0].toUpperCase());
      if (item) items.push(item);
    }
    if (p["@type"] === "ItemList" && Array.isArray(p.itemListElement)) {
      for (const el of p.itemListElement as unknown[]) {
        const e = el as Record<string, unknown>;
        const item = (e.item as Record<string, unknown>) || e;
        if (item["@type"] === "Product" && item.name) {
          const parsed = productFromJsonLd(item, baseUrl, domain, domain.split(".")[0].toUpperCase());
          if (parsed) items.push({ ...parsed, sourceUrl: baseUrl });
        }
      }
    }
  }
  if (items.length) return items;

  const ogTitle = extractMetaContent(html, "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  if (ogTitle) {
    const ogImage = extractMetaContent(html, "og:image");
    const ogPrice =
      extractMetaContent(html, "product:price:amount") ||
      extractMetaContent(html, "og:price:amount") ||
      html.match(/["']price["']\s*:\s*["']?\$?([\d.,]+)/i)?.[1];
    const price = ogPrice ? toPrice(ogPrice) : null;
    const cleaned = decodeHtml(ogTitle.trim());
    if (cleaned && cleaned.length > 5) {
      items.push({
        sourceUrl: normalizeUrl(baseUrl),
        sourceDomain: domain,
        title: cleaned.slice(0, 300),
        brand: (extractMetaContent(html, "product:brand") || extractMetaContent(html, "og:brand") || domain.split(".")[0].toUpperCase()).slice(0, 80),
        price,
        listPrice: null,
        currency: extractMetaContent(html, "product:price:currency") || "USD",
        imageUrl: ogImage,
        availability: /out of stock/i.test(html) ? "OUT_OF_STOCK" : /in stock/i.test(html) ? "IN_STOCK" : "UNKNOWN",
        asinCandidate: extractAsinCandidate(baseUrl),
        sourceSku: html.match(/"sku"\s*:\s*"([^"]+)"/i)?.[1]?.slice(0, 64) || null,
        gtin: pickGtin({}, html),
        mpn: null,
        isDiscounted: false,
        discountPct: null,
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Fetch katmanı — retry + stealth + Scrapling service fallback
// ---------------------------------------------------------------------------
async function tryScraplingService(url: string): Promise<ScrapeResult | null> {
  const svc = process.env.SCRAPLING_SERVICE_URL?.trim();
  if (!svc) return null;
  const token = process.env.SCRAPLING_SERVICE_TOKEN?.trim();
  // Public bir SSRF proxy'sine dönüşmemesi için mikro-servis paylaşımlı sır
  // olmadan hiçbir zaman çağrılmaz.
  if (!token || token.length < 32) return null;
  try {
    const endpoint = svc.replace(/\/$/, "") + "/scrape";
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Scrapling-Token": token,
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!r.ok) return null;
    const raw = await readResponseTextWithLimit(r, 1024 * 1024);
    const j = JSON.parse(raw) as ScrapeResult & { products: ScrapedItem[] };
    if (!j.products?.length) return null;
    return { ...j, engine: "scrapling-service", blockedBy: null };
  } catch {
    return null;
  }
}

/**
 * Bot koruması hatası. `status` bilinçli 403 DEĞİL: istek geçerli, sorun
 * erişimde. Kullanıcı "izin" sanıp URL'yi değiştirmeye çalışmasın.
 */
function botBlockedError(challenge: BotChallenge, scraplingConfigured: boolean): Error {
  const hint = scraplingConfigured
    ? "Scrapling servisi de engellendi — bu koruma TLS parmak izi + JavaScript çalıştırma istiyor, ABD kaynaklı egress gerekiyor."
    : "SCRAPLING_SERVICE_URL tanımlı değil. Bu koruma gerçek tarayıcı gerektiriyor: services/scrapling imajını çalıştırıp adresi tanımlayın.";
  return Object.assign(
    new Error(
      `Site bot korumasıyla erişimi engelledi (${BOT_PROTECTION_HINT[challenge.protection]}). URL geçerli — erişim reddedildi. ${hint}`
    ),
    { status: 422, blockedBy: challenge.protection }
  );
}

function crawlerAllowedHosts(): string[] | undefined {
  const configured = process.env.CRAWLER_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return configured?.length ? configured : undefined;
}

function scraplingConfigured(): boolean {
  const url = process.env.SCRAPLING_SERVICE_URL?.trim();
  const token = process.env.SCRAPLING_SERVICE_TOKEN?.trim();
  return Boolean(url && token && token.length >= 32);
}

async function fetchWithStealth(
  rawUrl: string,
  attempt = 0,
  redirectCount = 0,
  jar: CookieJar = new CookieJar(),
  warmed = false
): Promise<{ html: string; finalUrl: string }> {
  // Her istekten ve her yönlendirmeden önce DNS yeniden denetlenir. `fetch`
  // otomatik redirect takip etmez; aksi halde güvenli bir public URL özel ağa
  // 302 ile sıçrayabilirdi.
  let safeUrl: URL;
  try {
    safeUrl = await assertSafeOutboundUrl(rawUrl, {
      allowedHosts: crawlerAllowedHosts(),
    });
  } catch (error) {
    throwOutboundPolicyError(error);
  }
  const url = safeUrl.toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: stealthHeaders(url, pickProfile(url, attempt), warmed, jar.headerFor(url)),
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      // Isınma turu kritik değil; asıl isteğe sessizce devam et.
      if (warmed) return { html: "", finalUrl: url };
      throw new Error("Site 15 saniyede yanıt vermedi (timeout).");
    }
    throw new Error(`Ağ hatası: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
  jar.absorb(response, url);

  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= 3) throw new Error("Site çok fazla yönlendirme döndürdü.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Site geçersiz bir yönlendirme döndürdü.");
    const redirected = new URL(location, url).toString();
    return fetchWithStealth(redirected, attempt, redirectCount + 1, jar, warmed);
  }

  // 403/429/503 → koruma sayfasını oku ve fallback'e git.
  //
  // ÖNEMLİ: DataDome engel sayfasını 403 ile döndürür, 200 ile değil. Bu yüzden
  // önceki sürüm `!response.ok` dalına düşüp kullanıcıya "URL'yi kontrol edin"
  // diyor ve Scrapling fallback'ine HİÇ ulaşamıyordu. Korumayı burada, HTTP
  // durumundan bağımsız olarak tanımlamak zorunlu.
  if (response.status === 403 || response.status === 429 || response.status === 503) {
    let challenge: BotChallenge | null = null;
    try {
      challenge = detectBotChallenge(await readResponseTextWithLimit(response, 128 * 1024));
    } catch {
      challenge = null;
    }
    if (challenge) {
      const svc = await tryScraplingService(url);
      if (svc) throw Object.assign(new Error("__SCRAPLING_FALLBACK__"), { __fallback: svc });
      throw botBlockedError(challenge, scraplingConfigured());
    }
    // Koruma imzası yoksa tek bir UA-rotasyonlu deneme: bazı korumalar
    // yalnız UA tutarsızlığında 403 döner. `attempt` ile profil değişir.
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 700));
      return fetchWithStealth(url, attempt + 1, redirectCount, jar, warmed);
    }
  }

  if (!response.ok) {
    throw new Error(
      `Site ${response.status} ${response.statusText} döndürdü. Koruma imzası yok — URL'yi ve servisin erişimini kontrol edin.`
    );
  }
  const contentType = response.headers.get("content-type") || "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml") &&
    !contentType.includes("text/plain")
  ) {
    throw new Error(`Bu URL HTML değil (${contentType}). Ürün/kategori sayfası deneyin.`);
  }

  let html: string;
  try {
    html = await readResponseTextWithLimit(response, 3 * 1024 * 1024);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message.includes("sınırını");
    throw Object.assign(
      new Error(tooLarge ? "Sayfa çok büyük (>3 MB), taranamadı." : "Site yanıtı okunamadı."),
      { status: tooLarge ? 413 : 502 }
    );
  }
  if (html.length < 500) throw new Error("Sayfa boş veya erişim engellendi.");
  const challenge = detectBotChallenge(html);
  if (challenge) {
    const svc = await tryScraplingService(url);
    if (svc) throw Object.assign(new Error("__SCRAPLING_FALLBACK__"), { __fallback: svc });
    throw botBlockedError(challenge, scraplingConfigured());
  }
  return { html, finalUrl: url };
}

/**
 * Isınma turu: site köküne sessiz bir "hücre" isteği atıp `datadome` ve
 * çerezleri jar'a toplar. Gerçek tarayıcıda da kullanıcı önce siteye girer,
 * sonra ürüne tıklar — bu sıralama korumaların beklediği davranıştır.
 */
async function warmUpOrigin(origin: string, jar: CookieJar): Promise<void> {
  if (!origin || !origin.startsWith("http")) return;
  try {
    await fetchWithStealth(origin, 0, 0, jar, false);
  } catch {
    // Isınma başarısız olabilir; ana istek yine de denenir.
  }
}

// ---------------------------------------------------------------------------
// Ana giriş
// ---------------------------------------------------------------------------
export async function scrapeUrl(rawUrl: string): Promise<ScrapeResult> {
  // Hızlı sözdizimi/politika kontrolü burada; DNS ve redirect kontrolleri gerçek
  // outbound isteğin hemen öncesinde `fetchWithStealth` içinde tekrarlanır.
  try {
    validateOutboundUrlSyntax(rawUrl, { allowedHosts: crawlerAllowedHosts() });
  } catch (error) {
    throwOutboundPolicyError(error);
  }

  const sourceDomain = extractDomain(rawUrl);
  const normalized = normalizeUrl(rawUrl);

  let html: string;
  let finalUrl = normalized;
  const jar = new CookieJar();
  try {
    // Isınma: gerçek tarayıcı davranışını taklit et. Korumalar "siteye gir →
    // ürüne tıkla" sırasını bekler; çerezsiz tek seferlik istek şüphelidir.
    await warmUpOrigin(new URL(normalized).origin, jar);
    const res = await fetchWithStealth(normalized, 0, 0, jar, true);
    html = res.html;
    finalUrl = res.finalUrl;
  } catch (e: unknown) {
    const err = e as Error & { __fallback?: ScrapeResult };
    if (err.__fallback) return err.__fallback;
    throw e;
  }

  const warnings: string[] = [];
  let products: ScrapedItem[] = [];
  let isListingPage = false;

  if (sourceDomain.includes("vitaminshoppe")) {
    products = parseVitaminShoppe(html, finalUrl, sourceDomain);
    isListingPage = products.length > 3 || /\/c\//.test(normalized) || /category/i.test(html.slice(0, 5000));
  }
  if (!products.length) products = parseGeneric(html, finalUrl, sourceDomain);

  // Güvenilirlik süzgeci: SPA iskeleti, splash screen ve hata sayfalarından
  // gelen sahte "ürünleri" ele. Sessizce yanlış veri, hiç veri üretmemekten
  // daha kötüdür — kullanıcı bunu gerçek ürün sanıp satın alma kararına
  // dönüştürebilir.
  const beforeFilter = products.length;
  products = products.filter(isPlausibleProduct);
  if (beforeFilter > 0 && products.length === 0) {
    warnings.push(
      "Sayfa yüklendi ama ürün verisi çıkarılamadı. Site muhtemelen JavaScript ile veri çekiyor veya henüz koruma/ölçüm katmanının arkasında — Scrapling servisini kullanın."
    );
  } else if (beforeFilter !== products.length) {
    warnings.push(
      `${beforeFilter - products.length} kayıt ürün olarak doğrulanamadı ve elendi (sayfa iskeleti, splash screen veya hata sayfası).`
    );
  }

  if (!products.length) {
    // Son çare: ham link toplama — Scrapling'in adaptif yaklaşımı gibi, yapı yoksa linklerden üret
    const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1];
      if (!href.includes("/p/") && !href.includes("/product") && !href.includes("/dp/")) continue;
      let full: string;
      try {
        full = new URL(href, finalUrl).toString();
      } catch {
        continue;
      }
      if (seen.has(full)) continue;
      seen.add(full);
      if (products.length >= 10) break;
      products.push({
        sourceUrl: full,
        sourceDomain,
        title: `Keşfedilen Ürün ${products.length + 1}`,
        brand: sourceDomain.split(".")[0].toUpperCase(),
        price: null,
        listPrice: null,
        currency: "USD",
        imageUrl: null,
        availability: "UNKNOWN",
        asinCandidate: extractAsinCandidate(full),
        sourceSku: null,
        gtin: null,
        mpn: null,
        isDiscounted: false,
        discountPct: null,
      });
    }
    if (products.length) warnings.push("Yapılandırılmış ürün verisi çıkarılamadı, ham linkler toplandı. Tek ürün sayfası daha isabetlidir.");
  }

  if (!products.length) {
    // son bir şans: Scrapling servisi varsa tekrar dene
    const svc = await tryScraplingService(rawUrl);
    if (svc) return svc;
    throw new Error("Bu sayfadan ürün bilgisi çıkarılamadı. Tek ürün sayfasını (örn. /p/...) deneyin veya sayfanın herkese açık olduğunu kontrol edin.");
  }

  const withoutPrice = products.filter((p) => p.price === null).length;
  if (withoutPrice) warnings.push(`${withoutPrice} üründe fiyat bulunamadı; ürün sayfasından tekrar tarayın.`);

  // ASIN uyarısı: perakende sitesinden ASIN çıkmaz. Kullanıcının iş akışı
  // (SKU → Amazon → ASIN) GTIN üzerinden yürüdüğü için eksikliği adıyla söyle.
  const withGtin = products.filter((p) => p.gtin).length;
  if (withGtin === 0) {
    warnings.push(
      "Hiçbir üründe GTIN/UPC bulunamadı. Amazon'daki karşılığı bulmak için ürün SAYFASINI (kategori listesi değil) tarayın — GTIN JSON-LD'de ürün sayfasında bulunur."
    );
  } else if (withGtin < products.length) {
    warnings.push(`${products.length - withGtin} üründe GTIN yok; bu satırlar Amazon eşleştirmesinde atlanacak.`);
  }

  const discounted = products.filter((p) => p.isDiscounted);
  if (discounted.length) {
    warnings.push(`${discounted.length} ürün liste fiyatının altında — indirim fırsatı.`);
  }

  const withoutAsin = products.filter((p) => !p.asinCandidate).length;
  if (withoutAsin === products.length) {
    warnings.push(
      "Bu bir perakende sitesi; Amazon ASIN'i buradan gelmez. Ürünleri içe aktardıktan sonra GTIN/SKU ile Amazon kataloğunda eşleştirin."
    );
  }

  const cleaned = products.slice(0, 30).map((p) => ({ ...p, title: p.title.slice(0, 300), brand: p.brand.slice(0, 80) }));

  return {
    sourceUrl: normalized,
    sourceDomain,
    products: cleaned,
    warnings,
    fetchedAt: new Date().toISOString(),
    isListingPage,
    engine: "js-stealth",
    blockedBy: null,
  };
}
