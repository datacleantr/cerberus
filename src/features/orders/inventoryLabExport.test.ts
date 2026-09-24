import { describe, it, expect } from "vitest";
import { buildInventoryLabExportCsv, INVENTORY_LAB_EXPORT_COLUMNS } from "./inventoryLabExport";

describe("buildInventoryLabExportCsv", () => {
  it("başlık satırını gerçek Inventory Lab şablonuyla birebir üretir", () => {
    const csv = buildInventoryLabExportCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(INVENTORY_LAB_EXPORT_COLUMNS.map((c) => `"${c}"`).join(","));
    // Gerçek örnek dosyadaki (IL-FBA198Z678P1_Tue_Mar_24_2026.csv) başlık sırası
    expect(INVENTORY_LAB_EXPORT_COLUMNS.join(",")).toBe(
      "ASIN,TITLE,COSTUNIT,LISTPRICE,QUANTITY,PURCHASEDDATE,SUPPLIER,CONDITION,MSKU,PALLET ID,SALESTAX,DISCOUNT,EXPIRATIONDATE,TAXCODE,MINPRICE,MAXPRICE,MISSING IN THE SYSTEM"
    );
  });

  it("sipariş satırını doğru kolonlara eşler; MINPRICE/MAXPRICE satış fiyatına eşitlenir", () => {
    const csv = buildInventoryLabExportCsv([
      {
        asin: "B0DGQX1FS7",
        productTitle: "Test Ürün",
        unitCost: "29.99",
        sellingPrice: "65",
        shippedToAmazon: 4,
        orderDate: new Date("2026-02-11T00:00:00Z"),
        supplierCode: "A198",
        condition: "New",
        msku: "HRN-B0DGQX1FS7",
      },
    ]);
    const rows = csv.split("\r\n");
    expect(rows).toHaveLength(2);
    const cells = rows[1].split(",");
    expect(cells[0]).toBe('"B0DGQX1FS7"'); // ASIN
    expect(cells[6]).toBe('"A198"'); // SUPPLIER = supplierCode
    expect(rows[1]).toContain('"2026-02-11"'); // PURCHASEDDATE
    expect(rows[1].endsWith('"65","65",""')).toBe(true); // MINPRICE, MAXPRICE, MISSING IN THE SYSTEM
  });

  it("virgül içeren ürün adını doğru kaçışlar (RFC 4180)", () => {
    const csv = buildInventoryLabExportCsv([
      {
        asin: "B0TEST002",
        productTitle: 'Vitamin, 60 Tablet "Pro"',
        unitCost: "5.00",
        sellingPrice: "9.99",
        shippedToAmazon: 1,
        orderDate: "2026-09-18",
        supplierCode: "A199",
        condition: "New",
        msku: "HRN-B0TEST002",
      },
    ]);
    const rows = csv.split("\r\n");
    expect(rows[1]).toContain('"Vitamin, 60 Tablet ""Pro"""');
  });
});
