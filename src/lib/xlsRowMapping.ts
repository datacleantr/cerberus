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
import {
  IMPORT_FIELDS,
  normalizeHeaderLabel,
  type ImportFieldDef,
} from "@/lib/importFieldSchema";

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

/* ═══════════════════════════════════════════════════════════════════════
 * KOLON EŞLEME (COLUMN MAPPING) — kullanıcı isteği: "bazı xls ya da
 * drive'larda [kolon düzeni] farklı olabilir, sisteme atarken kolonları
 * eşleştirme yaparak atmamızı sağlayalım ve tip kontrolü yaparak
 * yanlışları giderelim."
 *
 * Yukarıdaki `parseXlsMatrixRow`/`parseXlsMatrix` KASITLI OLARAK
 * değiştirilmedi (geriye dönük uyumluluk + mevcut testler). Bu bölüm,
 * dosyanın başlık satırını gerçekten OKUYAN, alan kimliğine göre eşleyen
 * (pozisyona göre değil) ek/yeni bir motor sağlar. Kilitli 40-kolon
 * formatındaki bir dosya için otomatik eşleme, pozisyonel sonuçla birebir
 * aynı satırları üretir (aynı katalog + aynı varsayılanlar) — farklı
 * kolon sırası/adı olan bir dosya için ise doğru alanlara doğru veri gider.
 * ═══════════════════════════════════════════════════════════════════════ */

/** colIndex → hedef alan anahtarı (ör. 5 → "asin"). Eşlenmemiş kolonlar haritada yer almaz. */
export type ColumnMapping = Record<number, string>;

/**
 * Başlık satırından otomatik eşleme önerisi üretir. Üç aşamalı, artan
 * esneklikte dener — kısa/genel bir eşanlamlının (ör. "p1") yanlış bir
 * başlıkla erken eşleşip doğru adayı gölgelememesi için:
 *   1) kanonik başlıkla TAM eşleşme (tüm kolon/alan çiftleri)
 *   2) bilinen eşanlamlıyla TAM eşleşme
 *   3) alt-dize (contains) eşleşmesi — yalnızca 3+ karakterlik adaylar
 * Her alan yalnızca bir kolona, her kolon yalnızca bir alana eşlenir.
 */
export function guessColumnMapping(
  headerRow: unknown[],
  fields: ImportFieldDef[] = IMPORT_FIELDS
): ColumnMapping {
  const normalizedHeaders = headerRow.map((h) => normalizeHeaderLabel(h));
  const mapping: ColumnMapping = {};
  const usedFields = new Set<string>();
  const usedCols = new Set<number>();

  const tryPass = (getCandidates: (f: ImportFieldDef) => string[], allowShort: boolean) => {
    normalizedHeaders.forEach((norm, colIndex) => {
      if (usedCols.has(colIndex) || !norm) return;
      for (const field of fields) {
        if (usedFields.has(field.key)) continue;
        const candidates = getCandidates(field).filter((c) => allowShort || c.length >= 3);
        const matched = allowShort
          ? candidates.includes(norm)
          : candidates.some((c) => norm === c || norm.includes(c) || c.includes(norm));
        if (matched) {
          mapping[colIndex] = field.key;
          usedFields.add(field.key);
          usedCols.add(colIndex);
          return;
        }
      }
    });
  };

  // 1) kanonik başlıkla tam eşleşme
  tryPass((f) => [normalizeHeaderLabel(f.label)], true);
  // 2) bilinen eşanlamlıyla tam eşleşme
  tryPass((f) => f.aliases.map(normalizeHeaderLabel), true);
  // 3) alt-dize eşleşmesi (yalnızca 3+ karakter — "p1" gibi kısa adaylar hariç)
  tryPass((f) => [normalizeHeaderLabel(f.label), ...f.aliases.map(normalizeHeaderLabel)], false);

  return mapping;
}

/** mapping'te verilen field'a atanan kolonun ham değerini döner (yoksa undefined). */
function readMappedValue(cols: unknown[], mapping: ColumnMapping, fieldKey: string): unknown {
  for (const [idxStr, key] of Object.entries(mapping)) {
    if (key === fieldKey) return cols[Number(idxStr)];
  }
  return undefined;
}

/**
 * Eşlemeye göre tek bir veri satırını nesneye çevirir. `parseXlsMatrixRow`
 * ile aynı alan adlarını ve aynı tip/varsayılan davranışını üretir — tek
 * fark, hangi kolonun hangi alana karşılık geldiğinin artık HARİTADAN
 * (kullanıcı onaylı veya otomatik tahmin) gelmesi, sabit pozisyondan değil.
 */
export function buildRowFromMapping(
  cols: unknown[],
  mapping: ColumnMapping,
  defaults: XlsRowDefaults
): Record<string, unknown> | null {
  if (!cols || cols.length === 0) return null;

  const get = (key: string) => readMappedValue(cols, mapping, key);

  const productTitleRaw = String(get("productTitle") ?? "").trim();
  const orderNumberRaw = String(get("orderNumber") ?? "").trim();
  if (!productTitleRaw && !orderNumberRaw) return null;

  const result: Record<string, unknown> = {};
  for (const field of IMPORT_FIELDS) {
    const raw = get(field.key);
    switch (field.key) {
      case "buyerStore":
        result.buyerStore = String(raw ?? defaults.defaultStore).trim() || defaults.defaultStore;
        continue;
      case "orderDate":
        result.orderDate = excelCellToDateStr(raw) || new Date().toISOString().split("T")[0];
        continue;
      case "productTitle":
        result.productTitle = productTitleRaw || defaults.defaultProductTitle;
        continue;
      case "asin":
        result.asin = String(raw ?? "").trim().toUpperCase();
        continue;
      case "orderNumber":
        result.orderNumber =
          orderNumberRaw || `WO-${Math.floor(10000000 + Math.random() * 90000000)}`;
        continue;
      case "driveLink":
        result.driveLink = String(raw || defaults.defaultDriveLink || "").trim();
        continue;
      case "correctedCost": {
        const totalCostVal = result.totalCost as string | undefined;
        result.correctedCost = String(raw || totalCostVal || "0").replace(",", ".");
        continue;
      }
    }

    switch (field.type) {
      case "count": {
        const fallback = (field.staticDefault as number | null | undefined) ?? null;
        result[field.key] = Number(raw) || fallback;
        break;
      }
      case "money": {
        const fallback = (field.staticDefault as string | undefined) || "0";
        result[field.key] = String(raw || fallback).replace(",", ".");
        break;
      }
      default: {
        const fallback = (field.staticDefault as string | undefined) || "";
        result[field.key] = String(raw || fallback).trim();
      }
    }
  }

  return result;
}

/** Ham 2D matrisi (ilk satır başlık), verilen kolon eşlemesine göre satır nesnelerine çevirir. */
export function buildRowsFromMapping(
  rawMatrix: unknown[][],
  mapping: ColumnMapping,
  defaults: XlsRowDefaults
): Record<string, unknown>[] {
  if (!rawMatrix || rawMatrix.length < 2) return [];
  const dataRows = rawMatrix.slice(1);
  const parsed: Record<string, unknown>[] = [];
  for (const cols of dataRows) {
    const row = buildRowFromMapping(cols as unknown[], mapping, defaults);
    if (row) parsed.push(row);
  }
  return parsed;
}
