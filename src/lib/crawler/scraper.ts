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
  currency: string;
  imageUrl: string | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  asinCandidate: string | null;
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
// Stealth katmanı — Scrapling StealthyFetcher ilhamlı
// ---------------------------------------------------------------------------
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
];
function pickUA(seed?: string): string {
  if (!seed) return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return UA_POOL[h % UA_POOL.length];
}

function stealthHeaders(targetUrl: string): Record<string, string> {
  const ua = pickUA(targetUrl);
  const isChrome = ua.includes("Chrome");
  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,tr;q=0.6",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: new URL(targetUrl).origin + "/",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
  };
  if (isChrome) {
    headers["Sec-Ch-Ua"] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = '"Windows"';
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-User"] = "?1";
    headers["Sec-Fetch-Dest"] = "document";
  }
  return headers;
}

function looksLikeBotChallenge(html: string): boolean {
  const s = html.slice(0, 8000).toLowerCase();
  return (
    s.includes("cf-challenge") ||
    s.includes("turnstile") ||
    s.includes("checking if the site connection is secure") ||
    s.includes("attention required") ||
    s.includes("please enable cookies") ||
    s.includes("ddos protection by cloudflare") ||
    s.includes("access denied") && s.includes("cloudflare")
  );
}

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

function parseVitaminShoppe(html: string, baseUrl: string, domain: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const ld = extractJsonLdProducts(html);
  for (const p of ld) {
    if (p["@type"] === "Product") {
      const name = (p.name as string) || "";
      if (!name) continue;
      const brandRaw = p.brand;
      const brand = typeof brandRaw === "string" ? brandRaw : ((brandRaw as Record<string, unknown>)?.name as string) || "THE VITAMINSHOPPE";
      const offers = p.offers as Record<string, unknown> | undefined;
      let price: number | null = null;
      let currency = "USD";
      let availability: ScrapedItem["availability"] = "UNKNOWN";
      let image: string | null = null;
      if (offers) {
        const po = offers.price as string | number | undefined;
        if (po !== undefined) price = Number(String(po).replace(/,/g, ""));
        currency = (offers.priceCurrency as string) || "USD";
        const av = String(offers.availability || "").toLowerCase();
        if (av.includes("instock")) availability = "IN_STOCK";
        else if (av.includes("outofstock")) availability = "OUT_OF_STOCK";
      }
      const imgRaw = p.image;
      if (typeof imgRaw === "string") image = imgRaw;
      else if (Array.isArray(imgRaw) && imgRaw[0]) image = String(imgRaw[0]);
      let productUrl = (p.url as string) || baseUrl;
      try {
        productUrl = new URL(productUrl, baseUrl).toString();
      } catch {
        productUrl = baseUrl;
      }
      items.push({
        sourceUrl: productUrl,
        sourceDomain: domain,
        title: decodeHtml(String(name).trim()),
        brand: decodeHtml(String(brand).trim()) || "THE VITAMINSHOPPE",
        price: price !== null && Number.isFinite(price) ? price : null,
        currency,
        imageUrl: image,
        availability,
        asinCandidate: extractAsinCandidate(productUrl, html),
      });
    }
  }
  if (items.length) return items;

  const ogTitle = extractMetaContent(html, "og:title");
  const ogImage = extractMetaContent(html, "og:image");
  const priceText = html.match(/["']price["']\s*:\s*["']?\$?([\d.,]+)["']?/i)?.[1] || html.match(/class="[^"]*price[^"]*"[^>]*>\s*\$([\d.,]+)/i)?.[1];
  if (ogTitle && priceText) {
    const price = Number(priceText.replace(/,/g, ""));
    items.push({
      sourceUrl: normalizeUrl(baseUrl),
      sourceDomain: domain,
      title: ogTitle,
      brand: extractMetaContent(html, "og:brand") || html.match(/"brand"\s*:\s*"([^"]+)"/i)?.[1] || "THE VITAMINSHOPPE",
      price: Number.isFinite(price) ? price : null,
      currency: "USD",
      imageUrl: ogImage,
      availability: /out of stock/i.test(html) ? "OUT_OF_STOCK" : /in stock/i.test(html) ? "IN_STOCK" : "UNKNOWN",
      asinCandidate: extractAsinCandidate(baseUrl, html),
    });
    if (items.length) return items;
  }

  const tileRe = /<a[^>]+href=["']([^"']*\/p\/[^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tileRe.exec(html)) !== null) {
    const href = m[1];
    if (seen.has(href)) continue;
    seen.add(href);
    let full = href;
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
      title,
      brand: "THE VITAMINSHOPPE",
      price: null,
      currency: "USD",
      imageUrl: null,
      availability: "UNKNOWN",
      asinCandidate: extractAsinCandidate(full, html),
    });
  }
  return items;
}

function extractAsinCandidate(url: string, html: string): string | null {
  const m = url.match(/\/p\/([^/?#]+)/i);
  if (m) return m[1].slice(0, 32).toUpperCase();
  const m2 = url.match(/\b(B0[A-Z0-9]{8})\b/i);
  if (m2) return m2[1].toUpperCase();
  const m3 = html.match(/\b(VS-\d+|VS\d+)\b/i);
  if (m3) return m3[1].toUpperCase();
  return null;
}

function parseGeneric(html: string, baseUrl: string, domain: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const ld = extractJsonLdProducts(html);
  for (const p of ld) {
    if (p["@type"] === "Product") {
      const name = String(p.name || p.title || "").trim();
      if (!name) continue;
      const brandRaw = p.brand;
      const brand = typeof brandRaw === "string" ? brandRaw : ((brandRaw as Record<string, unknown>)?.name as string) || domain.split(".")[0].toUpperCase();
      const offers = p.offers as Record<string, unknown> | undefined;
      let price: number | null = null;
      let currency = "USD";
      let availability: ScrapedItem["availability"] = "UNKNOWN";
      let image: string | null = null;
      if (offers) {
        const po = offers.price as string | number | undefined;
        if (po !== undefined) price = Number(String(po).replace(/,/g, ""));
        currency = (offers.priceCurrency as string) || "USD";
        const av = String(offers.availability || "").toLowerCase();
        if (av.includes("instock")) availability = "IN_STOCK";
        else if (av.includes("outofstock")) availability = "OUT_OF_STOCK";
      }
      const imgRaw = p.image;
      if (typeof imgRaw === "string") image = imgRaw;
      else if (Array.isArray(imgRaw) && imgRaw[0]) image = String(imgRaw[0]);
      let productUrl = (p.url as string) || baseUrl;
      try {
        productUrl = new URL(productUrl, baseUrl).toString();
      } catch {
        productUrl = baseUrl;
      }
      items.push({
        sourceUrl: productUrl,
        sourceDomain: domain,
        title: decodeHtml(name),
        brand: decodeHtml(String(brand)),
        price: price !== null && Number.isFinite(price) ? price : null,
        currency,
        imageUrl: image,
        availability,
        asinCandidate: extractAsinCandidate(productUrl, html),
      });
    }
    if (p["@type"] === "ItemList" && Array.isArray(p.itemListElement)) {
      for (const el of p.itemListElement as unknown[]) {
        const e = el as Record<string, unknown>;
        const item = (e.item as Record<string, unknown>) || e;
        if (item["@type"] === "Product" && item.name) {
          items.push({
            sourceUrl: baseUrl,
            sourceDomain: domain,
            title: decodeHtml(String(item.name)),
            brand: String(((item.brand as Record<string, unknown>)?.name as string) || domain.split(".")[0].toUpperCase()),
            price: null,
            currency: "USD",
            imageUrl: (item.image as string) || null,
            availability: "UNKNOWN",
            asinCandidate: null,
          });
        }
      }
    }
  }
  if (items.length) return items;

  const ogTitle = extractMetaContent(html, "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  if (ogTitle) {
    const ogImage = extractMetaContent(html, "og:image");
    const ogPrice = extractMetaContent(html, "product:price:amount") || extractMetaContent(html, "og:price:amount") || html.match(/["']price["']\s*:\s*["']?\$?([\d.,]+)/i)?.[1];
    const price = ogPrice ? Number(String(ogPrice).replace(/,/g, "").replace("$", "")) : null;
    const cleaned = decodeHtml(ogTitle.trim());
    if (cleaned && cleaned.length > 5) {
      items.push({
        sourceUrl: normalizeUrl(baseUrl),
        sourceDomain: domain,
        title: cleaned,
        brand: extractMetaContent(html, "product:brand") || extractMetaContent(html, "og:brand") || domain.split(".")[0].toUpperCase(),
        price: price !== null && Number.isFinite(price) ? price : null,
        currency: extractMetaContent(html, "product:price:currency") || "USD",
        imageUrl: ogImage,
        availability: /out of stock/i.test(html) ? "OUT_OF_STOCK" : /in stock/i.test(html) ? "IN_STOCK" : "UNKNOWN",
        asinCandidate: extractAsinCandidate(baseUrl, html),
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
    return { ...j, engine: "scrapling-service" };
  } catch {
    return null;
  }
}

function crawlerAllowedHosts(): string[] | undefined {
  const configured = process.env.CRAWLER_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return configured?.length ? configured : undefined;
}

async function fetchWithStealth(
  rawUrl: string,
  attempt = 0,
  redirectCount = 0
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
      headers: stealthHeaders(url),
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted") || msg.includes("AbortError")) {
      throw new Error("Site 15 saniyede yanıt vermedi (timeout).");
    }
    throw new Error(`Ağ hatası: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= 3) throw new Error("Site çok fazla yönlendirme döndürdü.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Site geçersiz bir yönlendirme döndürdü.");
    const redirected = new URL(location, url).toString();
    return fetchWithStealth(redirected, attempt, redirectCount + 1);
  }

  // 403/429 → Scrapling service veya UA rotasyonu ile retry
  if ((response.status === 403 || response.status === 429) && attempt < 1) {
    const svc = await tryScraplingService(url);
    if (svc) throw Object.assign(new Error("__SCRAPLING_FALLBACK__"), { __fallback: svc });
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 700));
    return fetchWithStealth(url, attempt + 1, redirectCount);
  }

  if (!response.ok) {
    throw new Error(`Site hatası ${response.status} ${response.statusText}. URL'yi kontrol edin.`);
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
  if (looksLikeBotChallenge(html)) {
    const svc = await tryScraplingService(url);
    if (svc) throw Object.assign(new Error("__SCRAPLING_FALLBACK__"), { __fallback: svc });
    throw new Error("Site bot korumasını tetikledi (Cloudflare/Turnstile). Tek ürün sayfasını deneyin veya SCRAPLING_SERVICE_URL yapılandırın — ayrıntılar docs/CRAWLER.md.");
  }
  return { html, finalUrl: url };
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

  // önce Python servisi denenebilir (opsiyonel, env varsa) — JS fallback her zaman var
  let html: string;
  let finalUrl = normalized;
  try {
    const res = await fetchWithStealth(normalized);
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
        currency: "USD",
        imageUrl: null,
        availability: "UNKNOWN",
        asinCandidate: extractAsinCandidate(full, html),
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

  const cleaned = products.slice(0, 30).map((p) => ({ ...p, title: p.title.slice(0, 300), brand: p.brand.slice(0, 80) }));

  return { sourceUrl: normalized, sourceDomain, products: cleaned, warnings, fetchedAt: new Date().toISOString(), isListingPage, engine: "js-stealth" };
}
