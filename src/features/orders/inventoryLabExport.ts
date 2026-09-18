import { csvCell } from "./ordersCsv";

/**
 * Inventory Lab dışa aktarım kolonları — GERÇEK ŞABLON.
 *
 * Denetim raporu §13/§14: kullanıcının paylaştığı gerçek Inventory Lab
 * dosyasından (`IL-FBA198Z678P1_Tue_Mar_24_2026.csv`) alındı. Önceki sürüm
 * tahmini/genel bir kolon listesi kullanıyordu — bu artık Inventory Lab'ın
 * fiilen kabul ettiği başlıklarla birebir aynı.
 *
 * Eşleme notları:
 * - SUPPLIER kolonu gerçek örnekte "A198/A199/A200" gibi değerler taşıyor —
 *   bu birebir CERBERUS'un `supplierCode` alanı (supplierName değil).
 * - MINPRICE ve MAXPRICE örnekte her satırda LISTPRICE ile birebir aynı
 *   (repricer aralığı kullanılmıyor) — biz de sellingPrice'ı ikisine de
 *   yazıyoruz.
 * - PALLET ID, SALESTAX, EXPIRATIONDATE, TAXCODE, MISSING IN THE SYSTEM
 *   CERBERUS'ta henüz karşılığı olmayan alanlar; boş bırakılıyor
 *   (TAXCODE hariç — örnekte sabit "A_GEN_TAX" görülüyor, varsayılan
 *   olarak aynısı yazılıyor, ileride mağaza bazlı ayara taşınabilir).
 */
export const INVENTORY_LAB_EXPORT_COLUMNS = [
  "ASIN",
  "TITLE",
  "COSTUNIT",
  "LISTPRICE",
  "QUANTITY",
  "PURCHASEDDATE",
  "SUPPLIER",
  "CONDITION",
  "MSKU",
  "PALLET ID",
  "SALESTAX",
  "DISCOUNT",
  "EXPIRATIONDATE",
  "TAXCODE",
  "MINPRICE",
  "MAXPRICE",
  "MISSING IN THE SYSTEM",
] as const;

const DEFAULT_TAX_CODE = "A_GEN_TAX";

export interface InventoryLabExportOrder {
  asin: string;
  productTitle: string;
  unitCost: number | string | null;
  sellingPrice: number | string | null;
  shippedToAmazon: number | string | null;
  orderDate: Date | string | null;
  supplierCode: string | null;
  condition: string | null;
  msku: string;
}

function toDateOnly(value: Date | string | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
  return d.toISOString().split("T")[0];
}

export function buildInventoryLabExportCsv(batchOrders: InventoryLabExportOrder[]): string {
  const header = INVENTORY_LAB_EXPORT_COLUMNS.map(csvCell).join(",");
  const rows = batchOrders.map((o) => {
    const listPrice = o.sellingPrice;
    return [
      o.asin,
      o.productTitle,
      o.unitCost,
      listPrice,
      o.shippedToAmazon,
      toDateOnly(o.orderDate),
      o.supplierCode || "",
      o.condition || "New",
      o.msku,
      "", // PALLET ID — CERBERUS'ta izlenmiyor
      "", // SALESTAX
      "0", // DISCOUNT
      "", // EXPIRATIONDATE — CERBERUS'ta izlenmiyor
      DEFAULT_TAX_CODE,
      listPrice, // MINPRICE
      listPrice, // MAXPRICE
      "", // MISSING IN THE SYSTEM — yalnızca Inventory Lab'ın kendi çıktısı doldurur
    ]
      .map(csvCell)
      .join(",");
  });
  return [header, ...rows].join("\r\n");
}
