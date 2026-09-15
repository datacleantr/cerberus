import type { OrderKpis, OrderView } from "../types";
import { isProblemOrder } from "../types";

/** Google Drive XLS ana şemasının 40 kolonu — kilitli sıra (ARCHITECTURE_AND_DATABASE_SPEC.md) */
export const XLS_40_COLUMNS = [
  "Satın Alan",
  "Tarih",
  "Ürün resmi",
  "FBM/FBA",
  "Ürün adı Amazon",
  "ASIN",
  "MSKU",
  "Satıcı adı",
  "Satıcı kodu",
  "Satıcı link",
  "Amazon link",
  "Orderno",
  "Order'ın drive linki",
  "Kaçlı paket",
  "Ürün adedi",
  "Ürün birim maliyeti",
  "Ürün satış fiyatı",
  "Ürün toplam maliyeti",
  "Mail adresi",
  "Kargo durumu",
  "Amazona gönderilen adet",
  "İptal adet-P1",
  "Eksik adet-P2",
  "Defolu adet-P3",
  "Tarihi geçmiş adet-P4",
  "Problemle ilgili eylem",
  "Problemle ilgili sonuç",
  "Refund miktarı",
  "Kredi Kartı",
  "Fragile",
  "MultiPack",
  "Bundle",
  "CountPerBundle",
  "Condition",
  "Marka adı",
  "Açıklama1",
  "Açıklama2",
  "Denetim için açıklama",
  "Dönem Kodu",
  "Düzeltilmiş maliyet",
] as const;

/**
 * RFC 4180 uyumlu hücre kaçışı.
 * Önceki sürümde yalnızca birkaç alan elle tırnaklanıyordu; içinde virgül veya
 * satır sonu geçen tedarikçi adı CSV'yi kaydırıyor, kolonlar birbirine giriyordu.
 * Ayrıca "=" ile başlayan değerler Excel'de formül olarak çalışırdı (CSV injection).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildOrdersCsv(orders: OrderView[]): string {
  const rows = orders.map((o) =>
    [
      o.buyerStore,
      o.orderDate,
      o.imageUrl,
      o.fulfillmentType,
      o.productTitle,
      o.asin,
      o.msku,
      o.supplierName,
      o.supplierCode,
      o.supplierUrl,
      o.amazonUrl,
      o.orderNumber,
      o.driveLink,
      o.packCount,
      o.quantity,
      o.unitCost,
      o.sellingPrice,
      o.totalCost,
      o.orderEmail,
      o.cargoStatus,
      o.shippedToAmazon,
      o.p1CancelQty,
      o.p2MissingQty,
      o.p3DefectiveQty,
      o.p4ExpiredQty,
      o.problemAction,
      o.problemResult,
      o.refundAmount,
      o.creditCard,
      o.isFragile,
      o.isMultiPack,
      o.isBundle,
      o.countPerBundle,
      o.condition,
      o.brandName,
      o.description1,
      o.description2,
      o.auditNote,
      o.periodCode,
      o.correctedCost,
    ].map(csvCell)
  );

  return [XLS_40_COLUMNS.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/** Tarayıcıda verilen Blob için güvenli indirme tetikler. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Yalnız eldeki satırları indirir; test/çevrimdışı kullanım için korunur. */
export function downloadOrdersCsv(orders: OrderView[], storeCode: string): void {
  const csv = "\uFEFF" + buildOrdersCsv(orders);
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    `CERBERUS_${storeCode}_40KOLON_${new Date().toISOString().slice(0, 10)}.csv`
  );
}

/**
 * Tüm filtrelenmiş sonucu sunucudan akış olarak indirir. Böylece sayfalı
 * arayüzde yalnız görünen 50 satırın yanlışlıkla "tam export" sanılması önlenir.
 */
export async function downloadFilteredOrdersCsv(options: {
  storeCode: string;
  search: string;
  cargo: string;
  batch: string;
}): Promise<void> {
  const params = new URLSearchParams({ storeCode: options.storeCode });
  if (options.search.trim()) params.set("search", options.search.trim());
  if (options.cargo !== "ALL") params.set("cargoStatus", options.cargo);
  if (options.batch !== "ALL") params.set("pshBatchNo", options.batch);

  const response = await fetch(`/api/orders/export?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "CSV dışa aktarımı başarısız oldu.");
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ||
    `CERBERUS_${options.storeCode}_40KOLON_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(await response.blob(), filename);
}

/** Görüntülenen satırlardan KPI hesabı — sunucu özetiyle aynı tanımları kullanır */
export function computeOrderKpis(orders: OrderView[]): OrderKpis {
  const totalUnits = orders.reduce((s, o) => s + Number(o.quantity || 0), 0);
  const totalSpend = orders.reduce((s, o) => s + Number(o.totalCost || 0), 0);
  const totalShipped = orders.reduce((s, o) => s + Number(o.shippedToAmazon || 0), 0);
  const totalRevenueEst = orders.reduce((sum, order) => {
    const fire =
      Number(order.p1CancelQty || 0) +
      Number(order.p2MissingQty || 0) +
      Number(order.p3DefectiveQty || 0) +
      Number(order.p4ExpiredQty || 0);
    const saleableUnits = Math.max(0, Number(order.quantity || 0) - fire);
    return sum + Number(order.sellingPrice || 0) * saleableUnits;
  }, 0);
  const totalRefunds = orders.reduce((s, o) => s + Number(o.refundAmount || 0), 0);
  const effectiveCost = Math.max(0, totalSpend - totalRefunds);
  const grossNetEst = totalRevenueEst - effectiveCost;

  return {
    totalOrders: orders.length,
    totalUnits,
    totalSpend: totalSpend.toFixed(2),
    totalShipped,
    totalRevenueEst: totalRevenueEst.toFixed(2),
    grossNetEst: grossNetEst.toFixed(2),
    // Veri yoksa "41.4" gibi uydurma bir ROI göstermek yerine "—" döner (F-15)
    avgRoi: effectiveCost > 0 ? ((grossNetEst / effectiveCost) * 100).toFixed(1) : "—",
    fulfillmentRate: totalUnits > 0 ? Math.round((totalShipped / totalUnits) * 100) : 0,
    problemCount: orders.filter(isProblemOrder).length,
    totalRefunds: totalRefunds.toFixed(2),
  };
}

/** Arama + kargo + batch filtreleri — tek doğruluk kaynağı, test edilebilir */
export function filterOrders(
  orders: OrderView[],
  opts: { search: string; cargo: string; batch: string }
): OrderView[] {
  const q = opts.search.trim().toLowerCase();
  return orders.filter((o) => {
    if (opts.cargo !== "ALL" && o.cargoStatus !== opts.cargo) return false;
    if (opts.batch !== "ALL" && o.pshBatchNo !== opts.batch) return false;
    if (!q) return true;
    return [
      o.orderNumber,
      o.asin,
      o.msku,
      o.productTitle,
      o.brandName,
      o.supplierName,
      o.orderEmail,
    ].some((field) => field?.toLowerCase().includes(q));
  });
}
