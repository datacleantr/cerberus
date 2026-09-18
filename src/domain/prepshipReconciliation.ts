/**
 * PrepShip → CERBERUS Inventory Lab senkron teyidi (denetim raporu §17 —
 * §16'daki hatalı varsayımın düzeltilmiş hâli).
 *
 * ÖNEMLİ DÜZELTME: Kullanıcı QUANTITY alanının ne olduğunu netleştirdi —
 * bu, PrepShip'in fiilen depoya/Amazon'a giren adedi DEĞİL, "online
 * siteden verilen sipariş adedi" (CERBERUS'un kendi `orders.quantity`'si,
 * XLS'ten PrepShip'e girilen hâliyle). Depoya fiilen kaç adet geldiği
 * ("siparişler verilen adet kadar gelmiyor, farklı miktarlarda farklı
 * zamanlarda gelebiliyor") PrepShip içinde AYRI ve halen tamamen elle
 * takip edilen bir süreç — bu dosyada YOK.
 *
 * Yani bu dosya bir "depo sayım/reconciliation" kaynağı DEĞİL — PrepShip'in
 * Inventory Lab'a beslediği bir ürün/sipariş listesi. Bu modül bu yüzden
 * `shippedToAmazon`/`p2MissingQty`/`cargoStatus` gibi fiziksel teslimat
 * alanlarına HİÇBİR ZAMAN dokunmaz (o alanlar hâlâ, doğru şekilde,
 * `WarehouseReconciliationModal`'daki elle girişe ait). Bu modülün tek
 * işi: bir batch'in hangi siparişlerinin bu dosya üzerinden fiilen
 * Inventory Lab'a ulaştığını teyit edip `inventoryLabStatus`'u
 * güncellemek — ve MSKU bazında beklenen/dosyadaki adet arasında fark
 * varsa bunu bir veri-tutarlılığı uyarısı olarak yüzeye çıkarmak.
 */

export interface PrepShipExportRow {
  asin?: string | null;
  msku?: string | null;
  quantity?: number | string | null;
}

export interface SyncOrder {
  id: number;
  orderNumber: string;
  msku: string;
  quantity: number;
}

export interface OrderSyncResult {
  orderId: number;
  orderNumber: string;
  msku: string;
  orderedQty: number;
  matched: boolean;
  fileQtyForMsku: number | null;
}

export interface SyncWarning {
  code: "QUANTITY_MISMATCH" | "MSKU_NOT_IN_FILE" | "FILE_ROW_NO_MATCHING_ORDER";
  msku: string;
  detail: string;
}

export interface InventoryLabSyncPreview {
  perOrder: OrderSyncResult[];
  warnings: SyncWarning[];
  matchedCount: number;
  unmatchedCount: number;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normalizeMsku(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Dosyadaki satırları MSKU bazında toplar (aynı MSKU birden çok satırda geçebilir). */
export function aggregatePrepShipRowsByMsku(rows: PrepShipExportRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const msku = normalizeMsku(row.msku);
    if (!msku) continue;
    totals.set(msku, (totals.get(msku) || 0) + toNumber(row.quantity));
  }
  return totals;
}

/**
 * Bir batch'in siparişlerini, PrepShip'in Inventory Lab'a gönderdiği
 * dosyayla MSKU bazında eşleştirir. Hiçbir sevkiyat/fire alanına
 * dokunmaz — yalnızca "bu sipariş Inventory Lab'a ulaştı mı" teyidi ve
 * adet tutarsızlığı uyarısı üretir.
 */
export function computeInventoryLabSyncPreview(
  batchOrders: SyncOrder[],
  fileRows: PrepShipExportRow[]
): InventoryLabSyncPreview {
  const fileTotalsByMsku = aggregatePrepShipRowsByMsku(fileRows);
  const orderedTotalsByMsku = new Map<string, number>();
  for (const order of batchOrders) {
    const msku = normalizeMsku(order.msku);
    orderedTotalsByMsku.set(msku, (orderedTotalsByMsku.get(msku) || 0) + order.quantity);
  }

  const warnings: SyncWarning[] = [];
  const perOrder: OrderSyncResult[] = batchOrders.map((order) => {
    const msku = normalizeMsku(order.msku);
    const fileQty = fileTotalsByMsku.get(msku);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      msku,
      orderedQty: order.quantity,
      matched: fileQty !== undefined,
      fileQtyForMsku: fileQty ?? null,
    };
  });

  const seenMsku = new Set<string>();
  for (const order of perOrder) {
    if (seenMsku.has(order.msku)) continue;
    seenMsku.add(order.msku);

    if (!order.matched) {
      warnings.push({
        code: "MSKU_NOT_IN_FILE",
        msku: order.msku,
        detail: `${order.msku} bu dosyada bulunamadı — bu MSKU'ya ait siparişler henüz Inventory Lab'a gönderilmemiş olabilir.`,
      });
      continue;
    }
    const orderedTotal = orderedTotalsByMsku.get(order.msku) || 0;
    const fileTotal = fileTotalsByMsku.get(order.msku) || 0;
    if (orderedTotal !== fileTotal) {
      warnings.push({
        code: "QUANTITY_MISMATCH",
        msku: order.msku,
        detail: `${order.msku}: CERBERUS'taki sipariş toplamı ${orderedTotal}, dosyadaki toplam ${fileTotal} — kontrol edin.`,
      });
    }
  }

  for (const [msku, qty] of fileTotalsByMsku) {
    if (!orderedTotalsByMsku.has(msku) && qty > 0) {
      warnings.push({
        code: "FILE_ROW_NO_MATCHING_ORDER",
        msku,
        detail: `${msku} dosyada ${qty} adet olarak geçiyor ama bu batch'te bu MSKU'ya ait sipariş yok.`,
      });
    }
  }

  return {
    perOrder,
    warnings,
    matchedCount: perOrder.filter((o) => o.matched).length,
    unmatchedCount: perOrder.filter((o) => !o.matched).length,
  };
}
