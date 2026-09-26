/**
 * Kolon eşleme (column mapping) motorunun testleri — kullanıcı isteği:
 * "bazı xls yada drive'larda farklı olabilir, kolonları eşleştirme
 * yaparak atmamızı sağlayalım ve tip kontrolü yaparak yanlışları
 * giderelim."
 *
 * Üç şeyi doğrular: (1) kilitli 40-kolon formatı için otomatik eşleme
 * pozisyonel eski davranışla BİREBİR aynı sonucu üretir (geriye dönük
 * uyumluluk), (2) kolonları KARIŞTIRILMIŞ/yeniden ADLANDIRILMIŞ bir
 * dosya artık doğru eşlenir (asıl istenen özellik), (3) tip tespiti/
 * uyumluluk kontrolü beklendiği gibi çalışır.
 */
import { describe, expect, it } from "vitest";
import { XLS_40_COLUMNS } from "@/features/orders/ordersCsv";
import {
  guessColumnMapping,
  buildRowFromMapping,
  buildRowsFromMapping,
  parseXlsMatrixRow,
  parseXlsMatrix,
} from "./xlsRowMapping";
import {
  detectColumnSampleType,
  isColumnTypeCompatible,
  normalizeHeaderLabel,
  IMPORT_FIELDS,
} from "./importFieldSchema";

const DEFAULTS = { defaultStore: "HRN", defaultProductTitle: "Ürün" };

function standardRow(): unknown[] {
  const cols = new Array(40).fill("");
  cols[0] = "HRN";
  cols[4] = "Test Ürün";
  cols[5] = "B085542GWZ";
  cols[11] = "WO12345";
  cols[13] = 1;
  cols[14] = 3;
  cols[15] = 10;
  cols[16] = 20;
  cols[17] = 30;
  cols[31] = "YES";
  cols[32] = 2;
  return cols;
}

describe("normalizeHeaderLabel", () => {
  it("Türkçe karakterleri ve büyük/küçük harf farkını yok sayar", () => {
    expect(normalizeHeaderLabel("Satın Alan")).toBe(normalizeHeaderLabel("SATIN ALAN"));
    expect(normalizeHeaderLabel("Ürün adedi")).toBe(normalizeHeaderLabel("ürün  ADEDİ "));
  });
});

describe("guessColumnMapping — kilitli 40-kolon format", () => {
  it("kanonik başlıklarla tam sırayla eşleşir (pozisyonel ile aynı sonuç)", () => {
    const mapping = guessColumnMapping([...XLS_40_COLUMNS]);
    IMPORT_FIELDS.forEach((field, idx) => {
      expect(mapping[idx]).toBe(field.key);
    });
  });

  it("otomatik eşleme + buildRowFromMapping, pozisyonel parseXlsMatrixRow ile aynı satırı üretir", () => {
    const cols = standardRow();
    const mapping = guessColumnMapping([...XLS_40_COLUMNS]);
    const mapped = buildRowFromMapping(cols, mapping, DEFAULTS);
    const legacy = parseXlsMatrixRow(cols, DEFAULTS);
    expect(mapped).toEqual(legacy);
  });
});

describe("guessColumnMapping — farklı sıra/başlıklı dosya", () => {
  it("kolonları karıştırılmış bir başlık satırını doğru alanlara eşler", () => {
    // Gerçek dünya senaryosu: ASIN ve Adet yer değiştirmiş, başlıklar İngilizce/kısaltma.
    const shuffledHeaders = [
      "Store",           // buyerStore
      "Order Date",      // orderDate
      "ASIN",            // asin  (pozisyonu değişti — eskiden index 5'teydi)
      "Qty",             // quantity
      "Product Title",   // productTitle
      "Order No",        // orderNumber
      "Unit Cost",       // unitCost
      "Selling Price",   // sellingPrice
    ];
    const mapping = guessColumnMapping(shuffledHeaders);
    expect(mapping[0]).toBe("buyerStore");
    expect(mapping[1]).toBe("orderDate");
    expect(mapping[2]).toBe("asin");
    expect(mapping[3]).toBe("quantity");
    expect(mapping[4]).toBe("productTitle");
    expect(mapping[5]).toBe("orderNumber");
    expect(mapping[6]).toBe("unitCost");
    expect(mapping[7]).toBe("sellingPrice");
  });

  it("bilinmeyen/anlamsız bir başlık hiçbir alana eşlenmez (yoksayılır)", () => {
    const mapping = guessColumnMapping(["Store", "Tamamen Alakasız Bir Kolon Başlığı 123"]);
    expect(mapping[0]).toBe("buyerStore");
    expect(mapping[1]).toBeUndefined();
  });

  it("iki farklı kolon aynı alana çakışmaz — ilk eşleşen kazanır, ikinci eşlenmeden kalır", () => {
    const mapping = guessColumnMapping(["ASIN", "Asin (tekrar)"]);
    expect(mapping[0]).toBe("asin");
    expect(mapping[1]).toBeUndefined();
  });

  it("buildRowsFromMapping farklı kolon sırasıyla da doğru satır üretir", () => {
    const headers = ["ASIN", "Qty", "Order No", "Product Title", "Store"];
    const dataRow = ["B0TESTASIN1", 7, "PO-9999", "Karışık Sıra Ürünü", "SEL"];
    const mapping = guessColumnMapping(headers);
    const rows = buildRowsFromMapping([headers, dataRow], mapping, DEFAULTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].asin).toBe("B0TESTASIN1");
    expect(rows[0].quantity).toBe(7);
    expect(rows[0].orderNumber).toBe("PO-9999");
    expect(rows[0].productTitle).toBe("Karışık Sıra Ürünü");
    expect(rows[0].buyerStore).toBe("SEL");
  });
});

describe("buildRowFromMapping — eşlenmemiş/eksik kolonlarda varsayılanlar", () => {
  it("eşlenmemiş bir alan için doğru statik varsayılanı kullanır", () => {
    const mapping = { 0: "asin", 1: "orderNumber" }; // yalnızca 2 alan eşli
    const row = buildRowFromMapping(["B0X", "WO-1"], mapping, DEFAULTS);
    expect(row).not.toBeNull();
    expect(row!.supplierName).toBe("THE VITAMINSHOPPE");
    expect(row!.fulfillmentType).toBe("FBA");
    expect(row!.packCount).toBe(1);
    expect(row!.countPerBundle).toBeNull();
  });

  it("correctedCost boşsa totalCost'a düşer (eşlemede de aynı davranış)", () => {
    const mapping = { 0: "asin", 1: "orderNumber", 2: "totalCost" };
    const row = buildRowFromMapping(["B0X", "WO-1", "45.50"], mapping, DEFAULTS);
    expect(row!.correctedCost).toBe("45.50");
  });

  it("productTitle ve orderNumber ikisi de boşsa null döner (anlamsız satır)", () => {
    const mapping = { 0: "asin" };
    const row = buildRowFromMapping(["B0X"], mapping, DEFAULTS);
    expect(row).toBeNull();
  });
});

describe("detectColumnSampleType / isColumnTypeCompatible — tip kontrolü", () => {
  it("sayısal kolonu 'number' olarak tespit eder", () => {
    expect(detectColumnSampleType([10, 20, "30", "40,5"])).toBe("number");
  });
  it("tarih kolonunu 'date' olarak tespit eder", () => {
    expect(detectColumnSampleType(["2026-01-21", "2026-02-01", new Date()])).toBe("date");
  });
  it("metin kolonunu 'text' olarak tespit eder", () => {
    expect(detectColumnSampleType(["MegaFood One Daily", "Nature Made Vitamin D3"])).toBe("text");
  });
  it("tamamı boş kolonu 'empty' olarak tespit eder", () => {
    expect(detectColumnSampleType(["", "", null, undefined])).toBe("empty");
  });

  it("para/sayı alanına metin kolon eşlenirse UYUMSUZ işaretler", () => {
    expect(isColumnTypeCompatible("money", "text")).toBe(false);
    expect(isColumnTypeCompatible("count", "text")).toBe(false);
  });
  it("para/sayı alanına sayısal kolon eşlenirse UYUMLU işaretler", () => {
    expect(isColumnTypeCompatible("money", "number")).toBe(true);
    expect(isColumnTypeCompatible("count", "number")).toBe(true);
  });
  it("metin alanı her tiple uyumludur (yanlış-pozitif üretmez)", () => {
    expect(isColumnTypeCompatible("text", "number")).toBe(true);
    expect(isColumnTypeCompatible("text", "date")).toBe(true);
  });
  it("boş kolon her alan tipiyle uyumlu sayılır (henüz uyarı üretme)", () => {
    expect(isColumnTypeCompatible("money", "empty")).toBe(true);
    expect(isColumnTypeCompatible("date", "empty")).toBe(true);
  });
});

describe("Regresyon: pozisyonel eski yol hâlâ değişmedi", () => {
  it("parseXlsMatrix eskisi gibi çalışmaya devam ediyor", () => {
    const rows = parseXlsMatrix([[...XLS_40_COLUMNS], standardRow()], DEFAULTS);
    expect(rows).toHaveLength(1);
    expect(rows[0].countPerBundle).toBe(2);
  });
});
