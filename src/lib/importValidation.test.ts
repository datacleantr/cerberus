/**
 * İçe aktarma esnekliği — importValidation birim testleri.
 *
 * Beş gereksinim:
 *  1. Kargo durumu serbest metin kabul edilir.
 *  2. Diğer durum alanları (FBA/FBM, PSH, Inventory Lab) enum olarak kalır.
 *  3. Aynı order number altında farklı ASIN'lere izin verilir.
 *  4. Hatalı satırlar atlanır (partitionRows), doğru satırlar aktarılır.
 */
import { describe, it, expect } from "vitest";
import {
  validateImportRow,
  detectDuplicatePairs,
  partitionRows,
  normalizeMoney,
  normalizeOrderDate,
  CARGO_STATUSES,
} from "./importValidation";

const baseRow = () => ({
  orderNumber: "WO-1001",
  asin: "B0TESTCODE",
  quantity: 2,
  shippedToAmazon: 1,
  unitCost: "10,50",
  sellingPrice: "$25.00",
  totalCost: "21.00",
});

describe("kargo durumu — serbest metin", () => {
  it("enum dışı her değer sorunsuz geçer", () => {
    for (const v of [
      "Yolda",
      "Tam Geldi",
      "İPTAL",
      "Kayıp Depoya gelmiş",
      "IPTAL - kargo firmasina iade",
      "Kargoya verildi 12.09",
      "DELIVERED (Amazon)",
      "", // boş → route varsayılanı ("Tam Geldi") kullanır
      null,
      undefined,
    ]) {
      const problems = validateImportRow({ ...baseRow(), cargoStatus: v }, 0);
      const cargoProblems = problems.filter((p) => p.field === "Kargo durumu");
      expect(cargoProblems, `cargoStatus="${v}" sorun üretmemeli`).toHaveLength(0);
    }
  });

  it("CARGO_STATUSES sabiti artık yalnızca öneri listesidir (zorlanmaz)", () => {
    // Listenin DIŞINDA bir değer de kabul edilmeli — bu liste UI ipucudur.
    expect(CARGO_STATUSES).not.toContain("DELIVERED (Amazon)");
    expect(validateImportRow({ ...baseRow(), cargoStatus: "DELIVERED (Amazon)" }, 0)).toHaveLength(0);
  });
});

describe("diğer durum alanları enum olarak kalır", () => {
  it("geçersiz fulfillmentType reddedilir", () => {
    const p = validateImportRow({ ...baseRow(), fulfillmentType: "DHL" }, 0);
    expect(p.some((x) => x.field === "FBM/FBA")).toBe(true);
  });

  it("geçersiz PSH durumu reddedilir", () => {
    const p = validateImportRow({ ...baseRow(), pshStatus: "HERHANGI" }, 0);
    expect(p.some((x) => x.field === "PSH durumu")).toBe(true);
  });

  it("geçersiz Inventory Lab durumu reddedilir", () => {
    const p = validateImportRow({ ...baseRow(), inventoryLabStatus: "BITMIS" }, 0);
    expect(p.some((x) => x.field === "Inventory Lab durumu")).toBe(true);
  });
});

describe("aynı order number altında farklı ASIN'ler", () => {
  const resolve = (r: Record<string, any>) => String(r.buyerStore || "HRN");

  it("aynı mağaza + sipariş no + FARKLI ASIN sorun bildirmez", () => {
    const rows = [
      { ...baseRow(), buyerStore: "HRN", asin: "B0AAA" },
      { ...baseRow(), buyerStore: "HRN", asin: "B0BBB" },
    ];
    expect(detectDuplicatePairs(rows, resolve)).toHaveLength(0);
  });

  it("aynı mağaza + sipariş no + AYNI ASIN ikinci kez sorun bildirir", () => {
    const rows = [
      { ...baseRow(), buyerStore: "HRN", asin: "B0AAA" },
      { ...baseRow(), buyerStore: "HRN", asin: "b0aaa" }, // büyük/küçük harf farkı normalize edilir
    ];
    const problems = detectDuplicatePairs(rows, resolve);
    expect(problems).toHaveLength(1);
    expect(problems[0].row).toBe(2);
  });

  it("aynı sipariş no farklı mağazada sorun değil", () => {
    const rows = [
      { ...baseRow(), buyerStore: "HRN", asin: "B0AAA" },
      { ...baseRow(), buyerStore: "SEL", asin: "B0AAA" },
    ];
    expect(detectDuplicatePairs(rows, resolve)).toHaveLength(0);
  });
});

describe("partitionRows — hatalı satırlar atlanır, doğru satırlar aktarılır", () => {
  const resolve = (r: Record<string, any>) => String(r.buyerStore || "HRN");

  it("geçerli satırlar orijinal numaralarıyla döner, hatalılar sorun listesine düşer", () => {
    const rows = [
      { ...baseRow(), orderNumber: "WO-OK-1" }, // 1. satır: geçerli
      { orderNumber: "", asin: "B0AAA" }, // 2. satır: sipariş no boş → atlanır
      { ...baseRow(), orderNumber: "WO-OK-2", fulfillmentType: "DHL" }, // 3. satır: enum hatası → atlanır
      { ...baseRow(), orderNumber: "WO-OK-3" }, // 4. satır: geçerli
    ];
    const { validRows, problems } = partitionRows(rows, resolve);

    expect(validRows.map((v) => v.row)).toEqual([1, 4]);
    expect(validRows[0].data.orderNumber).toBe("WO-OK-1");
    expect(validRows[1].data.orderNumber).toBe("WO-OK-3");

    expect(problems.map((p) => p.row)).toEqual([2, 3]);
    expect(problems.find((p) => p.row === 2)?.field).toBe("Sipariş No (Orderno)");
    expect(problems.find((p) => p.row === 3)?.field).toBe("FBM/FBA");
  });

  it("batch içi mükerrer (aynı mağaza+orderNumber+ASIN) ikinci kopyayı atlatır", () => {
    const rows = [
      { ...baseRow(), asin: "B0DUP" },
      { ...baseRow(), asin: "B0DUP" },
    ];
    const { validRows, problems } = partitionRows(rows, resolve);
    expect(validRows.map((v) => v.row)).toEqual([1]);
    expect(problems).toHaveLength(1);
    expect(problems[0].row).toBe(2);
  });

  it("ASIN'i farklı olan mükerrer sipariş satırlarının ikisi de geçerlidir", () => {
    const rows = [
      { ...baseRow(), orderNumber: "WO-SAME", asin: "B0X1" },
      { ...baseRow(), orderNumber: "WO-SAME", asin: "B0X2" },
      { ...baseRow(), orderNumber: "WO-SAME", asin: "B0X3" },
    ];
    const { validRows, problems } = partitionRows(rows, resolve);
    expect(validRows).toHaveLength(3);
    expect(problems).toHaveLength(0);
  });
});

describe("normalizeMoney — sayıya çevrilemeyenler sorun üretir", () => {
  it("para birimi simgeli ve Türkçe biçimli değerler çevrilir", () => {
    expect(normalizeMoney("$1,234.56")).toBe(1234.56);
    expect(normalizeMoney("1.234,56")).toBe(1234.56);
    expect(normalizeMoney("10,50")).toBe(10.5);
  });

  it("geçersiz değer null döner", () => {
    expect(normalizeMoney("abc")).toBeNull();
    expect(normalizeMoney("-5")).toBeNull();
  });
});

describe("normalizeOrderDate — bozuk Excel serial sayısı Postgres'i patlatmaz", () => {
  it("geçerli YYYY-MM-DD olduğu gibi kalır", () => {
    expect(normalizeOrderDate("2024-03-15")).toBe("2024-03-15");
  });

  it("çıplak Excel serial sayısı (ör. 44281) bugüne düşer, 'yıl 44281' olmaz", () => {
    // new Date("44281") JS'de "yıl 44281" olarak parse edilir ve Postgres
    // timestamp sütununda 22009 (time zone displacement out of range) hatası verir.
    const today = new Date().toISOString().slice(0, 10);
    expect(normalizeOrderDate("44281")).toBe(today);
  });

  it("boş/null/tanımsız bugüne düşer", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(normalizeOrderDate("")).toBe(today);
    expect(normalizeOrderDate(null)).toBe(today);
    expect(normalizeOrderDate(undefined)).toBe(today);
  });

  it("makul olmayan yıl (ör. 1899 veya 2200) bugüne düşer", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(normalizeOrderDate("1899-12-30")).toBe(today);
    expect(normalizeOrderDate("2200-01-01")).toBe(today);
  });
});
