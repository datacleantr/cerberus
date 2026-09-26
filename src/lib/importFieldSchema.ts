/**
 * XLS/Drive içe aktarımının "kolon eşleme" ve "tip kontrolü" katmanının tek
 * kaynağı.
 *
 * Önceden `xlsRowMapping.ts` yalnızca POZİSYONEL çalışıyordu: satırın 0.
 * kolonu her zaman "buyerStore", 14. kolonu her zaman "quantity" kabul
 * edilirdi — dosyanın başlık satırı hiç OKUNMAZDI. Kullanıcının kendi
 * standardındaki (`XLS_40_COLUMNS`, bkz. ordersCsv.ts) bir dosya için bu
 * sorunsuzdu, ama farklı bir tedarikçi/depo formatından gelen, kolon sırası
 * veya adları farklı bir XLS/Drive tablosu sessizce YANLIŞ eşlenirdi (ör.
 * "Ürün Adedi" kolonu "unitCost" sütununa denk gelirse, iki değer de sayısal
 * göründüğü için hiçbir hata vermeden yer değiştirir).
 *
 * Bu dosya, her hedef alan için: kanonik başlık (XLS_40_COLUMNS ile aynı
 * kaynak), bilinen başlık eşanlamlıları (aliases) ve beklenen veri TİPİNİ
 * tutar. `xlsRowMapping.ts` bunu hem otomatik kolon eşleme önerisi
 * (`guessColumnMapping`) hem de eşleme sonrası satır üretimi
 * (`buildRowFromMapping`) için kullanır; UI ise aynı katalogla her kolonun
 * örnek değerlerinin beklenen tiple uyuşup uyuşmadığını (tip kontrolü)
 * kullanıcıya gösterir.
 */
import { XLS_40_COLUMNS } from "@/features/orders/ordersCsv";
import { FULFILLMENT_TYPES, CARGO_STATUSES } from "@/lib/importValidation";

export type ImportFieldType = "text" | "asin" | "count" | "money" | "date" | "enum";

export interface ImportFieldDef {
  /** orders tablosu / satır nesnesi alan adı (ör. "buyerStore") */
  key: string;
  /** Kanonik Türkçe başlık — XLS_40_COLUMNS ile birebir aynı sırada */
  label: string;
  type: ImportFieldType;
  /** Doğrulama katmanında (importValidation.ts) zorunlu tutulan alanlar */
  required: boolean;
  /** Başlık eşleştirmede denenecek ek varyantlar (Türkçe/İngilizce/kısaltma) */
  aliases: string[];
  enumValues?: readonly string[];
  /** Statik varsayılan değer. Dinamik varsayılanlar (mağaza/ürün adı/tarih/
   * drive linki/sipariş no/düzeltilmiş maliyet) buildRowFromMapping içinde
   * özel olarak ele alınır — bkz. xlsRowMapping.ts. */
  staticDefault?: string | number | null;
}

/**
 * XLS_40_COLUMNS ile AYNI SIRADA — index eşlemesi burada da korunur, çünkü
 * eski (pozisyonel) `parseXlsMatrixRow` hâlâ bu sıraya göre çalışıyor ve bu
 * dosya onu bozmadan üstüne ekleme yapıyor (bkz. xlsRowMapping.ts başlığı).
 */
export const IMPORT_FIELDS: ImportFieldDef[] = [
  { key: "buyerStore", label: XLS_40_COLUMNS[0], type: "text", required: false,
    aliases: ["mağaza", "magaza", "mağaza kodu", "store", "store code", "buyer", "hesap", "satin alan"] },
  { key: "orderDate", label: XLS_40_COLUMNS[1], type: "date", required: false,
    aliases: ["date", "sipariş tarihi", "siparis tarihi", "order date", "purchase date"] },
  { key: "imageUrl", label: XLS_40_COLUMNS[2], type: "text", required: false,
    aliases: ["resim", "image", "image url", "photo", "görsel", "gorsel", "ürün resmi"], staticDefault: "" },
  { key: "fulfillmentType", label: XLS_40_COLUMNS[3], type: "enum", required: false,
    aliases: ["fba/fbm", "fulfillment", "fulfillment type", "gönderim tipi", "gonderim tipi"],
    enumValues: FULFILLMENT_TYPES, staticDefault: "FBA" },
  { key: "productTitle", label: XLS_40_COLUMNS[4], type: "text", required: false,
    aliases: ["ürün adı", "urun adi", "product title", "product name", "title", "ürün", "urun"] },
  { key: "asin", label: XLS_40_COLUMNS[5], type: "asin", required: true, aliases: [], staticDefault: "" },
  { key: "msku", label: XLS_40_COLUMNS[6], type: "text", required: false, aliases: ["sku"], staticDefault: "" },
  { key: "supplierName", label: XLS_40_COLUMNS[7], type: "text", required: false,
    aliases: ["tedarikçi", "tedarikci", "tedarikçi adı", "tedarikci adi", "supplier", "supplier name", "vendor"],
    staticDefault: "THE VITAMINSHOPPE" },
  { key: "supplierCode", label: XLS_40_COLUMNS[8], type: "text", required: false,
    aliases: ["tedarikçi kodu", "tedarikci kodu", "supplier code", "vendor code"], staticDefault: "A198" },
  { key: "supplierUrl", label: XLS_40_COLUMNS[9], type: "text", required: false,
    aliases: ["tedarikçi linki", "tedarikci linki", "supplier url", "supplier link"], staticDefault: "" },
  { key: "amazonUrl", label: XLS_40_COLUMNS[10], type: "text", required: false,
    aliases: ["amazon url", "listing url"], staticDefault: "" },
  { key: "orderNumber", label: XLS_40_COLUMNS[11], type: "text", required: true,
    aliases: ["order no", "order number", "sipariş no", "siparis no", "sipariş numarası", "siparis numarasi",
      "po number", "po no", "wo no"] },
  { key: "driveLink", label: XLS_40_COLUMNS[12], type: "text", required: false,
    aliases: ["drive linki", "drive link", "drive url"], staticDefault: "" },
  { key: "packCount", label: XLS_40_COLUMNS[13], type: "count", required: false,
    aliases: ["paket adedi", "pack count", "pack qty"], staticDefault: 1 },
  { key: "quantity", label: XLS_40_COLUMNS[14], type: "count", required: false,
    aliases: ["adet", "quantity", "qty", "miktar"], staticDefault: 1 },
  { key: "unitCost", label: XLS_40_COLUMNS[15], type: "money", required: false,
    aliases: ["birim maliyet", "unit cost", "cost", "birim fiyat"], staticDefault: "0" },
  { key: "sellingPrice", label: XLS_40_COLUMNS[16], type: "money", required: false,
    aliases: ["satış fiyatı", "satis fiyati", "selling price", "price"], staticDefault: "0" },
  { key: "totalCost", label: XLS_40_COLUMNS[17], type: "money", required: false,
    aliases: ["toplam maliyet", "total cost", "toplam tutar"], staticDefault: "0" },
  { key: "orderEmail", label: XLS_40_COLUMNS[18], type: "text", required: false,
    aliases: ["e-posta", "eposta", "email", "sipariş e-postası", "order email"], staticDefault: "" },
  { key: "cargoStatus", label: XLS_40_COLUMNS[19], type: "enum", required: false,
    aliases: ["cargo status", "shipping status", "kargo"], enumValues: CARGO_STATUSES, staticDefault: "Tam Geldi" },
  { key: "shippedToAmazon", label: XLS_40_COLUMNS[20], type: "count", required: false,
    aliases: ["shipped to amazon", "gönderilen adet", "gonderilen adet"], staticDefault: 0 },
  { key: "p1CancelQty", label: XLS_40_COLUMNS[21], type: "count", required: false,
    aliases: ["iptal adet", "cancel qty"], staticDefault: 0 },
  { key: "p2MissingQty", label: XLS_40_COLUMNS[22], type: "count", required: false,
    aliases: ["eksik adet", "missing qty"], staticDefault: 0 },
  { key: "p3DefectiveQty", label: XLS_40_COLUMNS[23], type: "count", required: false,
    aliases: ["defolu adet", "defective qty"], staticDefault: 0 },
  { key: "p4ExpiredQty", label: XLS_40_COLUMNS[24], type: "count", required: false,
    aliases: ["tarihi geçmiş adet", "tarihi gecmis adet", "expired qty"], staticDefault: 0 },
  { key: "problemAction", label: XLS_40_COLUMNS[25], type: "text", required: false,
    aliases: ["problem action"], staticDefault: "" },
  { key: "problemResult", label: XLS_40_COLUMNS[26], type: "text", required: false,
    aliases: ["problem result", "problem sonucu"], staticDefault: "" },
  { key: "refundAmount", label: XLS_40_COLUMNS[27], type: "money", required: false,
    aliases: ["refund amount", "iade tutarı", "iade tutari", "iade miktarı", "iade miktari"], staticDefault: "0" },
  { key: "creditCard", label: XLS_40_COLUMNS[28], type: "text", required: false,
    aliases: ["credit card", "kart"], staticDefault: "" },
  { key: "isFragile", label: XLS_40_COLUMNS[29], type: "enum", required: false,
    aliases: ["kırılgan", "kirilgan"], enumValues: ["YES", "NO"], staticDefault: "NO" },
  { key: "isMultiPack", label: XLS_40_COLUMNS[30], type: "enum", required: false,
    aliases: ["multi pack", "çoklu paket", "coklu paket"], enumValues: ["YES", "NO"], staticDefault: "NO" },
  { key: "isBundle", label: XLS_40_COLUMNS[31], type: "enum", required: false,
    aliases: ["paket ürün", "paket urun"], enumValues: ["YES", "NO"], staticDefault: "NO" },
  { key: "countPerBundle", label: XLS_40_COLUMNS[32], type: "count", required: false,
    aliases: ["bundle adedi", "bundle count"], staticDefault: null },
  { key: "condition", label: XLS_40_COLUMNS[33], type: "text", required: false,
    aliases: ["durum", "ürün durumu", "urun durumu"], staticDefault: "New" },
  { key: "brandName", label: XLS_40_COLUMNS[34], type: "text", required: false,
    aliases: ["brand", "brand name", "marka"], staticDefault: "General" },
  { key: "description1", label: XLS_40_COLUMNS[35], type: "text", required: false,
    aliases: ["description1", "açıklama 1", "aciklama 1"], staticDefault: "" },
  { key: "description2", label: XLS_40_COLUMNS[36], type: "text", required: false,
    aliases: ["description2", "açıklama 2", "aciklama 2"], staticDefault: "" },
  { key: "auditNote", label: XLS_40_COLUMNS[37], type: "text", required: false,
    aliases: ["audit note"], staticDefault: "" },
  { key: "periodCode", label: XLS_40_COLUMNS[38], type: "text", required: false,
    aliases: ["period code", "dönem", "donem"], staticDefault: "Ş26" },
  { key: "correctedCost", label: XLS_40_COLUMNS[39], type: "money", required: false,
    aliases: ["corrected cost"] },
];

export const IMPORT_FIELD_TYPE_LABELS: Record<ImportFieldType, string> = {
  text: "Metin",
  asin: "ASIN",
  count: "Sayı (adet)",
  money: "Para ($)",
  date: "Tarih",
  enum: "Liste (sabit değerler)",
};

/** Türkçe başlığı karşılaştırılabilir hâle getirir: küçük harf, ASCII, tek boşluk. */
export function normalizeHeaderLabel(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/İ/g, "I").replace(/I/g, "i").toLowerCase();
  s = s
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
  s = s.replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return s;
}

export type ColumnSampleType = "number" | "date" | "text" | "empty";

/** Bir kolonun örnek (başlık hariç) ham değerlerinden veri tipini tahmin eder. */
export function detectColumnSampleType(rawValues: unknown[]): ColumnSampleType {
  const nonEmpty = rawValues.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (nonEmpty.length === 0) return "empty";

  const isDateVal = (v: unknown): boolean => {
    if (v instanceof Date) return true;
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}([ T]|$)/.test(s) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s);
  };
  const isNumberVal = (v: unknown): boolean => {
    if (typeof v === "number") return Number.isFinite(v);
    if (v instanceof Date) return false;
    const s = String(v).trim().replace(/[$€£₺\s]/g, "");
    if (!s) return false;
    return /^-?\d+([.,]\d+)?$/.test(s);
  };

  if (nonEmpty.every(isDateVal)) return "date";
  if (nonEmpty.every(isNumberVal)) return "number";
  return "text";
}

/** Beklenen alan tipi ile kolonun tespit edilen örnek tipi uyuşuyor mu? */
export function isColumnTypeCompatible(fieldType: ImportFieldType, detected: ColumnSampleType): boolean {
  if (detected === "empty") return true;
  switch (fieldType) {
    case "money":
    case "count":
      return detected === "number";
    case "date":
      return detected === "date" || detected === "number"; // excel serial tarihleri de sayı görünür
    default:
      return true; // text / asin / enum: serbest, yanlış-pozitif üretmesin
  }
}
