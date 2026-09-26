import { describe, expect, it } from "vitest";
import { isValidGtin } from "./scraper";

/**
 * GTIN kontrol hanesi. Yanlış bir UPC/EAN kabul edilirse, ürün Amazon'daki
 * GERÇEK karşılığı yerine başka bir ürüne eşlenir — sessiz ve pahalı bir hata.
 * Bu yüzden geçerli/geçersiz ayrımının kesin testi şart.
 */
describe("isValidGtin", () => {
  it("geçerli GTIN-12 (UPC-A) kabul eder", () => {
    expect(isValidGtin("036000291452")).toBe(true);
  });

  it("geçerli GTIN-13 (sıfır dolgulu UPC) kabul eder", () => {
    expect(isValidGtin("0036000291452")).toBe(true);
  });

  it("geçerli GTIN-14 (GS1 ambalaj) kabul eder", () => {
    expect(isValidGtin("00360002914522")).toBe(true);
  });

  it("geçerli GTIN-8 kabul eder", () => {
    expect(isValidGtin("96385074")).toBe(true);
  });

  it("kontrol hanesi bozuksa reddeder", () => {
    expect(isValidGtin("036000291453")).toBe(false);
    // Son hane değişince aynı gövde geçersizleşmeli.
    expect(isValidGtin("0036000291453")).toBe(false);
  });

  it("uzunluk dışı değerleri reddeder", () => {
    expect(isValidGtin("123")).toBe(false);
    expect(isValidGtin("123456789012345")).toBe(false);
    expect(isValidGtin("")).toBe(false);
    expect(isValidGtin("abc")).toBe(false);
  });

  it("boşluk ve tire toleransı", () => {
    expect(isValidGtin("0-36000 29145-2")).toBe(true);
  });
});
