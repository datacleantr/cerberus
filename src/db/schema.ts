import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. Users table (Preserved users with password_hash, store assignment & role)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Varsayılan parola kaldırıldı (F-03/F-04): her kayıt açıkça bcrypt hash'iyle yazılmalı
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("STORE_USER"), // 'ADMIN' | 'MANAGER' | 'STORE_USER'
  storeCode: text("store_code").notNull().default("HRN"), // e.g. 'HRN', 'ALL' for admin
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 2. Stores Table (26 Multi-Store Fleet & Admin Management)
export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  storeCode: text("store_code").notNull().unique(), // e.g. 'HRN', 'SEL', 'MK', 'AMZ-US-01'
  storeName: text("store_name").notNull(), // e.g. 'HRN Amazon Storefront'
  marketplace: text("marketplace").notNull().default("AMAZON"), // 'AMAZON' | 'WALMART' | 'SHOPIFY' | 'WHOLESALE'
  buyerName: text("buyer_name").notNull().default("Harun"),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("ACTIVE"), // 'ACTIVE' | 'PASSIVE'
  defaultCard: text("default_card"),
  defaultEmail: text("default_email"),
  notes: text("notes"),
  accountHealthScore: integer("account_health_score").notNull().default(98),
  totalOrdersCount: integer("total_orders_count").notNull().default(0),
  totalSpend: numeric("total_spend", { precision: 12, scale: 2 }).notNull().default("0.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 3. 10-Person US Sourcing Specialists (Quality-Adjusted Researcher Score)
export const researchers = pgTable("researchers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // e.g. 'SRC-01'
  name: text("name").notNull(),
  email: text("email").notNull(),
  specialtyDomain: text("specialty_domain").notNull(), // e.g. 'Home Depot & Lowe's Clearance Arbitrage'
  discoveryVolume: integer("discovery_volume").notNull().default(0),
  approvalRate: numeric("approval_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  purchaseConversion: numeric("purchase_conversion", { precision: 5, scale: 2 }).notNull().default("0.00"),
  averageRoi: numeric("average_roi", { precision: 6, scale: 2 }).notNull().default("0.00"),
  averageNetProfit: numeric("average_net_profit", { precision: 10, scale: 2 }).notNull().default("0.00"),
  problemRate: numeric("problem_rate", { precision: 5, scale: 2 }).notNull().default("0.00"),
  researcherScore: integer("researcher_score").notNull().default(85), // Quality-adjusted 0-100 score
  activeListingsCount: integer("active_listings_count").notNull().default(0),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 4. Research Sessions (Phase 5 Sourcing Engine Tracking)
export const researchSessions = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  sessionCode: text("session_code").notNull().unique(), // e.g. 'SES-2026-0827-01'
  researcherCode: text("researcher_code").notNull(),
  researcherName: text("researcher_name").notNull(),
  sourceDomain: text("source_domain").notNull(), // 'homedepot.com', 'ulta.com'
  productsFound: integer("products_found").notNull().default(0),
  productsApproved: integer("products_approved").notNull().default(0),
  sessionQualityScore: integer("session_quality_score").notNull().default(90),
  startedAt: timestamp("started_at").defaultNow().notNull(),
});

// 5. Product Master Decision Vault (Product ≠ Listing + Decision Engine + Evidence Chain)
export const productMasters = pgTable("product_masters", {
  id: serial("id").primaryKey(),
  productCode: text("product_code").notNull().unique(), // e.g. 'CRB-2026-9041'
  title: text("title").notNull(),
  brand: text("brand").notNull(),
  category: text("category").notNull(),
  upc: text("upc").notNull(),
  asin: text("asin").notNull(),
  msku: text("msku").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceDomain: text("source_domain").notNull(),
  supplierName: text("supplier_name").notNull(),
  researcherCode: text("researcher_code").notNull().default("SRC-01"),
  researcherName: text("researcher_name").notNull(),

  // 13-Stage Cerberus Lifecycle
  lifecycleStage: text("lifecycle_stage").notNull().default("APPROVED"),

  // Data Quality & Freshness Engine (Gap Phase 7 & 8)
  dataQualityStatus: text("data_quality_status").notNull().default("VALID"),
  // 'VALID' | 'INVALID' | 'MISSING' | 'STALE' | 'CONFLICTING'
  dataFreshnessStatus: text("data_freshness_status").notNull().default("FRESH"),
  // 'FRESH' | 'AGING' | 'STALE' | 'EXPIRED'
  observedAt: timestamp("observed_at").defaultNow().notNull(),

  // Commercial Decision Intelligence Engine (Gap Phase 12 & 13)
  decisionAction: text("decision_action").notNull().default("BUY"),
  // 'BUY' | 'TEST' | 'WAIT' | 'REJECT' | 'REPRICE' | 'REORDER' | 'PAUSE' | 'LIQUIDATE'
  confidenceScore: integer("confidence_score").notNull().default(88), // 0-100%
  riskLevel: text("risk_level").notNull().default("LOW"), // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  policyStatus: text("policy_status").notNull().default("APPROVED_BY_POLICY"),
  // 'APPROVED_BY_POLICY' | 'REQUIRES_MANAGER_APPROVAL' | 'FLAGGED_IP_RISK'

  // Landed Cost & Profitability
  sourcePrice: numeric("source_price", { precision: 10, scale: 2 }).notNull(),
  prepCost: numeric("prep_cost", { precision: 10, scale: 2 }).notNull().default("1.35"),
  marketplaceFee: numeric("marketplace_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  fulfillmentFee: numeric("fulfillment_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
  landedCost: numeric("landed_cost", { precision: 10, scale: 2 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  estimatedNetProfit: numeric("estimated_net_profit", { precision: 10, scale: 2 }).notNull(),
  roiPercent: numeric("roi_percent", { precision: 7, scale: 2 }).notNull(),
  actualRoiPercent: numeric("actual_roi_percent", { precision: 7, scale: 2 }), // Actual vs Estimated Engine

  // Duplicate Detection Score (0-100)
  duplicateScore: integer("duplicate_score").notNull().default(12),
  duplicateStatus: text("duplicate_status").notNull().default("CLEAR"),

  // AI Opportunity Radar Sub-Scores (0-100)
  profitabilityScore: integer("profitability_score").notNull().default(88),
  demandScore: integer("demand_score").notNull().default(92),
  competitionScore: integer("competition_score").notNull().default(78),
  priceStabilityScore: integer("price_stability_score").notNull().default(85),
  supplierRiskScore: integer("supplier_risk_score").notNull().default(94),
  operationalRiskScore: integer("operational_risk_score").notNull().default(90),
  opportunityScore: integer("opportunity_score").notNull().default(88),

  // Evidence Chain JSONB (Phase 30)
  evidenceChain: jsonb("evidence_chain").notNull().default([]),
  // Multi-Store channel allocations JSONB
  channelListings: jsonb("channel_listings").notNull().default([]),
  // Cost & Price History JSONB
  costHistory: jsonb("cost_history").notNull().default([]),

  notes: text("notes"),
  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
(t) => [
  // ── Aşama 0: Karar kasası bütünlüğü (B-04, B-05) ──
  index("product_masters_asin_idx").on(t.asin),

  check("pm_prices_non_negative", sql`
    ${t.sourcePrice} >= 0 and ${t.landedCost} >= 0 and ${t.sellingPrice} >= 0`),

  // Skorlar 0-100 bandının dışına çıkamaz. Bir hesap hatası skoru 1000
  // yaparsa fırsat sıralaması sessizce anlamsızlaşırdı.
  check("pm_scores_in_range", sql`
    ${t.confidenceScore} between 0 and 100
    and ${t.opportunityScore} between 0 and 100
    and ${t.profitabilityScore} between 0 and 100
    and ${t.demandScore} between 0 and 100
    and ${t.competitionScore} between 0 and 100
    and ${t.priceStabilityScore} between 0 and 100
    and ${t.supplierRiskScore} between 0 and 100
    and ${t.operationalRiskScore} between 0 and 100`),
  check("pm_duplicate_score_in_range", sql`${t.duplicateScore} between 0 and 100`),

  check("pm_decision_action_enum", sql`${t.decisionAction} in
    ('BUY', 'TEST', 'WAIT', 'REJECT', 'REPRICE', 'REORDER', 'PAUSE', 'LIQUIDATE')`),
  check("pm_risk_level_enum", sql`${t.riskLevel} in
    ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`),
  check("pm_policy_status_enum", sql`${t.policyStatus} in
    ('APPROVED_BY_POLICY', 'REQUIRES_MANAGER_APPROVAL', 'FLAGGED_IP_RISK')`),
  check("pm_freshness_enum", sql`${t.dataFreshnessStatus} in
    ('FRESH', 'AGING', 'STALE', 'EXPIRED')`),
  check("pm_quality_enum", sql`${t.dataQualityStatus} in
    ('VALID', 'INVALID', 'MISSING', 'STALE', 'CONFLICTING')`),
]);

// ============================================================================
// AŞAMA 1 — ÜRÜN MERKEZLİ ÇEKİRDEK
//
// Denetim bulguları B-01/B-02/B-03 (docs/audit/04) bu tablolarla kapatılır.
//
// Tasarım ilkesi: HIZLI DEĞİŞEN veriyle HİÇ DEĞİŞMEYEN veri ayrılır.
//   products         → ürünün değişmeyen kimliği (başlık, marka, ASIN)
//   supplierOffers   → tedarikçi fiyatının ZAMAN SERİSİ (günlük değişir)
//   productLifecycle → ürünün yolculuğundaki her durak (olay defteri)
//
// Bu ayrım olmadan fiyat geçmişi ya kaybolur ya da başlık N kez tekrarlanır.
// Mevcut veride her ikisi de oluyordu: %50.8 tekrar + JSONB'de gömülü fiyat.
// ============================================================================

/**
 * 9. PRODUCTS — Ürünün tek doğruluk kaynağı (Single Source of Truth)
 *
 * Sistemin kalbi. Bir ASIN burada BİR kez yaşar; siparişler, teklifler ve
 * yaşam döngüsü olayları buraya bağlanır.
 *
 * `orders` tablosundaki ürün alanları (productTitle, brandName, imageUrl…)
 * geçiş boyunca korunur ama doğruluk kaynağı artık burasıdır.
 */
export const products = pgTable("products", {
  id: serial("id").primaryKey(),

  // Kimlik — ASIN pazaryeri kimliği, UPC üretici kimliği
  asin: text("asin").notNull().unique(),
  upc: text("upc"),
  title: text("title").notNull(),
  brand: text("brand").notNull().default("General"),
  category: text("category").notNull().default("UNCATEGORIZED"),
  imageUrl: text("image_url"),
  amazonUrl: text("amazon_url"),

  // Fiziksel nitelikler — kargo ve prep maliyetini etkiler
  isFragile: boolean("is_fragile").notNull().default(false),
  isMultiPack: boolean("is_multipack").notNull().default(false),
  isBundle: boolean("is_bundle").notNull().default(false),
  countPerBundle: integer("count_per_bundle"),
  packCount: integer("pack_count").notNull().default(1),

  /**
   * Ürünün yolculuktaki mevcut durağı. Kullanıcının tarif ettiği akış:
   * keşif → analiz → puanlama → onay → satın alma → depo → listeleme →
   * satış → izleme → (gerekirse) durdurma
   */
  lifecycleStage: text("lifecycle_stage").notNull().default("DISCOVERED"),

  /** Ürün aktif takipte mi, yoksa durduruldu mu? */
  isActive: boolean("is_active").notNull().default(true),

  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
(t) => [
  index("products_brand_idx").on(t.brand),
  index("products_lifecycle_idx").on(t.lifecycleStage),
  index("products_active_idx").on(t.isActive),

  check("products_lifecycle_enum", sql`${t.lifecycleStage} in (
    'DISCOVERED', 'ANALYZING', 'SCORED', 'APPROVED', 'REJECTED',
    'PURCHASING', 'IN_WAREHOUSE', 'LISTED', 'SELLING', 'MONITORING',
    'PAUSED', 'DISCONTINUED')`),
  check("products_pack_count_positive", sql`${t.packCount} > 0`),
  check("products_bundle_count_positive", sql`
    ${t.countPerBundle} is null or ${t.countPerBundle} > 0`),
]);

/**
 * 10. SUPPLIER_OFFERS — Tedarikçi fiyatının zaman serisi
 *
 * Denetim bulgusu B-02: gerçek veride B0DGQX1FS7'nin maliyeti iki günde
 * $29.99 → $26.24 düşmüştü (-%12.5). Bu bir hata değil, arbitraj sinyaliydi;
 * ama şema onu saklayamıyordu (JSONB `costHistory` sorgulanamaz).
 *
 * Artık her fiyat gözlemi bir satırdır. "Maliyeti düşen ürünler" sorgusu
 * pencere fonksiyonuyla yazılabilir hale gelir.
 */
export const supplierOffers = pgTable("supplier_offers", {
  id: serial("id").primaryKey(),

  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),

  supplierName: text("supplier_name").notNull(),
  supplierCode: text("supplier_code"),
  sourceUrl: text("source_url"),
  sourceDomain: text("source_domain"),

  /** Gözlem anındaki birim fiyat */
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  inStock: boolean("in_stock").notNull().default(true),

  /**
   * Fiyatın GÖZLENDİĞİ an. Veri tazeliği (dataFreshness motoru) artık
   * ayrı bir metin alanı değil, bu damganın yaşıdır.
   */
  observedAt: timestamp("observed_at").defaultNow().notNull(),

  /** Gözlem nereden geldi: manuel giriş, XLS import, ileride scraper/API */
  sourceType: text("source_type").notNull().default("XLS_IMPORT"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
},
(t) => [
  // En sık sorgu: "bu ürünün son fiyatı" → (product_id, observed_at desc)
  index("supplier_offers_product_observed_idx").on(t.productId, t.observedAt),
  index("supplier_offers_supplier_idx").on(t.supplierName),

  check("supplier_offers_price_non_negative", sql`${t.unitPrice} >= 0`),
  check("supplier_offers_source_type_enum", sql`${t.sourceType} in (
    'XLS_IMPORT', 'MANUAL', 'SCRAPER', 'API', 'MIGRATION')`),
]);

/**
 * 11. PRODUCT_LIFECYCLE_EVENTS — Ürünün hafızası
 *
 * "Ve bütün bu yolculuk boyunca Cerberus hafızasını büyütür."
 *
 * Her durak bir olaydır: ne zaman, kim tarafından, hangi durumdan hangi
 * duruma. Bu tablo olmadan ürünün geçmişi yalnızca "şu an neredeyiz"
 * bilgisine indirgenir — nasıl geldiğimiz kaybolur.
 */
export const productLifecycleEvents = pgTable("product_lifecycle_events", {
  id: serial("id").primaryKey(),

  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),

  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),

  /** Olayı tetikleyen: kullanıcı adı ya da 'SYSTEM' */
  actorName: text("actor_name").notNull().default("SYSTEM"),

  /** Kararın gerekçesi — denetlenebilirlik için zorunlu alan değil ama önemli */
  reason: text("reason"),

  /** Olay anındaki ölçüm bağlamı (ROI, skor vb.) — denetim izi */
  contextSnapshot: jsonb("context_snapshot").notNull().default({}),

  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
},
(t) => [
  index("lifecycle_events_product_time_idx").on(t.productId, t.occurredAt),
  check("lifecycle_events_to_stage_enum", sql`${t.toStage} in (
    'DISCOVERED', 'ANALYZING', 'SCORED', 'APPROVED', 'REJECTED',
    'PURCHASING', 'IN_WAREHOUSE', 'LISTED', 'SELLING', 'MONITORING',
    'PAUSED', 'DISCONTINUED')`),
]);

// 6. Orders Master Table (Exact 40-Column Google Drive XLS Structure + PSH & Inventory Lab)
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),

    // Kolon 1-5: Temel & Amazon Kimlikleri
    // T2.2: Mağaza referansı artık FK ile DB seviyesinde zorlanır
    buyerStore: text("buyer_store")
      .notNull()
      .default("HRN")
      .references(() => stores.storeCode), // 1. Satın Alan (HRN vb.)
    orderDate: text("order_date").notNull(), // 2. Tarih (YYYY-MM-DD)
  imageUrl: text("image_url"), // 3. Ürün resmi linki
  fulfillmentType: text("fulfillment_type").notNull().default("FBA"), // 4. FBM/FBA
  productTitle: text("product_title").notNull(), // 5. Ürün adı Amazon

  // Kolon 6-11: ASIN, MSKU, Tedarikçi & Linkler
  asin: text("asin").notNull(), // 6. ASIN
  msku: text("msku").notNull(), // 7. MSKU
  supplierName: text("supplier_name").notNull(), // 8. Satıcı adı (THE VITAMINSHOPPE vb.)
  supplierCode: text("supplier_code").default("A198"), // 9. Satıcı kodu
  supplierUrl: text("supplier_url").notNull(), // 10. Satıcı link
  amazonUrl: text("amazon_url").notNull(), // 11. Amazon link

  // Kolon 12-14: Sipariş No, Drive, Paket
  orderNumber: text("order_number").notNull(), // 12. Orderno (WO110074776 vb.)
  driveLink: text("drive_link"), // 13. Order'ın drive linki
  packCount: integer("pack_count").notNull().default(1), // 14. Kaçlı paket

  // Kolon 15-18: Miktarlar ve Finans
  quantity: integer("quantity").notNull().default(1), // 15. Ürün adedi
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(), // 16. Ürün birim maliyeti ($)
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(), // 17. Ürün satış fiyatı ($)
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(), // 18. Ürün toplam maliyeti ($)

  // Kolon 19-21: Sipariş Maili, Kargo & Gönderim
  orderEmail: text("order_email").notNull(), // 19. Mail adresi (cerberusnisan@gmail.com vb.)
  cargoStatus: text("cargo_status").notNull().default("Yolda"), // 20. Kargo durumu — SERBEST METİN ('Yolda', 'Tam Geldi', 'İPTAL', 'Kayıp Depoya gelmiş', kargo firması notu vb.)
  shippedToAmazon: integer("shipped_to_amazon").notNull().default(0), // 21. Amazona gönderilen adet

  // Kolon 22-28: P1-P4 Fire / Problem Yönetimi
  p1CancelQty: integer("p1_cancel_qty").notNull().default(0), // 22. İptal adet-P1
  p2MissingQty: integer("p2_missing_qty").notNull().default(0), // 23. Eksik adet-P2
  p3DefectiveQty: integer("p3_defective_qty").notNull().default(0), // 24. Defolu adet-P3
  p4ExpiredQty: integer("p4_expired_qty").notNull().default(0), // 25. Tarihi geçmiş adet-P4
  problemAction: text("problem_action"), // 26. Problemle ilgili eylem
  problemResult: text("problem_result"), // 27. Problemle ilgili sonuç
  refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }).notNull().default("0.00"), // 28. Refund miktarı (R kodlu)

  // Kolon 29-35: Kredi Kartı ve Ürün Nitelikleri
  creditCard: text("credit_card"), // 29. Kredi Kartı son 4 hane; bilinmiyorsa null/boş
  isFragile: text("is_fragile").notNull().default("NO"), // 30. Fragile (YES/NO)
  isMultiPack: text("is_multipack").notNull().default("NO"), // 31. MultiPack (YES/NO)
  isBundle: text("is_bundle").notNull().default("NO"), // 32. Bundle (YES/NO)
  countPerBundle: integer("count_per_bundle"), // 33. CountPerBundle
  condition: text("condition").notNull().default("New"), // 34. Condition (New)
  brandName: text("brand_name").notNull(), // 35. Marka adı (MegaFood, Vital, FORCE vb.)

  // Kolon 36-40: Açıklamalar, Takip ve Denetim
  description1: text("description_1"), // 36. Ürünle ilgili açıklama1
  description2: text("description_2"), // 37. Ürünle ilgili açıklama2 (Tracking linki / Kargo takip no)
  auditNote: text("audit_note"), // 38. Denetim için açıklama (Depoda kayıp vb.)
  periodCode: text("period_code").default("O26"), // 39. Tarih2 / Dönem kodu (O26, Ş26 vb.)
  correctedCost: numeric("corrected_cost", { precision: 12, scale: 2 }).notNull(), // 40. Düzeltilmiş maliyet

  // PSH & Envanter Takip Entegrasyon Alanları
  // T2.2: Batch referansı FK ile zorlanır (nullable — batch'e bağlanmamış sipariş olabilir)
  /**
   * AŞAMA 1 — Ürün bağlantısı (denetim bulgusu B-03).
   *
   * Önce: orders ile product_masters ASIN METNİ üzerinden "umutla"
   * eşleşiyordu. Gerçek veride kesişim SIFIR çıkmıştı ve kimse fark
   * etmemişti — çünkü veritabanı bunu engelleyecek bir kısıt tanımıyordu.
   * Gerçekleşen ROI motorunun uydurma sayı üretmesinin kök nedeni buydu.
   *
   * Şimdi: FK garantisi + NOT NULL (Aşama 1.2 tamamlandı). Ürüne
   * bağlanmamış sipariş yazmak artık FİZİKSEL OLARAK İMKÂNSIZ.
   * Tüm yazma yolları `resolveProduct` üzerinden geçer.
   */
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),

  pshBatchNo: text("psh_batch_no").references(() => pshBatches.batchNumber), // PSH Batch Numarası (ör: BATCH-2026-01)
  pshStatus: text("psh_status").notNull().default("BEKLIYOR"), // 'BEKLIYOR' | 'BATCH_OLUSTURULDU' | 'DEPO_SAYILDI' | 'AMAZONA_SEVK'
  inventoryLabStatus: text("inventory_lab_status").notNull().default("GIRILMEDI"), // 'GIRILMEDI' | 'GIRILDI' | 'AKTIF_SATISTA'

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
// T2.3: Sorgu desenlerine gore indexler + mukerrer import engeli
(t) => [
  // Aynı order number altında FARKLI ASIN'ler geçerlidir (tek siparişte
  // birden çok ürün). Mükerrerlik ancak mağaza + sipariş no + ASIN
  // üçlüsü tekrar ederse engellenir.
  uniqueIndex("orders_order_number_store_asin_uq").on(t.orderNumber, t.buyerStore, t.asin),
  index("orders_buyer_store_date_idx").on(t.buyerStore, t.orderDate),
  index("orders_asin_idx").on(t.asin),
  index("orders_product_id_idx").on(t.productId),

  // ── Aşama 0: Veri bütünlüğü güvenlik ağı (denetim bulgusu B-04) ──
  // Veritabanı son savunma hattıdır. Bu kurallar uygulama katmanında da
  // var, ama toplu import, manuel SQL veya ileride yazılacak bir servis
  // onları atlayabilir. Buradan atlanamaz.
  check("orders_quantity_positive", sql`${t.quantity} > 0`),
  check("orders_pack_count_positive", sql`${t.packCount} > 0`),
  check("orders_unit_cost_non_negative", sql`${t.unitCost} >= 0`),
  check("orders_selling_price_non_negative", sql`${t.sellingPrice} >= 0`),
  check("orders_total_cost_non_negative", sql`${t.totalCost} >= 0`),
  check("orders_refund_non_negative", sql`${t.refundAmount} >= 0`),

  // Fire adetleri negatif olamaz
  check("orders_fire_qty_non_negative", sql`
    ${t.p1CancelQty} >= 0 and ${t.p2MissingQty} >= 0
    and ${t.p3DefectiveQty} >= 0 and ${t.p4ExpiredQty} >= 0`),
  check("orders_shipped_non_negative", sql`${t.shippedToAmazon} >= 0`),

  // Fiziksel imkânsızlık: var olandan fazlası sevk edilemez veya fire olamaz.
  // Bu kural olmadan bir import hatası sessizce ROI'yi ve sağlık skorunu
  // bozardı.
  check("orders_shipped_within_quantity", sql`${t.shippedToAmazon} <= ${t.quantity}`),
  check("orders_fire_within_quantity", sql`
    ${t.p1CancelQty} + ${t.p2MissingQty} + ${t.p3DefectiveQty} + ${t.p4ExpiredQty}
    <= ${t.quantity}`),

  // Durum alanları serbest metin olmaktan çıkar (B-05). Türkçe karakterli
  // string karşılaştırması artık yazım hatasına karşı korunur.
  // NOT: Kargo durumu (cargo_status) bilinçli olarak serbest metindir —
  // kargo firmalarının XLS'e serbest yazabildiği bir alandır ve enum'a
  // zorlamak içe aktarımda satır kaybına yol açıyordu.
  check("orders_psh_status_enum", sql`${t.pshStatus} in
    ('BEKLIYOR', 'BATCH_OLUSTURULDU', 'DEPO_SAYILDI', 'AMAZONA_SEVK')`),
  check("orders_inventory_lab_status_enum", sql`${t.inventoryLabStatus} in
    ('GIRILMEDI', 'GIRILDI', 'AKTIF_SATISTA')`),
  check("orders_fulfillment_type_enum", sql`${t.fulfillmentType} in ('FBA', 'FBM', 'RETURN', 'REMOVAL_ORDER')`),
]);

// 7. PSH Batch Master Table (PSH Programı Ön-Envanter Gruplama)
export const pshBatches = pgTable("psh_batches", {
  id: serial("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(), // e.g. 'PSH-2026-01-21'
  storeCode: text("store_code").notNull().default("HRN"),
  title: text("title").notNull(), // e.g. 'Ocak 2026 Vitamin Shoppe FBA Sevkiyatı'
  status: text("status").notNull().default("HAZIRLANIYOR"), // 'HAZIRLANIYOR' | 'DEPODA' | 'SAYILDI' | 'AMAZONA_GONDERILDI'
  totalItemsCount: integer("total_items_count").notNull().default(0),
  totalUnitsCount: integer("total_units_count").notNull().default(0),
  receivedUnitsCount: integer("received_units_count").notNull().default(0),
  missingUnitsCount: integer("missing_units_count").notNull().default(0),
  defectiveUnitsCount: integer("defective_units_count").notNull().default(0),
  inventoryLabSynced: boolean("inventory_lab_synced").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 8. Audit Log (Değiştirilemez Denetim İzi & AI Kanıt Zinciri)
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorName: text("actor_name").notNull(),
  storeCode: text("store_code").notNull().default("HRN"),
  actionType: text("action_type").notNull(), // 'DECISION_APPROVED' | 'ORDER_CREATED' | 'XLS_BATCH_IMPORT' | 'STORE_CREATED'
  targetEntity: text("target_entity").notNull(),
  beforeState: text("before_state"),
  afterState: text("after_state"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Researcher = typeof researchers.$inferSelect;
export type ResearchSession = typeof researchSessions.$inferSelect;
export type ProductMaster = typeof productMasters.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type PshBatch = typeof pshBatches.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type SupplierOffer = typeof supplierOffers.$inferSelect;
export type NewSupplierOffer = typeof supplierOffers.$inferInsert;
export type ProductLifecycleEvent = typeof productLifecycleEvents.$inferSelect;

// ============================================================================
// AŞAMA 5 — ARİTRAJ CRAWLER + KEEPA KARAR ZEKÂSI (2026-09-08)
// Mevcut kilit şema BOZULMAZ; bu tablolar ek genişletmedir.
// ============================================================================

/**
 * 12. SCRAPE_JOBS — Kaynak site tarama oturumu
 */
export const scrapeJobs = pgTable("scrape_jobs", {
  id: serial("id").primaryKey(),
  sourceUrl: text("source_url").notNull(),
  sourceDomain: text("source_domain").notNull(),
  storeCode: text("store_code").notNull().default("HRN"),
  status: text("status").notNull().default("PENDING"),
  productCount: integer("product_count").notNull().default(0),
  error: text("error"),
  createdBy: text("created_by").notNull().default("SYSTEM"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("scrape_jobs_domain_idx").on(t.sourceDomain),
  index("scrape_jobs_store_idx").on(t.storeCode),
  check("scrape_jobs_status_enum", sql`${t.status} in ('PENDING','DONE','FAILED')`),
]);

/**
 * 13. SCRAPED_PRODUCTS — Ham keşif havuzu
 */
export const scrapedProducts = pgTable("scraped_products", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => scrapeJobs.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  sourceDomain: text("source_domain").notNull(),
  title: text("title").notNull(),
  brand: text("brand").notNull().default("BILINMIYOR"),
  price: numeric("price", { precision: 10, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  imageUrl: text("image_url"),
  availability: text("availability").notNull().default("UNKNOWN"),
  asinCandidate: text("asin_candidate"),
  status: text("status").notNull().default("PENDING"),
  discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
}, (t) => [
  index("scraped_products_job_idx").on(t.jobId),
  index("scraped_products_domain_idx").on(t.sourceDomain),
  index("scraped_products_status_idx").on(t.status),
  check("scraped_products_availability_enum", sql`${t.availability} in ('IN_STOCK','OUT_OF_STOCK','UNKNOWN')`),
  check("scraped_products_status_enum", sql`${t.status} in ('PENDING','IMPORTED','REJECTED')`),
]);

/**
 * 14. KEEPA_CACHE — Keepa API kotasını koruyan önbellek
 */
export const keepaCache = pgTable("keepa_cache", {
  id: serial("id").primaryKey(),
  asin: text("asin").notNull(),
  domain: integer("domain").notNull().default(1),
  data: jsonb("data").notNull().default({}),
  salesRank: integer("sales_rank"),
  amazonPrice: numeric("amazon_price", { precision: 10, scale: 2 }),
  buyBoxPrice: numeric("buy_box_price", { precision: 10, scale: 2 }),
  offerCount: integer("offer_count"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  uniqueIndex("keepa_cache_asin_domain_uq").on(t.asin, t.domain),
  index("keepa_cache_expires_idx").on(t.expiresAt),
  index("keepa_cache_sales_rank_idx").on(t.salesRank),
]);

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type ScrapedProduct = typeof scrapedProducts.$inferSelect;
export type KeepaCache = typeof keepaCache.$inferSelect;

// ============================================================================
// AŞAMA 6 — KULLANICI AYARLARI (ROI EŞİKLERİ + KEEPA + GENEL)
// Tek satırlık key-value store — ağır ayar tablosu değil, esnek.
// ============================================================================
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;
