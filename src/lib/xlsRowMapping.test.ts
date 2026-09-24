import { describe, expect, it } from "vitest";
import { parseXlsMatrix, parseXlsMatrixRow } from "./xlsRowMapping";

const HEADER = Array.from({ length: 40 }, (_, i) => `col${i}`);

function realBundleRow(): unknown[] {
  // docs/Cerberus_yedek.xlsx'teki gerçek DEPO00001 satırının kısaltılmış hâli:
  // Bundle=YES, CountPerBundle=2 (kolon 32).
  const cols = new Array(40).fill("");
  cols[0] = "HRN";
  cols[4] = "Test Bundle Ürünü";
  cols[5] = "B085542GWZ";
  cols[11] = "DEPO00001";
  cols[14] = 1;
  cols[15] = 10;
  cols[16] = 20;
  cols[17] = 10;
  cols[31] = "YES"; // Bundle
  cols[32] = 2; // CountPerBundle — önceden atlanıyordu
  return cols;
}

describe("xlsRowMapping — regresyon: CountPerBundle (kolon 32) atlanmasın", () => {
  it("Bundle=YES satırında countPerBundle doğru okunur", () => {
    const row = parseXlsMatrixRow(realBundleRow(), {
      defaultStore: "HRN",
      defaultProductTitle: "Ürün",
    });
    expect(row).not.toBeNull();
    expect(row!.isBundle).toBe("YES");
    expect(row!.countPerBundle).toBe(2);
  });

  it("CountPerBundle boşsa null döner (varsayılan 0 değil)", () => {
    const cols = realBundleRow();
    cols[32] = "";
    const row = parseXlsMatrixRow(cols, { defaultStore: "HRN", defaultProductTitle: "Ürün" });
    expect(row!.countPerBundle).toBeNull();
  });

  it("parseXlsMatrix tam matris üzerinden aynı sonucu üretir", () => {
    const rows = parseXlsMatrix([HEADER, realBundleRow()], {
      defaultStore: "HRN",
      defaultProductTitle: "Ürün",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].countPerBundle).toBe(2);
    expect(rows[0].orderNumber).toBe("DEPO00001");
  });
});
