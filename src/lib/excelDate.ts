/**
 * Excel/Google Sheets hücresinden gelen bir tarih değerini "YYYY-MM-DD"
 * metnine çevirir.
 *
 * Neden gerekli: `cellDates: true` verilmeden okunan bir Excel tarih hücresi
 * ham "serial number" olarak gelir (ör. 44281). Bu sayı doğrudan
 * `new Date("44281")`'e verilirse JS onu "yıl 44281" olarak yorumlar ve
 * Postgres timestamp sütununda "22009 time zone displacement out of range"
 * hatası verir — bir üretim importunda 180 satırı bu şekilde kaybettik.
 * `cellDates: true` ile okunan dosyalarda hücre zaten bir Date nesnesidir;
 * bu fonksiyon hem o durumu hem de (savunma amaçlı) çıplak serial sayı ve
 * yaygın DD/MM/YYYY biçimlerini ele alır.
 */
export function excelCellToDateStr(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY veya DD.MM.YYYY
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Excel serial sayısı (cellDates başarısız olursa yedek yol) — makul aralık: ~1954-2064
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 60000) {
      const epoch = Date.UTC(1899, 11, 30);
      return new Date(epoch + Math.round(serial) * 86400000).toISOString().slice(0, 10);
    }
  }
  return "";
}
