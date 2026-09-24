/**
 * CERBERUS — Mağaza Rutin Kataloğu
 *
 * Kaynak: kullanıcının yüklediği "Amazon Mağaza Ekibi Rutin" belgesi.
 *
 * ÖNEMLİ: Belgenin kendisi 5 rol öngörüyordu (Mağaza Yöneticisi, Envanter/
 * Stok Sorumlusu, PPC Uzmanı, Müşteri Hizmetleri, Listing/İçerik Sorumlusu).
 * Kullanıcı belgeye eklediği notta bunun GERÇEK yapısını yansıtmadığını
 * söyledi: her mağazada TEK operatör (o mağazanın STORE_USER'ı) bu
 * görevlerin hepsini yapıyor. Bu yüzden katalog rol bazlı değil; belgedeki
 * görev listesi konsolide edilip TEK bir listeye indirildi.
 *
 * Bu katalog kasıtlı olarak DB'de değil, kod içinde statik tutulur — görev
 * metinleri mağazadan mağazaya değişmiyor (konsolide tek operatör modeli).
 * Yalnızca TAMAMLANMA kayıtları veritabanına yazılır
 * (bkz. src/db/schema.ts → routineCompletions, src/domain/storeRoutines.ts).
 */

export type RoutineFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RoutineDefinition {
  id: string;
  frequency: RoutineFrequency;
  title: string;
  description: string;
  /** Kritik rutin — belge bunlar için "ekran görüntüsü veya kısa not" kanıtı istiyor */
  requiresEvidence: boolean;
}

/**
 * Bu tarihten ÖNCEKİ dönemler asla "gecikmiş" sayılmaz — özellik bugün
 * devreye giriyor, geçmişe dönük sahte "kaçırıldı" bayrağı üretilmez.
 */
export const ROUTINE_TRACKING_STARTED_AT = "2026-09-25T00:00:00.000Z";

export const ROUTINE_CATALOG: RoutineDefinition[] = [
  // ---- GÜNLÜK ----
  {
    id: "daily-orders-shipping",
    frequency: "DAILY",
    title: "Sipariş ve kargo durumu kontrolü",
    description: "Yeni siparişler, kargo durumu ve gecikmeler gözden geçirilir.",
    requiresEvidence: false,
  },
  {
    id: "daily-buyer-messages",
    frequency: "DAILY",
    title: "Alıcı mesajlarına yanıt",
    description: "Bekleyen tüm alıcı mesajları zamanında yanıtlanır.",
    requiresEvidence: false,
  },
  {
    id: "daily-critical-stock",
    frequency: "DAILY",
    title: "Kritik SKU stok kontrolü",
    description: "Hızlı satan/az stoklu SKU'larda tükenme riski kontrol edilir.",
    requiresEvidence: false,
  },
  {
    id: "daily-account-health",
    frequency: "DAILY",
    title: "Hesap sağlığı panosu kontrolü",
    description: "Amazon Hesap Sağlığı panosunda yeni uyarı/ihlal var mı bakılır.",
    requiresEvidence: true,
  },
  {
    id: "daily-negative-reviews",
    frequency: "DAILY",
    title: "Olumsuz yorum taraması",
    description: "Yeni düşük puanlı yorumlar taranır, gerekirse yanıtlanır/eskale edilir.",
    requiresEvidence: true,
  },
  {
    id: "daily-ppc-acos",
    frequency: "DAILY",
    title: "Reklam/ACOS günlük kontrolü",
    description: "Kampanya harcaması ve ACOS'ta anormal sıçrama olup olmadığı kontrol edilir.",
    requiresEvidence: false,
  },
  // ---- HAFTALIK ----
  {
    id: "weekly-ppc-optimization",
    frequency: "WEEKLY",
    title: "PPC kampanya optimizasyonu",
    description: "Anahtar kelime/hedefleme performansına göre teklif ve bütçe ayarlanır.",
    requiresEvidence: false,
  },
  {
    id: "weekly-fba-shipment-planning",
    frequency: "WEEKLY",
    title: "FBA sevkiyat planlaması",
    description: "Gelecek haftanın sevkiyat ihtiyacı stok projeksiyonuna göre planlanır.",
    requiresEvidence: false,
  },
  {
    id: "weekly-listing-review",
    frequency: "WEEKLY",
    title: "Listing/içerik gözden geçirme",
    description: "Başlık, madde işareti, görsel ve A+ içerik güncelliği kontrol edilir.",
    requiresEvidence: false,
  },
  {
    id: "weekly-competitor-pricing",
    frequency: "WEEKLY",
    title: "Rakip fiyat analizi",
    description: "Ana rakiplerin fiyat/BuyBox hareketleri incelenir.",
    requiresEvidence: false,
  },
  {
    id: "weekly-storage-fees",
    frequency: "WEEKLY",
    title: "Depolama ücretleri kontrolü",
    description: "Uzun vadeli depolama ücreti riski taşıyan stok kalemleri belirlenir.",
    requiresEvidence: false,
  },
  {
    id: "weekly-kpi-report",
    frequency: "WEEKLY",
    title: "Haftalık KPI raporu",
    description: "Satış, harcama ve kâr özetinin haftalık özeti çıkarılır.",
    requiresEvidence: true,
  },
  // ---- AYLIK ----
  {
    id: "monthly-health-pnl",
    frequency: "MONTHLY",
    title: "Hesap sağlığı + P&L değerlendirmesi",
    description: "Aylık kâr/zarar tablosu ve hesap sağlığı trendi birlikte değerlendirilir.",
    requiresEvidence: true,
  },
  {
    id: "monthly-supply-chain",
    frequency: "MONTHLY",
    title: "Tedarik zinciri gözden geçirme",
    description: "Tedarikçi performansı ve alternatif tedarikçi ihtiyacı gözden geçirilir.",
    requiresEvidence: false,
  },
  {
    id: "monthly-new-product-opportunities",
    frequency: "MONTHLY",
    title: "Yeni ürün fırsatları araştırması",
    description: "Genişleme için yeni ürün/niş fırsatları araştırılır.",
    requiresEvidence: false,
  },
  {
    id: "monthly-storage-cleanup",
    frequency: "MONTHLY",
    title: "Depolama temizliği",
    description: "Durgun/fazla stok için removal veya disposal kararı alınır.",
    requiresEvidence: false,
  },
  {
    id: "monthly-ad-budget-planning",
    frequency: "MONTHLY",
    title: "Aylık reklam bütçesi planlaması",
    description: "Gelecek ayın reklam bütçesi geçen ayın performansına göre belirlenir.",
    requiresEvidence: false,
  },
];

export function routineById(id: string): RoutineDefinition | undefined {
  return ROUTINE_CATALOG.find((r) => r.id === id);
}
