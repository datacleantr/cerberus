import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, products, supplierOffers } from "@/db/schema";
import { requireUser, isDenied, resolveStoreScope } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { computeAnalyticsKpis, buildTrend, buildStoreComparison, buildAlerts, computeProductPnlRanking } from "@/domain/analytics";
import { computePriceTrend } from "@/domain/productBackfill";
import { sql, desc, eq, and, gte } from "drizzle-orm";

/**
 * GET /api/analytics/decision-support?storeCode=&period=30d
 * Canlı analitik: KPI + trend + mağaza kıyas + fırsatlar + alarmlar
 */
export async function GET(req: Request) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const { searchParams } = new URL(req.url);
    const requestedStore = searchParams.get("storeCode") || "ALL";
    const period = (searchParams.get("period") || "30d") as "7d" | "30d" | "90d" | "all";
    const effectiveStore = resolveStoreScope(user, requestedStore);

    // Dönem filtresi — orderDate TEXT (YYYY-MM-DD) olduğu için string kıyas yeterli
    const cutoff = (() => {
      if (period === "all") return null;
      const d = new Date();
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 10);
    })();

    const conditions = [];
    if (effectiveStore !== "ALL") conditions.push(eq(orders.buyerStore, effectiveStore));
    if (cutoff) conditions.push(gte(orders.orderDate, cutoff));

    const where = conditions.length ? and(...conditions) : undefined;

    const [orderRows, offerRows, productRows] = await Promise.all([
      where ? db.select().from(orders).where(where).orderBy(desc(orders.orderDate)) : db.select().from(orders).orderBy(desc(orders.orderDate)),
      db.select().from(supplierOffers).orderBy(supplierOffers.observedAt),
      db.select().from(products).orderBy(desc(products.updatedAt)),
    ]);

    // KPI
    const kpis = computeAnalyticsKpis(orderRows.map((o) => ({
      quantity: Number(o.quantity),
      totalCost: Number(o.totalCost),
      shippedToAmazon: Number(o.shippedToAmazon),
      p1CancelQty: Number(o.p1CancelQty),
      p2MissingQty: Number(o.p2MissingQty),
      p3DefectiveQty: Number(o.p3DefectiveQty),
      p4ExpiredQty: Number(o.p4ExpiredQty),
      refundAmount: Number(o.refundAmount),
      pshBatchNo: o.pshBatchNo,
      cargoStatus: o.cargoStatus,
      sellingPrice: Number(o.sellingPrice),
      fulfillmentType: o.fulfillmentType,
    })));

    // Trend
    const trend = buildTrend(orderRows.map((o) => ({
      orderDate: o.orderDate,
      quantity: Number(o.quantity),
      totalCost: Number(o.totalCost),
      shippedToAmazon: Number(o.shippedToAmazon),
      refundAmount: Number(o.refundAmount),
      sellingPrice: Number(o.sellingPrice),
      fulfillmentType: o.fulfillmentType,
    })), period === "7d" ? "daily" : "daily");

    // Mağaza kıyas
    const storeComparison = buildStoreComparison(orderRows.map((o) => ({
      buyerStore: o.buyerStore,
      quantity: Number(o.quantity),
      totalCost: Number(o.totalCost),
      shippedToAmazon: Number(o.shippedToAmazon),
      refundAmount: Number(o.refundAmount),
      p1CancelQty: Number(o.p1CancelQty),
      p2MissingQty: Number(o.p2MissingQty),
      p3DefectiveQty: Number(o.p3DefectiveQty),
      p4ExpiredQty: Number(o.p4ExpiredQty),
      cargoStatus: o.cargoStatus,
    })));

    // Fiyat düşüş fırsatları — supplierOffers gruplandır
    const offersByProduct = new Map<number, typeof offerRows>();
    for (const o of offerRows) {
      const b = offersByProduct.get(o.productId);
      if (b) b.push(o); else offersByProduct.set(o.productId, [o]);
    }
    const productById = new Map(productRows.map((p) => [p.id, p]));
    const opportunities = Array.from(offersByProduct.entries()).map(([pid, obs]) => {
      const trend = computePriceTrend(obs.map((x) => ({ unitPrice: x.unitPrice, observedAt: x.observedAt })));
      const prod = productById.get(pid);
      return {
        productId: pid,
        asin: prod?.asin || "—",
        title: prod?.title || `Ürün #${pid}`,
        brand: prod?.brand || "—",
        firstPrice: trend.firstPrice,
        latestPrice: trend.latestPrice,
        changePercent: trend.changePercent,
        direction: trend.direction,
        isOpportunity: trend.isBuyingOpportunity,
        observationCount: trend.observationCount,
      };
    }).filter((x) => x.observationCount >= 2);

    const buyingOpportunities = opportunities.filter((o) => o.isOpportunity).sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 10);
    const topOpportunities = opportunities.sort((a, b) => (a.changePercent ?? 999) - (b.changePercent ?? 999)).slice(0, 10);

    // Alarmlar
    const alerts = buildAlerts(kpis, opportunities.map((o) => ({
      asin: o.asin, title: o.title, firstPrice: o.firstPrice, latestPrice: o.latestPrice, changePercent: o.changePercent, direction: o.direction, isOpportunity: o.isOpportunity,
    })));

    // En kârlı / en zararlı ürünler (siparişlerden) — N-3 uzantısı: Amazon
    // ücreti artık düşülüyor (bkz. src/domain/analytics.ts computeProductPnlRanking).
    const pnlRanked = computeProductPnlRanking(
      orderRows.map((o) => ({
        productId: (o as unknown as { productId: number | null }).productId,
        asin: o.asin,
        title: o.productTitle,
        quantity: Number(o.quantity),
        shippedToAmazon: Number(o.shippedToAmazon),
        totalCost: Number(o.totalCost),
        sellingPrice: Number(o.sellingPrice),
        refundAmount: Number(o.refundAmount),
        fulfillmentType: o.fulfillmentType,
        category: productById.get((o as unknown as { productId: number | null }).productId ?? -1)?.category,
      }))
    );

    const topProfitable = pnlRanked.slice(0, 5);
    const topLossmaking = pnlRanked.filter((p) => p.netProfit < 0).slice(-5).reverse();

    return NextResponse.json({
      storeScope: effectiveStore,
      period,
      generatedAt: new Date().toISOString(),
      kpis,
      trend,
      storeComparison,
      opportunities: {
        buying: buyingOpportunities,
        all: topOpportunities,
        total: opportunities.length,
        buyingCount: buyingOpportunities.length,
      },
      pnl: { topProfitable, topLossmaking, totalProductsWithOrders: pnlRanked.length },
      alerts,
      sample: { orders: orderRows.length, products: productRows.length, offers: offerRows.length },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/analytics/decision-support", error);
  }
}
