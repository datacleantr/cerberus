import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, stores } from "@/db/schema";
import { requireUser, isDenied } from "@/lib/guards";
import { handleRouteError } from "@/lib/apiResponse";
import { computeWeeklyStoreHealth } from "@/domain/storeHealth";
import { eq } from "drizzle-orm";

/**
 * GET /api/analytics/store-health
 *
 * Haftalık mağaza/hesap sağlığı — `stores.account_health_score`'un yerini
 * alan CANLI hesap (bkz. src/domain/storeHealth.ts doc yorumu). STORE_USER
 * yalnız kendi mağazasını görür; ADMIN/MANAGER tüm filoyu görür.
 */
export async function GET() {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const user = gate.user;

    const isScoped = user.role === "STORE_USER";

    const [storeRows, orderRows] = await Promise.all([
      isScoped
        ? db.select().from(stores).where(eq(stores.storeCode, user.storeCode))
        : db.select().from(stores).orderBy(stores.storeCode),
      isScoped
        ? db.select().from(orders).where(eq(orders.buyerStore, user.storeCode))
        : db.select().from(orders),
    ]);

    const identities = storeRows.map((s) => ({
      storeCode: s.storeCode,
      storeName: s.storeName,
      status: s.status,
    }));

    const orderFacts = orderRows.map((o) => ({
      buyerStore: o.buyerStore,
      orderDate: o.orderDate,
      quantity: Number(o.quantity),
      totalCost: Number(o.totalCost),
      shippedToAmazon: Number(o.shippedToAmazon),
      p1CancelQty: Number(o.p1CancelQty),
      p2MissingQty: Number(o.p2MissingQty),
      p3DefectiveQty: Number(o.p3DefectiveQty),
      p4ExpiredQty: Number(o.p4ExpiredQty),
      refundAmount: Number(o.refundAmount),
      cargoStatus: o.cargoStatus,
      sellingPrice: Number(o.sellingPrice),
    }));

    const health = computeWeeklyStoreHealth(identities, orderFacts);

    // En düşük skor / en kritik sessizlik önce — yöneticinin ilk bakacağı yer.
    const sorted = [...health].sort((a, b) => {
      const rank = (h: (typeof health)[number]) => {
        if (h.silenceAlert?.severity === "CRITICAL") return 0;
        if (h.healthScore !== null) return 1 + h.healthScore / 100;
        if (h.silenceAlert?.severity === "WARN") return 0.5;
        return 3;
      };
      return rank(a) - rank(b);
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storeScope: isScoped ? user.storeCode : "ALL",
      stores: sorted,
      summary: {
        totalStores: sorted.length,
        activeThisWeek: sorted.filter((s) => s.isActiveThisWeek).length,
        criticalSilence: sorted.filter((s) => s.silenceAlert?.severity === "CRITICAL").length,
        measured: sorted.filter((s) => s.healthScore !== null).length,
      },
    });
  } catch (error: unknown) {
    return handleRouteError("GET /api/analytics/store-health", error);
  }
}
