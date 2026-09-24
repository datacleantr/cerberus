/**
 * T8.3 — Paylaşılan görünüm tipleri.
 * Önceki sürümde tüm UI state'i `any[]` idi; alan adı yanlış yazıldığında
 * derleyici uyarmıyor, ekranda sessizce `undefined` görünüyordu.
 */

export type Role = "ADMIN" | "MANAGER" | "STORE_USER";

export interface SessionUserView {
  id: number;
  name: string;
  email: string;
  role: Role;
  storeCode: string;
  avatar?: string | null;
}

export interface StoreView {
  id: number;
  storeCode: string;
  storeName: string;
  marketplace: string;
  status: string;
  accountHealthScore: number;
  /** NULL = eşik tanımlı değil, hiçbir sipariş onay beklemez (bkz. domain/purchaseApproval.ts) */
  purchaseApprovalThreshold?: string | null;
}

export interface OrderView {
  id: number;
  buyerStore: string;
  orderDate: string;
  imageUrl?: string | null;
  fulfillmentType: string;
  productTitle: string;
  asin: string;
  msku: string;
  supplierName: string;
  supplierCode?: string | null;
  supplierUrl: string;
  amazonUrl: string;
  orderNumber: string;
  driveLink?: string | null;
  packCount: number;
  quantity: number;
  unitCost: string;
  sellingPrice: string;
  totalCost: string;
  orderEmail: string;
  cargoStatus: string;
  shippedToAmazon: number;
  p1CancelQty: number;
  p2MissingQty: number;
  p3DefectiveQty: number;
  p4ExpiredQty: number;
  problemAction?: string | null;
  problemResult?: string | null;
  refundAmount: string;
  creditCard?: string | null;
  isFragile: string;
  isMultiPack: string;
  isBundle: string;
  countPerBundle?: number | null;
  condition: string;
  brandName: string;
  description1?: string | null;
  description2?: string | null;
  auditNote?: string | null;
  periodCode?: string | null;
  correctedCost: string;
  pshBatchNo?: string | null;
  pshStatus: string;
  inventoryLabStatus: string;
  /** 'AUTO_APPROVED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' */
  approvalStatus?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface BatchView {
  id: number;
  batchNumber: string;
  storeCode: string;
  title: string;
  status: string;
  notes?: string | null;
  inventoryLabSynced: boolean;
}

export interface ProductMasterView {
  id: number;
  productCode: string;
  title: string;
  brand: string;
  asin: string;
  upc: string;
  researcherName: string;
  dataFreshnessStatus: string;
  dataQualityStatus: string;
  landedCost: string;
  sellingPrice: string;
  roiPercent: string;
  /** Gerçekleşen ROI. null = henüz ölçülecek satış yok (uydurulmaz). */
  actualRoiPercent?: string | null;
  opportunityScore: number;
  decisionAction: string;
  confidenceScore: number;

  /** Gerçekleşen ROI'nin ham dökümü — sunucuda siparişlerden hesaplanır */
  realizedRoi?: {
    realizedRoiPercent: number | null;
    realizedUnits: number;
    realizedRevenue: number;
    realizedCost: number;
    realizedNetProfit: number;
    lostUnits: number;
    totalRefunds: number;
    sampleSize: number;
    reason?: "NO_ORDERS" | "NOTHING_SHIPPED" | "ZERO_COST";
  } | null;

  /** Tahmin ile gerçekleşen arasındaki sapma */
  roiVariance?: {
    variancePoints: number | null;
    status: "ON_TARGET" | "OPTIMISTIC" | "PESSIMISTIC" | "UNMEASURED";
  } | null;

  /** Fırsat skorunun yüzde kaçı gerçek ölçüme dayanıyor (0-100) */
  evidenceCoverage?: number;
  /** Sabit varsayıma dayanan eksenlerin adları */
  assumedAxes?: string[];

  /** observedAt'ten hesaplanan tazelik */
  freshness?: {
    status: "FRESH" | "AGING" | "STALE" | "EXPIRED";
    ageInDays: number;
    score: number;
    label: string;
  } | null;
}

export interface ResearcherView {
  id: number;
  code: string;
  name: string;
  specialtyDomain: string;
  discoveryVolume: number;
  /** REJECT olmayan karar oranı (0-100); kayıt yoksa null */
  approvalRate: number | null;
  /** En az bir gerçek siparişe dönüşen ürün oranı (0-100); ölçülemiyorsa null */
  purchaseConversion: number | null;
  /** Gerçekleşen ROI ortalaması; hiç ürün ölçülmediyse null */
  averageRoi: number | null;
  /** Gerçekleşen net kâr toplamı ($); hiç ürün ölçülmediyse null */
  averageNetProfit: number | null;
  /** Fire oranı (0-100); ölçülemiyorsa null */
  problemRate: number | null;
  /** Kalite-ayarlı bileşik skor (0-100); gerçek sipariş ölçümü yoksa null */
  researcherScore: number | null;
  activeListingsCount: number;
  /** researcherScore'un dayandığı ölçülmüş ürün sayısı — güven göstergesi */
  measuredProductCount: number;
  avatar?: string | null;
}

export interface BriefingItemView {
  text: string;
  metric: string;
  severity: "INFO" | "WARN" | "CRITICAL";
}

export interface HealthBreakdownView {
  axis: string;
  weight: number;
  score: number;
  detail: string;
}

export interface MorningBriefingView {
  businessHealthScore: number;
  /** false ise skor anlamlı değildir; arayüz "veri bekleniyor" gösterir */
  healthMeasurable?: boolean;
  healthGrade: string;
  healthBreakdown: HealthBreakdownView[];
  whatChanged: BriefingItemView[];
  whatMatters: BriefingItemView[];
  whatShouldIDo: BriefingItemView[];
  sampleSize: number;
  generatedAt: string;
}

export type TabId =
  | "BRIEFING_DECISION"
  | "ANALYTICS"
  | "STORE_HEALTH"
  | "CRAWLER"
  | "KEEPA"
  | "PRODUCTS"
  | "RESEARCHERS"
  | "XLS_MASTER"
  | "PSH_BATCHES"
  | "WAREHOUSE"
  | "INVENTORY_LAB"
  | "PROBLEMS"
  | "ADMIN";

export interface OrderPagination {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface OrderQuery {
  page: number;
  pageSize: number;
  search: string;
  cargo: string;
  batch: string;
}

export interface OrderKpis {
  totalOrders: number;
  totalUnits: number;
  totalSpend: string;
  totalShipped: number;
  totalRevenueEst: string;
  grossNetEst: string;
  avgRoi: string;
  fulfillmentRate: number;
  problemCount: number;
  totalRefunds: string;
}

/** Bir siparişin P1–P4 / iptal / refund açısından problemli olup olmadığı — tek doğruluk kaynağı */
export function isProblemOrder(o: OrderView): boolean {
  return (
    o.cargoStatus === "İPTAL" ||
    Number(o.p1CancelQty) > 0 ||
    Number(o.p2MissingQty) > 0 ||
    Number(o.p3DefectiveQty) > 0 ||
    Number(o.p4ExpiredQty) > 0 ||
    Number(o.refundAmount) > 0
  );
}

// ---------------------------------------------------------------------------
// Aşama 2 — Ürün merkezli görünüm tipleri
// ---------------------------------------------------------------------------

export interface ProductPnlView {
  netRevenue: number;
  netCost: number;
  netProfit: number;
  roiPercent: number | null;
  lossRatePercent: number;
  fulfillmentRatePercent: number;
  refundRatePercent: number;
  reason?: string;
}

export interface PriceTrendView {
  changePercent: number | null;
  direction: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  latestPrice: number | null;
  firstPrice: number | null;
  isBuyingOpportunity: boolean;
}

export interface ProductView {
  id: number;
  asin: string;
  title: string;
  brand: string;
  imageUrl?: string | null;
  amazonUrl?: string | null;
  lifecycleStage: string;
  isActive: boolean;
  discoveredAt?: string | null;
  priceTrend: PriceTrendView;
  latestPrice: number | null;
  offerCount: number;
  supplierName: string | null;
  operations: {
    orderCount: number;
    unitsPurchased: number;
    unitsShipped: number;
    unitsLost: number;
    lastOrderDate: string | null;
  };
  pnl: ProductPnlView;
  verdict: string;
  verdictReasons: string[];
  recommendedAction: string;
  severity: string;
}

export interface ProductSummaryView {
  totalProducts: number;
  byVerdict: Record<string, number>;
  byStage: Record<string, number>;
  buyingOpportunities: number;
  totalNetProfit: number;
  productsAtLoss: number;
}

export interface LifecycleEventView {
  id: number;
  fromStage: string | null;
  fromLabel: string | null;
  toStage: string;
  toLabel: string;
  actorName: string;
  reason: string | null;
  contextSnapshot: unknown;
  occurredAt: string;
}

export interface PriceObservationView {
  id: number;
  observedAt: string;
  unitPrice: number;
  supplierName: string;
  sourceDomain: string | null;
  sourceType: string;
}

export interface ProductDetailView {
  storeScope: string;
  product: ProductView & {
    upc?: string | null;
    category?: string | null;
    stageLabel: string;
    allowedNextStages: Array<{ stage: string; label: string }>;
    isTerminal: boolean;
    packCount: number;
    updatedAt: string;
  };
  priceTrend: PriceTrendView;
  priceSeries: PriceObservationView[];
  suppliers: Array<{
    supplierName: string;
    count: number;
    min: number;
    max: number;
    last: number;
  }>;
  operations: {
    orderCount: number;
    unitsPurchased: number;
    unitsShipped: number;
    unitsLost: number;
    totalCost: number;
    grossRevenue: number;
    totalRefunds: number;
    lossBreakdown: {
      p1Cancel: number;
      p2Missing: number;
      p3Defective: number;
      p4Expired: number;
    };
  };
  pnl: ProductPnlView;
  verdict: string;
  verdictReasons: string[];
  recommendedAction: string;
  severity: string;
  orders: Array<{
    id: number;
    orderNumber: string;
    orderDate: string;
    buyerStore: string;
    supplierName: string;
    quantity: number;
    shippedToAmazon: number;
    unitCost: string;
    sellingPrice: string;
    totalCost: string;
    refundAmount: string;
    cargoStatus: string;
    pshStatus: string;
  }>;
  timeline: LifecycleEventView[];
}
