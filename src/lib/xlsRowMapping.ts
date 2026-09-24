/**
 * 40-kolonluk kilitli XLS/Google Drive formatını satır nesnelerine çevirir.
 *
 * Bu dosya bilinçli olarak tek kaynak: aynı pozisyonel kolon haritalaması
 * hem dosya yükleme (GoogleDriveXlsImportModal) hem de Google Drive URL
 * (api/orders/import-drive-url) yollarında kopyalanmış hâlde yaşıyordu.
 * İki kopyanın birbirinden bağımsız evrilmesi tam olarak şu hataya yol
 * açmıştı: `CountPerBundle` (kolon 32) her iki kopyada da atlanmıştı —
 * Bundle=YES işaretli siparişlerde bu alan sessizce `null` yazılıyordu.
 * Tek kaynağa indirgeyip test etmek aynı hatanın üçüncü bir yerde
 * (veya bu ikisinden birinde düzeltilip diğerinde unutularak) tekrarını
 * engeller.
 */
import { excelCellToDateStr } from "@/lib/excelDate";

export interface XlsRowDefaults {
  /** Kolon 0 (Satın Alan) boşsa kullanılacak mağaza kodu */
  defaultStore: string;
  /** Kolon 4 ve 2 boşsa kullanılacak ürün adı */
  defaultProductTitle: string;
  /** Kolon 12 (Order'ın drive linki) boşsa kullanılacak değer */
  defaultDriveLink?: string;
}

/** Tek bir veri satırını (40 kolon) nesneye çevirir; anlamsız satırda null döner. */
export function parseXlsMatrixRow(
  cols: unknown[],
  defaults: XlsRowDefaults
): Record<string, unknown> | null {
  if (!cols || cols.length < 3) return null;

  const productTitle = String(cols[4] || cols[2] || "").trim();
  const orderNumber = String(cols[11] || cols[5] || "").trim();
  if (!productTitle && !orderNumber) return null;

  return {
    buyerStore: String(cols[0] || defaults.defaultStore).trim() || defaults.defaultStore,
    orderDate: excelCellToDateStr(cols[1]) || new Date().toISOString().split("T")[0],
    imageUrl: String(cols[2] || "").trim(),
    fulfillmentType: String(cols[3] || "FBA").trim(),
    productTitle: productTitle || defaults.defaultProductTitle,
    asin: String(cols[5] || "").trim().toUpperCase(),
    msku: String(cols[6] || "").trim(),
    supplierName: String(cols[7] || "THE VITAMINSHOPPE").trim(),
    supplierCode: String(cols[8] || "A198").trim(),
    supplierUrl: String(cols[9] || "").trim(),
    amazonUrl: String(cols[10] || "").trim(),
    orderNumber: orderNumber || `WO-${Math.floor(10000000 + Math.random() * 90000000)}`,
    driveLink: String(cols[12] || defaults.defaultDriveLink || "").trim(),
    packCount: Number(cols[13]) || 1,
    quantity: Number(cols[14]) || 1,
    unitCost: String(cols[15] || "0").replace(",", "."),
    sellingPrice: String(cols[16] || "0").replace(",", "."),
    totalCost: String(cols[17] || "0").replace(",", "."),
    orderEmail: String(cols[18] || "").trim(),
    cargoStatus: String(cols[19] || "Tam Geldi").trim(),
    shippedToAmazon: Number(cols[20]) || 0,
    p1CancelQty: Number(cols[21]) || 0,
    p2MissingQty: Number(cols[22]) || 0,
    p3DefectiveQty: Number(cols[23]) || 0,
    p4ExpiredQty: Number(cols[24]) || 0,
    problemAction: String(cols[25] || "").trim(),
    problemResult: String(cols[26] || "").trim(),
    refundAmount: String(cols[27] || "0").replace(",", "."),
    creditCard: String(cols[28] || "").trim(),
    isFragile: String(cols[29] || "NO").trim(),
    isMultiPack: String(cols[30] || "NO").trim(),
    isBundle: String(cols[31] || "NO").trim(),
    // Kolon 32 — CountPerBundle. Önceden her iki import yolunda da atlanıyordu.
    countPerBundle: Number(cols[32]) || null,
    condition: String(cols[33] || "New").trim(),
    brandName: String(cols[34] || "General").trim(),
    description1: String(cols[35] || "").trim(),
    description2: String(cols[36] || "").trim(),
    auditNote: String(cols[37] || "").trim(),
    periodCode: String(cols[38] || "Ş26").trim(),
    correctedCost: String(cols[39] || cols[17] || "0").replace(",", "."),
  };
}

/** Ham 2D matrisi (ilk satır başlık) satır nesnelerine çevirir. */
export function parseXlsMatrix(
  rawMatrix: unknown[][],
  defaults: XlsRowDefaults
): Record<string, unknown>[] {
  if (!rawMatrix || rawMatrix.length < 2) return [];
  const dataRows = rawMatrix.slice(1);
  const parsed: Record<string, unknown>[] = [];
  for (const cols of dataRows) {
    const row = parseXlsMatrixRow(cols as unknown[], defaults);
    if (row) parsed.push(row);
  }
  return parsed;
}
