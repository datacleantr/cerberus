import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amazonUrlFor,
  findAmazonProductByGtin,
  resolveAmazonProduct,
  type ProductLookupHints,
} from "./client";

/**
 * Kullanıcının akışı: perakende sitesinde ürünü bul → GTIN/SKU al → Amazon'daki
 * karşılığını bul → ASIN + linki kaydet.
 *
 * Keepa bu haliyle YALNIZ ASIN kabul ediyordu; ara halka eksikti.
 *
 * EN KRİTİK KURAL: yanlış ürüne eşleşmek, ürün bulamamaktan KÖTÜDÜR.
 * Birincisi sessizce yanlış mal satma riski doğurur, ikincisi sadece eksik
 * sonuçtur. Bu yüzden düşük benzerlikte eşleşme YAPILMAZ.
 */

const fetchMock = vi.fn();

function keepaResponse(products: Record<string, unknown>[]) {
  return new Response(JSON.stringify({ products }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.KEEPA_API_KEY = "test-key-32-characters-long-enough!!";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("amazonUrlFor", () => {
  it("farklı marketplace alan adlarını doğru kurar", () => {
    expect(amazonUrlFor("B0032BH76O", 1)).toBe("https://www.amazon.com/dp/B0032BH76O");
    expect(amazonUrlFor("B0032BH76O", 2)).toBe("https://www.amazon.co.uk/dp/B0032BH76O");
    expect(amazonUrlFor("B0032BH76O", 14)).toBe("https://www.amazon.com.tr/dp/B0032BH76O");
  });

  it("bilinmeyen domain'de amazon.com'a düşer", () => {
    expect(amazonUrlFor("B0032BH76O", 999)).toBe("https://www.amazon.com/dp/B0032BH76O");
  });
});

describe("findAmazonProductByGtin", () => {
  it("GTIN ile birebir eşleşen ürünü döner", async () => {
    fetchMock.mockResolvedValueOnce(
      keepaResponse([{ asin: "B0032BH76O", title: "NOW Foods Vitamin D-3", brand: "NOW" }])
    );

    const match = await findAmazonProductByGtin("0036000291452");
    expect(match?.asin).toBe("B0032BH76O");
    expect(match?.confidence).toBe("exact");
    expect(match?.amazonUrl).toBe("https://www.amazon.com/dp/B0032BH76O");
    // Gerçek Keepa çağrısı `code=` parametresini kullanmalı — `asin=` değil.
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("code=0036000291452");
  });

  it("sonuç yoksa null döner", async () => {
    fetchMock.mockResolvedValueOnce(keepaResponse([]));
    expect(await findAmazonProductByGtin("0036000291452")).toBeNull();
  });

  it("Keepa alakasız ürün dönerse ASIN biçimsizse reddeder", async () => {
    // Keepa bazen eşleşme bulamayınca ilgisiz sonuç listeler. Sessizce yanlış
    // ürünü kabul etmektense eşleşmesiz dönmeli.
    fetchMock.mockResolvedValueOnce(keepaResponse([{ asin: "", title: "irtree Jewelry Display" }]));
    expect(await findAmazonProductByGtin("0036000291452")).toBeNull();
  });

  it("geçersiz GTIN uzunluğunda API'yi hiç çağırmaz", async () => {
    expect(await findAmazonProductByGtin("123")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveAmazonProduct", () => {
  const hints: ProductLookupHints = {
    gtin: "0036000291452",
    brand: "NOW Foods",
    title: "NOW Foods Vitamin D-3 5,000 IU High Potency 240 Softgels",
    sourceSku: "NF_0373",
  };

  it("GTIN varsa arama yapmadan doğrudan çözer", async () => {
    fetchMock.mockResolvedValueOnce(keepaResponse([{ asin: "B0032BH76O", title: "NOW Vitamin D-3" }]));

    const match = await resolveAmazonProduct(hints);
    expect(match?.asin).toBe("B0032BH76O");
    expect(match?.confidence).toBe("exact");
    // Tek çağrı: GTIN yetmişti, pahalı arama yapılmamalı.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GTIN bulunamazsa MPN/SKU eşleşmesine düşer", async () => {
    fetchMock
      .mockResolvedValueOnce(keepaResponse([])) // GTIN → boş
      .mockResolvedValueOnce(
        keepaResponse([
          { asin: "B0OTHER123", title: "Vitamin D-3", brand: "NOW", partNumber: "NF_0373" },
        ])
      );

    const match = await resolveAmazonProduct(hints);
    expect(match?.asin).toBe("B0OTHER123");
    expect(match?.confidence).toBe("high");
    expect(match?.reason).toContain("MPN/SKU");
  });

  it("marka tutmuyorsa MPN eşleşmesini kabul etmez", async () => {
    fetchMock
      .mockResolvedValueOnce(keepaResponse([]))
      .mockResolvedValueOnce(
        keepaResponse([{ asin: "B0WRONG123", title: "Vitamin D-3", brand: "Nature Made", partNumber: "NF_0373" }])
      )
      .mockResolvedValueOnce(keepaResponse([]));

    // Aynı parça numarası farklı markada → eşleşme sayılmaz.
    expect(await resolveAmazonProduct(hints)).toBeNull();
  });

  it("benzerlik çok düşükse ürün bulamaz — yanlış eşleşme yapmaz", async () => {
    fetchMock
      .mockResolvedValueOnce(keepaResponse([]))
      .mockResolvedValueOnce(keepaResponse([]))
      .mockResolvedValueOnce(
        keepaResponse([{ asin: "B0UNREL01", title: "Yoga Mat Pro Extra Thick Non Slip", brand: "Gaiam" }])
      );

    // Alakasız ürün: eşleştirme yapmamak, yanlış ürün almaktan iyidir.
    expect(await resolveAmazonProduct(hints)).toBeNull();
  });

  it("başlık ve marka tutuyorsa gerekçe döner", async () => {
    fetchMock
      .mockResolvedValueOnce(keepaResponse([]))
      .mockResolvedValueOnce(keepaResponse([]))
      .mockResolvedValueOnce(
        keepaResponse([
          {
            asin: "B0032BH76O",
            title: "NOW Foods Vitamin D-3 5,000 IU High Potency 240 Softgels",
            brand: "NOW Foods",
          },
        ])
      );

    const match = await resolveAmazonProduct(hints);
    expect(match?.asin).toBe("B0032BH76O");
    expect(match?.reason).toContain("marka eşleşti");
  });

  it("GTIN ve SKU yoksa doğrudan aramaya geçer", async () => {
    // SKU yoksa MPN adımı hiç çalışmaz (pahalı arama israfi olur) — tek çağrı.
    fetchMock.mockResolvedValueOnce(
      keepaResponse([{ asin: "B0032BH76O", title: "NOW Foods Vitamin D-3 5,000 IU 240 Softgels", brand: "NOW" }])
    );

    const match = await resolveAmazonProduct({ brand: "NOW", title: "NOW Foods Vitamin D-3 5,000 IU 240 Softgels" });
    expect(match?.asin).toBe("B0032BH76O");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("başlık yoksa hiçbir şey denemez", async () => {
    expect(await resolveAmazonProduct({ gtin: null, brand: "NOW" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Keepa hata verirse sessizce null döner, patlamaz", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await resolveAmazonProduct(hints)).toBeNull();
  });
});
