/**
 * Karar Destek Analitik — sipariş + ürün verisinden canlı aggregate
 * 
 * Tüm metrikler SQL'de hesaplanır gibi saf fonksiyonlarla da hesaplanabilir;
 * burada JS fallback + test edilebilir mantık var. Gerçek API route'u DB aggregate kullanır.
 */

/**
 * DENETİM BULGUSU N-3'ün doğal uzantısı (2026-09-25): bu dosyadaki
 * `grossProfit`/`netProfit` hesapları gelir - tedarikçi maliyeti idi, Amazon'un
 * kestiği referral/fulfillment ücretini hiç düşmüyordu — ama arayüzde
 * (DecisionSupportDashboard.tsx) doğrudan "Net Kâr" olarak gösteriliyordu.
 * Artık `estimateAmazonFees` (amazonFees.ts) ile aynı dürüst tahmin
 * kullanılıyor; alan adı da gerçeği yansıtsın diye `netProfit` oldu.
 */
import { estimateAmazonFees } from "./amazonFees";

export interface AnalyticsKpis {
  totalOrders: number;
  totalUnits: number;
  totalSpend: number;
  totalShipped: number;
  fulfillmentRate: number; // 0..100
  totalRefunds: number;
  refundRate: number;
  netRevenue: number;
  /** Tahmini Amazon referral+fulfillment ücreti (bkz. amazonFees.ts) — netProfit'ten zaten düşülmüştür */
  estimatedAmazonFees: number;
  netProfit: number;
  avgUnitCost: number;
  problemRate: number;
  p1: number; p2: number; p3: number; p4: number;
  unbatchedCount: number;
  inTransitCount: number;
}

export interface TrendPoint {
  period: string; // YYYY-MM-DD veya YYYY-MM
  orders: number;
  units: number;
  spend: number;
  shipped: number;
  refunds: number;
  netProfit: number;
}

export interface StoreComparison {
  storeCode: string;
  orders: number;
  units: number;
  spend: number;
  shippedRate: number;
  problemRate: number;
  refunds: number;
}

export interface BuyingOpportunity {
  asin: string;
  title: string;
  firstPrice: number | null;
  latestPrice: number | null;
  changePercent: number | null;
  direction: string;
  isOpportunity: boolean;
}

export function computeAnalyticsKpis(orders: Array<{
  quantity: number; totalCost: number; shippedToAmazon: number;
  p1CancelQty: number; p2MissingQty: number; p3DefectiveQty: number; p4ExpiredQty: number;
  refundAmount: number; pshBatchNo: string | null; cargoStatus: string; sellingPrice: number;
  fulfillmentType?: string | null;
}>): AnalyticsKpis {
  const n = orders.length;
  if (n === 0) {
    return {
      totalOrders: 0, totalUnits: 0, totalSpend: 0, totalShipped: 0, fulfillmentRate: 0,
      totalRefunds: 0, refundRate: 0, netRevenue: 0, estimatedAmazonFees: 0, netProfit: 0, avgUnitCost: 0,
      problemRate: 0, p1: 0, p2: 0, p3: 0, p4: 0, unbatchedCount: 0, inTransitCount: 0,
    };
  }
  let totalUnits = 0, totalSpend = 0, totalShipped = 0, totalRefunds = 0;
  let p1 = 0, p2 = 0, p3 = 0, p4 = 0, unbatched = 0, inTransit = 0, problemOrders = 0;
  let netRevenue = 0;
  let estimatedAmazonFees = 0;
  for (const o of orders) {
    totalUnits += Number(o.quantity) || 0;
    totalSpend += Number(o.totalCost) || 0;
    totalShipped += Number(o.shippedToAmazon) || 0;
    totalRefunds += Number(o.refundAmount) || 0;
    p1 += Number(o.p1CancelQty) || 0;
    p2 += Number(o.p2MissingQty) || 0;
    p3 += Number(o.p3DefectiveQty) || 0;
    p4 += Number(o.p4ExpiredQty) || 0;
    if (!o.pshBatchNo) unbatched++;
    if (o.cargoStatus === "Yolda" || o.cargoStatus === "Kayıp Depoya gelmiş") inTransit++;
    const isProblem = o.cargoStatus === "İPTAL" || o.p1CancelQty > 0 || o.p2MissingQty > 0 || o.p3DefectiveQty > 0 || o.p4ExpiredQty > 0 || Number(o.refundAmount) > 0;
    if (isProblem) problemOrders++;
    const shippedQty = Number(o.shippedToAmazon) || 0;
    const price = Number(o.sellingPrice) || 0;
    netRevenue += shippedQty * price;
    if (shippedQty > 0) {
      estimatedAmazonFees += shippedQty * estimateAmazonFees({ sellingPrice: price, fulfillmentType: o.fulfillmentType }).totalFeeAmount;
    }
  }
  const fulfillmentRate = totalUnits ? Number(((totalShipped / totalUnits) * 100).toFixed(1)) : 0;
  const refundRate = totalSpend ? Number(((totalRefunds / totalSpend) * 100).toFixed(2)) : 0;
  // XLS'teki refund, tedarikçinin ödeme kartına yaptığı geri ödemedir;
  // müşteri satış iadesi gibi gelirden düşülmez, maliyeti azaltır.
  const effectiveCost = Math.max(0, totalSpend - totalRefunds);
  const roundedFees = Number(estimatedAmazonFees.toFixed(2));
  const netProfit = Number((netRevenue - effectiveCost - roundedFees).toFixed(2));
  const problemRate = n ? Number(((problemOrders / n) * 100).toFixed(1)) : 0;
  const avgUnitCost = totalUnits ? Number((totalSpend / totalUnits).toFixed(2)) : 0;
  return {
    totalOrders: n, totalUnits, totalSpend: Number(totalSpend.toFixed(2)), totalShipped, fulfillmentRate,
    totalRefunds: Number(totalRefunds.toFixed(2)), refundRate, netRevenue: Number(netRevenue.toFixed(2)),
    estimatedAmazonFees: roundedFees, netProfit, avgUnitCost, problemRate, p1, p2, p3, p4, unbatchedCount: unbatched, inTransitCount: inTransit,
  };
}

export function buildTrend(orders: Array<{ orderDate: string; quantity: number; totalCost: number; shippedToAmazon: number; refundAmount: number; sellingPrice: number; fulfillmentType?: string | null }>, period: "daily" | "weekly" = "daily"): TrendPoint[] {
  const bucket = new Map<string, TrendPoint>();
  for (const o of orders) {
    const d = o.orderDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const key = period === "weekly" ? d.slice(0, 7) + "-W" + String(Math.ceil(Number(d.slice(8, 10)) / 7)) : d;
    const b = bucket.get(key) || { period: key, orders: 0, units: 0, spend: 0, shipped: 0, refunds: 0, netProfit: 0 };
    b.orders += 1;
    b.units += Number(o.quantity) || 0;
    b.spend += Number(o.totalCost) || 0;
    const shippedQty = Number(o.shippedToAmazon) || 0;
    const price = Number(o.sellingPrice) || 0;
    b.shipped += shippedQty;
    b.refunds += Number(o.refundAmount) || 0;
    // N-3 uzantısı: Amazon'un kestiği pay artık düşülüyor (bkz. dosya başı yorum)
    const amazonFee = shippedQty > 0 ? shippedQty * estimateAmazonFees({ sellingPrice: price, fulfillmentType: o.fulfillmentType }).totalFeeAmount : 0;
    b.netProfit +=
      shippedQty * price -
      (Number(o.totalCost) || 0) +
      (Number(o.refundAmount) || 0) -
      amazonFee;
    bucket.set(key, b);
  }
  return Array.from(bucket.values()).sort((a, b) => a.period.localeCompare(b.period)).slice(-30);
}

export function buildStoreComparison(orders: Array<{ buyerStore: string; quantity: number; totalCost: number; shippedToAmazon: number; refundAmount: number; p1CancelQty: number; p2MissingQty: number; p3DefectiveQty: number; p4ExpiredQty: number; cargoStatus: string }>): StoreComparison[] {
  const m = new Map<string, { orders: number; units: number; spend: number; shipped: number; refunds: number; problems: number }>();
  for (const o of orders) {
    const k = o.buyerStore || "HRN";
    const b = m.get(k) || { orders: 0, units: 0, spend: 0, shipped: 0, refunds: 0, problems: 0 };
    b.orders += 1;
    b.units += Number(o.quantity) || 0;
    b.spend += Number(o.totalCost) || 0;
    b.shipped += Number(o.shippedToAmazon) || 0;
    b.refunds += Number(o.refundAmount) || 0;
    const isProblem = o.cargoStatus === "İPTAL" || o.p1CancelQty > 0 || o.p2MissingQty > 0 || o.p3DefectiveQty > 0 || o.p4ExpiredQty > 0 || Number(o.refundAmount) > 0;
    if (isProblem) b.problems++;
    m.set(k, b);
  }
  return Array.from(m.entries()).map(([storeCode, v]) => ({
    storeCode,
    orders: v.orders,
    units: v.units,
    spend: Number(v.spend.toFixed(2)),
    shippedRate: v.units ? Number(((v.shipped / v.units) * 100).toFixed(1)) : 0,
    problemRate: v.orders ? Number(((v.problems / v.orders) * 100).toFixed(1)) : 0,
    refunds: Number(v.refunds.toFixed(2)),
  })).sort((a, b) => b.spend - a.spend);
}

export interface ProductPnlItem {
  productId: number;
  asin: string;
  title: string;
  units: number;
  shipped: number;
  cost: number;
  revenue: number;
  refunds: number;
  estimatedAmazonFees: number;
  netProfit: number;
  roi: number | null;
  fulfillmentRate: number;
}

/**
 * Ürün bazlı en kârlı/en zararlı sıralaması. Önceden `decision-support`
 * route'una gömülüydü ve Amazon ücretini hiç düşmüyordu (N-3 uzantısı) —
 * artık paylaşılan, test edilebilir bir fonksiyon ve `estimateAmazonFees`
 * kullanıyor.
 */
export function computeProductPnlRanking(
  rows: Array<{
    productId: number | null | undefined;
    asin: string;
    title: string;
    quantity: number;
    shippedToAmazon: number;
    totalCost: number;
    sellingPrice: number;
    refundAmount: number;
    fulfillmentType?: string | null;
    category?: string | null;
  }>
): ProductPnlItem[] {
  const byProduct = new Map<
    number,
    { asin: string; title: string; units: number; shipped: number; cost: number; revenue: number; refunds: number; fees: number }
  >();

  for (const r of rows) {
    const pid = r.productId;
    if (!pid) continue;
    const b = byProduct.get(pid) || { asin: r.asin, title: r.title, units: 0, shipped: 0, cost: 0, revenue: 0, refunds: 0, fees: 0 };
    const shippedQty = Number(r.shippedToAmazon) || 0;
    const price = Number(r.sellingPrice) || 0;
    b.units += Number(r.quantity) || 0;
    b.shipped += shippedQty;
    b.cost += Number(r.totalCost) || 0;
    b.revenue += shippedQty * price;
    b.refunds += Number(r.refundAmount) || 0;
    if (shippedQty > 0) {
      b.fees += shippedQty * estimateAmazonFees({ sellingPrice: price, category: r.category, fulfillmentType: r.fulfillmentType }).totalFeeAmount;
    }
    byProduct.set(pid, b);
  }

  return Array.from(byProduct.entries())
    .map(([productId, p]) => {
      const effectiveCost = Math.max(0, p.cost - p.refunds);
      const fees = Number(p.fees.toFixed(2));
      const netProfit = Number((p.revenue - effectiveCost - fees).toFixed(2));
      const costBasis = effectiveCost + fees;
      return {
        productId,
        asin: p.asin,
        title: p.title,
        units: p.units,
        shipped: p.shipped,
        cost: Number(p.cost.toFixed(2)),
        revenue: Number(p.revenue.toFixed(2)),
        refunds: Number(p.refunds.toFixed(2)),
        estimatedAmazonFees: fees,
        netProfit,
        roi: costBasis > 0 ? Number(((netProfit / costBasis) * 100).toFixed(1)) : null,
        fulfillmentRate: p.units ? Number(((p.shipped / p.units) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit);
}

export interface AlertItem {
  severity: "CRITICAL" | "WARN" | "INFO";
  text: string;
  metric: string;
}

export function buildAlerts(kpis: AnalyticsKpis, opportunities: BuyingOpportunity[]): AlertItem[] {
  const alerts: AlertItem[] = [];
  if (kpis.problemRate > 20) alerts.push({ severity: "CRITICAL", text: `Problem oranı %${kpis.problemRate} — yangın var, P1-P4 kapatılmalı`, metric: "problemRate" });
  else if (kpis.problemRate > 10) alerts.push({ severity: "WARN", text: `Problem oranı %${kpis.problemRate} — izlemede`, metric: "problemRate" });
  if (kpis.fulfillmentRate < 60) alerts.push({ severity: "CRITICAL", text: `FBA sevk oranı %${kpis.fulfillmentRate} — ürünler depoda bekliyor`, metric: "fulfillmentRate" });
  else if (kpis.fulfillmentRate < 85) alerts.push({ severity: "WARN", text: `Sevk oranı %${kpis.fulfillmentRate} — partileme yavaş`, metric: "fulfillmentRate" });
  if (kpis.refundRate > 5) alerts.push({ severity: "CRITICAL", text: `Tedarikçi iade oranı %${kpis.refundRate} — fire/iptal kök nedenini inceleyin`, metric: "refundRate" });
  if (kpis.unbatchedCount > 5) alerts.push({ severity: "WARN", text: `${kpis.unbatchedCount} sipariş batch'siz — PSH partisi açın`, metric: "unbatched" });
  if (kpis.netProfit < 0) alerts.push({ severity: "CRITICAL", text: `Net zarar $${Math.abs(kpis.netProfit)} — marjlar gözden geçirilmeli`, metric: "netProfit" });
  const opps = opportunities.filter((o) => o.isOpportunity).length;
  if (opps) alerts.push({ severity: "INFO", text: `${opps} üründe fiyat düşüş fırsatı — Keepa/Crawler ile teyit edin`, metric: "buyingOpportunity" });
  if (alerts.length === 0) alerts.push({ severity: "INFO", text: "Kritik risk yok — karar kasası temiz", metric: "—" });
  return alerts;
}
