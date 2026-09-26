import { afterEach, describe, expect, it } from "vitest";
import { scrapeUrl } from "./scraper";

/**
 * Bu dosya iki regresyonu kilitler:
 *
 * 1. SAHTE ASIN — eski `extractAsinCandidate` /p/<slug> değerini ASIN sayıyordu.
 *    "omega-3-fish-oil" → "OMEGA3FIS" gibi 10 karakterlik slug'lar
 *    /^[A-Z0-9]{10}$/ kontrolünden geçip `products.asin` olarak yazılıyordu.
 *    Kullanıcının iş akışı SKU→Amazon→ASIN olduğu için bu yanlış eşleşme
 *    doğrudan yanlış ürün satın alma riski demektir.
 *
 * 2. KORUMA TESPİTİ — eski `looksLikeBotChallenge` yalnız Cloudflare kalıplarına
 *    bakıyordu. VitaminShoppe DataDome kullanıyor ve 403 + `captcha-delivery.com`
 *    gövdesi döndürüyor; eski kod bu sayfayı "bot koruması" olarak tanımadan
 *    kullanıcıya "URL'yi kontrol edin" diyordu.
 */

const VITAMINSHOPPE_BLOCK_PAGE = `<html lang="en"><head><title>vitaminshoppe.com</title></head><body><p id="cmsg">Please enable JS and disable any ad blocker</p><script>var dd={'rt':'c','host':'geo.captcha-delivery.com'}</script><script src="https://ct.captcha-delivery.com/c.js"></script></body></html>`;

function makeResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    statusText: status === 403 ? "Forbidden" : "OK",
    headers: { "content-type": "text/html;charset=utf-8", ...headers },
  });
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Scraper 500 byte altı yanıtları "boş sayfa" sayar; fixture'ları doldurur. */
function pad(html: string): string {
  return html + "<!-- " + "x".repeat(600) + " -->";
}

describe("crawler bot koruması tespiti", () => {
  it("DataDome 403 gövdesini bot koruması olarak tanır ve dürüst mesaj verir", async () => {
    globalThis.fetch = (async () => makeResponse(403, VITAMINSHOPPE_BLOCK_PAGE, { server: "DataDome" })) as typeof fetch;

    // DNS guard'ı aşmak için izolasyon: gerçek ağa çıkmasın.
    const error = await scrapeUrl("https://www.vitaminshoppe.com/").catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { blockedBy?: string }).blockedBy).toBe("datadome");
    // Eski mesaj: "Site hatası 403 Forbidden. URL'yi kontrol edin."
    // Bu mesaj kullanıcıyı yanlış yere yönlendiriyordu.
    expect((error as Error).message).not.toContain("URL'yi kontrol edin");
    expect((error as Error).message).toContain("URL geçerli");
    expect((error as Error).message).toContain("DataDome");
  });

  it("korumayı tanıyınca URL'yi suçlamayan, çözümü söyleyen mesaj verir", async () => {
    globalThis.fetch = (async () => makeResponse(403, VITAMINSHOPPE_BLOCK_PAGE)) as typeof fetch;

    const error = (await scrapeUrl("https://www.vitaminshoppe.com/").catch((e: Error) => e)) as Error;
    // Scrapling env boş olduğu için çözüm olarak servis kurulumunu önermeli.
    expect(error.message).toContain("SCRAPLING_SERVICE_URL");
  });
});

describe("ASIN tespiti — sahte ASIN regresyonu", () => {
  it("perakende slug'ını ASIN saymaz", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Omega 3 Fish Oil 1000mg",
      brand: { name: "Now Foods" },
      sku: "VS-48210",
      gtin13: "0036000291452",
      offers: { "@type": "Offer", price: "12.99", priceCurrency: "USD", availability: "https://schema.org/InStock" },
    })}</script></head><body>x</body></html>`;

    globalThis.fetch = (async () => makeResponse(200, pad(html))) as typeof fetch;

    const result = await scrapeUrl("https://www.vitaminshoppe.com/p/omega-3-fish-oil-1000mg");
    const product = result.products[0];

    // Eski davranış: "OMEGA3FIS" — 10 karakter, geçerli görünüyor, sahte.
    expect(product.asinCandidate).toBeNull();
    // Perakende kodu ayrı alanda kalmalı.
    expect(product.sourceSku).toBe("VS-48210");
    // GTIN yakalanmalı — bu, Amazon eşleştirmenin gerçek anahtarı.
    expect(product.gtin).toBe("0036000291452");
    expect(result.sourceDomain).toBe("vitaminshoppe.com");
  });

  it("gerçek Amazon ASIN'ini kabul eder", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Omega 3 Fish Oil",
      offers: { "@type": "Offer", price: "19.99", priceCurrency: "USD" },
    })}</script></head><body>x</body></html>`;

    globalThis.fetch = (async () => makeResponse(200, pad(html))) as typeof fetch;

    const result = await scrapeUrl("https://www.amazon.com/dp/B001KV5F1O");
    expect(result.products[0].asinCandidate).toBe("B001KV5F1O");
  });
});

describe("indirim tespiti", () => {
  it("liste fiyatı biliniyorsa indirimi raporlar", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Vitamin D3 5000 IU",
      gtin13: "0036000291452",
      offers: { "@type": "Offer", lowPrice: "8.99", highPrice: "17.99", priceCurrency: "USD" },
    })}</script></head><body>x</body></html>`;

    globalThis.fetch = (async () => makeResponse(200, pad(html))) as typeof fetch;

    const result = await scrapeUrl("https://www.vitaminshoppe.com/p/vitamin-d3-5000iu");
    const product = result.products[0];

    expect(product.price).toBe(8.99);
    expect(product.listPrice).toBe(17.99);
    expect(product.isDiscounted).toBe(true);
    expect(product.discountPct).toBe(50);
    expect(result.warnings.some((w) => w.includes("indirim"))).toBe(true);
  });

  it("indirim yoksa false döner", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Creatine Monohydrate",
      gtin13: "0036000291452",
      offers: { "@type": "Offer", price: "24.99", priceCurrency: "USD" },
    })}</script></head><body>x</body></html>`;

    globalThis.fetch = (async () => makeResponse(200, pad(html))) as typeof fetch;

    const result = await scrapeUrl("https://www.vitaminshoppe.com/p/creatine-monohydrate");
    expect(result.products[0].isDiscounted).toBe(false);
    expect(result.products[0].discountPct).toBeNull();
  });
});
