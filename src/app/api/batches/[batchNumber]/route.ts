import { NextResponse } from "next/server";
import { db } from "@/db";
import { pshBatches, orders, auditLogs } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { requireUser, isDenied, canAccessStore } from "@/lib/guards";
import { parseBody, batchUpdateSchema } from "@/lib/validation";
import { handleRouteError } from "@/lib/apiResponse";

/**
 * Inventory Lab / PrepShip köprüsü — Adım 1 (denetim raporu §13).
 *
 * Önce: `psh_batches.status/receivedUnitsCount/missingUnitsCount/
 * defectiveUnitsCount/inventoryLabSynced` alanları vardı ama hiçbir API
 * bunlara hiçbir zaman yazmıyordu — panelde görülen "AMAZONA_GONDERILDI"
 * rozeti ölü kod yoluydu, sayaçlar hep sıfırdı.
 *
 * Şimdi: bu endpoint batch durumunu gerçek sipariş verisinden yeniden
 * hesaplayıp yazıyor ve "Amazona Sevk" geçişinde batch'teki siparişleri
 * toplu olarak AMAZONA_SEVK'e taşıyor. Depo tek tek elle giriş yapmaya
 * devam ediyor (WarehouseReconciliationModal) ama artık batch bunu takip
 * edip kapatabiliyor.
 */
export async function PATCH(
  req: Request,
  context: { params: Promise<{ batchNumber: string }> }
) {
  try {
    const gate = await requireUser();
    if (isDenied(gate)) return gate.response;
    const currentUser = gate.user;

    const { batchNumber } = await context.params;

    const parsed = await parseBody(req, batchUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const { status: nextStatus, notes } = parsed.data;

    const existingBatch = await db
      .select()
      .from(pshBatches)
      .where(eq(pshBatches.batchNumber, batchNumber))
      .limit(1);

    if (!existingBatch.length) {
      return NextResponse.json({ error: "PSH batch bulunamadı." }, { status: 404 });
    }
    const batch = existingBatch[0];

    if (!canAccessStore(currentUser, batch.storeCode)) {
      return NextResponse.json(
        { error: "Bu batch sizin mağaza kapsamınızda değil." },
        { status: 403 }
      );
    }

    const result = await db.transaction(async (tx) => {
      const batchOrders = await tx
        .select()
        .from(orders)
        .where(eq(orders.pshBatchNo, batchNumber));

      // Batch sayaçları her zaman siparişlerden yeniden hesaplanır — elle
      // senkron tutulmaya çalışılmaz, tek doğruluk kaynağı `orders` kalır.
      const totalItemsCount = batchOrders.length;
      const totalUnitsCount = batchOrders.reduce((s, o) => s + Number(o.quantity || 0), 0);
      const missingUnitsCount = batchOrders.reduce((s, o) => s + Number(o.p2MissingQty || 0), 0);
      const defectiveUnitsCount = batchOrders.reduce((s, o) => s + Number(o.p3DefectiveQty || 0), 0);
      const receivedUnitsCount = batchOrders.reduce(
        (s, o) => s + Math.max(0, Number(o.quantity || 0) - Number(o.p2MissingQty || 0)),
        0
      );

      const [updatedBatch] = await tx
        .update(pshBatches)
        .set({
          status: nextStatus,
          totalItemsCount,
          totalUnitsCount,
          receivedUnitsCount,
          missingUnitsCount,
          defectiveUnitsCount,
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(pshBatches.batchNumber, batchNumber))
        .returning();

      // "Amazona Sevk" geçişi: fiilen sevk edilmiş (shippedToAmazon > 0)
      // siparişler toplu olarak AMAZONA_SEVK'e taşınır. Tamamen eksik/kayıp
      // gelen (shippedToAmazon = 0) siparişler elle çözülmeyi bekler —
      // batch'i kapatmak onları sessizce "sevk edildi" gibi göstermez.
      let shippedOrderCount = 0;
      if (nextStatus === "AMAZONA_GONDERILDI") {
        const shipped = await tx
          .update(orders)
          .set({ pshStatus: "AMAZONA_SEVK", updatedAt: new Date() })
          .where(and(eq(orders.pshBatchNo, batchNumber), gt(orders.shippedToAmazon, 0)))
          .returning({ id: orders.id });
        shippedOrderCount = shipped.length;
      }

      await tx.insert(auditLogs).values({
        actorName: currentUser.name,
        storeCode: batch.storeCode,
        actionType: "PSH_BATCH_STATUS_CHANGED",
        targetEntity: batchNumber,
        beforeState: batch.status,
        afterState: nextStatus,
        details: `${totalItemsCount} sipariş / ${totalUnitsCount} adet — alınan ${receivedUnitsCount}, eksik ${missingUnitsCount}, defolu ${defectiveUnitsCount}${
          nextStatus === "AMAZONA_GONDERILDI" ? `; ${shippedOrderCount} sipariş AMAZONA_SEVK'e taşındı` : ""
        }.`,
      });

      return { updatedBatch, shippedOrderCount };
    });

    return NextResponse.json({
      message: "PSH batch durumu güncellendi",
      batch: result.updatedBatch,
      shippedOrderCount: result.shippedOrderCount,
    });
  } catch (error: unknown) {
    return handleRouteError("PATCH /api/batches/[batchNumber]", error);
  }
}
