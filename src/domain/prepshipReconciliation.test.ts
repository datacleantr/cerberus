import { describe, it, expect } from "vitest";
import { aggregatePrepShipRowsByMsku, computeInventoryLabSyncPreview } from "./prepshipReconciliation";

describe("aggregatePrepShipRowsByMsku", () => {
  it("aynı MSKU'nun birden çok satırını toplar (gerçek dosyada olduğu gibi)", () => {
    const totals = aggregatePrepShipRowsByMsku([
      { msku: "HRN-B0C4FYSPZ9", quantity: 2 },
      { msku: "HRN-B0C4FYSPZ9", quantity: 2 },
      { msku: "hrn-b0c4fyspz9", quantity: 2 }, // büyük/küçük harf duyarsız
      { msku: "HRN-B09ZJ9N4MV", quantity: 2 },
    ]);
    expect(totals.get("HRN-B0C4FYSPZ9")).toBe(6);
    expect(totals.get("HRN-B09ZJ9N4MV")).toBe(2);
  });

  it("MSKU boşsa satırı yok sayar", () => {
    const totals = aggregatePrepShipRowsByMsku([{ msku: "", quantity: 5 }, { msku: null, quantity: 3 }]);
    expect(totals.size).toBe(0);
  });
});

describe("computeInventoryLabSyncPreview", () => {
  it("MSKU dosyada bulunursa siparişi 'matched' işaretler, hiçbir fiziksel alana dokunmaz", () => {
    const result = computeInventoryLabSyncPreview(
      [{ id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 6 }],
      [{ msku: "HRN-B001", quantity: 6 }]
    );
    expect(result.perOrder).toEqual([
      { orderId: 1, orderNumber: "WO-1", msku: "HRN-B001", orderedQty: 6, matched: true, fileQtyForMsku: 6 },
    ]);
    expect(result.matchedCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("MSKU dosyada yoksa 'matched:false' + uyarı üretir", () => {
    const result = computeInventoryLabSyncPreview(
      [{ id: 1, orderNumber: "WO-1", msku: "HRN-B999", quantity: 5 }],
      [{ msku: "HRN-B001", quantity: 5 }]
    );
    expect(result.perOrder[0]).toMatchObject({ matched: false, fileQtyForMsku: null });
    expect(result.unmatchedCount).toBe(1);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "MSKU_NOT_IN_FILE", msku: "HRN-B999" })
    );
  });

  it("CERBERUS'taki sipariş toplamı ile dosyadaki toplam farklıysa QUANTITY_MISMATCH uyarısı verir", () => {
    const result = computeInventoryLabSyncPreview(
      [
        { id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 4 },
        { id: 2, orderNumber: "WO-2", msku: "HRN-B001", quantity: 2 },
      ],
      [{ msku: "HRN-B001", quantity: 5 }] // CERBERUS toplamı 6, dosya 5
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "QUANTITY_MISMATCH", msku: "HRN-B001" })
    );
    // İki sipariş de yine de 'matched' — MSKU dosyada var, yalnızca toplam tutmuyor
    expect(result.perOrder.every((o) => o.matched)).toBe(true);
  });

  it("tutarlı toplamda QUANTITY_MISMATCH uyarısı vermez", () => {
    const result = computeInventoryLabSyncPreview(
      [
        { id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 4 },
        { id: 2, orderNumber: "WO-2", msku: "HRN-B001", quantity: 2 },
      ],
      [{ msku: "HRN-B001", quantity: 6 }]
    );
    expect(result.warnings.filter((w) => w.code === "QUANTITY_MISMATCH")).toHaveLength(0);
  });

  it("batch'te eşleşen siparişi olmayan dosya satırı için uyarı verir", () => {
    const result = computeInventoryLabSyncPreview(
      [{ id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 5 }],
      [
        { msku: "HRN-B001", quantity: 5 },
        { msku: "HRN-B002", quantity: 3 },
      ]
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "FILE_ROW_NO_MATCHING_ORDER", msku: "HRN-B002" })
    );
  });

  it("shippedToAmazon/p2MissingQty gibi fiziksel alanlar sonuç tipinde hiç yer almaz", () => {
    const result = computeInventoryLabSyncPreview(
      [{ id: 1, orderNumber: "WO-1", msku: "HRN-B001", quantity: 6 }],
      [{ msku: "HRN-B001", quantity: 3 }] // kasıtlı olarak farklı — bu bir "eksik teslimat" DEĞİLDİR
    );
    const keys = Object.keys(result.perOrder[0]);
    expect(keys).not.toContain("receivedQty");
    expect(keys).not.toContain("missingQty");
  });
});
